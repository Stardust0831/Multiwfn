#[path = "../../../frontend/matterviz-desktop/src/backend.rs"]
pub mod backend;
#[path = "../../../frontend/matterviz-desktop/src/cli.rs"]
pub mod cli;
#[path = "../../../frontend/matterviz-desktop/src/service.rs"]
pub mod service;
#[path = "../../../frontend/matterviz-desktop/src/transport.rs"]
pub mod transport;
#[path = "../../../frontend/matterviz-desktop/src/volume_protocol.rs"]
pub mod volume_protocol;
#[path = "../../../frontend/matterviz-desktop/src/volume_store.rs"]
pub mod volume_store;

#[cfg(test)]
mod tests {
    use std::ffi::{c_char, c_int, CString};
    use std::fs;
    use std::io::{Read, Write};
    use std::net::{TcpStream, ToSocketAddrs};
    use std::path::{Path, PathBuf};
    use std::thread;
    use std::time::{Duration, Instant};

    use serde_json::Value;
    use url::Url;

    use crate::service::{AppConfig, HttpService};
    use crate::transport::TransportConfig;

    const REJECTED_ACK: c_int = -1005;
    const PUBLISH_TIMEOUT: c_int = -1003;

    unsafe extern "C" {
        fn multiwfn_matterviz_spawn(
            executable: *const c_char,
            frontend: *const c_char,
            session: *const c_char,
            manifest: *const c_char,
            volume_write: *mut isize,
            ack_read: *mut isize,
            transport_error: *mut c_int,
        ) -> c_int;

        fn multiwfn_matterviz_publish_volume(
            volume_write: isize,
            ack_read: isize,
            request_id: i64,
            volume_id: i64,
            nx: i32,
            ny: i32,
            nz: i32,
            data_order: i32,
            periodic_axes: i32,
            coordinate_unit: i32,
            quantity_kind: i32,
            value_unit: i32,
            origin: *const f64,
            voxel_axes: *const f64,
            lattice: *const f64,
            samples: *const f64,
            sample_count: i64,
            publish_timeout_ms: u32,
        ) -> c_int;

        fn multiwfn_matterviz_transport_close(volume_write: *mut isize, ack_read: *mut isize);
    }

    struct ProducerPipes {
        volume_write: isize,
        ack_read: isize,
    }

    impl Drop for ProducerPipes {
        fn drop(&mut self) {
            unsafe {
                multiwfn_matterviz_transport_close(&mut self.volume_write, &mut self.ack_read);
            }
        }
    }

    #[test]
    fn request_publish_store_and_cube_fallback() {
        let root = temp_dir();
        let frontend = root.join("frontend");
        let session = root.join("session");
        fs::create_dir_all(&frontend).unwrap();
        fs::create_dir_all(&session).unwrap();
        fs::write(frontend.join("index.html"), "MatterViz").unwrap();
        fs::write(session.join("manifest.json"), r#"{"orbitals":{"count":5}}"#).unwrap();

        let (transport, mut producer) = pipes();
        let service = HttpService::start(AppConfig {
            frontend,
            session: session.clone(),
            manifest: None,
            state: None,
            host: "127.0.0.1".to_owned(),
            port: 0,
            transport: Some(transport),
        })
        .unwrap();
        read_ready(&mut producer);

        let base = service.url().to_owned();
        let capability = capability(&base);
        let first = spawn_orbital_request(&base, &capability, 3);
        let first_id = wait_for_request(&session, "orbital 3 120000 0.05");
        assert_eq!(publish(&producer, first_id, 1001), 0);
        write_binary_response(&session, first_id, 1001);
        let first_response = first.join().unwrap();
        assert_eq!(first_response["ok"], true);
        assert_eq!(first_response["layer"]["format"], "mwfn-volume-v1");

        let binary = request_bytes(&base, &format!("/api/volume/1001?cap={capability}"));
        let (headers, body) = split_response(&binary);
        assert!(headers.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(headers.contains("Content-Type: application/vnd.multiwfn.volume\r\n"));
        let decoded = crate::volume_protocol::decode_volume(body).unwrap();
        assert_eq!(decoded.request_id, first_id as u64);
        assert_eq!(decoded.volume_id, 1001);
        assert_eq!(decoded.dimensions, [2, 2, 3]);
        assert_eq!(decoded.samples, samples());

        let second = spawn_orbital_request(&base, &capability, 4);
        let second_id = wait_for_request(&session, "orbital 4 120000 0.05");
        assert_eq!(publish(&producer, second_id, 1001), REJECTED_ACK);
        unsafe {
            multiwfn_matterviz_transport_close(&mut producer.volume_write, &mut producer.ack_read);
        }
        let cube_name = "orbital_4_120000.cube";
        fs::copy(cube_fixture(), session.join(cube_name)).unwrap();
        write_cube_response(&session, second_id, cube_name);
        let second_response = second.join().unwrap();
        assert_eq!(second_response["ok"], true);
        assert_eq!(second_response["layer"]["path"], cube_name);
        assert!(second_response["layer"].get("format").is_none());
        assert!(request_bytes(&base, &format!("/session/{cube_name}"))
            .starts_with(b"HTTP/1.1 200 OK\r\n"));

        wait_until(Duration::from_secs(2), || {
            request_bytes(&base, &format!("/api/volume/1001?cap={capability}"))
                .starts_with(b"HTTP/1.1 404 Not Found\r\n")
        });

        service.shutdown();
        service.join();
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stalled_reader_times_out_during_frame_write() {
        let (_blocked_ends, producer) = stalled_pipes();
        let origin = [0.0; 3];
        let voxel_axes = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
        let lattice = voxel_axes;
        let samples = vec![0.25; 1_500_000];
        let started = Instant::now();
        let status = unsafe {
            multiwfn_matterviz_publish_volume(
                producer.volume_write,
                producer.ack_read,
                91,
                92,
                1_500_000,
                1,
                1,
                1,
                0,
                1,
                1,
                1,
                origin.as_ptr(),
                voxel_axes.as_ptr(),
                lattice.as_ptr(),
                samples.as_ptr(),
                samples.len() as i64,
                150,
            )
        };
        assert_eq!(status, PUBLISH_TIMEOUT);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn nonexistent_host_is_reported_as_launch_failure() {
        let root = temp_dir().join("missing-host");
        fs::create_dir_all(&root).unwrap();
        let executable = c_path(&root.join("matterviz-desktop-missing"));
        let frontend = c_path(&root);
        let session = c_path(&root);
        let manifest = c_path(&root.join("manifest.json"));
        let mut volume_write = -1_isize;
        let mut ack_read = -1_isize;
        let mut transport_error = 0;
        let status = unsafe {
            multiwfn_matterviz_spawn(
                executable.as_ptr(),
                frontend.as_ptr(),
                session.as_ptr(),
                manifest.as_ptr(),
                &mut volume_write,
                &mut ack_read,
                &mut transport_error,
            )
        };
        assert_ne!(status, 0);
        assert_eq!(volume_write, -1);
        assert_eq!(ack_read, -1);
        assert_ne!(transport_error, 0);
        let _ = fs::remove_dir_all(root);
    }

    fn publish(pipes: &ProducerPipes, request_id: i64, volume_id: i64) -> c_int {
        let origin = [0.25, -0.5, 1.0];
        let voxel_axes = [0.4, 0.1, 0.0, 0.0, 0.5, 0.2, 0.1, 0.0, 0.6];
        let lattice = [0.8, 0.2, 0.0, 0.0, 1.0, 0.4, 0.3, 0.0, 1.8];
        let samples = samples();
        unsafe {
            multiwfn_matterviz_publish_volume(
                pipes.volume_write,
                pipes.ack_read,
                request_id,
                volume_id,
                2,
                2,
                3,
                1,
                0,
                1,
                1,
                1,
                origin.as_ptr(),
                voxel_axes.as_ptr(),
                lattice.as_ptr(),
                samples.as_ptr(),
                samples.len() as i64,
                5_000,
            )
        }
    }

    fn samples() -> Vec<f64> {
        vec![
            -1.25, 0.5, 2.75, -3.0, 4.5, -5.25, 6.0, -7.5, 8.25, -9.0, 10.5, 11.75,
        ]
    }

    fn spawn_orbital_request(
        base: &str,
        capability: &str,
        index: usize,
    ) -> thread::JoinHandle<Value> {
        let base = base.to_owned();
        let path =
            format!("/api/orbital?index={index}&quality=120000&isovalue=0.05&cap={capability}");
        thread::spawn(move || {
            let response = request_bytes(&base, &path);
            let (headers, body) = split_response(&response);
            assert!(headers.starts_with("HTTP/1.1 200 OK\r\n"));
            serde_json::from_slice(body).unwrap()
        })
    }

    fn wait_for_request(session: &Path, expected: &str) -> i64 {
        let request = session.join("gui_request.txt");
        let mut request_id = None;
        wait_until(Duration::from_secs(3), || {
            let Ok(text) = fs::read_to_string(&request) else {
                return false;
            };
            let Some((id, payload)) = text.trim_end().split_once(' ') else {
                return false;
            };
            if payload != expected {
                return false;
            }
            request_id = id.parse().ok();
            request_id.is_some()
        });
        fs::remove_file(request).unwrap();
        request_id.unwrap()
    }

    fn write_binary_response(session: &Path, request_id: i64, volume_id: i64) {
        fs::write(
            session.join(format!("response_{request_id}.json")),
            format!(
                r#"{{"ok":true,"layer":{{"path":"/api/volume/{volume_id}","format":"mwfn-volume-v1","role":"orbital"}}}}"#
            ),
        )
        .unwrap();
    }

    fn write_cube_response(session: &Path, request_id: i64, cube_name: &str) {
        fs::write(
            session.join(format!("response_{request_id}.json")),
            format!(r#"{{"ok":true,"layer":{{"path":"{cube_name}","role":"orbital"}}}}"#),
        )
        .unwrap();
    }

    fn request_bytes(base: &str, path: &str) -> Vec<u8> {
        let url = Url::parse(base).unwrap();
        let host = url.host_str().unwrap();
        let port = url.port().unwrap();
        let address = (host, port).to_socket_addrs().unwrap().next().unwrap();
        let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\n\r\n",
            host, port
        )
        .unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        response
    }

    fn split_response(response: &[u8]) -> (&str, &[u8]) {
        let separator = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .unwrap()
            + 4;
        (
            std::str::from_utf8(&response[..separator]).unwrap(),
            &response[separator..],
        )
    }

    fn capability(base: &str) -> String {
        Url::parse(base)
            .unwrap()
            .query_pairs()
            .find_map(|(key, value)| (key == "cap").then(|| value.into_owned()))
            .unwrap()
    }

    fn wait_until(timeout: Duration, mut predicate: impl FnMut() -> bool) {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if predicate() {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("condition was not met within {timeout:?}");
    }

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "matterviz-volume-e2e-{}-{:?}",
            std::process::id(),
            thread::current().id()
        ))
    }

    fn cube_fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../fixtures/matterviz-volume-v1-orbital.cube")
    }

    fn c_path(path: &Path) -> CString {
        CString::new(path.to_string_lossy().as_bytes()).unwrap()
    }

    #[cfg(unix)]
    fn pipes() -> (TransportConfig, ProducerPipes) {
        use std::os::fd::IntoRawFd;

        let (volume_read, volume_write) = pipe_pair();
        let (ack_read, ack_write) = pipe_pair();
        (
            TransportConfig {
                volume_read_pipe: volume_read.into_raw_fd() as u64,
                volume_ack_pipe: ack_write.into_raw_fd() as u64,
            },
            ProducerPipes {
                volume_write: volume_write.into_raw_fd() as isize,
                ack_read: ack_read.into_raw_fd() as isize,
            },
        )
    }

    #[cfg(unix)]
    fn pipe_pair() -> (fs::File, fs::File) {
        use std::os::fd::FromRawFd;
        let mut ends = [0_i32; 2];
        assert_eq!(unsafe { libc::pipe(ends.as_mut_ptr()) }, 0);
        (unsafe { fs::File::from_raw_fd(ends[0]) }, unsafe {
            fs::File::from_raw_fd(ends[1])
        })
    }

    #[cfg(unix)]
    fn stalled_pipes() -> (Vec<fs::File>, ProducerPipes) {
        use std::os::fd::IntoRawFd;
        let (volume_read, volume_write) = pipe_pair();
        let (ack_read, ack_write) = pipe_pair();
        (
            vec![volume_read, ack_write],
            ProducerPipes {
                volume_write: volume_write.into_raw_fd() as isize,
                ack_read: ack_read.into_raw_fd() as isize,
            },
        )
    }

    #[cfg(windows)]
    fn pipes() -> (TransportConfig, ProducerPipes) {
        use std::os::windows::io::IntoRawHandle;

        let (volume_read, volume_write) = pipe_pair();
        let (ack_read, ack_write) = pipe_pair();
        (
            TransportConfig {
                volume_read_pipe: volume_read.into_raw_handle() as usize as u64,
                volume_ack_pipe: ack_write.into_raw_handle() as usize as u64,
            },
            ProducerPipes {
                volume_write: volume_write.into_raw_handle() as isize,
                ack_read: ack_read.into_raw_handle() as isize,
            },
        )
    }

    #[cfg(windows)]
    fn pipe_pair() -> (fs::File, fs::File) {
        use std::os::windows::io::{FromRawHandle, RawHandle};
        use windows_sys::Win32::Foundation::HANDLE;
        use windows_sys::Win32::System::Pipes::CreatePipe;

        let mut read: HANDLE = std::ptr::null_mut();
        let mut write: HANDLE = std::ptr::null_mut();
        assert_ne!(
            unsafe { CreatePipe(&mut read, &mut write, std::ptr::null(), 0) },
            0
        );
        (
            unsafe { fs::File::from_raw_handle(read as RawHandle) },
            unsafe { fs::File::from_raw_handle(write as RawHandle) },
        )
    }

    #[cfg(windows)]
    fn stalled_pipes() -> (Vec<fs::File>, ProducerPipes) {
        use std::os::windows::io::IntoRawHandle;
        let (volume_read, volume_write) = pipe_pair();
        let (ack_read, ack_write) = pipe_pair();
        (
            vec![volume_read, ack_write],
            ProducerPipes {
                volume_write: volume_write.into_raw_handle() as isize,
                ack_read: ack_read.into_raw_handle() as isize,
            },
        )
    }

    fn read_ready(pipes: &mut ProducerPipes) {
        let mut ready = [0_u8; crate::volume_protocol::PRELUDE_BYTES];
        with_ack_reader(pipes.ack_read, |reader| {
            reader.read_exact(&mut ready).unwrap()
        });
        crate::volume_protocol::decode_ready(&ready).unwrap();
    }

    #[cfg(unix)]
    fn with_ack_reader(raw: isize, read: impl FnOnce(&mut fs::File)) {
        use std::os::fd::{FromRawFd, IntoRawFd};
        let mut file = unsafe { fs::File::from_raw_fd(raw as i32) };
        read(&mut file);
        let _ = file.into_raw_fd();
    }

    #[cfg(windows)]
    fn with_ack_reader(raw: isize, read: impl FnOnce(&mut fs::File)) {
        use std::os::windows::io::{FromRawHandle, IntoRawHandle, RawHandle};
        let mut file = unsafe { fs::File::from_raw_handle(raw as RawHandle) };
        read(&mut file);
        let _ = file.into_raw_handle();
    }
}
