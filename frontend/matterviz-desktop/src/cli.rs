use std::path::PathBuf;
use std::time::Duration;

use url::Url;

use crate::control_transport::ControlTransportConfig;
use crate::service::AppConfig;
use crate::transport::TransportConfig;

const DEFAULT_URL: &str = "http://127.0.0.1:8765/index.html?manifest=/session/manifest.json";
const DEFAULT_MANAGED_HOST: &str = if cfg!(target_os = "macos") {
    "localhost"
} else {
    "127.0.0.1"
};

#[derive(Clone, Debug)]
pub enum FileDialogDestination {
    Output(PathBuf),
    ResultPipe(u64),
}

#[derive(Clone, Debug)]
pub struct FileDialogArgs {
    pub destination: FileDialogDestination,
}

#[derive(Clone, Debug)]
pub enum Mode {
    DevUrl(String),
    Managed(AppConfig),
}

#[derive(Clone, Debug)]
pub struct Cli {
    pub mode: Mode,
    pub file_dialog: Option<FileDialogArgs>,
    pub startup_timeout: Duration,
    pub control_transport: Option<ControlTransportConfig>,
}

impl Cli {
    pub fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut frontend = None;
        let mut session = None;
        let mut manifest = None;
        let mut state = None;
        let mut host = std::env::var("MULTIWFN_MATTERVIZ_HOST")
            .unwrap_or_else(|_| DEFAULT_MANAGED_HOST.to_owned());
        let mut host_arg = false;
        let mut port = match std::env::var("MULTIWFN_MATTERVIZ_PORT") {
            Ok(value) => value
                .parse()
                .map_err(|_| "MULTIWFN_MATTERVIZ_PORT must be 0..65535".to_owned())?,
            Err(_) => 8765_u16,
        };
        let mut port_arg = false;
        let mut url = None;
        let mut startup_timeout = None;
        let mut select_file = false;
        let mut output = None;
        let mut result_pipe = None;
        let mut volume_read_pipe = None;
        let mut volume_ack_pipe = None;
        let mut control_read_pipe = None;
        let mut control_write_pipe = None;
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            let (key, inline) = arg
                .split_once('=')
                .map_or((arg.as_str(), None), |(key, value)| (key, Some(value)));
            let mut take = |name: &str| -> Result<String, String> {
                inline
                    .map(ToOwned::to_owned)
                    .or_else(|| args.next())
                    .ok_or_else(|| format!("{name} requires a value"))
            };
            match key {
                "--frontend" => frontend = Some(PathBuf::from(take(key)?)),
                "--session" => session = Some(PathBuf::from(take(key)?)),
                "--manifest" => manifest = Some(PathBuf::from(take(key)?)),
                "--state" => state = Some(PathBuf::from(take(key)?)),
                "--host" => {
                    host_arg = true;
                    host = take(key)?;
                }
                "--port" => {
                    port_arg = true;
                    port = take(key)?
                        .parse()
                        .map_err(|_| "--port must be 0..65535".to_owned())?;
                }
                "--url" => url = Some(take(key)?),
                "--startup-timeout" => startup_timeout = Some(parse_timeout(&take(key)?)?),
                "--select-file" => select_file = true,
                "--output" => {
                    if output.is_some() {
                        return Err("--output must be provided once".to_owned());
                    }
                    output = Some(PathBuf::from(take(key)?));
                }
                "--result-pipe" => {
                    if result_pipe.is_some() {
                        return Err("--result-pipe must be provided once".to_owned());
                    }
                    result_pipe = Some(parse_pipe(&take(key)?, key)?);
                }
                "--volume-read-pipe" => {
                    if volume_read_pipe.is_some() {
                        return Err("--volume-read-pipe must be provided once".to_owned());
                    }
                    volume_read_pipe = Some(parse_pipe(&take(key)?, key)?);
                }
                "--volume-ack-pipe" => {
                    if volume_ack_pipe.is_some() {
                        return Err("--volume-ack-pipe must be provided once".to_owned());
                    }
                    volume_ack_pipe = Some(parse_pipe(&take(key)?, key)?);
                }
                "--control-read-pipe" => {
                    if control_read_pipe.is_some() {
                        return Err("--control-read-pipe must be provided once".to_owned());
                    }
                    control_read_pipe = Some(parse_pipe(&take(key)?, key)?);
                }
                "--control-write-pipe" => {
                    if control_write_pipe.is_some() {
                        return Err("--control-write-pipe must be provided once".to_owned());
                    }
                    control_write_pipe = Some(parse_pipe(&take(key)?, key)?);
                }
                "--help" | "-h" => return Err(usage()),
                other => return Err(format!("unknown argument {other}")),
            }
        }

        let startup_timeout = startup_timeout
            .or_else(|| {
                std::env::var("MULTIWFN_MATTERVIZ_STARTUP_TIMEOUT")
                    .ok()
                    .and_then(|value| parse_timeout(&value).ok())
            })
            .unwrap_or_else(|| Duration::from_secs(15));
        if select_file {
            let destination = match (output, result_pipe) {
                (Some(_), Some(_)) => {
                    return Err(
                        "--select-file requires exactly one of --output or --result-pipe"
                            .to_owned(),
                    )
                }
                (Some(output), None) => FileDialogDestination::Output(output),
                (None, Some(result_pipe)) => FileDialogDestination::ResultPipe(result_pipe),
                (None, None) => {
                    return Err(
                        "--select-file requires exactly one of --output or --result-pipe"
                            .to_owned(),
                    )
                }
            };
            if frontend.is_some()
                || session.is_some()
                || manifest.is_some()
                || state.is_some()
                || url.is_some()
                || host_arg
                || port_arg
                || volume_read_pipe.is_some()
                || volume_ack_pipe.is_some()
                || control_read_pipe.is_some()
                || control_write_pipe.is_some()
            {
                return Err("--select-file cannot be combined with a MatterViz session".to_owned());
            }
            return Ok(Self {
                mode: Mode::DevUrl(DEFAULT_URL.to_owned()),
                file_dialog: Some(FileDialogArgs { destination }),
                startup_timeout,
                control_transport: None,
            });
        }

        if output.is_some() || result_pipe.is_some() {
            return Err("--output and --result-pipe require --select-file".to_owned());
        }

        if let Some(url) = url {
            if frontend.is_some()
                || session.is_some()
                || manifest.is_some()
                || state.is_some()
                || volume_read_pipe.is_some()
                || volume_ack_pipe.is_some()
                || control_read_pipe.is_some()
                || control_write_pipe.is_some()
            {
                return Err("--url cannot be combined with a managed session".to_owned());
            }
            validate_url(&url)?;
            return Ok(Self {
                mode: Mode::DevUrl(url),
                file_dialog: None,
                startup_timeout,
                control_transport: None,
            });
        }

        if frontend.is_none() && session.is_none() {
            if volume_read_pipe.is_some()
                || volume_ack_pipe.is_some()
                || control_read_pipe.is_some()
                || control_write_pipe.is_some()
            {
                return Err("transport pipes require a managed session".to_owned());
            }
            let url = std::env::var("MATTERVIZ_WEB_URL").unwrap_or_else(|_| DEFAULT_URL.to_owned());
            validate_url(&url)?;
            return Ok(Self {
                mode: Mode::DevUrl(url),
                file_dialog: None,
                startup_timeout,
                control_transport: None,
            });
        }
        let transport = match (volume_read_pipe, volume_ack_pipe) {
            (Some(volume_read_pipe), Some(volume_ack_pipe)) => {
                if volume_read_pipe == volume_ack_pipe {
                    return Err("volume read and ACK pipes must be different".to_owned());
                }
                Some(TransportConfig {
                    volume_read_pipe,
                    volume_ack_pipe,
                })
            }
            (None, None) => None,
            _ => {
                return Err(
                    "--volume-read-pipe and --volume-ack-pipe must be provided together".to_owned(),
                )
            }
        };
        let control_transport = match (control_read_pipe, control_write_pipe) {
            (Some(read_pipe), Some(write_pipe)) => {
                if read_pipe == write_pipe {
                    return Err("control read and write pipes must be different".to_owned());
                }
                Some(ControlTransportConfig {
                    read_pipe,
                    write_pipe,
                })
            }
            (None, None) => None,
            _ => {
                return Err(
                    "--control-read-pipe and --control-write-pipe must be provided together"
                        .to_owned(),
                )
            }
        };
        if let (Some(volume), Some(control)) = (transport.as_ref(), control_transport.as_ref()) {
            let handles = [
                volume.volume_read_pipe,
                volume.volume_ack_pipe,
                control.read_pipe,
                control.write_pipe,
            ];
            if handles
                .iter()
                .enumerate()
                .any(|(index, value)| handles[..index].contains(value))
            {
                return Err("all volume and control pipes must be distinct".to_owned());
            }
        }
        let config = AppConfig {
            frontend: frontend
                .ok_or_else(|| "--frontend is required for a managed session".to_owned())?,
            session: session
                .ok_or_else(|| "--session is required for a managed session".to_owned())?,
            manifest,
            state,
            host,
            port,
            transport,
        };
        Ok(Self {
            mode: Mode::Managed(config),
            file_dialog: None,
            startup_timeout,
            control_transport,
        })
    }
}

fn parse_pipe(value: &str, name: &str) -> Result<u64, String> {
    let raw = value
        .parse::<u64>()
        .map_err(|_| format!("{name} must be an unsigned raw pipe value"))?;
    if raw == u64::MAX {
        return Err(format!("{name} is invalid"));
    }
    Ok(raw)
}

fn parse_timeout(value: &str) -> Result<Duration, String> {
    let seconds: f64 = value
        .parse()
        .map_err(|_| "startup timeout must be numeric".to_owned())?;
    if !seconds.is_finite() || seconds <= 0.0 {
        return Err("startup timeout must be a finite positive number".to_owned());
    }
    Ok(Duration::from_secs_f64(seconds))
}

fn validate_url(value: &str) -> Result<(), String> {
    let parsed = Url::parse(value).map_err(|error| format!("invalid MatterViz URL: {error}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "MatterViz URL must include a host".to_owned())?;
    if parsed.scheme() == "http" && !matches!(host, "localhost" | "127.0.0.1" | "::1") {
        return Err("plain HTTP MatterViz URLs must use localhost or loopback".to_owned());
    }
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("MatterViz URL must use HTTP(S)".to_owned());
    }
    Ok(())
}

fn usage() -> String {
    "usage: matterviz-desktop --frontend DIR --session DIR [--manifest FILE] [--state FILE] [--host HOST] [--port PORT] [--startup-timeout SEC] [--volume-read-pipe RAW --volume-ack-pipe RAW --control-read-pipe RAW --control-write-pipe RAW]\n       matterviz-desktop --select-file (--output FILE | --result-pipe RAW)\n       matterviz-desktop --url URL".to_owned()
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{Cli, FileDialogDestination, Mode, DEFAULT_MANAGED_HOST};

    #[test]
    fn parses_managed_session_and_defaults_manifest() {
        let cli = Cli::parse([
            "--frontend".into(),
            "dist".into(),
            "--session=session".into(),
            "--port".into(),
            "0".into(),
        ])
        .unwrap();
        let Mode::Managed(config) = cli.mode else {
            panic!("expected managed mode");
        };
        assert_eq!(config.host, DEFAULT_MANAGED_HOST);
        assert_eq!(config.port, 0);
    }

    #[test]
    fn parses_paired_managed_volume_pipes() {
        let cli = Cli::parse([
            "--frontend=dist".into(),
            "--session=session".into(),
            "--volume-read-pipe=41".into(),
            "--volume-ack-pipe".into(),
            "42".into(),
        ])
        .unwrap();
        let Mode::Managed(config) = cli.mode else {
            panic!("expected managed mode");
        };
        let transport = config.transport.expect("transport config");
        assert_eq!(transport.volume_read_pipe, 41);
        assert_eq!(transport.volume_ack_pipe, 42);
    }

    #[test]
    fn parses_paired_control_pipes() {
        let cli = Cli::parse([
            "--frontend=dist".into(),
            "--session=session".into(),
            "--volume-read-pipe=41".into(),
            "--volume-ack-pipe=42".into(),
            "--control-read-pipe=43".into(),
            "--control-write-pipe=44".into(),
        ])
        .unwrap();
        let control = cli.control_transport.expect("control transport");
        assert_eq!(control.read_pipe, 43);
        assert_eq!(control.write_pipe, 44);
    }

    #[test]
    fn rejects_partial_duplicate_or_nonmanaged_volume_pipes() {
        assert!(Cli::parse([
            "--frontend=dist".into(),
            "--session=session".into(),
            "--volume-read-pipe=41".into(),
        ])
        .is_err());
        assert!(Cli::parse([
            "--frontend=dist".into(),
            "--session=session".into(),
            "--volume-read-pipe=41".into(),
            "--volume-ack-pipe=42".into(),
            "--control-read-pipe=43".into(),
        ])
        .is_err());
        assert!(Cli::parse([
            "--frontend=dist".into(),
            "--session=session".into(),
            "--volume-read-pipe=41".into(),
            "--volume-ack-pipe=42".into(),
            "--control-read-pipe=42".into(),
            "--control-write-pipe=44".into(),
        ])
        .is_err());
        assert!(Cli::parse([
            "--frontend=dist".into(),
            "--session=session".into(),
            "--volume-read-pipe=41".into(),
            "--volume-ack-pipe=41".into(),
        ])
        .is_err());
        assert!(Cli::parse([
            "--frontend=dist".into(),
            "--session=session".into(),
            "--volume-read-pipe=41".into(),
            "--volume-read-pipe=42".into(),
            "--volume-ack-pipe=43".into(),
        ])
        .is_err());
        assert!(Cli::parse([
            "--url=http://127.0.0.1:8765".into(),
            "--volume-read-pipe=41".into(),
            "--volume-ack-pipe=42".into(),
        ])
        .is_err());
        assert!(Cli::parse([
            "--select-file".into(),
            "--output=x.txt".into(),
            "--control-read-pipe=43".into(),
            "--control-write-pipe=44".into(),
        ])
        .is_err());
    }

    #[test]
    fn rejects_non_loopback_http_url() {
        assert!(Cli::parse(["--url".into(), "http://example.com".into()]).is_err());
    }

    #[test]
    fn parses_file_dialog_boundary() {
        let cli = Cli::parse(["--select-file".into(), "--output=x.txt".into()]).unwrap();
        assert!(matches!(
            cli.file_dialog.map(|args| args.destination),
            Some(FileDialogDestination::Output(path)) if path == Path::new("x.txt")
        ));
        let cli = Cli::parse(["--select-file".into(), "--result-pipe=41".into()]).unwrap();
        assert!(matches!(
            cli.file_dialog.map(|args| args.destination),
            Some(FileDialogDestination::ResultPipe(41))
        ));
    }

    #[test]
    fn enforces_file_dialog_destination_and_exclusivity() {
        assert!(Cli::parse(["--select-file".into()]).is_err());
        assert!(Cli::parse([
            "--select-file".into(),
            "--output=x.txt".into(),
            "--result-pipe=41".into(),
        ])
        .is_err());
        assert!(Cli::parse([
            "--select-file".into(),
            "--output=x.txt".into(),
            "--output=y.txt".into(),
        ])
        .is_err());
        assert!(Cli::parse([
            "--select-file".into(),
            "--result-pipe=41".into(),
            "--url=http://127.0.0.1:8765".into(),
        ])
        .is_err());
        assert!(Cli::parse(["--result-pipe=41".into()]).is_err());
    }
}
