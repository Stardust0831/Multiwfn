use std::path::PathBuf;
use std::time::Duration;

use url::Url;

use crate::service::AppConfig;

const DEFAULT_URL: &str = "http://127.0.0.1:8765/index.html?manifest=/session/manifest.json";

#[derive(Clone, Debug)]
pub struct FileDialogArgs {
    pub output: PathBuf,
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
        let mut host =
            std::env::var("MULTIWFN_MATTERVIZ_HOST").unwrap_or_else(|_| "127.0.0.1".to_owned());
        let mut port = match std::env::var("MULTIWFN_MATTERVIZ_PORT") {
            Ok(value) => value
                .parse()
                .map_err(|_| "MULTIWFN_MATTERVIZ_PORT must be 0..65535".to_owned())?,
            Err(_) => 8765_u16,
        };
        let mut url = None;
        let mut startup_timeout = None;
        let mut select_file = false;
        let mut output = None;
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
                "--host" => host = take(key)?,
                "--port" => {
                    port = take(key)?
                        .parse()
                        .map_err(|_| "--port must be 0..65535".to_owned())?;
                }
                "--url" => url = Some(take(key)?),
                "--startup-timeout" => startup_timeout = Some(parse_timeout(&take(key)?)?),
                "--select-file" => select_file = true,
                "--output" => output = Some(PathBuf::from(take(key)?)),
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
            let output =
                output.ok_or_else(|| "--select-file requires --output <path>".to_owned())?;
            if frontend.is_some() || session.is_some() || manifest.is_some() || state.is_some() {
                return Err("--select-file cannot be combined with a MatterViz session".to_owned());
            }
            return Ok(Self {
                mode: Mode::DevUrl(DEFAULT_URL.to_owned()),
                file_dialog: Some(FileDialogArgs { output }),
                startup_timeout,
            });
        }

        if let Some(url) = url {
            if frontend.is_some() || session.is_some() || manifest.is_some() || state.is_some() {
                return Err("--url cannot be combined with a managed session".to_owned());
            }
            validate_url(&url)?;
            return Ok(Self {
                mode: Mode::DevUrl(url),
                file_dialog: None,
                startup_timeout,
            });
        }

        if frontend.is_none() && session.is_none() {
            let url = std::env::var("MATTERVIZ_WEB_URL").unwrap_or_else(|_| DEFAULT_URL.to_owned());
            validate_url(&url)?;
            return Ok(Self {
                mode: Mode::DevUrl(url),
                file_dialog: None,
                startup_timeout,
            });
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
        };
        Ok(Self {
            mode: Mode::Managed(config),
            file_dialog: None,
            startup_timeout,
        })
    }
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
    "usage: matterviz-desktop --frontend DIR --session DIR [--manifest FILE] [--state FILE] [--host HOST] [--port PORT] [--startup-timeout SEC]\n       matterviz-desktop --select-file --output FILE\n       matterviz-desktop --url URL".to_owned()
}

#[cfg(test)]
mod tests {
    use super::{Cli, Mode};

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
        match cli.mode {
            Mode::Managed(config) => assert_eq!(config.port, 0),
            Mode::DevUrl(_) => panic!("expected managed mode"),
        }
    }

    #[test]
    fn rejects_non_loopback_http_url() {
        assert!(Cli::parse(["--url".into(), "http://example.com".into()]).is_err());
    }

    #[test]
    fn parses_file_dialog_boundary() {
        let cli = Cli::parse(["--select-file".into(), "--output=x.txt".into()]).unwrap();
        assert!(cli.file_dialog.is_some());
    }
}
