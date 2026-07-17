mod backend;
mod cli;
mod control_protocol;
mod control_transport;
mod file_dialog;
mod inherited_pipe;
mod lifecycle;
mod memory_budget;
mod picker_protocol;
mod service;
mod session_data;
mod stream_broker;
mod transport;
pub mod volume_protocol;
pub mod volume_store;

use std::env;
use std::path::Path;
use std::process::ExitCode;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tauri::webview::PageLoadEvent;
use tauri::{WebviewUrl, WebviewWindowBuilder, WindowEvent};
use url::Url;

use cli::{Cli, FileDialogDestination, Mode};
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
        return match dialog.destination {
            FileDialogDestination::Output(output) => {
                let _ = std::fs::remove_file(&output);
                match file_dialog::select_file(&output) {
                    Ok(Some(path)) => {
                        if let Err(error) = std::fs::write(&output, format!("{}\n", path.display()))
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
                }
            }
            FileDialogDestination::ResultPipe(raw) => run_result_pipe_dialog(raw),
        };
    }

    let startup_timeout = cli.startup_timeout;
    let control_transport = cli.control_transport;
    let managed_control = control_transport.is_some();
    match cli.mode {
        Mode::DevUrl(url) => run_tauri(url, None, startup_timeout),
        Mode::Managed(config) => {
            let failed_session = config.session.clone();
            match HttpService::start_with_control(config, control_transport) {
                Ok(service) => {
                    let url = service.url().to_owned();
                    eprintln!("Multiwfn MatterViz GUI service: {url}");
                    run_tauri(url, Some(Arc::new(service)), startup_timeout)
                }
                Err(error) => {
                    if !managed_control {
                        if let Err(signal_error) =
                            std::fs::write(failed_session.join("gui_stop.flag"), "return\n")
                        {
                            eprintln!(
                                "MatterViz Desktop: could not signal Multiwfn after startup failure: {signal_error}"
                            );
                        }
                    }
                    eprintln!("MatterViz Desktop: could not start service: {error}");
                    ExitCode::from(2)
                }
            }
        }
    }
}

fn run_result_pipe_dialog(raw: u64) -> ExitCode {
    let mut writer = match picker_protocol::ResultPipeWriter::adopt(raw) {
        Ok(writer) => writer,
        Err(error) => {
            eprintln!("MatterViz Desktop: could not open picker result pipe: {error}");
            return ExitCode::from(2);
        }
    };
    let result = file_dialog::select_file(Path::new(""));
    let dialog_failed = result.is_err();
    let frame = match result {
        Ok(Some(path)) => match path.to_str() {
            Some(path) => picker_protocol::encode_selected(path),
            None => picker_protocol::encode_error("selected path is not valid UTF-8"),
        },
        Ok(None) => picker_protocol::encode_cancel(),
        Err(error) => picker_protocol::encode_error(&format!("file dialog failed: {error}")),
    };
    let frame = match frame {
        Ok(frame) => frame,
        Err(error) => {
            eprintln!("MatterViz Desktop: could not encode picker result: {error}");
            match picker_protocol::encode_error(&format!("picker result failed: {error}")) {
                Ok(frame) => frame,
                Err(_) => return ExitCode::from(2),
            }
        }
    };
    if let Err(error) = writer.write_frame(&frame) {
        eprintln!("MatterViz Desktop: could not write picker result: {error}");
        return ExitCode::from(2);
    }
    if dialog_failed || frame.get(12).copied() == Some(picker_protocol::PickerStatus::Error as u8) {
        ExitCode::from(2)
    } else {
        ExitCode::SUCCESS
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
                if service.uses_file_lifecycle() {
                    lifecycle::spawn_stop_watcher(
                        app.handle().clone(),
                        service.session_path().to_path_buf(),
                    );
                } else {
                    let app = app.handle().clone();
                    thread::spawn(move || {
                        while !service.is_shutdown() {
                            thread::sleep(Duration::from_millis(50));
                        }
                        app.exit(service.termination_exit_code());
                    });
                }
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
