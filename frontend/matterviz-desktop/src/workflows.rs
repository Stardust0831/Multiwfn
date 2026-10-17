//! Independent BaneWfn workbench: run workflows in isolated engine processes.
use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_SCRIPT: u64 = 512 * 1024;
const MAX_LIBRARY_BYTES: u64 = 64 * 1024 * 1024;
const MAX_LOG: u64 = 64 * 1024;
static RUN_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
pub(crate) struct Job {
    pub(crate) directory: PathBuf,
    pub(crate) state: &'static str,
    pub(crate) code: Option<i32>,
    pub(crate) message: String,
    pub(crate) cancel: Arc<AtomicBool>,
}

struct State {
    library: Option<PathBuf>,
    selected_script: Option<String>,
    results: Option<PathBuf>,
    results_selected: bool,
    wavefunction: Option<PathBuf>,
    job: Option<Job>,
}

pub struct WorkflowManager {
    runner: Option<PathBuf>,
    conf: PathBuf,
    multiwfn: Option<PathBuf>,
    state: Arc<Mutex<State>>,
    worker: Mutex<Option<JoinHandle<()>>>,
    stopped: AtomicBool,
}

impl WorkflowManager {
    pub fn inspect(&self, request: &Value) -> Result<Value, String> {
        let state = self.state.lock().map_err(|e| e.to_string())?;
        let id = request["script"]
            .as_str()
            .ok_or("Select a workflow script")?;
        let script = script_path(state.library.as_deref(), id)?;
        read_script(&script)?;
        drop(state);
        self.inspect_path(&script, request)
    }
    fn inspect_path(&self, script: &Path, request: &Value) -> Result<Value, String> {
        let default_wavefunction = self
            .state
            .lock()
            .map_err(|e| e.to_string())?
            .wavefunction
            .clone();
        let wavefunction = request["wavefunction"]
            .as_str()
            .map(PathBuf::from)
            .or(default_wavefunction);
        if let Some(path) = &wavefunction {
            validate_path(path)?;
        }
        let runner = self
            .runner
            .as_ref()
            .ok_or("Workflow runner is not installed")?;
        let directory = std::env::temp_dir().join(format!(
            "banewfn-inspect-{}-{}",
            std::process::id(),
            RUN_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&directory).map_err(|e| e.to_string())?;
        struct Scratch(PathBuf);
        impl Drop for Scratch {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let _scratch = Scratch(directory.clone());
        let conf = directory.join("conf");
        fs::create_dir(&conf).map_err(|e| e.to_string())?;
        copy_conf(&self.conf, &conf)?;
        let source = script.parent().ok_or("Invalid script folder")?;
        copy_conf(source, &conf)?;
        copy_conf(&source.join("conf"), &conf)?;
        let parameters = request.get("parameters").cloned().unwrap_or(json!({}));
        let path = directory.join("parameters.json");
        fs::write(
            &path,
            serde_json::to_vec(&parameters).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let mut command = Command::new(runner);
        command
            .arg("--inspect-json")
            .arg(runner_path(script))
            .arg("--conf-dir")
            .arg(runner_path(&conf))
            .arg("--parameters-json")
            .arg(runner_path(&path))
            .current_dir(&directory)
            .stdin(Stdio::null());
        if let Some(wfn) = &wavefunction {
            command.arg("--wfn").arg(runner_path(wfn));
        }
        if let Some(vars) = request["variables"].as_array() {
            for v in vars {
                command
                    .arg("--var")
                    .arg(v.as_str().ok_or("Invalid variable")?);
            }
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let output = command.output().map_err(|e| e.to_string())?;
        let value: Value = serde_json::from_slice(&output.stdout).map_err(|e| {
            format!(
                "Cannot inspect script: {e}: {}",
                String::from_utf8_lossy(&output.stderr)
            )
        })?;
        if !output.status.success() || value.get("error").is_some() {
            return Err(value["error"]
                .as_str()
                .unwrap_or("Script inspection failed")
                .to_owned());
        }
        Ok(value)
    }
    pub fn builder_catalog(&self) -> Result<Value, String> {
        crate::workflow_builder::catalog(&self.conf)
    }
    pub fn builder_preview(&self, draft: &Value) -> Result<Value, String> {
        let compiled = crate::workflow_builder::compile(&self.conf, draft)?;
        let directory = std::env::temp_dir().join(format!(
            "banewfn-builder-{}-{}",
            std::process::id(),
            RUN_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&directory).map_err(|e| e.to_string())?;
        struct Scratch(PathBuf);
        impl Drop for Scratch {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let _scratch = Scratch(directory.clone());
        let script = directory.join("workflow.bwc");
        fs::write(&script, &compiled.source).map_err(|e| e.to_string())?;
        let inspection = self.inspect_path(&script, &json!({}))?;
        let mut parameters = serde_json::Map::new();
        for id in &compiled.parameter_ids {
            let field = inspection["fields"]
                .as_array()
                .and_then(|fields| fields.iter().find(|field| field["id"] == *id))
                .ok_or("Unknown conf parameter")?;
            parameters.insert(id.clone(), field["value"].clone());
        }
        // Validate typed/select overrides using the driver's resolved values.
        if !parameters.is_empty() {
            self.inspect_path(&script, &json!({"parameters": parameters}))?;
        }
        Ok(json!({"source": compiled.source, "inspection": inspection}))
    }
    pub fn save_built_script(&self, path: &Path, draft: &Value) -> Result<Value, String> {
        if self
            .state
            .lock()
            .map_err(|e| e.to_string())?
            .job
            .as_ref()
            .is_some_and(active)
        {
            return Err("A workflow is still running".into());
        }
        validate_path(path)?;
        if path
            .extension()
            .and_then(|s| s.to_str())
            .is_none_or(|s| !s.eq_ignore_ascii_case("bwc"))
        {
            return Err("Save the generated script with a .bwc extension".into());
        }
        let preview = self.builder_preview(draft)?;
        fs::write(
            path,
            preview["source"]
                .as_str()
                .ok_or("Invalid generated script")?,
        )
        .map_err(|e| e.to_string())?;
        self.select("script", path)?;
        Ok(json!({"saved": true, "status": self.status()}))
    }
    pub fn standalone(engine: PathBuf, startup_file: Option<&Path>) -> Self {
        let executable = std::env::current_exe().unwrap_or_default();
        let tools = executable.parent().unwrap_or(Path::new("."));
        let resources = tools.parent().unwrap_or(tools);
        let runner = configured_path("MULTIWFN_WORKFLOW_RUNNER")
            .filter(|p| p.is_file())
            .or_else(|| existing_file(tools.join(executable_name("multiwfn-workflow"))));
        let resource_dir = runner
            .as_ref()
            .and_then(|p| p.parent())
            .unwrap_or(tools)
            .parent()
            .unwrap_or(resources)
            .join("workflows");
        let library = configured_path("MULTIWFN_WORKFLOW_LIBRARY")
            .or_else(|| resource_dir.join("scripts").canonicalize().ok());
        let conf =
            configured_path("MULTIWFN_WORKFLOW_CONF").unwrap_or_else(|| resource_dir.join("conf"));
        let manager = Self::with_paths(
            runner,
            conf,
            library,
            engine.canonicalize().ok().filter(|p| p.is_file()),
        );
        if let Some(path) = startup_file {
            let _ = manager.select("wavefunction", path);
        }
        manager
    }

    pub(crate) fn with_paths(
        runner: Option<PathBuf>,
        conf: PathBuf,
        library: Option<PathBuf>,
        multiwfn: Option<PathBuf>,
    ) -> Self {
        Self {
            runner,
            conf,
            multiwfn,
            state: Arc::new(Mutex::new(State {
                library,
                selected_script: None,
                results: None,
                results_selected: false,
                wavefunction: None,
                job: None,
            })),
            worker: Mutex::new(None),
            stopped: AtomicBool::new(false),
        }
    }

    pub fn select(&self, kind: &str, path: &Path) -> Result<(), String> {
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        validate_path(&path)?;
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        if state.job.as_ref().is_some_and(active) {
            return Err("A workflow is still running".into());
        }
        match kind {
            "library" if path.is_dir() => {
                state.library = Some(path);
                state.selected_script = None;
            }
            "script" if path.is_file() && crate::workbench_args::is_script(&path) => {
                read_script(&path)?;
                let parent = path.parent().ok_or("Invalid script folder")?;
                let id = if let Some(root) =
                    state.library.as_ref().filter(|root| path.starts_with(root))
                {
                    path.strip_prefix(root).map_err(|error| error.to_string())?
                } else {
                    state.library = Some(parent.to_owned());
                    path.file_name()
                        .map(Path::new)
                        .ok_or("Invalid script name")?
                };
                state.selected_script = Some(id.to_string_lossy().replace('\\', "/"));
            }
            "results" if path.is_dir() => {
                state.results = Some(path);
                state.results_selected = true;
            }
            "wavefunction" if path.is_file() => {
                if !state.results_selected {
                    let results = default_results(&path)?;
                    validate_path(&results)?;
                    state.results = Some(results);
                }
                state.wavefunction = Some(path);
            }
            _ => return Err("Invalid workflow selection".into()),
        }
        Ok(())
    }

    pub fn status(&self) -> Value {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let mut scripts = Vec::new();
        let mut catalog_error = None;
        if let Some(id) = &state.selected_script {
            scripts.push(json!({"id":id, "name":Path::new(id).file_name().unwrap_or_default().to_string_lossy()}));
        } else if let Some(root) = &state.library {
            if let Err(error) = scan_scripts(root, root, 0, &mut scripts) {
                catalog_error = Some(error);
            }
        }
        scripts.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
        let job = state.job.as_ref().map(job_value);
        json!({"format":"multiwfn-workflows", "version":1, "available":self.runner.is_some(),
            "runner":self.runner, "library":state.library, "results":state.results,
            "wavefunction":state.wavefunction, "multiwfn":self.multiwfn,
            "scripts":scripts, "selectedScript":state.selected_script, "catalogError":catalog_error, "job":job})
    }

    pub fn open_result(&self, request: &Value, frontend: &Path) -> Result<Value, String> {
        let state = self.state.lock().map_err(|e| e.to_string())?;
        let job = state.job.as_ref().ok_or("No workflow results")?;
        Self::open_job_result(job, request, frontend)
    }

    pub(crate) fn open_job_result(
        job: &Job,
        request: &Value,
        frontend: &Path,
    ) -> Result<Value, String> {
        if request["directory"] != json!(job.directory) {
            return Err("The displayed workflow has changed; refresh its results".into());
        }
        if active(job) || job.state == "prepared" {
            return Err("Wait for workflow execution to finish".into());
        }
        let plan = crate::workflow_results::plan(&job.directory, request)?;
        crate::workflow_results::launch(&plan, frontend)
    }

    // Opening a document/folder is allowed during a run, independently of the
    // render action. Only the currently displayed job's catalogue is accepted.
    fn result_path(&self, request: &Value) -> Result<PathBuf, String> {
        let state = self.state.lock().map_err(|e| e.to_string())?;
        let job = state.job.as_ref().ok_or("No workflow results")?;
        Self::job_result_path(job, request)
    }
    pub(crate) fn job_result_path(job: &Job, request: &Value) -> Result<PathBuf, String> {
        if request["directory"] != json!(job.directory) {
            return Err("The displayed workflow has changed; refresh its results".into());
        }
        let root = job.directory.canonicalize().map_err(|e| e.to_string())?;
        if !root.is_dir() {
            return Err("No workflow results".into());
        }
        let Some(file) = request.get("file") else {
            return Ok(root);
        };
        let file = file.as_str().ok_or("Invalid result file")?;
        if !crate::workflow_results::files(&root)
            .iter()
            .any(|name| name == file)
        {
            return Err("Result file is no longer available".into());
        }
        let path = root.join(file).canonicalize().map_err(|e| e.to_string())?;
        if !path.starts_with(&root) || !path.is_file() {
            return Err("Invalid result file".into());
        }
        Ok(path)
    }

    pub fn open_path(&self, request: &Value) -> Result<Value, String> {
        let path = self.result_path(request)?;
        open_in_default_app(&path)?;
        Ok(json!({"opened":true}))
    }

    pub fn preview(&self, id: &str) -> Result<Value, String> {
        let state = self.state.lock().map_err(|e| e.to_string())?;
        let path = script_path(state.library.as_deref(), id)?;
        let source = read_script(&path)?;
        Ok(json!({"id":id, "source":source}))
    }

    pub fn start(&self, request: &Value) -> Result<(), String> {
        self.start_at(request, None)
    }
    pub(crate) fn start_at(&self, request: &Value, output: Option<&Path>) -> Result<(), String> {
        if request.get("parameters").is_some() {
            let inspection = self.inspect(request)?;
            if inspection["runnable"] != true {
                return Err(inspection["diagnostics"].to_string());
            }
        }
        let mut worker = self.worker.lock().map_err(|e| e.to_string())?;
        if self.stopped.load(Ordering::Acquire) {
            return Err("Workflow host is closing".into());
        }
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        if state.job.as_ref().is_some_and(active) {
            return Err("A workflow is still running".into());
        }
        if let Some(previous) = worker.take() {
            let _ = previous.join();
        }
        let runner = self
            .runner
            .as_ref()
            .ok_or("Workflow runner is not installed")?;
        let id = request
            .get("script")
            .and_then(Value::as_str)
            .ok_or("Select a workflow script")?;
        let script = script_path(state.library.as_deref(), id)?;
        read_script(&script)?;
        let cores = request
            .get("cores")
            .and_then(Value::as_u64)
            .filter(|n| *n > 0 && *n <= 1024)
            .ok_or("Cores must be an integer from 1 to 1024")?;
        let dry_run = request
            .get("dryRun")
            .and_then(Value::as_bool)
            .ok_or("Invalid dry-run flag")?;
        let variables = request
            .get("variables")
            .and_then(Value::as_array)
            .ok_or("Invalid variables")?;
        if variables.len() > 64 {
            return Err("Too many workflow variables".into());
        }
        let variables = variables
            .iter()
            .map(|v| {
                let text = v.as_str().ok_or("Invalid workflow variable")?;
                if text.len() > 4096 || !text.contains('=') || text.contains(['\0', '\r', '\n']) {
                    return Err("Variables must use key=value, one per line");
                }
                Ok(text.to_owned())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let results = state.results.as_ref().ok_or("Choose a results folder")?;
        let source_dir = script.parent().ok_or("Invalid script folder")?;
        let multiwfn = self
            .multiwfn
            .as_ref()
            .ok_or("The bundled Multiwfn executable could not be located.")?;
        fs::create_dir_all(results).map_err(|e| e.to_string())?;
        let results = results.canonicalize().map_err(|e| e.to_string())?;
        validate_path(&results)?;
        if results == source_dir {
            return Err("The results folder must differ from the script folder".into());
        }
        let marker = results.join(".workflow-results.json");
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(marker)
        {
            Ok(mut file) => {
                use std::io::Write;
                file.write_all(b"{\"format\":\"multiwfn-workflow-results\",\"version\":1}\n")
                    .map_err(|e| e.to_string())?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.to_string()),
        }
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis();
        let sequence = RUN_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let directory = output
            .map(Path::to_path_buf)
            .unwrap_or_else(|| results.join(format!("workflow-{stamp}-{sequence}")));
        if directory.parent() != Some(results.as_path()) {
            return Err("Invalid attempt directory".into());
        }
        fs::create_dir(&directory).map_err(|e| e.to_string())?;
        let cancel = Arc::new(AtomicBool::new(false));
        let prepared = (|| -> Result<(Child, ProcessTree), String> {
            let mut budget = CopyBudget::default();
            let single_script = state.selected_script.is_some();
            if single_script {
                fs::copy(
                    &script,
                    directory.join(script.file_name().ok_or("Invalid script name")?),
                )
                .map_err(|error| error.to_string())?;
            } else {
                copy_inputs(source_dir, &directory, &results, 0, &mut budget)?;
            }
            let conf = directory.join(".workflow-conf");
            fs::create_dir(&conf).map_err(|e| e.to_string())?;
            copy_conf(&self.conf, &conf)?;
            if single_script {
                copy_conf(source_dir, &conf)?;
                copy_conf(&source_dir.join("conf"), &conf)?;
            }
            copy_conf(&directory, &conf)?;
            copy_conf(&directory.join("conf"), &conf)?;
            let rc = format!("Multiwfn_exec=\"{}\"\nconfpath=\"{}\"\ncores={cores}\ncitations_output=references.bib\n",
                runner_path(multiwfn), runner_path(&conf));
            fs::write(directory.join("banewfn.rc"), rc).map_err(|e| e.to_string())?;
            if let Some(settings) = multiwfn
                .parent()
                .map(|p| p.join("settings.ini"))
                .filter(|p| p.is_file())
            {
                fs::copy(settings, directory.join("settings.ini")).map_err(|e| e.to_string())?;
            }
            let log = File::create(directory.join("workflow.log")).map_err(|e| e.to_string())?;
            let mut command = Command::new(runner);
            if let Some(parameters) = request.get("parameters") {
                fs::write(
                    directory.join("parameters.json"),
                    serde_json::to_vec_pretty(parameters).map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
                fs::write(
                    directory.join("workflow-request.json"),
                    serde_json::to_vec_pretty(request).map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
            }
            command
                .arg(script.file_name().ok_or("Invalid script name")?)
                .arg("--batch")
                .arg("--cores")
                .arg(cores.to_string());
            if let Some(wfn) = &state.wavefunction {
                command.arg("--wfn").arg(runner_path(wfn));
            }
            for variable in &variables {
                command.arg("--var").arg(variable);
            }
            if request.get("parameters").is_some() {
                command.arg("--parameters-json").arg("parameters.json");
            }
            if dry_run {
                command.arg("--dryrun");
            }
            command
                .current_dir(&directory)
                .stdin(Stdio::null())
                .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
                .stderr(Stdio::from(log))
                .env("NO_COLOR", "1");
            for (key, _) in
                std::env::vars().filter(|(key, _)| key.starts_with("MULTIWFN_MATTERVIZ_"))
            {
                command.env_remove(key);
            }
            fs::write(directory.join("workflow-run.json"), serde_json::to_vec_pretty(&json!({
                "script":script,"runner":runner,"multiwfn":multiwfn,"wavefunction":state.wavefunction,
                "cores":cores,"variables":variables,"dryRun":dry_run
            })).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            ProcessTree::spawn(command)
        })();
        let (mut child, tree) = match prepared {
            Ok(value) => value,
            Err(error) => {
                state.job = Some(Job {
                    directory,
                    state: "failed",
                    code: None,
                    message: error.clone(),
                    cancel: Arc::new(AtomicBool::new(false)),
                });
                return Err(error);
            }
        };
        state.job = Some(Job {
            directory: directory.clone(),
            state: "running",
            code: None,
            message: String::new(),
            cancel: cancel.clone(),
        });
        let shared = self.state.clone();
        *worker = Some(thread::spawn(move || {
            let outcome = loop {
                if cancel.load(Ordering::Acquire) {
                    tree.terminate();
                    let _ = child.kill();
                    let _ = child.wait();
                    break ("cancelled", None, String::new());
                }
                match child.try_wait() {
                    Ok(Some(status)) => {
                        break (
                            if status.success() {
                                if dry_run {
                                    "prepared"
                                } else {
                                    "completed"
                                }
                            } else {
                                "failed"
                            },
                            status.code(),
                            String::new(),
                        )
                    }
                    Ok(None) => thread::sleep(Duration::from_millis(50)),
                    Err(error) => {
                        tree.terminate();
                        let _ = child.kill();
                        let _ = child.wait();
                        break ("failed", None, error.to_string());
                    }
                }
            };
            // No helper or Multiwfn descendant may outlive the workflow owner.
            tree.terminate();
            let mut state = shared.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(job) = &mut state.job {
                job.state = outcome.0;
                job.code = outcome.1;
                job.message = outcome.2;
                let _ = fs::write(
                    directory.join("workflow-status.json"),
                    serde_json::to_vec_pretty(&json!({
                        "state":job.state,"exitCode":job.code,"message":job.message
                    }))
                    .unwrap_or_default(),
                );
            }
        }));
        Ok(())
    }

    pub fn cancel(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(job) = &mut state.job {
            if active(job) {
                job.cancel.store(true, Ordering::Release);
                job.state = "cancelling";
            }
        }
    }

    pub(crate) fn job_snapshot(&self) -> Option<Job> {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .job
            .clone()
    }
    pub(crate) fn batch_inputs(&self, files: &[String]) -> Result<(), String> {
        let first = files.first().ok_or("Choose at least one input file")?;
        self.select("wavefunction", Path::new(first))?;
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        if !state.results_selected {
            state.results = Some(
                Path::new(first)
                    .parent()
                    .ok_or("Invalid input folder")?
                    .join("BaneWfn_results"),
            );
        }
        Ok(())
    }
    pub(crate) fn plan_inputs(&self, request: &Value) -> Result<Value, String> {
        let runner = self
            .runner
            .as_ref()
            .ok_or("Workflow runner is not installed")?;
        let state = self.state.lock().map_err(|e| e.to_string())?;
        let script = request["script"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(|id| script_path(state.library.as_deref(), id))
            .transpose()?;
        let exclude = state.results.clone();
        drop(state);
        let directory = std::env::temp_dir().join(format!(
            "banewfn-plan-{}-{}",
            std::process::id(),
            RUN_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&directory).map_err(|e| e.to_string())?;
        struct Scratch(PathBuf);
        impl Drop for Scratch {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let _scratch = Scratch(directory.clone());
        let files = request["files"].as_array().cloned().unwrap_or_default();
        if files.len() > 1024 {
            return Err("Select at most 1024 input files".into());
        }
        let files: serde_json::Map<_, _> = files
            .into_iter()
            .enumerate()
            .map(|(i, v)| (i.to_string(), v))
            .collect();
        for (name, value) in [
            ("files", Value::Object(files)),
            (
                "bindings",
                request.get("bindings").cloned().unwrap_or(json!({})),
            ),
            (
                "parameters",
                request.get("parameters").cloned().unwrap_or(json!({})),
            ),
        ] {
            fs::write(
                directory.join(format!("{name}.json")),
                serde_json::to_vec(&value).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        }
        let mut roots = request["roots"].as_array().cloned().unwrap_or_default();
        if roots.len() > 16 {
            return Err("Choose at most 16 input folders".into());
        }
        if roots.is_empty() {
            roots.push(Value::Null);
        }
        let mut inputs = std::collections::BTreeMap::new();
        let mut combinations = 1;
        for (index, root) in roots.iter().enumerate() {
            let mut command = Command::new(runner);
            command
                .arg("--plan-json")
                .current_dir(&directory)
                .stdin(Stdio::null());
            if let Some(script) = &script {
                command.arg(runner_path(script));
            }
            for name in ["bindings", "parameters"] {
                command
                    .arg(format!("--{name}-json"))
                    .arg(runner_path(&directory.join(format!("{name}.json"))));
            }
            if index == 0 {
                command
                    .arg("--files-json")
                    .arg(runner_path(&directory.join("files.json")));
            }
            if !root.is_null() {
                let path = Path::new(root["path"].as_str().ok_or("Choose an input folder")?);
                validate_path(path)?;
                command.arg("--root").arg(runner_path(path));
                if root["recursive"] == true {
                    command.arg("--recursive");
                }
                let patterns = root["patterns"]
                    .as_array()
                    .ok_or("Enter a filename pattern")?;
                if patterns.len() > 16 {
                    return Err("Too many filename patterns".into());
                }
                for pattern in patterns {
                    command
                        .arg("--pattern")
                        .arg(pattern.as_str().ok_or("Invalid filename pattern")?);
                }
            }
            if let Some(path) = &exclude {
                command.arg("--exclude-dir").arg(runner_path(path));
            }
            if let Some(vars) = request["variables"].as_array() {
                for variable in vars {
                    command
                        .arg("--var")
                        .arg(variable.as_str().ok_or("Invalid variable")?);
                }
            }
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let output = command.output().map_err(|e| e.to_string())?;
            let value: Value = serde_json::from_slice(&output.stdout)
                .map_err(|e| format!("Cannot plan inputs: {e}"))?;
            if !output.status.success() {
                return Err(value["error"]
                    .as_str()
                    .unwrap_or("Cannot plan inputs")
                    .into());
            }
            combinations = value["combinations"].as_u64().ok_or("Invalid batch plan")?;
            for item in value["inputs"].as_array().ok_or("Invalid batch plan")? {
                let path = Path::new(item["path"].as_str().ok_or("Invalid input file")?)
                    .canonicalize()
                    .map_err(|e| e.to_string())?;
                validate_path(&path)?;
                let mut item = item.clone();
                item["path"] = json!(runner_path(&path));
                item["name"] = json!(path.file_name().unwrap_or_default().to_string_lossy());
                inputs.insert(path, item);
            }
        }
        if inputs.len() > 1024 {
            return Err("Select at most 1024 input files".into());
        }
        Ok(
            json!({"version":1,"combinations":combinations,"inputs":inputs.into_values().collect::<Vec<_>>()}),
        )
    }
    pub(crate) fn freeze_batch(
        &self,
        root: &Path,
        request: &Value,
    ) -> Result<(PathBuf, String), String> {
        let state = self.state.lock().map_err(|e| e.to_string())?;
        let script = script_path(
            state.library.as_deref(),
            request["script"]
                .as_str()
                .ok_or("Select a workflow script")?,
        )?;
        let source = script.parent().ok_or("Invalid script folder")?;
        let snapshot = root.join("workflow");
        fs::create_dir(&snapshot).map_err(|e| e.to_string())?;
        let name = script
            .file_name()
            .ok_or("Invalid script name")?
            .to_string_lossy()
            .to_string();
        if state.selected_script.is_some() {
            fs::copy(&script, snapshot.join(&name)).map_err(|e| e.to_string())?;
        } else {
            copy_inputs(source, &snapshot, root, 0, &mut CopyBudget::default())?;
        }
        let conf = snapshot.join(".workflow-conf");
        fs::create_dir(&conf).map_err(|e| e.to_string())?;
        copy_conf(&self.conf, &conf)?;
        copy_conf(source, &conf)?;
        copy_conf(&source.join("conf"), &conf)?;
        Ok((snapshot, name))
    }
    pub(crate) fn batch_child(&self, snapshot: &Path) -> WorkflowManager {
        Self::with_paths(
            self.runner.clone(),
            snapshot.join(".workflow-conf"),
            Some(snapshot.to_owned()),
            self.multiwfn.clone(),
        )
    }

    pub fn shutdown(&self) {
        // Serialize with launch so closing cannot race with a newly spawned child.
        let mut worker = self.worker.lock().unwrap_or_else(|e| e.into_inner());
        self.stopped.store(true, Ordering::Release);
        self.cancel();
        if let Some(worker) = worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for WorkflowManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}
fn active(job: &Job) -> bool {
    matches!(job.state, "running" | "cancelling")
}
pub(crate) fn job_value(job: &Job) -> Value {
    let mut log = read_log_tail(&job.directory.join("workflow.log"));
    if let Some(output) = fs::read_dir(&job.directory)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|s| s == "out"))
        .max_by_key(|entry| entry.metadata().ok().and_then(|m| m.modified().ok()))
    {
        log.push_str(&format!(
            "\n--- {} ---\n{}",
            output.file_name().to_string_lossy(),
            read_log_tail(&output.path())
        ));
        if log.len() > MAX_LOG as usize {
            let mut start = log.len() - MAX_LOG as usize;
            while !log.is_char_boundary(start) {
                start += 1;
            }
            log = log[start..].to_owned();
        }
    }
    let files = crate::workflow_results::files(&job.directory);
    let cubes = crate::workflow_results::cubes(&job.directory, &files);
    json!({"directory":job.directory,"state":job.state,"exitCode":job.code,"message":job.message,"log":log,"files":files,"cubes":cubes})
}
fn executable_name(name: &str) -> String {
    format!("{name}{}", std::env::consts::EXE_SUFFIX)
}
fn existing_file(path: PathBuf) -> Option<PathBuf> {
    path.canonicalize().ok().filter(|p| p.is_file())
}

pub(crate) fn open_in_default_app(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
        // Shell associations need ordinary drive/UNC paths, not Rust's verbatim
        // canonical namespace. Pass UTF-16 directly, without cmd.exe quoting.
        let normal = runner_path(path);
        let wide: Vec<u16> = std::ffi::OsStr::new(&normal)
            .encode_wide()
            .chain(Some(0))
            .collect();
        let code = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                windows_sys::w!("open"),
                wide.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        } as isize;
        if code <= 32 {
            return Err(format!(
                "Windows could not open the result (ShellExecute error {code})"
            ));
        }
    }
    #[cfg(not(windows))]
    {
        let mut command = if cfg!(target_os = "macos") {
            let mut command = Command::new("/usr/bin/open");
            command.arg("--");
            command
        } else {
            Command::new("xdg-open")
        };
        let mut child = command
            .arg(path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        // Some desktop handlers wait until the external editor closes. Reap the
        // launcher separately so the workbench remains interactive.
        thread::spawn(move || {
            let _ = child.wait();
        });
    }
    Ok(())
}

// Keep canonical paths for host I/O and containment checks, but do not leak
// Rust's Windows verbatim namespace into BaneWfn's rc file.
// The runner appends /module.conf and its batch backend invokes cmd.exe; neither
// operation accepts verbatim paths with the same semantics as native Win32 I/O.
fn runner_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    if let Some(std::path::Component::Prefix(prefix)) = path.components().next() {
        match prefix.kind() {
            std::path::Prefix::VerbatimDisk(_) => return value[4..].to_owned(),
            std::path::Prefix::VerbatimUNC(_, _) => return format!("\\\\{}", &value[8..]),
            _ => {}
        }
    }
    value.into_owned()
}

#[cfg(all(test, windows))]
#[test]
fn runner_paths_use_win32_drive_and_unc_names() {
    for (input, expected) in [
        (
            r"\\?\C:\目录 with spaces\engine.exe",
            r"C:\目录 with spaces\engine.exe",
        ),
        (
            r"\\?\UNC\server\share\目录\config",
            r"\\server\share\目录\config",
        ),
        (r"C:\normal\input.fch", r"C:\normal\input.fch"),
        (r"\\server\share\input.fch", r"\\server\share\input.fch"),
    ] {
        assert_eq!(runner_path(Path::new(input)), expected);
    }
}
fn default_results(startup_file: &Path) -> Result<PathBuf, String> {
    let parent = startup_file.parent().ok_or("Invalid startup file")?;
    let mut name = startup_file
        .file_stem()
        .ok_or("Invalid startup file")?
        .to_os_string();
    name.push("_workflows");
    Ok(parent.join(name))
}

fn configured_path(key: &str) -> Option<PathBuf> {
    std::env::var_os(key).and_then(|p| PathBuf::from(p).canonicalize().ok())
}
fn is_results_dir(path: &Path) -> bool {
    path.join(".workflow-results.json")
        .symlink_metadata()
        .is_ok_and(|metadata| metadata.file_type().is_file())
}
fn validate_path(path: &Path) -> Result<(), String> {
    let value = path.to_str().ok_or("Workflow paths must be UTF-8")?;
    if value.contains(['\0', '\r', '\n', '"']) {
        return Err("Workflow paths cannot contain quotes or control characters".into());
    }
    #[cfg(windows)]
    if value.contains(['%', '"']) {
        return Err("Windows workflow paths cannot contain % or quotes".into());
    }
    Ok(())
}
fn is_script(path: &Path) -> bool {
    crate::workbench_args::is_script(path)
}
fn script_path(root: Option<&Path>, id: &str) -> Result<PathBuf, String> {
    let root = root.ok_or("Choose a script folder")?;
    let relative = Path::new(id);
    if relative.is_absolute()
        || relative
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err("Invalid workflow script identifier".into());
    }
    let path = root
        .join(relative)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !path.starts_with(root) || !path.is_file() || !is_script(&path) {
        return Err("Invalid workflow script".into());
    }
    validate_path(&path)?;
    Ok(path)
}
fn read_script(path: &Path) -> Result<String, String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_SCRIPT {
        return Err("Workflow script exceeds 512 KiB".into());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}
fn scan_scripts(
    root: &Path,
    directory: &Path,
    depth: usize,
    scripts: &mut Vec<Value>,
) -> Result<(), String> {
    if depth > 4 {
        return Ok(());
    }
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if entry.file_name().to_string_lossy().starts_with('.')
            || kind.is_symlink()
            || (kind.is_dir() && is_results_dir(&entry.path()))
            || matches!(
                entry.file_name().to_str(),
                Some("build" | "target" | "node_modules")
            )
        {
            continue;
        }
        if kind.is_dir() {
            scan_scripts(root, &entry.path(), depth + 1, scripts)?;
        } else if kind.is_file() && is_script(&entry.path()) {
            if scripts.len() >= 256 {
                return Err("Script catalog exceeds 256 entries".into());
            }
            scripts.push(json!({"id":entry.path().strip_prefix(root).map_err(|e| e.to_string())?.to_string_lossy().replace('\\',"/"),
                "name":entry.file_name().to_string_lossy()}));
        }
    }
    Ok(())
}
#[derive(Default)]
struct CopyBudget {
    bytes: u64,
    files: usize,
}
fn copy_inputs(
    source: &Path,
    target: &Path,
    results: &Path,
    depth: usize,
    budget: &mut CopyBudget,
) -> Result<(), String> {
    if depth > 8 {
        return Err("Script input tree exceeds eight directory levels".into());
    }
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if entry.path() == results
            || name.to_string_lossy().starts_with('.')
            || matches!(name.to_str(), Some("build" | "target" | "node_modules"))
        {
            continue;
        }
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            return Err("Script input folders must not contain symbolic links".into());
        }
        if kind.is_dir() && is_results_dir(&entry.path()) {
            continue;
        }
        let destination = target.join(name);
        if kind.is_dir() {
            fs::create_dir(&destination).map_err(|e| e.to_string())?;
            copy_inputs(&entry.path(), &destination, results, depth + 1, budget)?;
        } else if kind.is_file() {
            budget.bytes += entry.metadata().map_err(|e| e.to_string())?.len();
            budget.files += 1;
            if budget.bytes > MAX_LIBRARY_BYTES || budget.files > 1024 {
                return Err("Script companion files exceed 64 MiB or 1024 files; keep wavefunctions outside the script folder".into());
            }
            fs::copy(entry.path(), destination).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
fn copy_conf(source: &Path, target: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map_err(|e| e.to_string())?.is_file()
            && entry.path().extension().is_some_and(|s| s == "conf")
        {
            if entry.metadata().map_err(|e| e.to_string())?.len() > MAX_SCRIPT {
                return Err("Module configuration exceeds 512 KiB".into());
            }
            fs::copy(entry.path(), target.join(entry.file_name())).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
fn read_log_tail(path: &Path) -> String {
    let mut bytes = Vec::new();
    if let Ok(mut file) = File::open(path) {
        let length = file.metadata().map(|m| m.len()).unwrap_or_default();
        let _ = file.seek(SeekFrom::Start(length.saturating_sub(MAX_LOG)));
        let _ = file.take(MAX_LOG).read_to_end(&mut bytes);
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

#[cfg(unix)]
struct ProcessTree(u32);
#[cfg(unix)]
impl ProcessTree {
    fn spawn(mut command: Command) -> Result<(Child, Self), String> {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
        let child = command.spawn().map_err(|e| e.to_string())?;
        let tree = Self(child.id());
        Ok((child, tree))
    }
    fn terminate(&self) {
        unsafe {
            libc::kill(-(self.0 as i32), libc::SIGKILL);
        }
    }
}

#[cfg(windows)]
struct ProcessTree(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
unsafe impl Send for ProcessTree {}
#[cfg(windows)]
impl ProcessTree {
    fn spawn(mut command: Command) -> Result<(Child, Self), String> {
        use std::os::windows::io::AsRawHandle;
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::System::JobObjects::*;
        // Kill-on-close keeps descendant shells and Multiwfn owned by this job.
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let tree = Self(handle);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        if unsafe { AssignProcessToJobObject(handle, child.as_raw_handle()) } == 0 {
            let error = std::io::Error::last_os_error().to_string();
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        Ok((child, tree))
    }
    fn terminate(&self) {
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0, 1);
        }
    }
}
#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(test)]
mod result_path_tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
        manager: WorkflowManager,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "workflow-open-{}-{}",
                std::process::id(),
                RUN_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(root.join("run/nested")).unwrap();
            let root = root.canonicalize().unwrap();
            let manager = WorkflowManager::with_paths(None, root.join("conf"), None, None);
            manager.state.lock().unwrap().job = Some(Job {
                directory: root.join("run"),
                state: "completed",
                code: Some(0),
                message: String::new(),
                cancel: Arc::new(AtomicBool::new(false)),
            });
            Self { root, manager }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.manager.shutdown();
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn result_files_and_directory_can_open_during_runs_and_preflight() {
        let fixture = Fixture::new();
        let root = fixture.root.join("run");
        let file = "nested/报告 with spaces.txt";
        fs::write(root.join(file), "existing result").unwrap();
        for state in [
            "running",
            "cancelling",
            "prepared",
            "completed",
            "failed",
            "cancelled",
        ] {
            fixture
                .manager
                .state
                .lock()
                .unwrap()
                .job
                .as_mut()
                .unwrap()
                .state = state;
            assert_eq!(
                fixture
                    .manager
                    .result_path(&json!({"directory":root}))
                    .unwrap(),
                root
            );
            assert_eq!(
                fixture
                    .manager
                    .result_path(&json!({"directory":root,"file":file}))
                    .unwrap(),
                root.join(file).canonicalize().unwrap()
            );
        }
    }

    #[test]
    fn result_paths_reject_stale_jobs_and_files_outside_the_catalogue() {
        let fixture = Fixture::new();
        let root = fixture.root.join("run");
        fs::write(fixture.root.join("outside.txt"), "outside").unwrap();
        fs::write(root.join(".hidden.txt"), "not listed").unwrap();
        assert!(fixture
            .manager
            .result_path(&json!({"directory":fixture.root}))
            .unwrap_err()
            .contains("changed"));
        for file in [
            json!("../outside.txt"),
            json!(fixture.root.join("outside.txt")),
            json!("nested"),
            json!(".hidden.txt"),
            json!("missing.txt"),
            json!(null),
        ] {
            assert!(fixture
                .manager
                .result_path(&json!({"directory":root,"file":file}))
                .is_err());
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(fixture.root.join("outside.txt"), root.join("escape.txt"))
                .unwrap();
            assert!(fixture
                .manager
                .result_path(&json!({"directory":root,"file":"escape.txt"}))
                .is_err());
        }
        fixture.manager.state.lock().unwrap().job = None;
        assert!(fixture
            .manager
            .result_path(&json!({"directory":root}))
            .unwrap_err()
            .contains("No workflow results"));
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};
    use std::time::Instant;

    struct Fixture {
        root: PathBuf,
        manager: WorkflowManager,
    }
    impl Fixture {
        fn new(runner: &str) -> Self {
            Self::with_results(runner, true)
        }
        fn with_results(runner: &str, select_results: bool) -> Self {
            let root = std::env::temp_dir().join(format!(
                "workflow-host-{}-{}",
                std::process::id(),
                RUN_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            // macOS temp_dir() uses /var, which resolves to /private/var.
            // Match the canonical paths supplied by production native selection.
            let root = root.canonicalize().unwrap();
            let library = root.join("scripts");
            fs::create_dir(&library).unwrap();
            fs::write(library.join("run.bw"), "%raw\nq\nend\n").unwrap();
            let results = root.join("results");
            fs::create_dir(&results).unwrap();
            let executable = root.join("mock runner");
            fs::write(&executable, format!("#!/bin/sh\n{runner}\n")).unwrap();
            fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
            let manager = WorkflowManager::with_paths(
                Some(executable.clone()),
                root.join("conf"),
                Some(library),
                Some(executable),
            );
            if select_results {
                manager.select("results", &results).unwrap();
            }
            Self { root, manager }
        }
        fn request(&self) -> Value {
            json!({"script":"run.bw","cores":1,"variables":[],"dryRun":false})
        }
        fn finish(&self) -> Value {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                let status = self.manager.status();
                if !matches!(
                    status["job"]["state"].as_str(),
                    Some("running" | "cancelling")
                ) {
                    return status;
                }
                assert!(Instant::now() < deadline, "workflow did not finish");
                thread::sleep(Duration::from_millis(10));
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.manager.shutdown();
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn opening_an_external_script_selects_it_without_execution() {
        let f = Fixture::new("touch unexpected-execution");
        let external = f.root.join("external scripts");
        fs::create_dir(&external).unwrap();
        let script = external.join("chosen file.BWC");
        fs::write(&script, "%command\necho ready\nend\n").unwrap();
        f.manager.select("script", &script).unwrap();
        let status = f.manager.status();
        assert_eq!(status["selectedScript"], "chosen file.BWC");
        assert_eq!(status["library"], json!(external));
        assert_eq!(status["scripts"][0]["id"], "chosen file.BWC");
        assert!(status["job"].is_null());
        assert!(!f.root.join("unexpected-execution").exists());
        f.manager
            .select("library", &f.root.join("scripts"))
            .unwrap();
        assert!(f.manager.status()["selectedScript"].is_null());
    }

    #[test]
    fn single_script_start_skips_unrelated_downloads_and_keeps_local_conf() {
        let f = Fixture::new("test -f chosen.bwc && test -f .workflow-conf/local.conf && test ! -e unrelated.download");
        let external = f.root.join("downloads");
        fs::create_dir(&external).unwrap();
        fs::write(external.join("chosen.bwc"), "%command\necho ready\nend\n").unwrap();
        fs::write(external.join("local.conf"), "[main]\nq\n").unwrap();
        fs::write(
            external.join("a-first.bw"),
            "%command\necho unrelated\nend\n",
        )
        .unwrap();
        File::create(external.join("unrelated.download"))
            .unwrap()
            .set_len(MAX_LIBRARY_BYTES + 1)
            .unwrap();
        f.manager
            .select("script", &external.join("chosen.bwc"))
            .unwrap();
        assert_eq!(f.manager.status()["scripts"].as_array().unwrap().len(), 1);
        f.manager
            .start(&json!({"script":"chosen.bwc","cores":1,"variables":[],"dryRun":false}))
            .unwrap();
        let status = f.finish();
        assert_eq!(status["job"]["state"], "completed");
        assert!(!status["job"]["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|name| name == "unrelated.download"));
    }

    #[test]
    fn startup_file_derives_results_and_preserves_explicit_directory() {
        let f = Fixture::with_results("exit 0", false);
        let first = f.root.join("complex molecule.fchk");
        let second = f.root.join("另一个体系.xyz");
        fs::write(&first, "mock input").unwrap();
        fs::write(&second, "mock input").unwrap();
        f.manager.select("wavefunction", &first).unwrap();
        let automatic = f.root.join("complex molecule_workflows");
        assert_eq!(f.manager.status()["results"], json!(automatic));
        assert!(
            !automatic.exists(),
            "selection must not create output files"
        );
        f.manager.select("wavefunction", &second).unwrap();
        assert_eq!(
            f.manager.status()["results"],
            json!(f.root.join("另一个体系_workflows"))
        );
        f.manager
            .select("results", &f.root.join("results"))
            .unwrap();
        f.manager.select("wavefunction", &first).unwrap();
        assert_eq!(f.manager.status()["results"], json!(f.root.join("results")));
    }

    #[test]
    fn automatic_results_inside_library_are_not_catalogued_or_copied() {
        let f = Fixture::with_results("exit 0", false);
        let library = f.root.join("scripts");
        let first = library.join("first.fchk");
        let second = library.join("second.xyz");
        fs::write(&first, "mock input").unwrap();
        fs::write(&second, "mock input").unwrap();
        fs::write(library.join("companion.txt"), "keep this input").unwrap();
        f.manager.select("wavefunction", &first).unwrap();
        f.manager.start(&f.request()).unwrap();
        let first_status = f.finish();
        assert_eq!(first_status["job"]["state"], "completed");
        let first_job = PathBuf::from(first_status["job"]["directory"].as_str().unwrap());
        assert!(!first_job.join("first_workflows").exists());
        assert_eq!(
            fs::read_to_string(first_job.join("companion.txt")).unwrap(),
            "keep this input"
        );
        assert_eq!(first_status["scripts"].as_array().unwrap().len(), 1);
        f.manager.select("wavefunction", &second).unwrap();
        f.manager.start(&f.request()).unwrap();
        let second_status = f.finish();
        assert_eq!(second_status["job"]["state"], "completed");
        let second_job = PathBuf::from(second_status["job"]["directory"].as_str().unwrap());
        assert!(!second_job.join("first_workflows").exists());
        assert!(!second_job.join("second_workflows").exists());
        assert!(first_job.join("workflow-status.json").is_file());
        assert_eq!(second_status["scripts"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn packaged_engine_cannot_be_replaced() {
        let f = Fixture::new("exit 0");
        let locked = f.manager.status()["multiwfn"].clone();
        let other = f.root.join("different Multiwfn");
        fs::write(&other, "must not run").unwrap();
        assert!(f.manager.select("multiwfn", &other).is_err());
        let mut request = f.request();
        request["multiwfn"] = json!(other);
        f.manager.start(&request).unwrap();
        let status = f.finish();
        let directory = PathBuf::from(status["job"]["directory"].as_str().unwrap());
        let rc = fs::read_to_string(directory.join("banewfn.rc")).unwrap();
        assert!(rc.contains(locked.as_str().unwrap()));
        assert!(!rc.contains("different Multiwfn"));
        assert_eq!(status["multiwfn"], locked);
    }

    #[test]
    fn missing_bundled_engine_fails_without_creating_a_job() {
        let mut f = Fixture::new("exit 0");
        f.manager.multiwfn = None;
        assert!(f
            .manager
            .start(&f.request())
            .unwrap_err()
            .contains("bundled Multiwfn"));
        assert_eq!(fs::read_dir(f.root.join("results")).unwrap().count(), 0);
    }

    #[test]
    fn result_open_rejects_stale_running_and_preflight_jobs() {
        let fixture = Fixture::new("exit 0");
        let root = fixture.root.clone();
        let mut state = fixture.manager.state.lock().unwrap();
        state.job = Some(Job {
            directory: root.clone(),
            state: "running",
            code: None,
            message: String::new(),
            cancel: Arc::new(AtomicBool::new(false)),
        });
        drop(state);
        assert!(fixture
            .manager
            .open_result(&json!({"directory":"old job","file":"x.cub"}), &root)
            .unwrap_err()
            .contains("changed"));
        assert!(fixture
            .manager
            .open_result(&json!({"directory":root,"file":"x.cub"}), &root)
            .unwrap_err()
            .contains("finish"));
        fixture
            .manager
            .state
            .lock()
            .unwrap()
            .job
            .as_mut()
            .unwrap()
            .state = "prepared";
        assert!(fixture
            .manager
            .open_result(&json!({"directory":root,"file":"x.cub"}), &root)
            .unwrap_err()
            .contains("finish"));
    }

    #[test]
    fn catalog_and_preview_reject_paths_outside_native_selection() {
        let f = Fixture::new("exit 0");
        fs::write(f.root.join("outside.bw"), "outside").unwrap();
        symlink(f.root.join("outside.bw"), f.root.join("scripts/escape.bw")).unwrap();
        assert_eq!(f.manager.status()["scripts"].as_array().unwrap().len(), 1);
        assert!(f.manager.preview("../outside.bw").is_err());
        assert!(f.manager.preview("escape.bw").is_err());
        assert!(f.manager.preview("run.bw").unwrap()["source"]
            .as_str()
            .unwrap()
            .contains("%raw"));
        let mut invalid = f.request();
        invalid["cores"] = json!(0);
        assert!(f.manager.start(&invalid).is_err());
        assert_eq!(fs::read_dir(f.root.join("results")).unwrap().count(), 0);
    }

    #[test]
    fn exit_status_logs_and_fresh_directories_survive_repeated_runs() {
        let f = Fixture::new("echo runner-output\necho engine-output > mock.out\nexit 7");
        f.manager.start(&f.request()).unwrap();
        let first = f.finish();
        assert_eq!(first["job"]["state"], "failed");
        assert_eq!(first["job"]["exitCode"], 7);
        assert!(first["job"]["log"]
            .as_str()
            .unwrap()
            .contains("engine-output"));
        f.manager.start(&f.request()).unwrap();
        let second = f.finish();
        assert_ne!(first["job"]["directory"], second["job"]["directory"]);
        assert!(Path::new(first["job"]["directory"].as_str().unwrap())
            .join("workflow-status.json")
            .exists());
    }

    #[test]
    fn preflight_has_a_distinct_terminal_state() {
        let f = Fixture::new("exit 0");
        let mut request = f.request();
        request["dryRun"] = json!(true);
        f.manager.start(&request).unwrap();
        assert_eq!(f.finish()["job"]["state"], "prepared");
    }

    #[test]
    fn cancel_and_shutdown_stop_the_owned_process_tree() {
        let f = Fixture::new("sleep 60 &\necho $! > descendant.pid\nwait");
        f.manager.start(&f.request()).unwrap();
        assert!(f.manager.start(&f.request()).is_err());
        assert!(f.manager.select("library", &f.root).is_err());
        let directory = PathBuf::from(f.manager.status()["job"]["directory"].as_str().unwrap());
        let pid_path = directory.join("descendant.pid");
        let deadline = Instant::now() + Duration::from_secs(3);
        while !pid_path.exists() {
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(10));
        }
        let _pid: i32 = fs::read_to_string(pid_path)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        f.manager.cancel();
        assert_eq!(f.finish()["job"]["state"], "cancelled");
        #[cfg(target_os = "linux")]
        if let Ok(stat) = fs::read_to_string(format!("/proc/{_pid}/stat")) {
            assert_eq!(stat.split(") ").nth(1).unwrap().chars().next(), Some('Z'));
        }
        f.manager.start(&f.request()).unwrap();
        f.manager.shutdown();
        assert_eq!(f.manager.status()["job"]["state"], "cancelled");
        assert!(f.manager.start(&f.request()).is_err());
    }

    #[test]
    fn native_sidecar_runs_the_copied_script_and_generated_rc() {
        // CI can set this after building the optional C++ target. Other host tests
        // still exercise process ownership when that optional target is absent.
        let Some(runner) = std::env::var_os("MULTIWFN_TEST_WORKFLOW_RUNNER") else {
            return;
        };
        let mut f = Fixture::new("cat > received.stdin\necho 'Native analysis result: 42'");
        f.manager.runner = Some(PathBuf::from(runner));
        let wfn = f.root.join("input molecule '#.fchk");
        fs::write(&wfn, "mock").unwrap();
        f.manager.select("wavefunction", &wfn).unwrap();
        fs::write(f.root.join("scripts/run.bw"), "%raw\n100\nq\n%grep\nmatch \"Native analysis result\" -> selected.txt\n%command\ncat selected.txt > processed.txt\nend\n").unwrap();
        f.manager.start(&f.request()).unwrap();
        let status = f.finish();
        assert_eq!(status["job"]["state"], "completed", "{status}");
        let directory = Path::new(status["job"]["directory"].as_str().unwrap());
        assert_eq!(
            fs::read_to_string(directory.join("received.stdin")).unwrap(),
            "100\nq\n"
        );
        assert_eq!(
            fs::read_to_string(directory.join("processed.txt")).unwrap(),
            "Native analysis result: 42\n"
        );
    }
}
