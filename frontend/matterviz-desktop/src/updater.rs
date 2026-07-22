use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

const MAX_OUTPUT_BYTES: usize = 64 * 1024;
const MAX_FIELD_BYTES: usize = 1024;
const MAX_TAG_BYTES: usize = 128;
const MAX_CONFLICTS: usize = 16;
const CHECK_TIMEOUT: Duration = Duration::from_secs(75);
const STARTUP_STATUS_TIMEOUT: Duration = Duration::from_secs(3);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Clone, Debug)]
pub(crate) struct UpdateManager {
    executable: Option<PathBuf>,
    host_pid: u32,
    multiwfn_pid: Option<u64>,
    state: Arc<Mutex<UpdateState>>,
    operation: Arc<AtomicBool>,
}

struct OperationGuard(Arc<AtomicBool>);

impl Drop for OperationGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Clone, Debug)]
struct UpdateState {
    visible: bool,
    state: &'static str,
    current_tag: Option<String>,
    target_tag: Option<String>,
    progress: u8,
    conflicts: Vec<String>,
    message: Option<String>,
}

impl UpdateState {
    fn hidden() -> Self {
        Self {
            visible: false,
            state: "idle",
            current_tag: None,
            target_tag: None,
            progress: 0,
            conflicts: Vec::new(),
            message: None,
        }
    }

    fn visible() -> Self {
        Self {
            visible: true,
            state: "idle",
            current_tag: None,
            target_tag: None,
            progress: 0,
            conflicts: Vec::new(),
            message: None,
        }
    }

    fn json(&self) -> Value {
        json!({
            "format": "multiwfn-matterviz-update",
            "version": 1,
            "visible": self.visible,
            "state": self.state,
            "currentTag": self.current_tag,
            "targetTag": self.target_tag,
            "progress": self.progress,
            "conflicts": self.conflicts,
            "message": self.message,
        })
    }
}

#[derive(Debug)]
struct CommandOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

impl UpdateManager {
    pub(crate) fn new(multiwfn_pid: Option<u64>) -> Self {
        let host_pid = std::process::id();
        let sibling = std::env::current_exe()
            .ok()
            .and_then(|host| updater_sibling(&host))
            .filter(|path| path.is_file());
        let startup = if multiwfn_pid.is_some() {
            sibling
                .as_deref()
                .and_then(updater_status)
                .filter(|value| value.get("enabled").and_then(Value::as_bool) == Some(true))
        } else {
            None
        };
        let executable = startup.as_ref().and(sibling);
        let initial = startup.map_or_else(UpdateState::hidden, |value| startup_state(&value));
        Self {
            executable,
            host_pid,
            multiwfn_pid,
            state: Arc::new(Mutex::new(initial)),
            operation: Arc::new(AtomicBool::new(false)),
        }
    }

    #[cfg(test)]
    fn with_executable(executable: Option<PathBuf>, host_pid: u32, multiwfn_pid: Option<u64>) -> Self {
        let initial = if executable.is_some() && multiwfn_pid.is_some() {
            UpdateState::visible()
        } else {
            UpdateState::hidden()
        };
        Self {
            executable,
            host_pid,
            multiwfn_pid,
            state: Arc::new(Mutex::new(initial)),
            operation: Arc::new(AtomicBool::new(false)),
        }
    }

    pub(crate) fn status(&self) -> Value {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .json()
    }

    pub(crate) fn visible(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .visible
    }

    pub(crate) fn start_check(&self) -> Result<Value, String> {
        self.start_async("checking", "check", CHECK_TIMEOUT, |state, output| {
            apply_helper_state(state, output, "available")
        })
    }

    pub(crate) fn start_stage(&self) -> Result<Value, String> {
        self.start_async("staging", "stage", CHECK_TIMEOUT, |state, output| {
            apply_helper_state(state, output, "ready")
        })
    }

    pub(crate) fn install(&self) -> Result<Value, String> {
        let Some(executable) = self.executable.clone() else {
            return Err("MatterViz updater is unavailable".to_owned());
        };
        let Some(multiwfn_pid) = self.multiwfn_pid else {
            return Err("Multiwfn PID is unavailable".to_owned());
        };
        let _guard = self.try_acquire_operation()?;
        self.set_state(|state| {
            state.state = "installing";
            state.progress = 0;
            state.message = None;
            state.conflicts.clear();
        });
        let output = run_helper(
            &executable,
            &[
                "install",
                "--json",
                "--host-pid",
                &self.host_pid.to_string(),
                "--multiwfn-pid",
                &multiwfn_pid.to_string(),
            ],
            INSTALL_TIMEOUT,
        );
        match output.and_then(parse_helper_json) {
            Ok(value) if value.get("ok").and_then(Value::as_bool) != Some(false) => {
                self.set_state(|state| {
                    state.state = "idle";
                    state.progress = 100;
                    state.message = helper_message(&value);
                });
                Ok(value)
            }
            Ok(value) => {
                let message = helper_error(&value);
                self.set_failure(&value, &message);
                Err(message)
            }
            Err(error) => {
                self.set_error(&error);
                Err(error)
            }
        }
    }

    pub(crate) fn confirm_after_ready(&self) {
        let Some(executable) = self.executable.clone() else {
            return;
        };
        let manager = self.clone();
        thread::spawn(move || {
            let Ok(_guard) = manager.try_acquire_operation() else {
                return;
            };
            let status = run_helper(&executable, &["status", "--json"], CHECK_TIMEOUT)
                .and_then(parse_helper_json);
            let Ok(value) = status else {
                return;
            };
            if !pending_healthy(&value) {
                return;
            }
            let result = run_helper(&executable, &["confirm", "--json"], CHECK_TIMEOUT)
                .and_then(parse_helper_json);
            if let Ok(result) = result {
                if result.get("ok").and_then(Value::as_bool) == Some(false) {
                    manager.set_failure(&result, &helper_error(&result));
                } else {
                    manager.set_state(|state| apply_helper_state(state, &result, "idle"));
                }
            }
        });
    }

    fn start_async<F>(
        &self,
        state_name: &'static str,
        command: &'static str,
        timeout: Duration,
        apply: F,
    ) -> Result<Value, String>
    where
        F: Fn(&mut UpdateState, &Value) + Send + 'static,
    {
        let Some(executable) = self.executable.clone() else {
            return Err("MatterViz updater is unavailable".to_owned());
        };
        let guard = self.try_acquire_operation()?;
        self.set_state(|state| {
            state.state = state_name;
            state.progress = 0;
            state.message = None;
            state.conflicts.clear();
        });
        let manager = self.clone();
        thread::spawn(move || {
            let _guard = guard;
            let result = run_helper(&executable, &[command, "--json"], timeout)
                .and_then(parse_helper_json);
            match result {
                Ok(value) if value.get("ok").and_then(Value::as_bool) != Some(false) => {
                    manager.set_state(|state| apply(state, &value));
                }
                Ok(value) => manager.set_failure(&value, &helper_error(&value)),
                Err(error) => manager.set_error(&error),
            }
        });
        Ok(self.status())
    }

    fn try_acquire_operation(&self) -> Result<OperationGuard, String> {
        self.operation
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| OperationGuard(self.operation.clone()))
            .map_err(|_| "an update operation is already running".to_owned())
    }

    fn set_state<F>(&self, update: F)
    where
        F: FnOnce(&mut UpdateState),
    {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        update(&mut state);
    }

    fn set_error(&self, message: &str) {
        self.set_state(|state| {
            state.state = "error";
            state.progress = 0;
            state.message = Some(bound_string(message, MAX_FIELD_BYTES));
        });
    }

    fn set_failure(&self, value: &Value, message: &str) {
        let explicit_state = value
            .get("state")
            .and_then(Value::as_str)
            .and_then(valid_state);
        let conflicts = conflicts_value(value);
        self.set_state(|state| {
            state.state = explicit_state.unwrap_or(if conflicts.is_empty() {
                "error"
            } else {
                "conflict"
            });
            state.progress = 0;
            state.conflicts = conflicts;
            state.current_tag = tag_value(value, "currentTag");
            state.target_tag = tag_value(value, "targetTag");
            state.message = Some(bound_string(message, MAX_FIELD_BYTES));
        });
    }
}

pub(crate) fn updater_sibling(host: &Path) -> Option<PathBuf> {
    let parent = host.parent()?;
    let name = if cfg!(windows) {
        "multiwfn-matterviz-updater.exe"
    } else {
        "multiwfn-matterviz-updater"
    };
    Some(parent.join(name))
}

fn updater_status(executable: &Path) -> Option<Value> {
    run_helper(executable, &["status", "--json"], STARTUP_STATUS_TIMEOUT)
        .and_then(parse_helper_json)
        .ok()
}

fn startup_state(value: &Value) -> UpdateState {
    let mut state = UpdateState::visible();
    state.state = if value.get("recovery").and_then(Value::as_bool) == Some(true) {
        "recovery"
    } else {
        value
            .get("state")
            .and_then(Value::as_str)
            .and_then(valid_state)
            .unwrap_or("idle")
    };
    state.current_tag = tag_value(value, "currentTag");
    state.target_tag = tag_value(value, "targetTag");
    state.progress = value
        .get("progress")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        .min(100) as u8;
    state.message = helper_message(value);
    state
}

fn run_helper(executable: &Path, args: &[&str], timeout: Duration) -> Result<CommandOutput, String> {
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("could not start updater: {error}"))?;
    let stdout = child.stdout.take().ok_or_else(|| "updater stdout unavailable".to_owned())?;
    let stderr = child.stderr.take().ok_or_else(|| "updater stderr unavailable".to_owned())?;
    let stdout_thread = thread::spawn(|| bounded_read(stdout));
    let stderr_thread = thread::spawn(|| bounded_read(stderr));
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                child
                    .wait()
                    .map_err(|error| format!("could not stop timed out updater: {error}"))?;
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err("updater timed out".to_owned());
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(error) => return Err(format!("could not poll updater: {error}")),
        }
    };
    let stdout = stdout_thread
        .join()
        .map_err(|_| "updater stdout reader failed".to_owned())??;
    let stderr = stderr_thread
        .join()
        .map_err(|_| "updater stderr reader failed".to_owned())??;
    Ok(CommandOutput {
        status,
        stdout,
        stderr,
    })
}

fn bounded_read(mut reader: impl Read) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        let count = reader
            .read(&mut chunk)
            .map_err(|error| format!("could not read updater output: {error}"))?;
        if count == 0 {
            return Ok(bytes);
        }
        if bytes.len().saturating_add(count) > MAX_OUTPUT_BYTES {
            return Err("updater output exceeded 64 KiB".to_owned());
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
}

fn parse_helper_json(output: CommandOutput) -> Result<Value, String> {
    parse_helper_bytes(
        output.status.success(),
        &output.stdout,
        &output.stderr,
        &output.status.to_string(),
    )
}

fn parse_helper_bytes(
    success: bool,
    stdout: &[u8],
    stderr: &[u8],
    status: &str,
) -> Result<Value, String> {
    if let Ok(value) = serde_json::from_slice::<Value>(stdout) {
        if value.get("format").and_then(Value::as_str)
            == Some("multiwfn-matterviz-update")
            && value.get("version").and_then(Value::as_u64) == Some(1)
        {
            return Ok(value);
        }
    }
    if !success {
        let detail = if stderr.is_empty() {
            format!("updater exited with {status}")
        } else {
            String::from_utf8_lossy(stderr).trim().to_owned()
        };
        return Err(bound_string(&detail, MAX_FIELD_BYTES));
    }
    let value: Value = serde_json::from_slice(stdout)
        .map_err(|error| format!("updater returned invalid JSON: {error}"))?;
    Err(if value.is_object() {
        "updater returned an unsupported protocol response".to_owned()
    } else {
        "updater returned a non-object JSON value".to_owned()
    })
}

fn apply_helper_state(state: &mut UpdateState, value: &Value, available_state: &'static str) {
    state.state = value
        .get("state")
        .and_then(Value::as_str)
        .and_then(valid_state)
        .unwrap_or_else(|| {
            if value.get("available").and_then(Value::as_bool) == Some(true) {
                available_state
            } else if available_state == "ready" {
                "ready"
            } else {
                "idle"
            }
        });
    state.progress = value
        .get("progress")
        .and_then(Value::as_u64)
        .unwrap_or(if state.state == "idle" { 100 } else { 0 })
        .min(100) as u8;
    state.current_tag = tag_value(value, "currentTag");
    state.target_tag = tag_value(value, "targetTag");
    state.conflicts = conflicts_value(value);
    if !state.conflicts.is_empty() {
        state.state = "conflict";
    }
    state.message = helper_message(value);
}

fn valid_state(value: &str) -> Option<&'static str> {
    match value {
        "idle" => Some("idle"),
        "checking" => Some("checking"),
        "available" => Some("available"),
        "staging" => Some("staging"),
        "ready" => Some("ready"),
        "conflict" => Some("conflict"),
        "installing" => Some("installing"),
        "error" => Some("error"),
        "recovery" => Some("recovery"),
        _ => None,
    }
}

fn tag_value(value: &Value, name: &str) -> Option<String> {
    value
        .get(name)
        .or_else(|| value.get(name.strip_suffix("Tag").unwrap_or(name)))
        .and_then(Value::as_str)
        .map(|tag| bound_string(tag, MAX_TAG_BYTES))
}

fn conflicts_value(value: &Value) -> Vec<String> {
    value
        .get("conflicts")
        .and_then(Value::as_array)
        .into_iter()
        .flat_map(|items| items.iter())
        .filter_map(Value::as_str)
        .take(MAX_CONFLICTS)
        .map(|message| bound_string(message, MAX_FIELD_BYTES))
        .collect()
}

fn helper_message(value: &Value) -> Option<String> {
    value
        .get("message")
        .and_then(Value::as_str)
        .map(|message| bound_string(message, MAX_FIELD_BYTES))
}

fn helper_error(value: &Value) -> String {
    helper_message(value).unwrap_or_else(|| "updater operation failed".to_owned())
}

fn pending_healthy(value: &Value) -> bool {
    value.get("pendingHealthy").and_then(Value::as_bool) == Some(true)
}

fn bound_string(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::{parse_helper_bytes, startup_state, updater_sibling, UpdateManager};
    use serde_json::json;
    use std::path::Path;

    #[test]
    fn updater_path_is_exact_host_sibling() {
        let host = Path::new("/tmp/package/resources/tools/matterviz-desktop");
        let expected_name = if cfg!(windows) {
            "multiwfn-matterviz-updater.exe"
        } else {
            "multiwfn-matterviz-updater"
        };
        assert_eq!(
            updater_sibling(host).unwrap(),
            Path::new("/tmp/package/resources/tools").join(expected_name)
        );
    }

    #[test]
    fn absent_updater_is_hidden() {
        let manager = UpdateManager::with_executable(None, 12, Some(34));
        assert_eq!(manager.status()["visible"], false);
        assert!(manager.start_check().is_err());
    }

    #[test]
    fn missing_multiwfn_pid_keeps_updater_hidden() {
        let manager = UpdateManager::with_executable(
            Some(Path::new("/tmp/sibling-updater").to_owned()),
            12,
            None,
        );
        assert_eq!(manager.status()["visible"], false);
    }

    #[test]
    fn preserves_structured_failure_json_from_nonzero_exit() {
        let value = parse_helper_bytes(
            false,
            br#"{"format":"multiwfn-matterviz-update","version":1,"ok":false,"state":"conflict","conflicts":["settings.ini"]}"#,
            b"",
            "exit status: 1",
        )
        .unwrap();
        assert_eq!(value["state"], "conflict");
        assert_eq!(value["conflicts"][0], "settings.ini");
    }

    #[test]
    fn rejects_unversioned_updater_responses() {
        let error = parse_helper_bytes(
            true,
            br#"{"ok":true,"enabled":true}"#,
            b"",
            "exit status: 0",
        )
        .unwrap_err();
        assert!(error.contains("unsupported protocol"));
    }

    #[test]
    fn startup_preserves_an_explicit_recovery_state() {
        let state = startup_state(&json!({
            "state": "idle",
            "recovery": true,
            "pendingHealthy": false,
            "currentTag": "matterviz-preview-1",
            "targetTag": "matterviz-preview-2"
        }));
        assert_eq!(state.state, "recovery");
        assert_eq!(state.current_tag.as_deref(), Some("matterviz-preview-1"));
        assert_eq!(state.target_tag.as_deref(), Some("matterviz-preview-2"));
    }
}
