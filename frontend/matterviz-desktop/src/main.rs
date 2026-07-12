use std::env;

use tauri::{WebviewUrl, WebviewWindowBuilder};
use url::Url;

const DEFAULT_URL: &str =
    "http://127.0.0.1:8765/index.html?manifest=/session/manifest.json";
const URL_ENV: &str = "MATTERVIZ_WEB_URL";

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

fn main() {
    let web_url = requested_url().unwrap_or_else(|error| {
        eprintln!("MatterViz Desktop: {error}");
        std::process::exit(2);
    });

    tauri::Builder::default()
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(web_url.clone()))
                .title("MatterViz")
                .inner_size(1400.0, 900.0)
                .resizable(true)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running MatterViz Desktop");
}
