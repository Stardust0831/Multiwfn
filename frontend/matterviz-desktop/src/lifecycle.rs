use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tauri::Runtime;

const STARTUP_STATUS_ENV: &str = "MULTIWFN_MATTERVIZ_STARTUP_STATUS";
const STARTUP_TOKEN_ENV: &str = "MULTIWFN_MATTERVIZ_STARTUP_TOKEN";

#[derive(Clone, Debug)]
pub struct StartupStatus {
    pub path: Option<PathBuf>,
    pub token: Option<String>,
    pub reported_ready: Arc<AtomicBool>,
}

impl Default for StartupStatus {
    fn default() -> Self {
        Self {
            path: None,
            token: None,
            reported_ready: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl StartupStatus {
    pub fn from_environment() -> Self {
        Self {
            path: env::var_os(STARTUP_STATUS_ENV).map(PathBuf::from),
            token: env::var(STARTUP_TOKEN_ENV).ok(),
            reported_ready: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn line(&self, state: &str, message: Option<&str>) -> String {
        let token = self.token.as_deref().unwrap_or("");
        let message = message.unwrap_or("").replace(['\r', '\n'], " ");
        match (token.is_empty(), message.is_empty()) {
            (true, true) => format!("{state}\n"),
            (false, true) => format!("{state} {token}\n"),
            (true, false) => format!("{state}: {message}\n"),
            (false, false) => format!("{state} {token} {message}\n"),
        }
    }

    pub fn report(&self, state: &str, message: Option<&str>) {
        let Some(path) = &self.path else { return };
        let temporary = path.with_extension("status.tmp");
        if fs::write(&temporary, self.line(state, message)).is_ok() {
            let _ = fs::rename(temporary, path);
        }
    }

    pub fn ready(&self) {
        if !self.reported_ready.swap(true, Ordering::AcqRel) {
            self.report("ready", None);
        }
    }

    pub fn error(&self, message: &str) {
        self.report("error", Some(message));
    }
}

pub fn spawn_startup_timeout<R: Runtime>(
    app: tauri::AppHandle<R>,
    status: StartupStatus,
    timeout: Duration,
) {
    thread::spawn(move || {
        thread::sleep(timeout);
        if !status.reported_ready.load(Ordering::Acquire) {
            status.error("MatterViz WebView startup timed out");
            app.exit(2);
        }
    });
}

pub fn spawn_stop_watcher<R: Runtime>(app: tauri::AppHandle<R>, session: PathBuf) {
    thread::spawn(move || {
        let stop = session.join("gui_stop.flag");
        while !stop.is_file() {
            thread::sleep(Duration::from_millis(100));
        }
        app.exit(0);
    });
}

#[cfg(test)]
mod tests {
    use super::StartupStatus;

    #[test]
    fn status_line_sanitizes_messages() {
        let status = StartupStatus {
            token: Some("abc".to_owned()),
            ..Default::default()
        };
        assert_eq!(
            status.line("error", Some("bad\nnews")),
            "error abc bad news\n"
        );
    }
}
