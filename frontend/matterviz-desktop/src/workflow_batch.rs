//! File-level queue around the existing independent workflow executor.
use crate::workflows::{job_value, open_in_default_app, Job, WorkflowManager};
use serde_json::{json, Value};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn busy(state: &str) -> bool {
    matches!(state, "running" | "pausing" | "paused" | "cancelling")
}
fn state_name(value: &Value) -> &'static str {
    match value.as_str().unwrap_or("") {
        "running" => "running",
        "cancelling" => "cancelling",
        "completed" => "completed",
        "prepared" => "prepared",
        "cancelled" => "cancelled",
        "interrupted" => "interrupted",
        _ => "failed",
    }
}
fn relative(root: &Path, name: &str) -> Result<PathBuf, String> {
    let path = Path::new(name);
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|p| !matches!(p, Component::Normal(_)))
    {
        return Err("Invalid batch result path".into());
    }
    let joined = root.join(path);
    if joined.exists()
        && !joined
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(root)
    {
        return Err("Invalid batch result path".into());
    }
    Ok(joined)
}
fn save(batch: &Value) -> Result<(), String> {
    let root = Path::new(batch["directory"].as_str().ok_or("Invalid batch folder")?);
    fs::write(
        root.join("batch.json.tmp"),
        serde_json::to_vec_pretty(batch).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(root.join("batch.json.tmp"), root.join("batch.json")).map_err(|e| e.to_string())
}
struct Shared {
    data: Mutex<Option<Value>>,
    inputs: Mutex<Value>,
    current: Mutex<Option<Arc<WorkflowManager>>>,
    stop: AtomicBool,
    pause: AtomicBool,
}
pub struct WorkflowBatch {
    manager: Arc<WorkflowManager>,
    shared: Arc<Shared>,
    worker: Mutex<Option<JoinHandle<()>>>,
    lifecycle: Mutex<()>,
    stopped: AtomicBool,
}
impl WorkflowBatch {
    pub fn new(manager: Arc<WorkflowManager>) -> Self {
        Self {
            manager,
            shared: Arc::new(Shared {
                data: Mutex::new(None),
                inputs: Mutex::new(json!({"files":[],"roots":[]})),
                current: Mutex::new(None),
                stop: AtomicBool::new(false),
                pause: AtomicBool::new(false),
            }),
            worker: Mutex::new(None),
            lifecycle: Mutex::new(()),
            stopped: AtomicBool::new(false),
        }
    }
    pub fn active(&self) -> bool {
        self.shared
            .data
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|v| busy(v["state"].as_str().unwrap_or("")))
    }
    pub fn clear(&self) -> Result<(), String> {
        let _guard = self.lifecycle.lock().map_err(|e| e.to_string())?;
        if self.active() {
            return Err("A batch is still active".into());
        }
        *self.shared.data.lock().unwrap() = None;
        Ok(())
    }
    pub fn status(&self) -> Value {
        let mut status = self.manager.status();
        status["inputSet"] = self.shared.inputs.lock().unwrap().clone();
        status["batch"]=self.shared.data.lock().unwrap().as_ref().map(|batch| {
            let cases:Vec<_>=batch["cases"].as_array().unwrap().iter().map(|item|{
                let attempts=item["attempts"].as_array().unwrap(); let last=attempts.last();
                json!({"id":item["id"],"name":item["name"],"path":item["path"],"state":item["state"],"attempts":attempts.len(),"started":last.map(|v|&v["started"]),"finished":last.map(|v|&v["finished"]),"message":last.map(|v|&v["message"])})
            }).collect();
            let mut counts=serde_json::Map::new();
            for item in &cases {let key=item["state"].as_str().unwrap_or("failed"); let n=counts.get(key).and_then(Value::as_u64).unwrap_or(0)+1; counts.insert(key.into(),json!(n));}
            json!({"id":batch["id"],"directory":batch["directory"],"state":batch["state"],"script":batch["script"],"combinations":batch["combinations"],"created":batch["created"],"message":batch["message"],"counts":counts,"cases":cases})
        }).unwrap_or(Value::Null);
        if !status["batch"].is_null() {
            status["job"] = Value::Null;
        }
        status
    }
    pub fn select_inputs(&self, request: &Value) -> Result<Value, String> {
        let _guard = self.lifecycle.lock().map_err(|e| e.to_string())?;
        if self.stopped.load(Ordering::Acquire) {
            return Err("Workflow host is closing".into());
        }
        if self.active() {
            return Err("A batch is still active".into());
        }
        let planned = self
            .manager
            .plan_inputs(&json!({"files":request["files"]}))?;
        let files: Vec<_> = planned["inputs"]
            .as_array()
            .ok_or("Invalid input list")?
            .iter()
            .map(|i| i["path"].as_str().unwrap().to_owned())
            .collect();
        self.manager.batch_inputs(&files)?;
        *self.shared.inputs.lock().unwrap() = json!({"files":files,"roots":request.get("roots").cloned().unwrap_or(json!([])),"explicitFiles":request.get("explicitFiles").cloned().unwrap_or(json!([])),"excluded":request.get("excluded").cloned().unwrap_or(json!([]))});
        Ok(self.status())
    }
    pub fn start(&self, request: &Value) -> Result<Value, String> {
        let _guard = self.lifecycle.lock().map_err(|e| e.to_string())?;
        if self.stopped.load(Ordering::Acquire) {
            return Err("Workflow host is closing".into());
        }
        if !request.is_object() {
            return Err("Invalid workflow request".into());
        }
        if request["cores"].as_u64().is_none_or(|n| n == 0 || n > 1024)
            || !request["dryRun"].is_boolean()
            || request["variables"].as_array().is_none_or(|v| v.len() > 64)
            || !request["parameters"].is_object()
        {
            return Err("Invalid workflow request".into());
        }
        if self.active() || self.manager.job_snapshot().is_some_and(|j| busy(j.state)) {
            return Err("A workflow is still running".into());
        }
        let inputs = self.shared.inputs.lock().unwrap().clone();
        let files = inputs["files"]
            .as_array()
            .filter(|v| !v.is_empty())
            .ok_or("Choose at least one input file")?;
        let mut plan_request = request.clone();
        plan_request["files"] = json!(files);
        plan_request["roots"] = json!([]);
        let plan = self.manager.plan_inputs(&plan_request)?;
        let results = self.manager.batch_results(request)?;
        let root = results.join(format!(
            "batch-{}-{}",
            now(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).map_err(|e| e.to_string())?;
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        let (_, script) = self.manager.freeze_batch(&root, &results, request)?;
        let cases:Vec<_>=plan["inputs"].as_array().ok_or("Invalid batch plan")?.iter().enumerate().map(|(index,input)|{
            let id=format!("{:04}",index+1);
            let stem=Path::new(input["path"].as_str().unwrap()).file_stem().unwrap_or_default().to_string_lossy().chars().map(|c|if c.is_alphanumeric()||matches!(c,'_'|'-'){c}else{'_'}).take(80).collect::<String>();
            json!({"id":id,"folder":format!("{id}-{stem}"),"path":input["path"],"name":input["name"],"bindings":input["bindings"],"errors":input["errors"],"state":"waiting","attempts":[]})
        }).collect();
        if cases.is_empty() {
            return Err("Choose at least one input file".into());
        }
        let batch = json!({"format":"banewfn-batch","version":1,"id":root.file_name().unwrap().to_string_lossy(),"directory":root,"script":script,"created":now(),"state":"running","message":"","combinations":plan["combinations"],"request":request,"cases":cases});
        save(&batch)?;
        *self.shared.data.lock().unwrap() = Some(batch);
        self.launch()?;
        Ok(self.status())
    }
    fn launch(&self) -> Result<(), String> {
        let mut worker = self.worker.lock().map_err(|e| e.to_string())?;
        if let Some(old) = worker.take() {
            old.join()
                .map_err(|_| "Batch worker stopped unexpectedly")?;
        }
        self.shared.stop.store(false, Ordering::Release);
        self.shared.pause.store(false, Ordering::Release);
        let shared = self.shared.clone();
        let manager = self.manager.clone();
        *worker = Some(thread::spawn(move || {
            if let Err(error) = run(&shared, &manager) {
                let _ = edit(&shared, |batch| {
                    batch["state"] = json!("failed");
                    batch["message"] = json!(error);
                });
            }
        }));
        Ok(())
    }
    pub fn control(&self, request: &Value) -> Result<Value, String> {
        let _guard = self.lifecycle.lock().map_err(|e| e.to_string())?;
        if self.stopped.load(Ordering::Acquire) {
            return Err("Workflow host is closing".into());
        }
        let action = request["action"].as_str().ok_or("Invalid batch action")?;
        {
            let data = self.shared.data.lock().unwrap();
            let batch = data.as_ref().ok_or("No batch is open")?;
            if request["batch"] != batch["id"] {
                return Err("The displayed batch has changed".into());
            }
        }
        match action {
            "pause" if self.active() => {
                self.shared.pause.store(true, Ordering::Release);
                edit(&self.shared, |b| b["state"] = json!("pausing"))?;
            }
            "resume" if self.active() => {
                self.shared.pause.store(false, Ordering::Release);
                edit(&self.shared, |b| b["state"] = json!("running"))?;
            }
            "cancel" => {
                self.shared.stop.store(true, Ordering::Release);
                if let Some(child) = self.shared.current.lock().unwrap().as_ref() {
                    child.cancel();
                }
                if self.active() {
                    edit(&self.shared, |b| b["state"] = json!("cancelling"))?;
                }
            }
            "retry" if !self.active() => {
                let wanted = request["item"].as_str();
                let snapshot = self.shared.data.lock().unwrap().as_ref().unwrap().clone();
                let mut planning = snapshot["request"].clone();
                planning["script"] = snapshot["script"].clone();
                planning["files"] = json!(snapshot["cases"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|item| matches!(
                        item["state"].as_str(),
                        Some("failed" | "cancelled" | "interrupted" | "waiting")
                    ) && wanted.is_none_or(|id| item["id"] == id))
                    .map(|item| item["path"].clone())
                    .collect::<Vec<_>>());
                if planning["files"].as_array().unwrap().is_empty() {
                    return Err("No failed or unfinished inputs to retry".into());
                }
                let child = self.manager.batch_child(
                    &Path::new(snapshot["directory"].as_str().unwrap()).join("workflow"),
                );
                let planned = child.plan_inputs(&planning)?;
                let mut count = 0;
                edit(&self.shared, |batch| {
                    for item in batch["cases"].as_array_mut().unwrap() {
                        let eligible = matches!(
                            item["state"].as_str(),
                            Some("failed" | "cancelled" | "interrupted" | "waiting")
                        );
                        if eligible && wanted.is_none_or(|id| item["id"] == id) {
                            if let Some(input) = planned["inputs"]
                                .as_array()
                                .unwrap()
                                .iter()
                                .find(|input| input["path"] == item["path"])
                            {
                                item["bindings"] = input["bindings"].clone();
                                item["errors"] = input["errors"].clone();
                            }
                            item["state"] = json!("waiting");
                            count += 1;
                        }
                    }
                    if count > 0 {
                        batch["state"] = json!("running");
                        batch["message"] = json!("");
                    }
                })?;
                if count == 0 {
                    return Err("No failed or unfinished inputs to retry".into());
                }
                self.launch()?;
            }
            _ => return Err("Invalid batch action".into()),
        }
        Ok(self.status())
    }
    pub fn load(&self, root: &Path) -> Result<Value, String> {
        let _guard = self.lifecycle.lock().map_err(|e| e.to_string())?;
        if self.stopped.load(Ordering::Acquire) {
            return Err("Workflow host is closing".into());
        }
        if self.active() || self.manager.job_snapshot().is_some_and(|j| busy(j.state)) {
            return Err("A workflow is still running".into());
        }
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        let file = root.join("batch.json");
        if fs::metadata(&file).map_err(|e| e.to_string())?.len() > 16 * 1024 * 1024 {
            return Err("Batch manifest is too large".into());
        }
        let mut batch: Value = serde_json::from_slice(&fs::read(file).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if batch["format"] != "banewfn-batch"
            || batch["version"] != 1
            || !batch["id"].is_string()
            || !batch["request"].is_object()
        {
            return Err("Invalid batch manifest".into());
        }
        let cases = batch["cases"]
            .as_array_mut()
            .filter(|v| !v.is_empty() && v.len() <= 1024)
            .ok_or("Invalid batch manifest")?;
        for (index, item) in cases.iter_mut().enumerate() {
            if item["id"] != format!("{:04}", index + 1)
                || !item["path"].is_string()
                || !item["name"].is_string()
                || !item["bindings"].is_object()
                || item["errors"]
                    .as_array()
                    .is_none_or(|v| v.iter().any(|e| !e.is_string()))
                || !matches!(
                    item["state"].as_str(),
                    Some(
                        "waiting"
                            | "running"
                            | "cancelling"
                            | "cancelled"
                            | "interrupted"
                            | "failed"
                            | "prepared"
                            | "completed"
                    )
                )
            {
                return Err("Invalid batch manifest".into());
            }
            relative(
                &root,
                item["folder"].as_str().ok_or("Invalid batch result path")?,
            )?;
            if matches!(item["state"].as_str(), Some("running" | "cancelling")) {
                item["state"] = json!("interrupted");
            }
            let attempts = item["attempts"]
                .as_array_mut()
                .filter(|v| v.len() <= 128)
                .ok_or("Invalid batch attempts")?;
            for attempt in attempts {
                if !attempt.is_object()
                    || !matches!(
                        attempt["state"].as_str(),
                        Some(
                            "running"
                                | "cancelling"
                                | "cancelled"
                                | "interrupted"
                                | "failed"
                                | "prepared"
                                | "completed"
                        )
                    )
                {
                    return Err("Invalid batch attempts".into());
                }
                relative(
                    &root,
                    attempt["directory"]
                        .as_str()
                        .ok_or("Invalid batch result path")?,
                )?;
                if matches!(attempt["state"].as_str(), Some("running" | "cancelling")) {
                    attempt["state"] = json!("interrupted");
                    attempt["finished"] = json!(now());
                }
            }
        }
        batch["directory"] = json!(root);
        if busy(batch["state"].as_str().unwrap_or("")) {
            batch["state"] = json!("interrupted");
        }
        relative(&root, "workflow")?;
        *self.shared.data.lock().unwrap() = Some(batch);
        Ok(self.status())
    }
    fn job(&self, request: &Value) -> Result<(Job, Value), String> {
        let data = self.shared.data.lock().unwrap();
        let batch = data.as_ref().ok_or("No batch is open")?;
        if request["batch"] != batch["id"] {
            return Err("The displayed batch has changed".into());
        }
        let item = batch["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == request["item"])
            .ok_or("Invalid batch item")?;
        let attempts = item["attempts"].as_array().unwrap();
        let index = request["attempt"].as_u64().unwrap_or(attempts.len() as u64);
        let attempt = index
            .checked_sub(1)
            .and_then(|i| attempts.get(i as usize))
            .ok_or("This input has not started")?;
        let root = Path::new(batch["directory"].as_str().unwrap());
        let directory = relative(root, attempt["directory"].as_str().unwrap())?;
        Ok((
            Job {
                directory,
                state: state_name(&attempt["state"]),
                code: attempt["exitCode"].as_i64().map(|n| n as i32),
                message: attempt["message"].as_str().unwrap_or("").to_owned(),
                cancel: Arc::new(AtomicBool::new(false)),
            },
            json!({"id":item["id"],"name":item["name"],"path":item["path"],"attempt":index,"attempts":attempts.len()}),
        ))
    }
    pub fn detail(&self, request: &Value) -> Result<Value, String> {
        let (job, item) = self.job(request)?;
        Ok(json!({"job":job_value(&job),"item":item}))
    }
    pub fn trace(&self, request: &Value) -> Result<Value, String> {
        let (job, _) = self.job(request)?;
        crate::workflow_trace::read(&job, request)
    }
    pub fn open_result(&self, request: &Value, frontend: &Path) -> Result<Value, String> {
        let (job, _) = self.job(request)?;
        WorkflowManager::open_job_result(&job, request, frontend)
    }
    pub fn open_path(&self, request: &Value) -> Result<Value, String> {
        if request.get("item").is_none() {
            let data = self.shared.data.lock().unwrap();
            let b = data.as_ref().ok_or("No batch is open")?;
            if request["batch"] != b["id"]
                || request["directory"] != b["directory"]
                || request.get("file").is_some()
            {
                return Err("Invalid batch result path".into());
            }
            open_in_default_app(Path::new(b["directory"].as_str().unwrap()))?;
        } else {
            let (job, _) = self.job(request)?;
            open_in_default_app(&WorkflowManager::job_result_path(&job, request)?)?;
        }
        Ok(json!({"opened":true}))
    }
    pub fn shutdown(&self) {
        let _guard = self.lifecycle.lock().unwrap_or_else(|e| e.into_inner());
        self.stopped.store(true, Ordering::Release);
        self.shared.stop.store(true, Ordering::Release);
        if let Some(child) = self.shared.current.lock().unwrap().as_ref() {
            child.cancel();
        }
        if let Some(worker) = self.worker.lock().unwrap().take() {
            let _ = worker.join();
        }
    }
}
impl Drop for WorkflowBatch {
    fn drop(&mut self) {
        self.shutdown();
    }
}
fn edit(shared: &Shared, change: impl FnOnce(&mut Value)) -> Result<(), String> {
    let mut data = shared.data.lock().map_err(|e| e.to_string())?;
    let batch = data.as_mut().ok_or("No batch is open")?;
    change(batch);
    save(batch)
}
fn run(shared: &Shared, manager: &WorkflowManager) -> Result<(), String> {
    let count = shared.data.lock().unwrap().as_ref().unwrap()["cases"]
        .as_array()
        .unwrap()
        .len();
    for index in 0..count {
        let state = shared.data.lock().unwrap().as_ref().unwrap()["cases"][index]["state"].clone();
        if state != "waiting" {
            continue;
        }
        if shared.pause.load(Ordering::Acquire) {
            edit(shared, |b| b["state"] = json!("paused"))?;
        }
        while shared.pause.load(Ordering::Acquire) && !shared.stop.load(Ordering::Acquire) {
            thread::sleep(Duration::from_millis(150));
        }
        if shared.stop.load(Ordering::Acquire) {
            break;
        }
        let batch = shared.data.lock().unwrap().as_ref().unwrap().clone();
        let item = &batch["cases"][index];
        let root = Path::new(batch["directory"].as_str().unwrap());
        let folder = relative(root, item["folder"].as_str().unwrap())?;
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let attempt = item["attempts"].as_array().unwrap().len() + 1;
        if attempt > 128 {
            return Err("Too many attempts for this input".into());
        }
        let destination = folder.join(format!("attempt-{attempt:02}"));
        let record = json!({"directory":destination.strip_prefix(root).unwrap().to_string_lossy().replace('\\',"/"),"state":"running","exitCode":null,"message":"","started":now(),"finished":null});
        edit(shared, |b| {
            b["cases"][index]["state"] = json!("running");
            b["cases"][index]["attempts"]
                .as_array_mut()
                .unwrap()
                .push(record);
        })?;
        let child = Arc::new(manager.batch_child(&root.join("workflow")));
        *shared.current.lock().unwrap() = Some(child.clone());
        let launched = (|| -> Result<(), String> {
            if item["errors"].as_array().is_some_and(|v| !v.is_empty()) {
                return Err(item["errors"].to_string());
            }
            child.select("wavefunction", Path::new(item["path"].as_str().unwrap()))?;
            child.select("results", &folder)?;
            let mut request = batch["request"].clone();
            request["script"] = batch["script"].clone();
            let mut parameters = request["parameters"]
                .as_object()
                .cloned()
                .unwrap_or_default();
            if let Some(bindings) = item["bindings"].as_object() {
                for (key, value) in bindings {
                    if !Path::new(value.as_str().ok_or("Invalid file binding")?).is_file() {
                        return Err(format!("Companion file is missing: {value}"));
                    }
                    parameters.insert(key.clone(), value.clone());
                }
            }
            request["parameters"] = json!(parameters);
            if shared.stop.load(Ordering::Acquire) {
                return Err("Batch cancelled".into());
            }
            child.start_at(&request, Some(&destination))
        })();
        let outcome = match launched {
            Err(error) => {
                fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
                json!({"state":if shared.stop.load(Ordering::Acquire){"cancelled"}else{"failed"},"exitCode":null,"message":error})
            }
            Ok(()) => loop {
                if shared.stop.load(Ordering::Acquire) {
                    child.cancel();
                }
                if let Some(job) = child.job_snapshot() {
                    if !busy(job.state) {
                        break json!({"state":job.state,"exitCode":job.code,"message":job.message});
                    }
                }
                thread::sleep(Duration::from_millis(100));
            },
        };
        child.shutdown();
        *shared.current.lock().unwrap() = None;
        fs::write(
            destination.join("workflow-status.json"),
            serde_json::to_vec_pretty(&outcome).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        edit(shared, |b| {
            b["cases"][index]["state"] = outcome["state"].clone();
            let last = b["cases"][index]["attempts"]
                .as_array_mut()
                .unwrap()
                .last_mut()
                .unwrap();
            for key in ["state", "exitCode", "message"] {
                last[key] = outcome[key].clone();
            }
            last["finished"] = json!(now());
        })?;
    }
    edit(shared, |b| {
        let mut failed = false;
        let mut completed = false;
        for item in b["cases"].as_array_mut().unwrap() {
            if shared.stop.load(Ordering::Acquire) && item["state"] == "waiting" {
                item["state"] = json!("cancelled");
            }
            failed |= item["state"] == "failed";
            completed |= item["state"] == "completed";
        }
        b["state"] = json!(if shared.stop.load(Ordering::Acquire) {
            "cancelled"
        } else if failed {
            if completed {
                "partial"
            } else {
                "failed"
            }
        } else if b["request"]["dryRun"] == true {
            "prepared"
        } else {
            "completed"
        });
    })
}
