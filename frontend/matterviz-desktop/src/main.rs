use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::webview::PageLoadEvent;
use tauri::{WebviewUrl, WebviewWindowBuilder};
use url::Url;

const DEFAULT_URL: &str = "http://127.0.0.1:8765/index.html?manifest=/session/manifest.json";
const URL_ENV: &str = "MATTERVIZ_WEB_URL";
const STARTUP_STATUS_ENV: &str = "MULTIWFN_MATTERVIZ_STARTUP_STATUS";
const STARTUP_TOKEN_ENV: &str = "MULTIWFN_MATTERVIZ_STARTUP_TOKEN";
const STOP_FILE_ENV: &str = "MULTIWFN_MATTERVIZ_STOP_FILE";
const STOP_FILE_POLL_INTERVAL: Duration = Duration::from_millis(250);

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1")
}

fn requested_url() -> Result<Url, String> {
    let mut cli_url = None;
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--url" {
            cli_url = Some(
                args.next()
                    .ok_or_else(|| "--url requires an HTTP(S) URL".to_owned())?,
            );
        } else if let Some(value) = arg.strip_prefix("--url=") {
            cli_url = Some(value.to_owned());
        } else if !arg.starts_with('-') && cli_url.is_none() {
            cli_url = Some(arg);
        }
    }

    let value = cli_url
        .or_else(|| env::var(URL_ENV).ok())
        .unwrap_or_else(|| DEFAULT_URL.to_owned());
    let parsed = Url::parse(&value).map_err(|error| format!("invalid MatterViz URL: {error}"))?;

    let host = parsed
        .host_str()
        .ok_or_else(|| "MatterViz URL must include a host".to_owned())?
        .to_ascii_lowercase();
    match parsed.scheme() {
        "http" if !is_loopback_host(&host) => {
            return Err(format!(
                "plain HTTP MatterViz URLs must use localhost, 127.0.0.1, or ::1; got {host}"
            ));
        }
        "http" | "https" => {}
        scheme => return Err(format!("MatterViz URL must use HTTP(S), got {scheme:?}")),
    }

    Ok(parsed)
}

#[derive(Clone, Debug)]
struct StartupStatus {
    path: Option<PathBuf>,
    token: Option<String>,
    reported_ready: Arc<AtomicBool>,
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
    fn from_environment() -> Self {
        Self {
            path: env::var_os(STARTUP_STATUS_ENV).map(PathBuf::from),
            token: env::var(STARTUP_TOKEN_ENV).ok(),
            reported_ready: Arc::new(AtomicBool::new(false)),
        }
    }

    fn line(&self, state: &str, message: Option<&str>) -> String {
        let token = self.token.as_deref().unwrap_or("");
        let clean_message = message.unwrap_or("").replace('\r', " ").replace('\n', " ");
        if clean_message.is_empty() {
            if token.is_empty() {
                format!("{state}\n")
            } else {
                format!("{state} {token}\n")
            }
        } else if token.is_empty() {
            format!("{state}: {clean_message}\n")
        } else {
            format!("{state} {token} {clean_message}\n")
        }
    }

    fn report(&self, state: &str, message: Option<&str>) {
        let Some(path) = &self.path else {
            return;
        };
        let payload = self.line(state, message);
        // Replace in the same directory so readers never observe a partially
        // written status. A fixed temporary name is sufficient because only
        // one shell process owns a session status path at a time.
        let temporary = path.with_extension("status.tmp");
        if fs::write(&temporary, payload).is_ok() {
            let _ = fs::rename(&temporary, path);
        }
    }

    fn ready(&self) {
        if self.reported_ready.swap(true, Ordering::AcqRel) {
            return;
        }
        self.report("ready", None);
    }

    fn error(&self, message: &str) {
        self.report("error", Some(message));
    }

    fn managed_by_adapter(&self) -> bool {
        self.path.is_some()
    }
}

fn stop_file_path(managed_by_adapter: bool, configured_path: Option<OsString>) -> Option<PathBuf> {
    if !managed_by_adapter {
        return None;
    }
    configured_path
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

fn stop_file_from_environment(managed_by_adapter: bool) -> Option<PathBuf> {
    if !managed_by_adapter {
        return None;
    }
    stop_file_path(true, env::var_os(STOP_FILE_ENV))
}

// The adapter owns this session flag. Keep the watcher out of standalone
// desktop launches, where no session lifecycle is managed by this process.
fn spawn_stop_file_watcher<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: PathBuf) {
    let app_handle = app.clone();
    std::thread::spawn(move || loop {
        if path.is_file() {
            app_handle.exit(0);
            break;
        }
        std::thread::sleep(STOP_FILE_POLL_INTERVAL);
    });
}

fn main() {
    let startup = StartupStatus::from_environment();
    let web_url = requested_url().unwrap_or_else(|error| {
        startup.error(&error);
        if !startup.managed_by_adapter() {
            eprintln!("MatterViz Desktop: {error}");
        }
        std::process::exit(2);
    });

    let setup_status = startup.clone();
    let setup_url = web_url.clone();
    let stop_file = stop_file_from_environment(startup.managed_by_adapter());
    let result = tauri::Builder::default()
        .setup(move |app| {
            let callback_status = setup_status.clone();
            let window_result =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(setup_url.clone()))
                    .title("MatterViz")
                    .inner_size(1400.0, 900.0)
                    .resizable(true)
                    .on_page_load(move |_window, payload| {
                        if matches!(payload.event(), PageLoadEvent::Finished) {
                            callback_status.ready();
                        }
                    })
                    .build();
            if let Err(error) = window_result {
                let message = format!("could not create MatterViz window: {error}");
                setup_status.error(&message);
                return Err(std::io::Error::new(std::io::ErrorKind::Other, message).into());
            }
            if let Some(path) = stop_file.clone() {
                spawn_stop_file_watcher(app.handle(), path);
            }
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(error) = result {
        let message = format!("error while running MatterViz Desktop: {error}");
        startup.error(&message);
        if !startup.managed_by_adapter() {
            eprintln!("MatterViz Desktop: {message}");
        }
        std::process::exit(2);
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::path::PathBuf;

    use super::{stop_file_path, StartupStatus};

    #[test]
    fn status_line_contains_token_and_single_line_message() {
        let status = StartupStatus {
            path: None,
            token: Some("session-token".to_owned()),
            reported_ready: Default::default(),
        };
        assert_eq!(status.line("ready", None), "ready session-token\n");
        assert_eq!(
            status.line("error", Some("bad\nnews")),
            "error session-token bad news\n"
        );
    }

    #[test]
    fn status_line_works_without_adapter_environment() {
        let status = StartupStatus::default();
        assert_eq!(status.line("ready", None), "ready\n");
        assert_eq!(status.line("error", Some("bad URL")), "error: bad URL\n");
    }

    #[test]
    fn stop_file_path_requires_adapter_management() {
        let configured = Some(OsString::from("/tmp/session/gui_stop.flag"));
        assert_eq!(stop_file_path(false, configured), None);
    }

    #[test]
    fn stop_file_path_preserves_configured_path() {
        let configured = Some(OsString::from("/tmp/session/gui_stop.flag"));
        assert_eq!(
            stop_file_path(true, configured),
            Some(PathBuf::from("/tmp/session/gui_stop.flag"))
        );
        assert_eq!(stop_file_path(true, Some(OsString::new())), None);
    }
}
