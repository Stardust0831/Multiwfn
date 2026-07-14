mod backend;
mod cli;
mod file_dialog;
mod lifecycle;
mod memory_budget;
mod service;
mod stream_broker;
mod transport;
pub mod volume_protocol;
pub mod volume_store;

use std::env;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use tauri::webview::PageLoadEvent;
use tauri::{WebviewUrl, WebviewWindowBuilder, WindowEvent};
use url::Url;

use cli::{Cli, Mode};
use lifecycle::StartupStatus;
use service::HttpService;

fn main() -> ExitCode {
    let cli = match Cli::parse(env::args().skip(1)) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("MatterViz Desktop: {error}");
            return ExitCode::from(2);
        }
    };

    if let Some(dialog) = cli.file_dialog {
        let _ = std::fs::remove_file(&dialog.output);
        return match file_dialog::select_file(&dialog.output) {
            Ok(Some(path)) => {
                if let Err(error) = std::fs::write(&dialog.output, format!("{}\n", path.display()))
                {
                    eprintln!("MatterViz Desktop: could not write selected path: {error}");
                    ExitCode::from(2)
                } else {
                    ExitCode::SUCCESS
                }
            }
            Ok(None) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("MatterViz Desktop: file dialog failed: {error}");
                ExitCode::from(2)
            }
        };
    }

    match cli.mode {
        Mode::DevUrl(url) => run_tauri(url, None, cli.startup_timeout),
        Mode::Managed(config) => {
            let failed_session = config.session.clone();
            match HttpService::start(config) {
                Ok(service) => {
                    let url = service.url().to_owned();
                    eprintln!("Multiwfn MatterViz GUI service: {url}");
                    run_tauri(url, Some(Arc::new(service)), cli.startup_timeout)
                }
                Err(error) => {
                    if let Err(signal_error) =
                        std::fs::write(failed_session.join("gui_stop.flag"), "return\n")
                    {
                        eprintln!(
                            "MatterViz Desktop: could not signal Multiwfn after startup failure: {signal_error}"
                        );
                    }
                    eprintln!("MatterViz Desktop: could not start service: {error}");
                    ExitCode::from(2)
                }
            }
        }
    }
}

fn run_tauri(url: String, service: Option<Arc<HttpService>>, timeout: Duration) -> ExitCode {
    let startup = StartupStatus::from_environment();
    let parsed = match Url::parse(&url) {
        Ok(value) => value,
        Err(error) => {
            startup.error(&format!("invalid MatterViz URL: {error}"));
            return ExitCode::from(2);
        }
    };
    let setup_status = startup.clone();
    let page_url = parsed.clone();
    let window_service = service.clone();
    let cleanup_service = service.clone();
    let stop_service = service.clone();
    let result = tauri::Builder::default()
        .setup(move |app| {
            let callback_status = setup_status.clone();
            let window_result =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(page_url.clone()))
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
                return Err(std::io::Error::other(message).into());
            }
            lifecycle::spawn_startup_timeout(app.handle().clone(), setup_status.clone(), timeout);
            if let Some(service) = stop_service.clone() {
                lifecycle::spawn_stop_watcher(
                    app.handle().clone(),
                    service.session_path().to_path_buf(),
                );
            }
            Ok(())
        })
        .on_window_event(move |_window, event| {
            if let Some(service) = window_service.as_ref() {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        if let Err(error) = service.signal_return() {
                            eprintln!("MatterViz Desktop: {error}");
                            api.prevent_close();
                            return;
                        }
                        service.shutdown();
                    }
                    WindowEvent::Destroyed => {
                        if let Err(error) = service.signal_return() {
                            eprintln!("MatterViz Desktop: {error}");
                        }
                        service.shutdown();
                    }
                    _ => {}
                }
            }
        })
        .run(tauri::generate_context!());

    if let Err(error) = result {
        let message = format!("error while running MatterViz Desktop: {error}");
        startup.error(&message);
        if let Some(service) = service.as_ref() {
            if let Err(signal_error) = service.signal_return() {
                eprintln!("MatterViz Desktop: {signal_error}");
            }
            service.shutdown();
            service.join();
        }
        eprintln!("MatterViz Desktop: {message}");
        return ExitCode::from(2);
    }
    if let Some(service) = cleanup_service {
        let signal_result = service.signal_return();
        service.shutdown();
        service.join();
        if let Err(error) = signal_result {
            eprintln!("MatterViz Desktop: {error}");
            return ExitCode::from(2);
        }
    }
    ExitCode::SUCCESS
}
