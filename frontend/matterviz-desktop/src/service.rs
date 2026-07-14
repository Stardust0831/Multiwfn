use std::fmt::Write as _;
use std::fs;
use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::backend;
use crate::transport::{TransportConfig, VolumeTransport};
#[cfg(test)]
use crate::volume_store::InsertError;
use crate::volume_store::VolumeStore;
use serde_json::{json, Value};
use socket2::{Domain, Protocol, Socket, Type};

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub frontend: PathBuf,
    pub session: PathBuf,
    pub manifest: Option<PathBuf>,
    pub state: Option<PathBuf>,
    pub host: String,
    pub port: u16,
    pub transport: Option<TransportConfig>,
}

pub struct HttpService {
    session: PathBuf,
    stop: Arc<AtomicBool>,
    listener: TcpListener,
    url: String,
    backend_lock: Arc<Mutex<()>>,
    capability: String,
    authority: String,
    volume_store: Arc<VolumeStore>,
    transport: Mutex<Option<VolumeTransport>>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

impl HttpService {
    pub fn start(config: AppConfig) -> Result<Self, String> {
        let frontend = config
            .frontend
            .canonicalize()
            .map_err(|error| format!("frontend directory not found: {error}"))?;
        let session = config
            .session
            .canonicalize()
            .map_err(|error| format!("session directory not found: {error}"))?;
        let manifest = config
            .manifest
            .unwrap_or_else(|| session.join("manifest.json"))
            .canonicalize()
            .map_err(|error| format!("manifest not found: {error}"))?;
        let state = config
            .state
            .map(|path| {
                path.canonicalize()
                    .map_err(|error| format!("state not found: {error}"))
            })
            .transpose()?;
        if !frontend.is_dir() {
            return Err("frontend path is not a directory".to_owned());
        }
        if !session.is_dir()
            || !manifest.is_file()
            || state.as_ref().is_some_and(|path| !path.is_file())
        {
            return Err("invalid MatterViz session files".to_owned());
        }
        validate_host(&config.host)?;
        cleanup(&session);
        let capability = new_capability()?;
        let listener = bind(&config.host, config.port)?;
        listener
            .set_nonblocking(true)
            .map_err(|error| error.to_string())?;
        let address = listener.local_addr().map_err(|error| error.to_string())?;
        let host = if address.ip().is_unspecified() {
            config.host.clone()
        } else {
            address.ip().to_string()
        };
        let mut query = "manifest=/session/manifest.json".to_owned();
        if state.is_some() {
            query.push_str("&state=/session/workbench-state.json");
        }
        write!(query, "&cap={capability}").expect("write capability query");
        let url = format!(
            "http://{}:{}/index.html?{query}",
            format_host(&host),
            address.port()
        );
        let authority = format!("{}:{}", format_host(&host), address.port());
        let stop = Arc::new(AtomicBool::new(false));
        let volume_store = Arc::new(VolumeStore::new());
        let transport = config
            .transport
            .map(|transport| VolumeTransport::start(transport, volume_store.clone(), stop.clone()))
            .transpose()?;
        let service = Self {
            session,
            stop,
            listener,
            url,
            backend_lock: Arc::new(Mutex::new(())),
            capability,
            authority,
            volume_store,
            transport: Mutex::new(transport),
            worker: Mutex::new(None),
        };
        let runner = service.clone_for_thread(frontend, manifest, state);
        let worker = thread::spawn(move || runner.run());
        *service.worker.lock().expect("service worker lock") = Some(worker);
        Ok(service)
    }

    fn clone_for_thread(
        &self,
        frontend: PathBuf,
        manifest: PathBuf,
        state: Option<PathBuf>,
    ) -> ServiceRunner {
        ServiceRunner {
            frontend,
            session: self.session.clone(),
            manifest,
            state,
            listener: self.listener.try_clone().expect("listener clone"),
            stop: self.stop.clone(),
            backend_lock: self.backend_lock.clone(),
            capability: self.capability.clone(),
            authority: self.authority.clone(),
            volume_store: self.volume_store.clone(),
        }
    }
    pub fn url(&self) -> &str {
        &self.url
    }
    pub fn session_path(&self) -> &Path {
        &self.session
    }
    pub fn signal_return(&self) -> Result<(), String> {
        fs::write(self.session.join("gui_stop.flag"), "return\n")
            .map_err(|error| format!("could not signal Multiwfn Return: {error}"))?;
        self.volume_store.clear();
        Ok(())
    }
    #[cfg(test)]
    pub fn insert_volume<B>(&self, frame: B) -> Result<u64, InsertError>
    where
        B: Into<Arc<[u8]>>,
    {
        self.volume_store.insert(frame)
    }
    pub fn shutdown(&self) {
        self.volume_store.clear();
        self.stop.store(true, Ordering::Release);
        wake_listener(&self.listener);
    }
    pub fn join(&self) {
        if let Some(worker) = self.worker.lock().expect("service worker lock").take() {
            let _ = worker.join();
        }
        if let Some(transport) = self.transport.lock().expect("transport lock").as_ref() {
            transport.join();
        }
    }
}

struct ServiceRunner {
    frontend: PathBuf,
    session: PathBuf,
    manifest: PathBuf,
    state: Option<PathBuf>,
    listener: TcpListener,
    stop: Arc<AtomicBool>,
    backend_lock: Arc<Mutex<()>>,
    capability: String,
    authority: String,
    volume_store: Arc<VolumeStore>,
}
impl ServiceRunner {
    fn run(self) {
        while !self.stop.load(Ordering::Acquire) {
            match self.listener.accept() {
                Ok((stream, _)) => {
                    if self.stop.load(Ordering::Acquire) {
                        break;
                    }
                    let runner = self.clone_for_request();
                    thread::spawn(move || runner.handle(stream));
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(20))
                }
                Err(_) => {
                    self.volume_store.clear();
                    break;
                }
            }
        }
    }
    fn clone_for_request(&self) -> Self {
        Self {
            frontend: self.frontend.clone(),
            session: self.session.clone(),
            manifest: self.manifest.clone(),
            state: self.state.clone(),
            listener: self.listener.try_clone().expect("listener clone"),
            stop: self.stop.clone(),
            backend_lock: self.backend_lock.clone(),
            capability: self.capability.clone(),
            authority: self.authority.clone(),
            volume_store: self.volume_store.clone(),
        }
    }
    fn handle(&self, mut stream: TcpStream) {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let (first, host) = match read_http_request(&mut stream) {
            Ok(value) => value,
            Err(_) => {
                respond(&mut stream, 400, "text/plain", b"Bad Request", false);
                return;
            }
        };
        if !host.eq_ignore_ascii_case(&self.authority) {
            respond(&mut stream, 403, "text/plain", b"Invalid Host", false);
            return;
        }
        let mut parts = first.split_whitespace();
        let method = parts.next().unwrap_or("");
        let target = parts.next().unwrap_or("/");
        if method != "GET" && method != "HEAD" {
            respond(
                &mut stream,
                405,
                "text/plain",
                b"Method Not Allowed",
                method == "HEAD",
            );
            return;
        }
        let (raw_path, raw_query) = target.split_once('?').unwrap_or((target, ""));
        if !raw_path.starts_with('/') {
            respond(
                &mut stream,
                400,
                "text/plain",
                b"Bad Request",
                method == "HEAD",
            );
            return;
        }
        let path = match decode_path(raw_path) {
            Ok(value) => value,
            Err(_) => {
                respond(
                    &mut stream,
                    400,
                    "text/plain",
                    b"Bad Request",
                    method == "HEAD",
                );
                return;
            }
        };
        let query: Vec<_> = url::form_urlencoded::parse(raw_query.as_bytes())
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect();
        if path == "/favicon.ico" {
            respond(&mut stream, 204, "", &[], true);
            return;
        }
        if path == "/" || path.is_empty() {
            let mut location = "/index.html?manifest=/session/manifest.json".to_owned();
            if self.state.is_some() {
                location.push_str("&state=/session/workbench-state.json");
            }
            write!(location, "&cap={}", self.capability).expect("write capability redirect");
            respond_redirect(&mut stream, &location);
            return;
        }
        if path.starts_with("/api/") && !has_capability(&query, &self.capability) {
            respond_json(
                &mut stream,
                &json!({"ok": false, "message": "Missing or invalid session capability"}),
                403,
                method == "HEAD",
            );
            return;
        }
        if path == "/api/return" {
            if method != "GET" {
                respond(&mut stream, 405, "text/plain", b"Method Not Allowed", true);
                return;
            }
            if let Err(message) = self.signal_return() {
                respond_json(
                    &mut stream,
                    &json!({"ok": false, "message": message}),
                    500,
                    false,
                );
                return;
            }
            respond_json(&mut stream, &json!({"ok": true}), 200, false);
            self.volume_store.clear();
            self.stop.store(true, Ordering::Release);
            wake_listener(&self.listener);
            return;
        }
        if let Some(volume_id) = path.strip_prefix("/api/volume/") {
            if method != "GET" {
                respond(&mut stream, 405, "text/plain", b"Method Not Allowed", true);
                return;
            }
            let Ok(parsed_id) = volume_id.parse::<u64>() else {
                respond(&mut stream, 400, "text/plain", b"Bad Request", false);
                return;
            };
            if parsed_id == 0 || parsed_id.to_string() != volume_id {
                respond(&mut stream, 400, "text/plain", b"Bad Request", false);
                return;
            }
            if let Some(frame) = self.volume_store.get(parsed_id) {
                respond(
                    &mut stream,
                    200,
                    "application/vnd.multiwfn.volume",
                    &frame,
                    false,
                );
            } else {
                respond(&mut stream, 404, "text/plain", b"Not Found", false);
            }
            return;
        }
        let value = match path.as_str() {
            "/api/orbital" if method == "GET" => Some(backend::request_orbital(
                &self.session,
                &query,
                &self.manifest,
                &self.backend_lock,
            )),
            "/api/bond" if method == "GET" => Some(backend::request_bond(
                &self.session,
                &query,
                &self.backend_lock,
            )),
            "/api/esp" if method == "GET" => Some(backend::request_esp(
                &self.session,
                &query,
                &self.backend_lock,
            )),
            _ => None,
        };
        if method == "HEAD" && path.starts_with("/api/") {
            respond(&mut stream, 405, "text/plain", b"Method Not Allowed", true);
            return;
        }
        if let Some(value) = value {
            let status = if path == "/api/orbital"
                && value
                    .get("message")
                    .and_then(Value::as_str)
                    .is_some_and(|message| message.starts_with("Orbital"))
            {
                400
            } else {
                200
            };
            respond_json(&mut stream, &value, status, method == "HEAD");
            return;
        }
        if path == "/session/manifest.json" {
            serve_file(&mut stream, &self.manifest, method == "HEAD");
            return;
        }
        if path == "/session/workbench-state.json" {
            if let Some(state) = &self.state {
                serve_file(&mut stream, state, method == "HEAD");
            } else {
                respond(
                    &mut stream,
                    404,
                    "text/plain",
                    b"Not Found",
                    method == "HEAD",
                );
            }
            return;
        }
        if let Some(relative) = path.strip_prefix("/session/") {
            match safe_join(&self.session, relative) {
                Ok(candidate) => serve_file(&mut stream, &candidate, method == "HEAD"),
                Err(_) => respond(
                    &mut stream,
                    403,
                    "text/plain",
                    b"Invalid session path",
                    method == "HEAD",
                ),
            };
            return;
        }
        match safe_join(&self.frontend, path.trim_start_matches('/')) {
            Ok(candidate) => serve_file(&mut stream, &candidate, method == "HEAD"),
            Err(_) => respond(
                &mut stream,
                403,
                "text/plain",
                b"Invalid path",
                method == "HEAD",
            ),
        }
    }
    fn signal_return(&self) -> Result<(), String> {
        fs::write(self.session.join("gui_stop.flag"), "return\n")
            .map_err(|error| format!("could not signal Multiwfn Return: {error}"))?;
        self.volume_store.clear();
        Ok(())
    }
}

fn read_http_request(stream: &mut TcpStream) -> Result<(String, String), ()> {
    const MAX_HEADERS: usize = 64 * 1024;
    const MAX_REQUEST_LINE: usize = 8 * 1024;
    let mut request = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 1024];
    loop {
        let length = stream.read(&mut chunk).map_err(|_| ())?;
        if length == 0 {
            return Err(());
        }
        request.extend_from_slice(&chunk[..length]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if request.len() > MAX_HEADERS {
            return Err(());
        }
    }
    if request.len() > MAX_HEADERS {
        return Err(());
    }
    let request = std::str::from_utf8(&request).map_err(|_| ())?;
    let mut lines = request.split("\r\n");
    let first = lines.next().ok_or(())?;
    if first.is_empty() || first.len() > MAX_REQUEST_LINE {
        return Err(());
    }
    let mut hosts = lines.filter_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("host").then_some(value.trim())
    });
    let host = hosts.next().filter(|value| !value.is_empty()).ok_or(())?;
    if hosts.next().is_some() {
        return Err(());
    }
    Ok((first.to_owned(), host.to_owned()))
}

fn bind(host: &str, port: u16) -> Result<TcpListener, String> {
    let address: std::net::IpAddr = if host.eq_ignore_ascii_case("localhost") {
        "127.0.0.1".parse().unwrap()
    } else {
        host.parse::<IpAddr>().map_err(|error| error.to_string())?
    };
    let socket = new_socket(address)?;
    let requested = SocketAddr::new(address, port);
    if let Err(error) = socket.bind(&socket2::SockAddr::from(requested)) {
        if port == 0 {
            return Err(error.to_string());
        }
        let fallback = new_socket(address)?;
        fallback
            .bind(&socket2::SockAddr::from(SocketAddr::new(address, 0)))
            .map_err(|inner| inner.to_string())?;
        fallback.listen(128).map_err(|inner| inner.to_string())?;
        return Ok(fallback.into());
    }
    socket.listen(128).map_err(|error| error.to_string())?;
    Ok(socket.into())
}

fn wake_listener(listener: &TcpListener) {
    if let Ok(address) = listener.local_addr() {
        let _ = TcpStream::connect_timeout(&address, Duration::from_millis(100));
    }
}

fn new_socket(address: IpAddr) -> Result<Socket, String> {
    let socket = Socket::new(
        if address.is_ipv6() {
            Domain::IPV6
        } else {
            Domain::IPV4
        },
        Type::STREAM,
        Some(Protocol::TCP),
    )
    .map_err(|error| error.to_string())?;
    #[cfg(windows)]
    configure_windows_exclusive(&socket)?;
    Ok(socket)
}

fn new_capability() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("could not create session capability: {error}"))?;
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(token, "{byte:02x}").expect("write capability byte");
    }
    Ok(token)
}

fn has_capability(query: &[(String, String)], expected: &str) -> bool {
    let mut values = query.iter().filter(|(name, _)| name == "cap");
    matches!(values.next(), Some((_, value)) if value == expected) && values.next().is_none()
}

#[cfg(windows)]
fn configure_windows_exclusive(socket: &Socket) -> Result<(), String> {
    use std::os::windows::io::AsRawSocket;
    use windows_sys::Win32::Networking::WinSock::{
        setsockopt, SOCKET_ERROR, SOL_SOCKET, SO_EXCLUSIVEADDRUSE,
    };

    socket
        .set_reuse_address(false)
        .map_err(|error| error.to_string())?;
    let enabled = 1_i32;
    let status = unsafe {
        setsockopt(
            socket.as_raw_socket() as usize,
            SOL_SOCKET,
            SO_EXCLUSIVEADDRUSE,
            (&enabled as *const i32).cast(),
            std::mem::size_of_val(&enabled) as i32,
        )
    };
    if status == SOCKET_ERROR {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}
fn validate_host(host: &str) -> Result<(), String> {
    if host.eq_ignore_ascii_case("localhost") {
        return Ok(());
    }
    let parsed: IpAddr = host
        .parse()
        .map_err(|_| "MatterViz host must be loopback".to_owned())?;
    if !parsed.is_loopback() {
        return Err("MatterViz host must be loopback".to_owned());
    }
    Ok(())
}
fn format_host(host: &str) -> String {
    if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_owned()
    }
}
fn cleanup(session: &Path) {
    if let Ok(entries) = fs::read_dir(session) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("response_") && name.ends_with(".json")
                || name.starts_with("orbital_") && name.ends_with(".cube")
                || name.starts_with("esp_density_") && name.ends_with(".cube")
                || name.starts_with("esp_potential_") && name.ends_with(".cube")
            {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}
fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, ()> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(());
    }
    let candidate = root.join(relative_path);
    if let Ok(resolved) = candidate.canonicalize() {
        resolved.strip_prefix(root).map_err(|_| ())?;
        return Ok(resolved);
    }
    let parent = candidate
        .parent()
        .ok_or(())?
        .canonicalize()
        .map_err(|_| ())?;
    parent.strip_prefix(root).map_err(|_| ())?;
    Ok(candidate)
}
fn decode_path(path: &str) -> Result<String, ()> {
    let bytes = path.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err(());
            }
            let high = hex(bytes[index + 1]).ok_or(())?;
            let low = hex(bytes[index + 2]).ok_or(())?;
            output.push(high * 16 + low);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output).map_err(|_| ())
}
fn hex(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}
fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "wasm" => "application/wasm",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "map" => "application/json",
        "cube" => "application/octet-stream",
        _ => "application/octet-stream",
    }
}
fn serve_file(stream: &mut TcpStream, path: &Path, head: bool) {
    match fs::read(path) {
        Ok(data) => respond(stream, 200, content_type(path), &data, head),
        Err(_) => respond(stream, 404, "text/plain", b"Not Found", head),
    }
}
fn respond_json(stream: &mut TcpStream, value: &Value, status: u16, head: bool) {
    let data = serde_json::to_vec(value).unwrap_or_else(|_| b"{\"ok\":false}".to_vec());
    respond(stream, status, "application/json", &data, head);
}
fn respond_redirect(stream: &mut TcpStream, location: &str) {
    let header = format!("HTTP/1.1 302 Found\r\nLocation: {location}\r\nCache-Control: no-store\r\nX-Frame-Options: DENY\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    let _ = stream.write_all(header.as_bytes());
}
fn respond(stream: &mut TcpStream, status: u16, content_type: &str, body: &[u8], head: bool) {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        302 => "Found",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        _ => "Error",
    };
    let header = format!("HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Frame-Options: DENY\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n", body.len());
    let _ = stream.write_all(header.as_bytes());
    if !head {
        let _ = stream.write_all(body);
    }
}

#[cfg(test)]
mod tests {
    use super::{content_type, decode_path, safe_join, AppConfig, HttpService};
    use std::fs;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::path::PathBuf;

    use url::Url;

    #[test]
    fn path_decoder_handles_percent_and_rejects_bad_hex() {
        assert_eq!(decode_path("/a%20b").unwrap(), "/a b");
        assert!(decode_path("/%xx").is_err());
    }

    #[test]
    fn frontend_wasm_uses_the_required_content_type() {
        assert_eq!(
            content_type(std::path::Path::new("parser.wasm")),
            "application/wasm"
        );
    }
    #[test]
    fn safe_join_blocks_traversal() {
        let root = tempfile_dir();
        assert!(safe_join(&root, "../outside").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn service_serves_manifest_rejects_head_api_and_returns_cleanly() {
        let root = fixture("routes");
        let frontend = root.join("frontend");
        let session = root.join("session");
        fs::create_dir_all(&frontend).unwrap();
        fs::create_dir_all(&session).unwrap();
        fs::write(frontend.join("index.html"), "MatterViz").unwrap();
        fs::write(session.join("manifest.json"), r#"{"session":"rust"}"#).unwrap();

        let service = HttpService::start(AppConfig {
            frontend,
            session: session.clone(),
            manifest: None,
            state: None,
            host: "127.0.0.1".to_owned(),
            port: 0,
            transport: None,
        })
        .unwrap();
        let manifest = request(service.url(), "GET", "/session/manifest.json");
        assert!(manifest.starts_with("HTTP/1.1 200 OK"));
        assert!(manifest.ends_with(r#"{"session":"rust"}"#));
        let wrong_host = request_with_host(
            service.url(),
            "GET",
            "/session/manifest.json",
            "attacker.example:8765",
        );
        assert!(wrong_host.starts_with("HTTP/1.1 403 Forbidden"));
        let duplicate_host =
            request_with_duplicate_host(service.url(), "GET", "/session/manifest.json");
        assert!(duplicate_host.starts_with("HTTP/1.1 400 Bad Request"));
        let fragmented = fragmented_request(service.url(), "/session/manifest.json");
        assert!(fragmented.starts_with("HTTP/1.1 200 OK"));

        let missing_capability = request(service.url(), "GET", "/api/return");
        assert!(missing_capability.starts_with("HTTP/1.1 403 Forbidden"));
        let wrong_capability = request(service.url(), "GET", "/api/return?cap=wrong");
        assert!(wrong_capability.starts_with("HTTP/1.1 403 Forbidden"));
        let duplicate_capability = request(
            service.url(),
            "GET",
            &format!(
                "{}&cap=duplicate",
                authorized_path(service.url(), "/api/return")
            ),
        );
        assert!(duplicate_capability.starts_with("HTTP/1.1 403 Forbidden"));

        let head = request(
            service.url(),
            "HEAD",
            &authorized_path(service.url(), "/api/orbital?index=1"),
        );
        assert!(head.starts_with("HTTP/1.1 405 Method Not Allowed"));
        assert!(!session.join("gui_request.txt").exists());

        let traversal = request(service.url(), "GET", "/session/../manifest.json");
        assert!(traversal.starts_with("HTTP/1.1 403 Forbidden"));

        let stop_path = session.join("gui_stop.flag");
        fs::create_dir(&stop_path).unwrap();
        let failed_return = request(
            service.url(),
            "GET",
            &authorized_path(service.url(), "/api/return"),
        );
        assert!(failed_return.starts_with("HTTP/1.1 500 Internal Server Error"));
        fs::remove_dir(&stop_path).unwrap();

        let returned = request(
            service.url(),
            "GET",
            &authorized_path(service.url(), "/api/return"),
        );
        assert!(returned.starts_with("HTTP/1.1 200 OK"));
        assert!(returned.ends_with(r#"{"ok":true}"#));
        assert_eq!(fs::read_to_string(stop_path).unwrap(), "return\n");
        join_service(service);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn volume_route_is_capability_protected_and_serves_exact_frame() {
        let root = fixture("volume-route");
        let frontend = root.join("frontend");
        let session = root.join("session");
        fs::create_dir_all(&frontend).unwrap();
        fs::create_dir_all(&session).unwrap();
        fs::write(frontend.join("index.html"), "MatterViz").unwrap();
        fs::write(session.join("manifest.json"), "{}").unwrap();

        let service = HttpService::start(AppConfig {
            frontend,
            session,
            manifest: None,
            state: None,
            host: "127.0.0.1".to_owned(),
            port: 0,
            transport: None,
        })
        .unwrap();
        let frame = golden_frame();
        assert_eq!(service.insert_volume(frame.clone()).unwrap(), 1001);

        assert!(request_bytes(service.url(), "GET", "/api/volume/1001")
            .starts_with(b"HTTP/1.1 403 Forbidden"));
        assert!(
            request_bytes(service.url(), "GET", "/api/volume/1001?cap=wrong")
                .starts_with(b"HTTP/1.1 403 Forbidden")
        );

        let authorized = authorized_path(service.url(), "/api/volume/1001");
        let response = request_bytes(service.url(), "GET", &authorized);
        assert!(response.starts_with(b"HTTP/1.1 200 OK"));
        let separator = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .expect("response headers")
            + 4;
        let headers = std::str::from_utf8(&response[..separator]).unwrap();
        assert!(headers.contains("Content-Type: application/vnd.multiwfn.volume\r\n"));
        assert!(headers.contains("Cache-Control: no-store\r\n"));
        assert_eq!(&response[separator..], frame.as_slice());

        assert!(request_bytes(service.url(), "HEAD", &authorized,)
            .starts_with(b"HTTP/1.1 405 Method Not Allowed"));
        assert!(request_bytes(
            service.url(),
            "GET",
            &authorized_path(service.url(), "/api/volume/1002"),
        )
        .starts_with(b"HTTP/1.1 404 Not Found"));
        service.shutdown();
        join_service(service);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn busy_preferred_port_falls_back_to_an_os_assigned_port() {
        let root = fixture("fallback");
        let frontend = root.join("frontend");
        let session = root.join("session");
        fs::create_dir_all(&frontend).unwrap();
        fs::create_dir_all(&session).unwrap();
        fs::write(frontend.join("index.html"), "MatterViz").unwrap();
        fs::write(session.join("manifest.json"), "{}").unwrap();
        let occupied = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let preferred = occupied.local_addr().unwrap().port();

        let service = HttpService::start(AppConfig {
            frontend,
            session,
            manifest: None,
            state: None,
            host: "127.0.0.1".to_owned(),
            port: preferred,
            transport: None,
        })
        .unwrap();
        let actual = Url::parse(service.url()).unwrap().port().unwrap();
        assert_ne!(actual, preferred);
        service.shutdown();
        join_service(service);
        drop(occupied);
        let _ = fs::remove_dir_all(root);
    }

    fn request(base: &str, method: &str, path: &str) -> String {
        let url = Url::parse(base).unwrap();
        request_with_host(base, method, path, &authority(&url))
    }

    fn request_with_host(base: &str, method: &str, path: &str, host: &str) -> String {
        let url = Url::parse(base).unwrap();
        let mut stream = connect_client(&url);
        write!(
            stream,
            "{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    fn request_bytes(base: &str, method: &str, path: &str) -> Vec<u8> {
        let url = Url::parse(base).unwrap();
        let mut stream = connect_client(&url);
        write!(
            stream,
            "{method} {path} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
            authority(&url)
        )
        .unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        response
    }

    fn request_with_duplicate_host(base: &str, method: &str, path: &str) -> String {
        let url = Url::parse(base).unwrap();
        let host = authority(&url);
        let mut stream = connect_client(&url);
        write!(
            stream,
            "{method} {path} HTTP/1.1\r\nHost: {host}\r\nHost: {host}\r\n\r\n"
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    fn fragmented_request(base: &str, path: &str) -> String {
        let url = Url::parse(base).unwrap();
        let mut stream = connect_client(&url);
        stream.set_nodelay(true).unwrap();
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: {}\r\nX-Padding: {}",
            authority(&url),
            "x".repeat(2048)
        )
        .unwrap();
        stream.flush().unwrap();
        write!(stream, "\r\nConnection: close\r\n\r\n").unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    fn connect_client(url: &Url) -> TcpStream {
        let stream = TcpStream::connect((url.host_str().unwrap(), url.port().unwrap())).unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        stream
    }

    fn join_service(service: HttpService) {
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            service.join();
            let _ = sender.send(());
        });
        receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("HTTP service did not stop within five seconds");
    }

    fn authorized_path(base: &str, path: &str) -> String {
        let page = Url::parse(base).unwrap();
        let capability = page
            .query_pairs()
            .find(|(name, _)| name == "cap")
            .map(|(_, value)| value.into_owned())
            .expect("service capability");
        let separator = if path.contains('?') { '&' } else { '?' };
        format!("{path}{separator}cap={capability}")
    }

    fn authority(url: &Url) -> String {
        let host = match url.host().unwrap() {
            url::Host::Ipv6(address) => format!("[{address}]"),
            host => host.to_string(),
        };
        format!("{host}:{}", url.port().unwrap())
    }

    fn fixture(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "matterviz-test-{name}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&path);
        path
    }

    fn golden_frame() -> Vec<u8> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/matterviz-volume-v1-orbital.hex"
        );
        fs::read_to_string(path)
            .unwrap()
            .lines()
            .flat_map(|line| line.split('#').next().unwrap_or("").split_whitespace())
            .flat_map(|word| {
                (0..word.len())
                    .step_by(2)
                    .map(move |index| u8::from_str_radix(&word[index..index + 2], 16).unwrap())
            })
            .collect()
    }

    fn tempfile_dir() -> PathBuf {
        let path = fixture("path");
        let _ = fs::create_dir_all(&path);
        path
    }
}
