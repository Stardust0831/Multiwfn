use std::fmt::Write as _;
use std::fs;
use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::backend;
use crate::control_protocol::MessageType;
use crate::control_transport::{ControlTransport, ControlTransportConfig};
use crate::memory_budget;
use crate::session_data::SessionData;
use crate::stream_broker::{StreamEvent, VolumeStreamBroker};
use crate::transport::{TransportConfig, VolumeTransport};
#[cfg(test)]
use crate::volume_store::InsertError;
use crate::volume_store::VolumeStore;
use serde_json::{json, Value};
use socket2::{Domain, Protocol, Socket, Type};

const SESSION_BOOTSTRAP_STAGE_TIMEOUT: Duration = Duration::from_secs(30);
const SESSION_BOOTSTRAP_STAGES: u32 = 3; // Two optional initial volumes, then session_init.

fn session_bootstrap_wait_timeout(stage_timeout: Duration) -> Duration {
    stage_timeout.saturating_mul(SESSION_BOOTSTRAP_STAGES)
}

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
    stream_broker: Arc<VolumeStreamBroker>,
    streaming_volume_enabled: bool,
    transport: Mutex<Option<VolumeTransport>>,
    control_transport: Arc<Mutex<Option<Arc<ControlTransport>>>>,
    session_data: Option<SessionData>,
    in_memory_session: bool,
    frontend_ready: Arc<AtomicBool>,
    return_signaled: Arc<Mutex<bool>>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

impl HttpService {
    #[cfg(test)]
    pub fn start(config: AppConfig) -> Result<Self, String> {
        Self::start_with_control(config, None)
    }

    pub fn start_with_control(
        config: AppConfig,
        control_config: Option<ControlTransportConfig>,
    ) -> Result<Self, String> {
        Self::start_with_control_stage_timeout(
            config,
            control_config,
            SESSION_BOOTSTRAP_STAGE_TIMEOUT,
        )
    }

    fn start_with_control_stage_timeout(
        config: AppConfig,
        control_config: Option<ControlTransportConfig>,
        bootstrap_stage_timeout: Duration,
    ) -> Result<Self, String> {
        let in_memory_session = control_config.is_some();
        let frontend = config
            .frontend
            .canonicalize()
            .map_err(|error| format!("frontend directory not found: {error}"))?;
        let session = if in_memory_session {
            config.session.clone()
        } else {
            config
                .session
                .canonicalize()
                .map_err(|error| format!("session directory not found: {error}"))?
        };
        let manifest = if in_memory_session {
            None
        } else {
            Some(
                config
                    .manifest
                    .unwrap_or_else(|| session.join("manifest.json"))
                    .canonicalize()
                    .map_err(|error| format!("manifest not found: {error}"))?,
            )
        };
        let state = if in_memory_session {
            None
        } else {
            config
                .state
                .map(|path| {
                    path.canonicalize()
                        .map_err(|error| format!("state not found: {error}"))
                })
                .transpose()?
        };
        if !frontend.is_dir() {
            return Err("frontend path is not a directory".to_owned());
        }
        let entry_document = frontend.join("index.html");
        if !entry_document.is_file() {
            return Err("frontend entry document index.html was not found".to_owned());
        }
        fs::File::open(&entry_document).map_err(|error| {
            format!("frontend entry document index.html is not readable: {error}")
        })?;
        if (!in_memory_session && !session.is_dir())
            || manifest.as_ref().is_some_and(|path| !path.is_file())
            || state.as_ref().is_some_and(|path| !path.is_file())
        {
            return Err("invalid MatterViz session files".to_owned());
        }
        validate_host(&config.host)?;
        if !in_memory_session {
            cleanup(&session);
        }
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
        let authority = format!("{}:{}", format_host(&host), address.port());
        let stop = Arc::new(AtomicBool::new(false));
        let frontend_ready = Arc::new(AtomicBool::new(false));
        let volume_store = Arc::new(VolumeStore::new());
        let stream_broker = Arc::new(VolumeStreamBroker::default());
        let streaming_volume_enabled = config.transport.is_some();
        let transport = config
            .transport
            .map(|transport| {
                VolumeTransport::start_with_broker(
                    transport,
                    volume_store.clone(),
                    stream_broker.clone(),
                    stop.clone(),
                )
            })
            .transpose()?;
        let (control_transport, session_data) = control_config
            .map(|config| {
                let transport = ControlTransport::adopt(config)
                    .map_err(|error| format!("could not adopt control transport: {error}"))?;
                transport
                    .send_hello()
                    .map_err(|error| format!("could not start control transport: {error}"))?;
                let frame = transport
                    .read_frame_startup(
                        session_bootstrap_wait_timeout(bootstrap_stage_timeout),
                        bootstrap_stage_timeout,
                    )
                    .map_err(|error| format!("could not receive session bootstrap: {error}"))?;
                let data = SessionData::from_frame(&frame)
                    .map_err(|error| format!("invalid session bootstrap: {error}"))?;
                Ok::<_, String>((transport, data))
            })
            .transpose()?
            .map_or((None, None), |(transport, data)| {
                (Some(Arc::new(transport)), Some(data))
            });
        let has_state = state.is_some()
            || session_data
                .as_ref()
                .is_some_and(|data| data.state_bytes().is_some());
        if has_state && !query.contains("state=/session/workbench-state.json") {
            let capability_suffix = format!("&cap={capability}");
            query = query.replace(
                &capability_suffix,
                &format!("&state=/session/workbench-state.json{capability_suffix}"),
            );
        }
        let url = format!(
            "http://{}:{}/index.html?{query}",
            format_host(&host),
            address.port()
        );
        let service = Self {
            session,
            stop,
            listener,
            url,
            backend_lock: Arc::new(Mutex::new(())),
            capability,
            authority,
            volume_store,
            stream_broker,
            streaming_volume_enabled,
            transport: Mutex::new(transport),
            control_transport: Arc::new(Mutex::new(control_transport)),
            session_data,
            in_memory_session,
            frontend_ready,
            return_signaled: Arc::new(Mutex::new(false)),
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
        manifest: Option<PathBuf>,
        state: Option<PathBuf>,
    ) -> ServiceRunner {
        let orbital_count = self
            .session_data
            .as_ref()
            .and_then(|data| backend::manifest_orbital_count_bytes(data.manifest_bytes()))
            .or_else(|| {
                manifest.as_ref().and_then(|path| {
                    fs::read(path)
                        .ok()
                        .and_then(|bytes| backend::manifest_orbital_count_bytes(&bytes))
                })
            });
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
            stream_broker: self.stream_broker.clone(),
            streaming_volume_enabled: self.streaming_volume_enabled,
            session_data: self.session_data.clone(),
            orbital_count,
            control_transport: self.control_transport.clone(),
            in_memory_session: self.in_memory_session,
            frontend_ready: self.frontend_ready.clone(),
            return_signaled: self.return_signaled.clone(),
        }
    }
    pub fn url(&self) -> &str {
        &self.url
    }
    pub fn session_path(&self) -> &Path {
        &self.session
    }
    pub fn frontend_ready(&self) -> bool {
        self.frontend_ready.load(Ordering::Acquire)
    }
    pub fn uses_file_lifecycle(&self) -> bool {
        !self.in_memory_session
    }
    pub fn is_shutdown(&self) -> bool {
        self.stop.load(Ordering::Acquire)
    }
    pub fn termination_exit_code(&self) -> i32 {
        if self.in_memory_session
            && (!*self
                .return_signaled
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                || self
                    .control_transport
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .is_none())
        {
            2
        } else {
            0
        }
    }
    pub fn signal_return(&self) -> Result<(), String> {
        let result = signal_return(
            self.in_memory_session,
            &self.return_signaled,
            &self.control_transport,
            &self.session,
        );
        self.volume_store.clear();
        if result.is_err() && self.in_memory_session {
            terminate_control_session(&self.control_transport, &self.stop, &self.volume_store);
            wake_listener(&self.listener);
        }
        result
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
    manifest: Option<PathBuf>,
    state: Option<PathBuf>,
    listener: TcpListener,
    stop: Arc<AtomicBool>,
    backend_lock: Arc<Mutex<()>>,
    capability: String,
    authority: String,
    volume_store: Arc<VolumeStore>,
    stream_broker: Arc<VolumeStreamBroker>,
    streaming_volume_enabled: bool,
    session_data: Option<SessionData>,
    orbital_count: Option<i64>,
    control_transport: Arc<Mutex<Option<Arc<ControlTransport>>>>,
    in_memory_session: bool,
    frontend_ready: Arc<AtomicBool>,
    return_signaled: Arc<Mutex<bool>>,
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
            stream_broker: self.stream_broker.clone(),
            streaming_volume_enabled: self.streaming_volume_enabled,
            session_data: self.session_data.clone(),
            orbital_count: self.orbital_count,
            control_transport: self.control_transport.clone(),
            in_memory_session: self.in_memory_session,
            frontend_ready: self.frontend_ready.clone(),
            return_signaled: self.return_signaled.clone(),
        }
    }
    fn handle(&self, mut stream: TcpStream) {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
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
        if method != "GET" && method != "HEAD" && method != "POST" {
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
        if path == "/api/ready" {
            if method != "POST" {
                respond(
                    &mut stream,
                    405,
                    "text/plain",
                    b"Method Not Allowed",
                    method == "HEAD",
                );
                return;
            }
            self.frontend_ready.store(true, Ordering::Release);
            respond_json(&mut stream, &json!({"ok": true}), 200, false);
            return;
        }
        if method == "POST" {
            respond(&mut stream, 405, "text/plain", b"Method Not Allowed", false);
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
        if path == "/api/orbital" && method == "GET" && self.streaming_volume_enabled {
            self.stream_orbital(&mut stream, &query);
            return;
        }
        let value = match path.as_str() {
            "/api/orbital" if method == "GET" => Some(match self.manifest.as_ref() {
                Some(manifest) => {
                    backend::request_orbital(&self.session, &query, manifest, &self.backend_lock)
                }
                None => json!({"ok": false, "message": backend::BACKEND_UNAVAILABLE}),
            }),
            "/api/bond" if method == "GET" => Some(if self.session_data.is_some() {
                self.request_control_bond(&query)
            } else {
                backend::request_bond(&self.session, &query, &self.backend_lock)
            }),
            "/api/esp" if method == "GET" => Some(if self.session_data.is_some() {
                self.request_control_esp(&query)
            } else {
                backend::request_esp(&self.session, &query, &self.backend_lock)
            }),
            _ => None,
        };
        if method == "HEAD" && path.starts_with("/api/") {
            respond(&mut stream, 405, "text/plain", b"Method Not Allowed", true);
            return;
        }
        if let Some(value) = value {
            let status = if self.session_data.is_some() {
                backend_response_status(&value)
            } else if path == "/api/orbital"
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
            if let Some(data) = &self.session_data {
                respond(
                    &mut stream,
                    200,
                    "application/json",
                    data.manifest_bytes(),
                    method == "HEAD",
                );
            } else if let Some(manifest) = &self.manifest {
                serve_file(&mut stream, manifest, method == "HEAD");
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
        if path == "/session/workbench-state.json" {
            if let Some(bytes) = self
                .session_data
                .as_ref()
                .and_then(SessionData::state_bytes)
            {
                respond(
                    &mut stream,
                    200,
                    "application/json",
                    bytes,
                    method == "HEAD",
                );
            } else if let Some(state) = &self.state {
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
        if path == "/session/structure.json" {
            if let Some(bytes) = self
                .session_data
                .as_ref()
                .and_then(SessionData::structure_bytes)
            {
                respond(
                    &mut stream,
                    200,
                    "application/json",
                    bytes,
                    method == "HEAD",
                );
            } else if self.session_data.is_some() {
                respond(
                    &mut stream,
                    404,
                    "text/plain",
                    b"Not Found",
                    method == "HEAD",
                );
            } else {
                match safe_join(&self.session, "structure.json") {
                    Ok(candidate) => serve_file(&mut stream, &candidate, method == "HEAD"),
                    Err(_) => respond(
                        &mut stream,
                        403,
                        "text/plain",
                        b"Invalid session path",
                        method == "HEAD",
                    ),
                }
            }
            return;
        }
        if let Some(relative) = path.strip_prefix("/session/") {
            if self.session_data.is_some() {
                respond(
                    &mut stream,
                    404,
                    "text/plain",
                    b"Not Found",
                    method == "HEAD",
                );
            } else {
                match safe_join(&self.session, relative) {
                    Ok(candidate) => serve_file(&mut stream, &candidate, method == "HEAD"),
                    Err(_) => respond(
                        &mut stream,
                        403,
                        "text/plain",
                        b"Invalid session path",
                        method == "HEAD",
                    ),
                }
            }
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
        let result = signal_return(
            self.in_memory_session,
            &self.return_signaled,
            &self.control_transport,
            &self.session,
        );
        self.volume_store.clear();
        if result.is_err() && self.in_memory_session {
            terminate_control_session(&self.control_transport, &self.stop, &self.volume_store);
            wake_listener(&self.listener);
        }
        result
    }

    fn stream_orbital(&self, stream: &mut TcpStream, query: &[(String, String)]) {
        let reported_active = match query_u64(query, "activeVolumeBytes") {
            Ok(value) => value,
            Err(message) => {
                respond_json(
                    stream,
                    &json!({"ok": false, "message": message}),
                    400,
                    false,
                );
                return;
            }
        };
        let request = match backend::parse_orbital_request(query, self.orbital_count) {
            Ok(value) => value,
            Err(message) => {
                respond_json(
                    stream,
                    &json!({"ok": false, "message": message}),
                    400,
                    false,
                );
                return;
            }
        };
        let _guard = self
            .backend_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let request_id = backend::reserve_request_id();
        let registration = match self.stream_broker.register(request_id) {
            Ok(value) => value,
            Err(message) => {
                respond_json(
                    stream,
                    &json!({"ok": false, "message": message}),
                    500,
                    false,
                );
                return;
            }
        };
        let command = backend::orbital_request_payload(&request);
        let mut control_receiver = None;
        let mut file_pending = None;
        if self.session_data.is_some() {
            let (sender, receiver) = std::sync::mpsc::channel();
            let control_transport = self.control_transport.clone();
            let stop = self.stop.clone();
            let volume_store = self.volume_store.clone();
            std::thread::spawn(move || {
                let result = request_control(
                    &control_transport,
                    &stop,
                    &volume_store,
                    request_id,
                    &command,
                    Duration::from_secs(300),
                );
                let _ = sender.send(result);
            });
            control_receiver = Some(receiver);
        } else {
            file_pending = Some(
                match backend::start_backend_request(
                    &self.session,
                    request_id,
                    &command,
                    Duration::from_secs(300),
                    "Timed out waiting for Multiwfn orbital grid",
                ) {
                    Ok(value) => value,
                    Err(value) => {
                        respond_json(stream, &value, backend_start_status(&value), false);
                        return;
                    }
                },
            );
        }
        let mut started = false;
        loop {
            match registration
                .receiver()
                .recv_timeout(Duration::from_millis(100))
            {
                Ok(StreamEvent::Begin(metadata, header)) => {
                    if started {
                        return;
                    }
                    let current_active =
                        (self.volume_store.bytes() as u64).saturating_add(reported_active);
                    let budget = match memory_budget::active_volume_budget(current_active) {
                        Ok(value) => value,
                        Err(message) => {
                            respond_json(
                                stream,
                                &json!({"ok": false, "message": message}),
                                500,
                                false,
                            );
                            return;
                        }
                    };
                    let requested_active = current_active.saturating_add(metadata.body_bytes);
                    if requested_active > budget.active_limit_bytes {
                        let message = format!(
                            "Volume requires {} active bytes but the current limit is {} bytes ({} available, {} reserved)",
                            requested_active,
                            budget.active_limit_bytes,
                            budget.available_bytes,
                            budget.reserve_bytes
                        );
                        respond_json(
                            stream,
                            &json!({"ok": false, "message": message}),
                            413,
                            false,
                        );
                        return;
                    }
                    let content_length = match metadata
                        .body_bytes
                        .checked_add(crate::volume_protocol::VOLUME_HEADER_BYTES as u64)
                    {
                        Some(value) => value,
                        None => {
                            respond_json(
                                stream,
                                &json!({"ok": false, "message": "Volume response length overflow"}),
                                500,
                                false,
                            );
                            return;
                        }
                    };
                    let geometry_budget =
                        budget.active_limit_bytes.saturating_sub(requested_active);
                    if write_stream_header(stream, content_length, geometry_budget).is_err()
                        || stream.write_all(header.as_ref()).is_err()
                    {
                        return;
                    }
                    started = true;
                }
                Ok(StreamEvent::Chunk(chunk)) => {
                    if !started || stream.write_all(&chunk).is_err() {
                        return;
                    }
                }
                Ok(StreamEvent::End) => return,
                Ok(StreamEvent::Error(message)) => {
                    if !started {
                        respond_json(
                            stream,
                            &json!({"ok": false, "message": message}),
                            500,
                            false,
                        );
                    }
                    return;
                }
                Err(RecvTimeoutError::Timeout) => {
                    let completed = control_receiver
                        .as_ref()
                        .and_then(|receiver| receiver.try_recv().ok())
                        .or_else(|| file_pending.as_mut().and_then(|pending| pending.poll()));
                    if let Some(value) = completed {
                        if started {
                            return;
                        }
                        let status = backend_response_status(&value);
                        respond_json(stream, &value, status, false);
                        return;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    if !started {
                        respond_json(
                            stream,
                            &json!({"ok": false, "message": "MatterViz volume stream disconnected"}),
                            500,
                            false,
                        );
                    }
                    return;
                }
            }
        }
    }

    fn request_control_bond(&self, query: &[(String, String)]) -> Value {
        let _guard = self
            .backend_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let (command, timeout, _) = match backend::prepare_bond_request(query) {
            Ok(value) => value,
            Err(message) => return json!({"ok": false, "message": message}),
        };
        request_control(
            &self.control_transport,
            &self.stop,
            &self.volume_store,
            backend::reserve_request_id(),
            &command,
            timeout,
        )
    }

    fn request_control_esp(&self, query: &[(String, String)]) -> Value {
        let _guard = self
            .backend_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let command = match backend::prepare_esp_request(query) {
            Ok(value) => value,
            Err(message) => return json!({"ok": false, "message": message}),
        };
        request_control(
            &self.control_transport,
            &self.stop,
            &self.volume_store,
            backend::reserve_request_id(),
            &command,
            Duration::from_secs(900),
        )
    }
}

fn signal_return(
    in_memory_session: bool,
    return_signaled: &Mutex<bool>,
    control: &Arc<Mutex<Option<Arc<ControlTransport>>>>,
    session: &Path,
) -> Result<(), String> {
    let mut returned = return_signaled
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if *returned {
        return Ok(());
    }
    let result = if in_memory_session {
        let body = json!({
            "format": "multiwfn-matterviz-control",
            "version": 1,
            "kind": "shutdown",
        });
        let transport = control
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .cloned();
        match transport {
            Some(transport) => transport
                .send_json(MessageType::Shutdown, 0, &body)
                .map_err(|error| format!("could not signal Multiwfn Return: {error}")),
            None => Err("Multiwfn control transport is unavailable".to_owned()),
        }
    } else {
        fs::write(session.join("gui_stop.flag"), "return\n")
            .map_err(|error| format!("could not signal Multiwfn Return: {error}"))
    };
    if result.is_ok() {
        *returned = true;
    }
    result
}

fn request_control(
    control: &Arc<Mutex<Option<Arc<ControlTransport>>>>,
    stop: &AtomicBool,
    volume_store: &VolumeStore,
    request_id: u64,
    command: &str,
    timeout: Duration,
) -> Value {
    let transport = control
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .as_ref()
        .cloned();
    let Some(transport) = transport else {
        return json!({"ok": false, "message": backend::BACKEND_UNAVAILABLE});
    };
    let result = transport
        .send_request(request_id, command)
        .map_err(|error| format!("Multiwfn control request failed: {error}"))
        .and_then(|()| {
            transport
                .read_frame_timeout(timeout)
                .map_err(|error| format!("Multiwfn control response failed: {error}"))
        })
        .and_then(|frame| {
            if frame.header.request_id != request_id
                || !matches!(
                    frame.header.message_type,
                    MessageType::Response | MessageType::Error
                )
            {
                Err("Mismatched Multiwfn control response".to_owned())
            } else {
                let result = frame
                    .body
                    .and_then(|body| body.get("result").cloned())
                    .ok_or_else(|| "Malformed Multiwfn control response".to_owned())?;
                if result
                    .as_object()
                    .and_then(|object| object.get("ok"))
                    .and_then(Value::as_bool)
                    .is_none()
                {
                    Err("Malformed Multiwfn control response".to_owned())
                } else {
                    Ok(result)
                }
            }
        });
    match result {
        Ok(value) => value,
        Err(message) => {
            terminate_control_session(control, stop, volume_store);
            json!({"ok": false, "message": message})
        }
    }
}

fn terminate_control_session(
    control: &Arc<Mutex<Option<Arc<ControlTransport>>>>,
    stop: &AtomicBool,
    volume_store: &VolumeStore,
) {
    let mut guard = control
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    guard.take();
    volume_store.clear();
    stop.store(true, Ordering::Release);
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
fn backend_response_status(value: &Value) -> u16 {
    if value.get("ok").and_then(Value::as_bool) != Some(false) {
        return 200;
    }
    let message = value.get("message").and_then(Value::as_str).unwrap_or("");
    if message == backend::BACKEND_UNAVAILABLE {
        503
    } else if message.starts_with("Timed out") {
        504
    } else {
        400
    }
}
fn backend_start_status(value: &Value) -> u16 {
    let message = value.get("message").and_then(Value::as_str).unwrap_or("");
    if message == backend::BACKEND_UNAVAILABLE {
        503
    } else {
        500
    }
}
fn query_u64(query: &[(String, String)], name: &str) -> Result<u64, String> {
    let mut values = query.iter().filter(|(key, _)| key == name);
    let Some((_, value)) = values.next() else {
        return Ok(0);
    };
    if values.next().is_some() {
        return Err(format!("{name} must be specified at most once"));
    }
    value
        .parse::<u64>()
        .map_err(|_| format!("{name} must be a non-negative integer"))
}
fn respond_redirect(stream: &mut TcpStream, location: &str) {
    let header = format!("HTTP/1.1 302 Found\r\nLocation: {location}\r\nCache-Control: no-store\r\nX-Frame-Options: DENY\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nCross-Origin-Opener-Policy: same-origin\r\nCross-Origin-Embedder-Policy: require-corp\r\nCross-Origin-Resource-Policy: same-origin\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    let _ = stream.write_all(header.as_bytes());
}
fn write_stream_header(
    stream: &mut TcpStream,
    content_length: u64,
    geometry_budget: u64,
) -> std::io::Result<()> {
    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/vnd.multiwfn.volume; version=2\r\nContent-Length: {content_length}\r\nX-MatterViz-Geometry-Memory-Budget: {geometry_budget}\r\nCache-Control: no-store\r\nX-Frame-Options: DENY\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nCross-Origin-Opener-Policy: same-origin\r\nCross-Origin-Embedder-Policy: require-corp\r\nCross-Origin-Resource-Policy: same-origin\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(header.as_bytes())
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
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Error",
    };
    let header = format!("HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Frame-Options: DENY\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nCross-Origin-Opener-Policy: same-origin\r\nCross-Origin-Embedder-Policy: require-corp\r\nCross-Origin-Resource-Policy: same-origin\r\nConnection: close\r\n\r\n", body.len());
    let _ = stream.write_all(header.as_bytes());
    if !head {
        let _ = stream.write_all(body);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        backend_response_status, content_type, decode_path, query_u64, request_control, safe_join,
        AppConfig, HttpService,
    };
    use crate::control_protocol::{
        decode_frame, decode_header, encode_frame, MessageType, HEADER_BYTES,
    };
    use crate::control_transport::ControlTransportConfig;
    use crate::transport::TransportConfig;
    use crate::volume_protocol::{
        decode_ack, decode_volume, encode_volume, Crc32c, ACK_HEADER_BYTES, PRELUDE_BYTES,
        VOLUME_HEADER_BYTES,
    };
    use std::fs;
    use std::io::{ErrorKind, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::path::{Path, PathBuf};

    use url::Url;

    #[cfg(any(unix, windows))]
    #[test]
    fn in_memory_bootstrap_serves_session_without_creating_files() {
        let root = fixture("memory-bootstrap");
        let frontend = root.join("frontend");
        let session = root.join("session-must-not-exist");
        fs::create_dir_all(&frontend).unwrap();
        fs::write(frontend.join("index.html"), "MatterViz").unwrap();

        let (mut hello_read, hello_write) = pipe_pair();
        let (bootstrap_read, mut bootstrap_write) = pipe_pair();
        let producer = std::thread::spawn(move || {
            let hello = read_control_frame(&mut hello_read);
            assert_eq!(
                decode_frame(&hello).unwrap().header.message_type,
                MessageType::Hello
            );
            let body = serde_json::json!({
                "format": "multiwfn-matterviz-control",
                "version": 1,
                "kind": "session_init",
                "manifest": {
                    "format": "multiwfn-matterviz-workbench",
                    "version": 2,
                    "orbitals": {"count": 7},
                    "structure": {"path": "structure.json", "format": "json"},
                    "cubes": []
                },
                "structure": {"sites": [], "charge": 0, "properties": {"bonds": []}},
                "state": null
            });
            let frame = encode_frame(MessageType::SessionInit, 0, Some(&body)).unwrap();
            bootstrap_write.write_all(&frame).unwrap();

            let request = decode_frame(&read_control_frame(&mut hello_read)).unwrap();
            assert_eq!(request.header.message_type, MessageType::Request);
            assert_eq!(request.body.as_ref().unwrap()["command"], "bond 1 2 mayer");
            let response = serde_json::json!({
                "format": "multiwfn-matterviz-control",
                "version": 1,
                "kind": "response",
                "request_id": request.header.request_id,
                "result": {"ok": true, "method": "mayer", "value": 1.25}
            });
            let response = encode_frame(
                MessageType::Response,
                request.header.request_id,
                Some(&response),
            )
            .unwrap();
            bootstrap_write.write_all(&response).unwrap();

            let shutdown = read_control_frame(&mut hello_read);
            assert_eq!(
                decode_frame(&shutdown).unwrap().header.message_type,
                MessageType::Shutdown
            );
        });

        let service = HttpService::start_with_control(
            AppConfig {
                frontend,
                session: session.clone(),
                manifest: Some(root.join("manifest-must-not-exist.json")),
                state: None,
                host: "127.0.0.1".to_owned(),
                port: 0,
                transport: None,
            },
            Some(ControlTransportConfig {
                read_pipe: into_raw_pipe(bootstrap_read),
                write_pipe: into_raw_pipe(hello_write),
            }),
        )
        .unwrap();

        let manifest = request(service.url(), "GET", "/session/manifest.json");
        assert!(manifest.starts_with("HTTP/1.1 200 OK"));
        assert!(manifest.contains("\"multiwfn-matterviz-workbench\""));
        let structure = request(service.url(), "GET", "/session/structure.json");
        assert!(structure.starts_with("HTTP/1.1 200 OK"));
        assert!(structure.contains("\"sites\":[]"));
        let bond = request(
            service.url(),
            "GET",
            &authorized_path(service.url(), "/api/bond?atom1=1&atom2=2&method=mayer"),
        );
        assert!(bond.starts_with("HTTP/1.1 200 OK"));
        assert!(bond.ends_with(r#"{"method":"mayer","ok":true,"value":1.25}"#));
        assert!(!session.exists());

        service.signal_return().unwrap();
        producer.join().unwrap();
        service.shutdown();
        join_service(service);
        assert!(!session.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn delayed_initial_volumes_complete_before_session_bootstrap() {
        for volume_count in 1_u64..=2 {
            let root = fixture(&format!("delayed-bootstrap-{volume_count}"));
            let frontend = root.join("frontend");
            let session = root.join("session-must-not-exist");
            fs::create_dir_all(&frontend).unwrap();
            fs::write(frontend.join("index.html"), "MatterViz").unwrap();

            let (volume_read, mut volume_write) = pipe_pair();
            let (mut ack_read, ack_write) = pipe_pair();
            let (mut hello_read, hello_write) = pipe_pair();
            let (bootstrap_read, mut bootstrap_write) = pipe_pair();
            let producer = std::thread::spawn(move || {
                let hello = decode_frame(&read_control_frame(&mut hello_read)).unwrap();
                assert_eq!(hello.header.message_type, MessageType::Hello);
                let mut ready = [0_u8; PRELUDE_BYTES];
                ack_read.read_exact(&mut ready).unwrap();

                for offset in 0..volume_count {
                    let mut volume = decode_volume(&golden_frame()).unwrap();
                    volume.request_id += offset;
                    volume.volume_id += offset;
                    let frame = encode_volume(&volume).unwrap();
                    let chunk_len = frame.len().div_ceil(4);
                    for chunk in frame.chunks(chunk_len) {
                        std::thread::sleep(std::time::Duration::from_millis(45));
                        volume_write.write_all(chunk).unwrap();
                    }
                    let mut ack = [0_u8; ACK_HEADER_BYTES];
                    ack_read.read_exact(&mut ack).unwrap();
                    assert_eq!(decode_ack(&ack).unwrap().2, 0);
                }

                let body = serde_json::json!({
                    "format": "multiwfn-matterviz-control",
                    "version": 1,
                    "kind": "session_init",
                    "manifest": {
                        "format": "multiwfn-matterviz-workbench",
                        "version": 2,
                        "structure": null,
                        "cubes": []
                    },
                    "structure": null
                });
                bootstrap_write
                    .write_all(&encode_frame(MessageType::SessionInit, 0, Some(&body)).unwrap())
                    .unwrap();
                let shutdown = decode_frame(&read_control_frame(&mut hello_read)).unwrap();
                assert_eq!(shutdown.header.message_type, MessageType::Shutdown);
            });

            let service = HttpService::start_with_control_stage_timeout(
                AppConfig {
                    frontend,
                    session: session.clone(),
                    manifest: None,
                    state: None,
                    host: "127.0.0.1".to_owned(),
                    port: 0,
                    transport: Some(TransportConfig {
                        volume_read_pipe: into_raw_pipe(volume_read),
                        volume_ack_pipe: into_raw_pipe(ack_write),
                    }),
                },
                Some(ControlTransportConfig {
                    read_pipe: into_raw_pipe(bootstrap_read),
                    write_pipe: into_raw_pipe(hello_write),
                }),
                std::time::Duration::from_millis(300),
            )
            .unwrap();
            service.signal_return().unwrap();
            service.shutdown();
            service.join();
            producer.join().unwrap();
            assert!(!session.exists());
            let _ = fs::remove_dir_all(root);
        }
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn concurrent_in_memory_sessions_keep_data_and_capabilities_isolated() {
        let root = fixture("memory-concurrent");
        let (first, first_producer, first_session) =
            start_memory_session(&root.join("first"), "first");
        let (second, second_producer, second_session) =
            start_memory_session(&root.join("second"), "second");

        let first_manifest = request(first.url(), "GET", "/session/manifest.json");
        let second_manifest = request(second.url(), "GET", "/session/manifest.json");
        assert!(first_manifest.contains(r#""session":"first""#));
        assert!(!first_manifest.contains(r#""session":"second""#));
        assert!(second_manifest.contains(r#""session":"second""#));
        assert!(!second_manifest.contains(r#""session":"first""#));

        let first_return = authorized_path(first.url(), "/api/return");
        assert!(request(second.url(), "GET", &first_return).starts_with("HTTP/1.1 403 Forbidden"));
        assert!(!first_session.exists());
        assert!(!second_session.exists());

        first.signal_return().unwrap();
        second.signal_return().unwrap();
        first_producer.join().unwrap();
        second_producer.join().unwrap();
        first.shutdown();
        second.shutdown();
        join_service(first);
        join_service(second);
        assert!(!first_session.exists());
        assert!(!second_session.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn rejected_in_memory_bootstrap_leaves_no_session_path() {
        let root = fixture("memory-rejected");
        let frontend = root.join("frontend");
        let session = root.join("session-must-not-exist");
        fs::create_dir_all(&frontend).unwrap();
        fs::write(frontend.join("index.html"), "MatterViz").unwrap();
        let (mut hello_read, hello_write) = pipe_pair();
        let (bootstrap_read, mut bootstrap_write) = pipe_pair();
        let producer = std::thread::spawn(move || {
            let hello = decode_frame(&read_control_frame(&mut hello_read)).unwrap();
            assert_eq!(hello.header.message_type, MessageType::Hello);
            let invalid = serde_json::json!({
                "format": "multiwfn-matterviz-control",
                "version": 1,
                "kind": "session_init",
                "structure": {"sites": []}
            });
            bootstrap_write
                .write_all(&encode_frame(MessageType::SessionInit, 0, Some(&invalid)).unwrap())
                .unwrap();
        });
        let result = HttpService::start_with_control(
            AppConfig {
                frontend,
                session: session.clone(),
                manifest: Some(root.join("manifest-must-not-exist.json")),
                state: None,
                host: "127.0.0.1".to_owned(),
                port: 0,
                transport: None,
            },
            Some(ControlTransportConfig {
                read_pipe: into_raw_pipe(bootstrap_read),
                write_pipe: into_raw_pipe(hello_write),
            }),
        );
        assert!(result.is_err());
        producer.join().unwrap();
        assert!(!session.exists());
        assert!(!root.join("manifest-must-not-exist.json").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn formal_return_pipe_failure_is_terminal() {
        let root = fixture("memory-return-failure");
        let frontend = root.join("frontend");
        let session = root.join("session-must-not-exist");
        fs::create_dir_all(&frontend).unwrap();
        fs::write(frontend.join("index.html"), "MatterViz").unwrap();
        let (mut hello_read, hello_write) = pipe_pair();
        let (bootstrap_read, mut bootstrap_write) = pipe_pair();
        let producer = std::thread::spawn(move || {
            let hello = decode_frame(&read_control_frame(&mut hello_read)).unwrap();
            assert_eq!(hello.header.message_type, MessageType::Hello);
            let body = serde_json::json!({
                "format": "multiwfn-matterviz-control",
                "version": 1,
                "kind": "session_init",
                "manifest": {
                    "format": "multiwfn-matterviz-workbench",
                    "version": 2,
                    "structure": null,
                    "cubes": []
                },
                "structure": null
            });
            bootstrap_write
                .write_all(&encode_frame(MessageType::SessionInit, 0, Some(&body)).unwrap())
                .unwrap();
        });
        let service = HttpService::start_with_control(
            AppConfig {
                frontend,
                session: session.clone(),
                manifest: None,
                state: None,
                host: "127.0.0.1".to_owned(),
                port: 0,
                transport: None,
            },
            Some(ControlTransportConfig {
                read_pipe: into_raw_pipe(bootstrap_read),
                write_pipe: into_raw_pipe(hello_write),
            }),
        )
        .unwrap();
        producer.join().unwrap();
        assert!(service.signal_return().is_err());
        assert!(service.is_shutdown());
        assert_eq!(service.termination_exit_code(), 2);
        assert!(!session.exists());
        join_service(service);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn mismatched_control_response_invalidates_the_session() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::{Arc, Mutex};

        let (mut request_read, request_write) = pipe_pair();
        let (response_read, mut response_write) = pipe_pair();
        let control = Arc::new(Mutex::new(Some(Arc::new(
            crate::control_transport::ControlTransport::adopt(ControlTransportConfig {
                read_pipe: into_raw_pipe(response_read),
                write_pipe: into_raw_pipe(request_write),
            })
            .unwrap(),
        ))));
        let producer = std::thread::spawn(move || {
            let request_bytes = read_control_frame(&mut request_read);
            assert_eq!(
                std::str::from_utf8(&request_bytes[HEADER_BYTES..]).unwrap(),
                r#"{"format":"multiwfn-matterviz-control","version":1,"kind":"request","request_id":41,"command":"bond 1 2 mayer"}"#
            );
            let request = decode_frame(&request_bytes).unwrap();
            assert_eq!(request.header.request_id, 41);
            let wrong_id = 42;
            let response = serde_json::json!({
                "format": "multiwfn-matterviz-control",
                "version": 1,
                "kind": "response",
                "request_id": wrong_id,
                "result": {"ok": true}
            });
            let frame = encode_frame(MessageType::Response, wrong_id, Some(&response)).unwrap();
            for chunk in frame.chunks(3) {
                response_write.write_all(chunk).unwrap();
            }
        });
        let stop = AtomicBool::new(false);
        let volumes = crate::volume_store::VolumeStore::new();
        volumes.insert(golden_frame()).unwrap();
        let response = request_control(
            &control,
            &stop,
            &volumes,
            41,
            "bond 1 2 mayer",
            std::time::Duration::from_secs(1),
        );
        producer.join().unwrap();
        assert_eq!(response["ok"], false);
        assert!(response["message"].as_str().unwrap().contains("Mismatched"));
        assert!(stop.load(Ordering::Acquire));
        assert!(control.lock().unwrap().is_none());
        assert_eq!(volumes.bytes(), 0);
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn return_is_not_blocked_by_a_pending_control_response() {
        use std::sync::atomic::AtomicBool;
        use std::sync::{mpsc, Arc, Mutex};
        use std::time::{Duration, Instant};

        let (mut request_read, request_write) = pipe_pair();
        let (response_read, mut response_write) = pipe_pair();
        let control = Arc::new(Mutex::new(Some(Arc::new(
            crate::control_transport::ControlTransport::adopt(ControlTransportConfig {
                read_pipe: into_raw_pipe(response_read),
                write_pipe: into_raw_pipe(request_write),
            })
            .unwrap(),
        ))));
        let (request_seen, wait_for_request) = mpsc::channel();
        let producer = std::thread::spawn(move || {
            let request = decode_frame(&read_control_frame(&mut request_read)).unwrap();
            request_seen.send(()).unwrap();
            std::thread::sleep(Duration::from_millis(250));
            let response = serde_json::json!({
                "format": "multiwfn-matterviz-control",
                "version": 1,
                "kind": "response",
                "request_id": request.header.request_id,
                "result": {"ok": true}
            });
            response_write
                .write_all(
                    &encode_frame(
                        MessageType::Response,
                        request.header.request_id,
                        Some(&response),
                    )
                    .unwrap(),
                )
                .unwrap();
            let shutdown = decode_frame(&read_control_frame(&mut request_read)).unwrap();
            assert_eq!(shutdown.header.message_type, MessageType::Shutdown);
        });
        let stop = Arc::new(AtomicBool::new(false));
        let volumes = Arc::new(crate::volume_store::VolumeStore::new());
        let request_control_handle = control.clone();
        let request_stop = stop.clone();
        let request_volumes = volumes.clone();
        let requester = std::thread::spawn(move || {
            request_control(
                &request_control_handle,
                &request_stop,
                &request_volumes,
                91,
                "bond 1 2 mayer",
                Duration::from_secs(1),
            )
        });
        wait_for_request.recv().unwrap();

        let returned = Mutex::new(false);
        let started = Instant::now();
        super::signal_return(true, &returned, &control, Path::new("unused")).unwrap();
        assert!(started.elapsed() < Duration::from_millis(100));

        assert_eq!(requester.join().unwrap()["ok"], true);
        producer.join().unwrap();
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn control_result_requires_an_object_with_boolean_ok() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::{Arc, Mutex};

        let cases = [
            ("missing result", None, false),
            ("null result", Some(serde_json::Value::Null), false),
            ("string result", Some(serde_json::json!("ok")), false),
            ("array result", Some(serde_json::json!([])), false),
            ("number result", Some(serde_json::json!(1)), false),
            ("missing ok", Some(serde_json::json!({})), false),
            (
                "non-boolean ok",
                Some(serde_json::json!({"ok": "true"})),
                false,
            ),
            (
                "valid success",
                Some(serde_json::json!({"ok": true, "value": 1.25})),
                true,
            ),
            (
                "valid failure",
                Some(serde_json::json!({"ok": false, "message": "rejected"})),
                true,
            ),
        ];

        for (index, (name, result, valid)) in cases.into_iter().enumerate() {
            let (mut request_read, request_write) = pipe_pair();
            let (response_read, mut response_write) = pipe_pair();
            let control = Arc::new(Mutex::new(Some(Arc::new(
                crate::control_transport::ControlTransport::adopt(ControlTransportConfig {
                    read_pipe: into_raw_pipe(response_read),
                    write_pipe: into_raw_pipe(request_write),
                })
                .unwrap(),
            ))));
            let request_id = 70 + index as u64;
            let producer = std::thread::spawn(move || {
                let request = decode_frame(&read_control_frame(&mut request_read)).unwrap();
                assert_eq!(request.header.request_id, request_id);
                let mut response = serde_json::json!({
                    "format": "multiwfn-matterviz-control",
                    "version": 1,
                    "kind": "response",
                    "request_id": request_id,
                });
                if let Some(result) = result {
                    response["result"] = result;
                }
                let frame =
                    encode_frame(MessageType::Response, request_id, Some(&response)).unwrap();
                response_write.write_all(&frame).unwrap();
            });
            let stop = AtomicBool::new(false);
            let volumes = crate::volume_store::VolumeStore::new();
            volumes.insert(golden_frame()).unwrap();
            let response = request_control(
                &control,
                &stop,
                &volumes,
                request_id,
                "bond 1 2 mayer",
                std::time::Duration::from_secs(1),
            );
            producer.join().unwrap();

            if valid {
                assert!(
                    response
                        .get("ok")
                        .and_then(serde_json::Value::as_bool)
                        .is_some(),
                    "{name}"
                );
                assert!(!stop.load(Ordering::Acquire), "{name}");
                assert!(control.lock().unwrap().is_some(), "{name}");
                assert_ne!(volumes.bytes(), 0, "{name}");
            } else {
                assert_eq!(response["ok"], false, "{name}");
                assert!(
                    response["message"].as_str().unwrap().contains("Malformed"),
                    "{name}"
                );
                assert_ne!(backend_response_status(&response), 200, "{name}");
                assert!(stop.load(Ordering::Acquire), "{name}");
                assert!(control.lock().unwrap().is_none(), "{name}");
                assert_eq!(volumes.bytes(), 0, "{name}");
            }
        }
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn malformed_control_result_returns_http_error_and_stops_session() {
        let root = fixture("malformed-control-result");
        let frontend = root.join("frontend");
        let session = root.join("session-must-not-exist");
        fs::create_dir_all(&frontend).unwrap();
        fs::write(frontend.join("index.html"), "MatterViz").unwrap();

        let (mut request_read, request_write) = pipe_pair();
        let (response_read, mut response_write) = pipe_pair();
        let producer = std::thread::spawn(move || {
            let hello = decode_frame(&read_control_frame(&mut request_read)).unwrap();
            assert_eq!(hello.header.message_type, MessageType::Hello);
            let session_init = serde_json::json!({
                "format": "multiwfn-matterviz-control",
                "version": 1,
                "kind": "session_init",
                "manifest": {
                    "format": "multiwfn-matterviz-workbench",
                    "version": 2,
                    "structure": {"path": "structure.json", "format": "json"},
                    "cubes": []
                },
                "structure": {"sites": [], "charge": 0, "properties": {"bonds": []}}
            });
            response_write
                .write_all(&encode_frame(MessageType::SessionInit, 0, Some(&session_init)).unwrap())
                .unwrap();

            let request = decode_frame(&read_control_frame(&mut request_read)).unwrap();
            assert_eq!(request.header.message_type, MessageType::Request);
            let response = serde_json::json!({
                "format": "multiwfn-matterviz-control",
                "version": 1,
                "kind": "response",
                "request_id": request.header.request_id,
                "result": null
            });
            response_write
                .write_all(
                    &encode_frame(
                        MessageType::Response,
                        request.header.request_id,
                        Some(&response),
                    )
                    .unwrap(),
                )
                .unwrap();
        });

        let service = HttpService::start_with_control(
            AppConfig {
                frontend,
                session,
                manifest: None,
                state: None,
                host: "127.0.0.1".to_owned(),
                port: 0,
                transport: None,
            },
            Some(ControlTransportConfig {
                read_pipe: into_raw_pipe(response_read),
                write_pipe: into_raw_pipe(request_write),
            }),
        )
        .unwrap();
        service.insert_volume(golden_frame()).unwrap();
        let response = request(
            service.url(),
            "GET",
            &authorized_path(service.url(), "/api/bond?atom1=1&atom2=2&method=mayer"),
        );

        producer.join().unwrap();
        assert!(response.starts_with("HTTP/1.1 400 Bad Request"));
        assert!(response.contains("Malformed Multiwfn control response"));
        assert!(service.is_shutdown());
        assert_eq!(service.volume_store.bytes(), 0);
        assert_eq!(service.termination_exit_code(), 2);
        join_service(service);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn control_timeout_invalidates_the_session() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::{Arc, Mutex};

        let (mut request_read, request_write) = pipe_pair();
        let (response_read, response_write) = pipe_pair();
        let control = Arc::new(Mutex::new(Some(Arc::new(
            crate::control_transport::ControlTransport::adopt(ControlTransportConfig {
                read_pipe: into_raw_pipe(response_read),
                write_pipe: into_raw_pipe(request_write),
            })
            .unwrap(),
        ))));
        let producer = std::thread::spawn(move || {
            let _response_write = response_write;
            let request = decode_frame(&read_control_frame(&mut request_read)).unwrap();
            assert_eq!(request.header.request_id, 51);
            std::thread::sleep(std::time::Duration::from_millis(80));
        });
        let stop = AtomicBool::new(false);
        let volumes = crate::volume_store::VolumeStore::new();
        let response = request_control(
            &control,
            &stop,
            &volumes,
            51,
            "bond 1 2 mayer",
            std::time::Duration::from_millis(20),
        );
        producer.join().unwrap();
        assert!(response["message"].as_str().unwrap().contains("timed out"));
        assert!(stop.load(Ordering::Acquire));
        assert!(control.lock().unwrap().is_none());
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn corrupt_control_response_invalidates_the_session() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::{Arc, Mutex};

        let (mut request_read, request_write) = pipe_pair();
        let (response_read, mut response_write) = pipe_pair();
        let control = Arc::new(Mutex::new(Some(Arc::new(
            crate::control_transport::ControlTransport::adopt(ControlTransportConfig {
                read_pipe: into_raw_pipe(response_read),
                write_pipe: into_raw_pipe(request_write),
            })
            .unwrap(),
        ))));
        let producer = std::thread::spawn(move || {
            let request = decode_frame(&read_control_frame(&mut request_read)).unwrap();
            let response = serde_json::json!({
                "format": "multiwfn-matterviz-control",
                "version": 1,
                "kind": "response",
                "request_id": request.header.request_id,
                "result": {"ok": true}
            });
            let mut frame = encode_frame(
                MessageType::Response,
                request.header.request_id,
                Some(&response),
            )
            .unwrap();
            *frame.last_mut().unwrap() ^= 1;
            response_write.write_all(&frame).unwrap();
        });
        let stop = AtomicBool::new(false);
        let volumes = crate::volume_store::VolumeStore::new();
        let response = request_control(
            &control,
            &stop,
            &volumes,
            61,
            "bond 1 2 mayer",
            std::time::Duration::from_secs(1),
        );
        producer.join().unwrap();
        assert!(response["message"].as_str().unwrap().contains("CRC32C"));
        assert!(stop.load(Ordering::Acquire));
        assert!(control.lock().unwrap().is_none());
    }

    #[cfg(any(unix, windows))]
    fn start_memory_session(
        root: &Path,
        marker: &'static str,
    ) -> (HttpService, std::thread::JoinHandle<()>, PathBuf) {
        let frontend = root.join("frontend");
        let session = root.join("session-must-not-exist");
        fs::create_dir_all(&frontend).unwrap();
        fs::write(frontend.join("index.html"), "MatterViz").unwrap();
        let (mut hello_read, hello_write) = pipe_pair();
        let (bootstrap_read, mut bootstrap_write) = pipe_pair();
        let producer = std::thread::spawn(move || {
            let hello = decode_frame(&read_control_frame(&mut hello_read)).unwrap();
            assert_eq!(hello.header.message_type, MessageType::Hello);
            let body = serde_json::json!({
                "format": "multiwfn-matterviz-control",
                "version": 1,
                "kind": "session_init",
                "manifest": {
                    "format": "multiwfn-matterviz-workbench",
                    "version": 2,
                    "session": marker,
                    "structure": {"path": "structure.json", "format": "json"},
                    "cubes": []
                },
                "structure": {"sites": [], "charge": 0, "properties": {"bonds": []}}
            });
            bootstrap_write
                .write_all(&encode_frame(MessageType::SessionInit, 0, Some(&body)).unwrap())
                .unwrap();
            let shutdown = decode_frame(&read_control_frame(&mut hello_read)).unwrap();
            assert_eq!(shutdown.header.message_type, MessageType::Shutdown);
        });
        let service = HttpService::start_with_control(
            AppConfig {
                frontend,
                session: session.clone(),
                manifest: Some(root.join("manifest-must-not-exist.json")),
                state: None,
                host: "127.0.0.1".to_owned(),
                port: 0,
                transport: None,
            },
            Some(ControlTransportConfig {
                read_pipe: into_raw_pipe(bootstrap_read),
                write_pipe: into_raw_pipe(hello_write),
            }),
        )
        .unwrap();
        (service, producer, session)
    }

    #[test]
    fn path_decoder_handles_percent_and_rejects_bad_hex() {
        assert_eq!(decode_path("/a%20b").unwrap(), "/a b");
        assert!(decode_path("/%xx").is_err());
    }

    #[test]
    fn active_volume_byte_query_is_unique_and_unsigned() {
        assert_eq!(query_u64(&[], "activeVolumeBytes").unwrap(), 0);
        assert_eq!(
            query_u64(
                &[("activeVolumeBytes".to_owned(), "1234".to_owned())],
                "activeVolumeBytes",
            )
            .unwrap(),
            1234
        );
        assert!(query_u64(
            &[("activeVolumeBytes".to_owned(), "-1".to_owned())],
            "activeVolumeBytes",
        )
        .is_err());
        assert!(query_u64(
            &[
                ("activeVolumeBytes".to_owned(), "1".to_owned()),
                ("activeVolumeBytes".to_owned(), "2".to_owned()),
            ],
            "activeVolumeBytes",
        )
        .is_err());
    }

    #[test]
    fn frontend_wasm_uses_the_required_content_type() {
        assert_eq!(
            content_type(std::path::Path::new("parser.wasm")),
            "application/wasm"
        );
    }

    #[test]
    fn service_rejects_a_missing_frontend_entry_document() {
        let root = fixture("missing-frontend-entry");
        let frontend = root.join("frontend");
        let session = root.join("session");
        fs::create_dir_all(&frontend).unwrap();
        fs::create_dir_all(&session).unwrap();
        fs::write(session.join("manifest.json"), "{}").unwrap();

        let result = HttpService::start(AppConfig {
            frontend,
            session,
            manifest: None,
            state: None,
            host: "127.0.0.1".to_owned(),
            port: 0,
            transport: None,
        });
        match result {
            Err(error) => assert!(error.contains("index.html"), "{error}"),
            Ok(service) => {
                service.shutdown();
                join_service(service);
                panic!("service accepted a frontend directory without index.html");
            }
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn service_requires_a_capability_authenticated_ready_post() {
        let root = fixture("frontend-ready");
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
        assert!(!service.frontend_ready());

        let missing_capability = request(service.url(), "POST", "/api/ready");
        assert!(missing_capability.starts_with("HTTP/1.1 403 Forbidden"));
        let wrong_capability = request(service.url(), "POST", "/api/ready?cap=wrong");
        assert!(wrong_capability.starts_with("HTTP/1.1 403 Forbidden"));
        let wrong_method = request(
            service.url(),
            "GET",
            &authorized_path(service.url(), "/api/ready"),
        );
        assert!(wrong_method.starts_with("HTTP/1.1 405 Method Not Allowed"));
        assert!(!service.frontend_ready());

        let ready = request(
            service.url(),
            "POST",
            &authorized_path(service.url(), "/api/ready"),
        );
        assert!(ready.starts_with("HTTP/1.1 200 OK"));
        assert!(ready.ends_with(r#"{"ok":true}"#));
        assert!(service.frontend_ready());

        service.shutdown();
        join_service(service);
        let _ = fs::remove_dir_all(root);
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
        assert!(manifest.contains("Cross-Origin-Opener-Policy: same-origin\r\n"));
        assert!(manifest.contains("Cross-Origin-Embedder-Policy: require-corp\r\n"));
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

    #[cfg(any(unix, windows))]
    #[test]
    fn orbital_route_streams_exact_major_two_frame_and_ack() {
        crate::memory_budget::set_test_active_limit_bytes(64 * 1024 * 1024);
        let root = fixture("orbital-stream");
        let frontend = root.join("frontend");
        let session = root.join("session");
        fs::create_dir_all(&frontend).unwrap();
        fs::create_dir_all(&session).unwrap();
        fs::write(frontend.join("index.html"), "MatterViz").unwrap();
        fs::write(session.join("manifest.json"), r#"{"orbitals":{"count":2}}"#).unwrap();
        let (volume_read, mut volume_write) = pipe_pair();
        let (mut ack_read, ack_write) = pipe_pair();
        let service = HttpService::start(AppConfig {
            frontend,
            session: session.clone(),
            manifest: None,
            state: None,
            host: "127.0.0.1".to_owned(),
            port: 0,
            transport: Some(TransportConfig {
                volume_read_pipe: into_raw_pipe(volume_read),
                volume_ack_pipe: into_raw_pipe(ack_write),
            }),
        })
        .unwrap();
        let mut ready = [0_u8; PRELUDE_BYTES];
        ack_read.read_exact(&mut ready).unwrap();
        let base = service.url().to_owned();
        let path = authorized_path(&base, "/api/orbital?index=1&quality=120000&isovalue=0.05");
        let client = std::thread::spawn(move || request_bytes(&base, "GET", &path));

        let request_path = session.join("gui_request.txt");
        let request = wait_for_file(&request_path);
        let request_id = request
            .split_whitespace()
            .next()
            .unwrap()
            .parse::<u64>()
            .unwrap();
        assert!(request.contains(" orbital 1 120000 0.05"));
        fs::remove_file(&request_path).unwrap();

        let mut frame = golden_frame();
        frame[8..10].copy_from_slice(&2_u16.to_le_bytes());
        frame[20..28].copy_from_slice(&request_id.to_le_bytes());
        frame[36..40].fill(0);
        let mut crc = Crc32c::new();
        crc.update(&frame[..VOLUME_HEADER_BYTES]);
        frame[36..40].copy_from_slice(&crc.finish().to_le_bytes());
        for chunk in frame.chunks(23) {
            volume_write.write_all(chunk).unwrap();
        }

        let response = client.join().unwrap();
        let separator = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .unwrap()
            + 4;
        let headers = std::str::from_utf8(&response[..separator]).unwrap();
        assert!(headers.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(headers.contains("Content-Type: application/vnd.multiwfn.volume; version=2\r\n"));
        assert!(headers.contains("X-MatterViz-Geometry-Memory-Budget: "));
        assert!(headers.contains("Cross-Origin-Embedder-Policy: require-corp\r\n"));
        assert_eq!(&response[separator..], frame.as_slice());

        let mut ack = [0_u8; ACK_HEADER_BYTES];
        ack_read.read_exact(&mut ack).unwrap();
        assert_eq!(u16::from_le_bytes(ack[8..10].try_into().unwrap()), 2);
        assert_eq!(
            u64::from_le_bytes(ack[20..28].try_into().unwrap()),
            request_id
        );
        assert_eq!(u32::from_le_bytes(ack[56..60].try_into().unwrap()), 0);

        drop(volume_write);
        service.shutdown();
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
        String::from_utf8(read_response(&mut stream, method == "HEAD")).unwrap()
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
        read_response(&mut stream, method == "HEAD")
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
        String::from_utf8(read_response(&mut stream, method == "HEAD")).unwrap()
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
        String::from_utf8(read_response(&mut stream, false)).unwrap()
    }

    fn read_response(stream: &mut TcpStream, head: bool) -> Vec<u8> {
        let mut response = Vec::new();
        let mut chunk = [0_u8; 4096];
        loop {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(length) => response.extend_from_slice(&chunk[..length]),
                Err(error)
                    if error.kind() == ErrorKind::ConnectionReset && !response.is_empty() =>
                {
                    break;
                }
                Err(error) => panic!("could not read HTTP test response: {error}"),
            }
        }
        let separator = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .expect("complete HTTP response headers")
            + 4;
        let headers = std::str::from_utf8(&response[..separator]).expect("ASCII HTTP headers");
        let content_length = headers
            .lines()
            .find_map(|line| {
                line.strip_prefix("Content-Length: ")
                    .and_then(|value| value.parse::<usize>().ok())
            })
            .expect("HTTP response Content-Length");
        let expected_body = if head { 0 } else { content_length };
        assert_eq!(
            response.len(),
            separator + expected_body,
            "complete HTTP response body"
        );
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

    fn wait_for_file(path: &std::path::Path) -> String {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            if let Ok(text) = fs::read_to_string(path) {
                if !text.is_empty() {
                    return text;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        panic!("timed out waiting for {}", path.display());
    }

    #[cfg(unix)]
    fn pipe_pair() -> (std::fs::File, std::fs::File) {
        use std::os::fd::FromRawFd;
        let mut ends = [0_i32; 2];
        assert_eq!(unsafe { libc::pipe(ends.as_mut_ptr()) }, 0);
        let read = unsafe { std::fs::File::from_raw_fd(ends[0]) };
        let write = unsafe { std::fs::File::from_raw_fd(ends[1]) };
        (read, write)
    }

    #[cfg(any(unix, windows))]
    fn read_control_frame(reader: &mut std::fs::File) -> Vec<u8> {
        let mut header_bytes = [0_u8; HEADER_BYTES];
        reader.read_exact(&mut header_bytes).unwrap();
        let header = decode_header(&header_bytes).unwrap();
        let mut frame = vec![0_u8; HEADER_BYTES + header.body_bytes as usize];
        frame[..HEADER_BYTES].copy_from_slice(&header_bytes);
        reader.read_exact(&mut frame[HEADER_BYTES..]).unwrap();
        frame
    }

    #[cfg(windows)]
    fn pipe_pair() -> (std::fs::File, std::fs::File) {
        use std::os::windows::io::{FromRawHandle, RawHandle};
        use windows_sys::Win32::Foundation::HANDLE;
        use windows_sys::Win32::System::Pipes::CreatePipe;
        let mut read: HANDLE = std::ptr::null_mut();
        let mut write: HANDLE = std::ptr::null_mut();
        assert_ne!(
            unsafe { CreatePipe(&mut read, &mut write, std::ptr::null(), 0) },
            0
        );
        let read = unsafe { std::fs::File::from_raw_handle(read as RawHandle) };
        let write = unsafe { std::fs::File::from_raw_handle(write as RawHandle) };
        (read, write)
    }

    #[cfg(unix)]
    fn into_raw_pipe(file: std::fs::File) -> u64 {
        use std::os::fd::IntoRawFd;
        file.into_raw_fd() as u64
    }

    #[cfg(windows)]
    fn into_raw_pipe(file: std::fs::File) -> u64 {
        use std::os::windows::io::IntoRawHandle;
        file.into_raw_handle() as usize as u64
    }

    fn tempfile_dir() -> PathBuf {
        let path = fixture("path");
        let _ = fs::create_dir_all(&path);
        path
    }
}
