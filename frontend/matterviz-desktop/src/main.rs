mod backend;
mod cli;
mod control_protocol;
mod control_transport;
mod file_dialog;
mod inherited_pipe;
mod lifecycle;
mod memory_budget;
mod picker_protocol;
pub mod plot_protocol;
pub mod plot_store;
mod service;
mod session_data;
mod shutdown;
mod stream_broker;
mod transport;
mod updater;
pub mod volume_protocol;
pub mod volume_store;
mod workbench_args;
mod workflow_results;
mod workflows;

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
    if env::args().nth(1).as_deref() == Some("--workflow-result") {
        return launch_workflow_result();
    }
    if env::args().nth(1).as_deref() == Some("--workbench") {
        return launch_workbench();
    }
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

#[cfg(any(unix, windows))]
fn desktop_context() -> tauri::Context<tauri::Wry> {
    // macOS embeds a named Info.plist symbol: expand this macro only once.
    tauri::generate_context!()
}

#[cfg(any(unix, windows))]
fn launch_workbench() -> ExitCode {
    let result = (|| -> Result<(), String> {
        let executable = env::current_exe().map_err(|e| e.to_string())?;
        let resources = executable
            .parent()
            .and_then(Path::parent)
            .ok_or("Invalid installation")?;
        let root = resources.parent().ok_or("Missing installation directory")?;
        let engine = if resources.file_name().is_some_and(|n| n == "Resources") {
            root.join("MacOS/Multiwfn_MatterVizGUI")
        } else {
            root.join(if cfg!(windows) {
                "Multiwfn_MatterVizGUI.exe"
            } else {
                "Multiwfn_MatterVizGUI"
            })
        };
        let args = workbench_args::WorkbenchArgs::parse(env::args_os().skip(2))?;
        let service = service::WorkbenchService::start(
            resources.join("frontend/matterviz-viewer/dist"),
            engine,
            args.startup.as_deref(),
            args.script.as_deref(),
        )?;
        let page = Url::parse(&service.url).map_err(|e| e.to_string())?;
        eprintln!("BaneWfn workbench started");
        let mut context = desktop_context();
        context.set_default_window_icon(Some(tauri::include_image!(
            "../workflows/icons/banewfn.png"
        )));
        let result = tauri::Builder::default()
            .setup(move |app| {
                let _window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(page))
                    .title("BaneWfn")
                    .inner_size(1200.0, 820.0)
                    .min_inner_size(900.0, 600.0)
                    .build()?;
                #[cfg(windows)]
                {
                    // Tao sets the title-bar icon; Windows uses ICON_BIG for
                    // the taskbar and Alt+Tab. Both borrow the window-owned icon.
                    use windows_sys::Win32::UI::WindowsAndMessaging::{
                        SendMessageW, ICON_BIG, ICON_SMALL, WM_GETICON, WM_SETICON,
                    };
                    let hwnd = _window.hwnd()?.0 as _;
                    unsafe {
                        let icon = SendMessageW(hwnd, WM_GETICON, ICON_SMALL as usize, 0);
                        if icon != 0 {
                            SendMessageW(hwnd, WM_SETICON, ICON_BIG as usize, icon);
                        }
                    }
                }
                Ok(())
            })
            .build(context)
            .map(|app| {
                app.run_return(|_, _| {});
            });
        service.shutdown();
        result.map_err(|e| e.to_string())
    })();
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("BaneWfn: {e}");
            ExitCode::from(2)
        }
    }
}

fn launch_workflow_result() -> ExitCode {
    use std::io::Read;
    let result = (|| -> Result<ExitCode, String> {
        let frontend = env::args_os().nth(2).ok_or("Missing viewer frontend")?;
        let mut input = String::new();
        std::io::stdin()
            .take(128 * 1024)
            .read_to_string(&mut input)
            .map_err(|e| e.to_string())?;
        let plan = serde_json::from_str(&input).map_err(|e| e.to_string())?;
        let session = workflow_results::ViewSession::create(&plan)?;
        let service = HttpService::start_with_control(
            service::AppConfig {
                frontend: frontend.into(),
                session: session.0.clone(),
                manifest: None,
                state: None,
                host: if cfg!(target_os = "macos") {
                    "localhost"
                } else {
                    "127.0.0.1"
                }
                .into(),
                port: 0,
                transport: None,
                multiwfn_pid: None,
            },
            None,
        )?;
        eprintln!("BaneWfn result viewer started");
        // The guard lives through the WebView event loop, even if the workbench exits.
        Ok(run_tauri(
            service.url().to_owned(),
            Some(Arc::new(service)),
            Duration::from_secs(120),
        ))
    })();
    match result {
        Ok(code) => code,
        Err(error) => {
            eprintln!("BaneWfn result viewer: {error}");
            rfd::MessageDialog::new()
                .set_title("BaneWfn")
                .set_description(&error)
                .set_level(rfd::MessageLevel::Error)
                .show();
            ExitCode::from(2)
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
    let ready_service = service.clone();
    let navigation_reports_ready = service.is_none();
    let result = tauri::Builder::default()
        .setup(move |app| {
            let callback_status = setup_status.clone();
            let window_result =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(page_url.clone()))
                    .title("MatterViz")
                    .inner_size(1400.0, 900.0)
                    .resizable(true)
                    .on_page_load(move |_window, payload| {
                        if navigation_reports_ready
                            && matches!(payload.event(), PageLoadEvent::Finished)
                        {
                            callback_status.ready();
                        }
                    })
                    .build();
            if let Err(error) = window_result {
                let message = format!("could not create MatterViz window: {error}");
                setup_status.error(&message);
                return Err(std::io::Error::other(message).into());
            }
            if let Some(service) = ready_service.clone() {
                let ready_status = setup_status.clone();
                thread::spawn(move || {
                    while !service.is_shutdown() {
                        if service.frontend_ready() {
                            service.confirm_update_after_ready();
                            ready_status.ready();
                            break;
                        }
                        thread::sleep(Duration::from_millis(20));
                    }
                });
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
        // Builder::run exits the process directly, bypassing cleanup guards.
        .build(desktop_context())
        .map(|app| app.run_return(|_, _| {}));

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
    ExitCode::from(result.unwrap_or(2) as u8)
}
