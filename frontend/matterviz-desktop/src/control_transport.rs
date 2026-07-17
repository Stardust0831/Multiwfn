//! Inherited-pipe transport for the MatterViz control protocol.

use std::fmt;
use std::io::{self, Read, Write};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::control_protocol::{
    checked_frame_len, decode_frame, decode_header, encode_frame, encode_json, ControlError,
    ControlFrame, MessageType, HEADER_BYTES,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ControlTransportConfig {
    pub read_pipe: u64,
    pub write_pipe: u64,
}

#[derive(Debug)]
pub enum ControlTransportError {
    InvalidConfig(&'static str),
    Io(io::Error),
    Codec(ControlError),
    Closed,
    Timeout,
}

impl fmt::Display for ControlTransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidConfig(message) => f.write_str(message),
            Self::Io(error) => write!(f, "control pipe I/O failed: {error}"),
            Self::Codec(error) => write!(f, "invalid control frame: {error}"),
            Self::Closed => f.write_str("control transport is closed"),
            Self::Timeout => f.write_str("control transport read timed out"),
        }
    }
}

impl std::error::Error for ControlTransportError {}

impl From<io::Error> for ControlTransportError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<ControlError> for ControlTransportError {
    fn from(error: ControlError) -> Self {
        Self::Codec(error)
    }
}

pub struct ControlTransport {
    reader: Option<platform::PipeReader>,
    writer: Mutex<Option<platform::PipeWriter>>,
}

impl ControlTransport {
    pub fn adopt(config: ControlTransportConfig) -> Result<Self, ControlTransportError> {
        if config.read_pipe == config.write_pipe {
            return Err(ControlTransportError::InvalidConfig(
                "control read and write pipes must be distinct",
            ));
        }
        let reader = platform::PipeReader::adopt(config.read_pipe)?;
        let writer = platform::PipeWriter::adopt(config.write_pipe)?;
        Ok(Self {
            reader: Some(reader),
            writer: Mutex::new(Some(writer)),
        })
    }

    pub fn send_hello(&self) -> Result<(), ControlTransportError> {
        self.send_bytes(&encode_frame(MessageType::Hello, 0, None)?)
    }

    pub fn send_json(
        &self,
        message_type: MessageType,
        request_id: u64,
        body: &Value,
    ) -> Result<(), ControlTransportError> {
        self.send_bytes(&encode_frame(message_type, request_id, Some(body))?)
    }

    pub fn send_request(
        &self,
        request_id: u64,
        command: &str,
    ) -> Result<(), ControlTransportError> {
        let command = serde_json::to_string(command).map_err(|_| ControlError::InvalidJson)?;
        let body = format!(
            r#"{{"format":"multiwfn-matterviz-control","version":1,"kind":"request","request_id":{request_id},"command":{command}}}"#
        );
        self.send_bytes(&encode_json(
            MessageType::Request,
            request_id,
            Some(body.as_bytes()),
        )?)
    }

    fn send_bytes(&self, bytes: &[u8]) -> Result<(), ControlTransportError> {
        let mut guard = self
            .writer
            .lock()
            .map_err(|_| ControlTransportError::Closed)?;
        let writer = guard.as_mut().ok_or(ControlTransportError::Closed)?;
        writer.write_all(bytes)?;
        writer.flush()?;
        Ok(())
    }

    #[cfg(test)]
    pub fn read_frame(&mut self) -> Result<ControlFrame, ControlTransportError> {
        let reader = self.reader.as_mut().ok_or(ControlTransportError::Closed)?;
        let mut header = [0_u8; HEADER_BYTES];
        read_exact(reader, &mut header)?;
        let parsed = decode_header(&header)?;
        let total = checked_frame_len(parsed.body_bytes)?;
        let mut frame = vec![0_u8; total];
        frame[..HEADER_BYTES].copy_from_slice(&header);
        if total > HEADER_BYTES {
            read_exact(reader, &mut frame[HEADER_BYTES..])?;
        }
        Ok(decode_frame(&frame)?)
    }

    /// Read one complete frame, including its header and body, before `timeout` expires.
    pub fn read_frame_timeout(
        &mut self,
        timeout: Duration,
    ) -> Result<ControlFrame, ControlTransportError> {
        let reader = self.reader.as_mut().ok_or(ControlTransportError::Closed)?;
        let deadline = Instant::now()
            .checked_add(timeout)
            .ok_or(ControlTransportError::Timeout)?;
        let mut header = [0_u8; HEADER_BYTES];
        read_exact_timeout(reader, &mut header, deadline)?;
        let parsed = decode_header(&header)?;
        let total = checked_frame_len(parsed.body_bytes)?;
        let mut frame = vec![0_u8; total];
        frame[..HEADER_BYTES].copy_from_slice(&header);
        if total > HEADER_BYTES {
            read_exact_timeout(reader, &mut frame[HEADER_BYTES..], deadline)?;
        }
        Ok(decode_frame(&frame)?)
    }

    /// Wait up to `start_timeout` for a frame to begin, then require the complete
    /// frame to arrive within `completion_timeout` of its first byte.
    pub fn read_frame_startup(
        &mut self,
        start_timeout: Duration,
        completion_timeout: Duration,
    ) -> Result<ControlFrame, ControlTransportError> {
        let reader = self.reader.as_mut().ok_or(ControlTransportError::Closed)?;
        let start_deadline = Instant::now()
            .checked_add(start_timeout)
            .ok_or(ControlTransportError::Timeout)?;
        let mut header = [0_u8; HEADER_BYTES];
        read_exact_timeout(reader, &mut header[..1], start_deadline)?;

        let completion_deadline = Instant::now()
            .checked_add(completion_timeout)
            .ok_or(ControlTransportError::Timeout)?;
        read_exact_timeout(reader, &mut header[1..], completion_deadline)?;
        let parsed = decode_header(&header)?;
        let total = checked_frame_len(parsed.body_bytes)?;
        let mut frame = vec![0_u8; total];
        frame[..HEADER_BYTES].copy_from_slice(&header);
        if total > HEADER_BYTES {
            read_exact_timeout(reader, &mut frame[HEADER_BYTES..], completion_deadline)?;
        }
        Ok(decode_frame(&frame)?)
    }

    pub fn close(&mut self) {
        self.reader.take();
        if let Ok(mut writer) = self.writer.lock() {
            writer.take();
        }
    }
}

impl Drop for ControlTransport {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
fn read_exact<R: Read>(reader: &mut R, bytes: &mut [u8]) -> Result<(), ControlTransportError> {
    let mut offset = 0;
    while offset < bytes.len() {
        match reader.read(&mut bytes[offset..]) {
            Ok(0) => {
                return Err(ControlTransportError::Io(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "control pipe closed",
                )))
            }
            Ok(count) => offset += count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn read_exact_timeout(
    reader: &mut platform::PipeReader,
    bytes: &mut [u8],
    deadline: Instant,
) -> Result<(), ControlTransportError> {
    let mut offset = 0;
    while offset < bytes.len() {
        let count = reader
            .read_until(deadline, &mut bytes[offset..])
            .map_err(|error| {
                if error.kind() == io::ErrorKind::TimedOut {
                    ControlTransportError::Timeout
                } else {
                    error.into()
                }
            })?;
        if count == 0 {
            return Err(ControlTransportError::Io(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "control pipe closed",
            )));
        }
        offset += count;
    }
    Ok(())
}

#[cfg(unix)]
mod platform {
    use super::*;
    use crate::inherited_pipe;
    use std::fs::File;

    pub struct PipeReader(File);
    pub struct PipeWriter(File);

    impl PipeReader {
        pub fn adopt(raw: u64) -> Result<Self, ControlTransportError> {
            Ok(Self(inherited_pipe::adopt(raw)?))
        }

        pub(super) fn read_until(
            &mut self,
            deadline: Instant,
            bytes: &mut [u8],
        ) -> io::Result<usize> {
            use std::os::fd::AsRawFd;
            loop {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "control pipe read timed out",
                    ));
                }
                let millis = remaining.as_millis().min(i32::MAX as u128).max(1) as i32;
                let mut pollfd = libc::pollfd {
                    fd: self.0.as_raw_fd(),
                    events: libc::POLLIN,
                    revents: 0,
                };
                let result = unsafe { libc::poll(&mut pollfd, 1, millis) };
                if result < 0 {
                    let error = io::Error::last_os_error();
                    if error.kind() == io::ErrorKind::Interrupted {
                        continue;
                    }
                    return Err(error);
                }
                if result == 0 {
                    continue;
                }
                if pollfd.revents & (libc::POLLERR | libc::POLLNVAL) != 0 {
                    return Err(io::Error::last_os_error());
                }
                return self.read(bytes);
            }
        }
    }

    impl PipeWriter {
        pub fn adopt(raw: u64) -> Result<Self, ControlTransportError> {
            Ok(Self(inherited_pipe::adopt(raw)?))
        }
    }

    impl Read for PipeReader {
        fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
            self.0.read(bytes)
        }
    }
    impl Write for PipeWriter {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0.write(bytes)
        }
        fn flush(&mut self) -> io::Result<()> {
            self.0.flush()
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use crate::inherited_pipe;
    use std::fs::File;

    pub struct PipeReader(File);
    pub struct PipeWriter(File);

    impl PipeReader {
        pub fn adopt(raw: u64) -> Result<Self, ControlTransportError> {
            Ok(Self(inherited_pipe::adopt(raw)?))
        }

        pub(super) fn read_until(
            &mut self,
            deadline: Instant,
            bytes: &mut [u8],
        ) -> io::Result<usize> {
            use std::os::windows::io::AsRawHandle;
            use std::thread;
            use windows_sys::Win32::Foundation::{ERROR_BROKEN_PIPE, HANDLE};
            use windows_sys::Win32::System::Pipes::PeekNamedPipe;

            let handle = self.0.as_raw_handle() as HANDLE;
            loop {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "control pipe read timed out",
                    ));
                }
                let mut available = 0_u32;
                let peeked = unsafe {
                    PeekNamedPipe(
                        handle,
                        std::ptr::null_mut(),
                        0,
                        std::ptr::null_mut(),
                        &mut available,
                        std::ptr::null_mut(),
                    )
                };
                if peeked == 0 {
                    let error = io::Error::last_os_error();
                    if error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) {
                        return Ok(0);
                    }
                    return Err(error);
                }
                if available > 0 {
                    return self.read(bytes);
                }
                thread::sleep(Duration::from_millis(5).min(remaining));
            }
        }
    }

    impl PipeWriter {
        pub fn adopt(raw: u64) -> Result<Self, ControlTransportError> {
            Ok(Self(inherited_pipe::adopt(raw)?))
        }
    }

    impl Read for PipeReader {
        fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
            self.0.read(bytes)
        }
    }
    impl Write for PipeWriter {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0.write(bytes)
        }
        fn flush(&mut self) -> io::Result<()> {
            self.0.flush()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use crate::control_protocol::MessageType;
    #[cfg(unix)]
    use serde_json::json;
    #[cfg(unix)]
    use std::os::fd::FromRawFd;

    #[test]
    fn rejects_equal_or_invalid_config() {
        assert!(ControlTransport::adopt(ControlTransportConfig {
            read_pipe: 1,
            write_pipe: 1
        })
        .is_err());
        assert!(ControlTransport::adopt(ControlTransportConfig {
            read_pipe: u64::MAX,
            write_pipe: 2
        })
        .is_err());
    }

    #[cfg(unix)]
    fn pipe() -> (i32, i32) {
        let mut fds = [0; 2];
        assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
        (fds[0], fds[1])
    }

    #[cfg(unix)]
    fn clear_close_on_exec(fd: i32) {
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
        assert!(flags >= 0);
        assert_eq!(
            unsafe { libc::fcntl(fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) },
            0
        );
    }

    #[cfg(unix)]
    fn assert_close_on_exec(fd: i32) {
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
        assert!(flags >= 0);
        assert_ne!(flags & libc::FD_CLOEXEC, 0);
    }

    #[cfg(unix)]
    #[test]
    fn adopted_control_descriptors_are_close_on_exec() {
        let (read_in, write_in) = pipe();
        let (read_out, write_out) = pipe();
        let _input = unsafe { std::fs::File::from_raw_fd(write_in) };
        let _output = unsafe { std::fs::File::from_raw_fd(read_out) };
        clear_close_on_exec(read_in);
        clear_close_on_exec(write_out);

        let _transport = ControlTransport::adopt(ControlTransportConfig {
            read_pipe: read_in as u64,
            write_pipe: write_out as u64,
        })
        .unwrap();

        assert_close_on_exec(read_in);
        assert_close_on_exec(write_out);
    }

    #[cfg(unix)]
    #[test]
    fn fragmented_and_concatenated_frames() {
        let (read_in, write_in) = pipe();
        let (read_out, write_out) = pipe();
        let mut input = unsafe { std::fs::File::from_raw_fd(write_in) };
        let mut output = unsafe { std::fs::File::from_raw_fd(read_out) };
        let mut transport = ControlTransport::adopt(ControlTransportConfig {
            read_pipe: read_in as u64,
            write_pipe: write_out as u64,
        })
        .unwrap();
        let hello = encode_frame(MessageType::Hello, 0, None).unwrap();
        let request = encode_frame(MessageType::Request, 4, Some(&json!({"format":"multiwfn-matterviz-control","version":1,"kind":"request","request_id":4}))).unwrap();
        for byte in &hello {
            input.write_all(std::slice::from_ref(byte)).unwrap();
        }
        input.write_all(&request).unwrap();
        assert_eq!(
            transport.read_frame().unwrap().header.message_type,
            MessageType::Hello
        );
        assert_eq!(transport.read_frame().unwrap().header.request_id, 4);
        transport.send_hello().unwrap();
        let mut received = vec![0; HEADER_BYTES];
        std::io::Read::read_exact(&mut output, &mut received).unwrap();
        assert_eq!(received, hello);
    }

    #[cfg(unix)]
    #[test]
    fn timed_read_reports_no_data_timeout() {
        let (read_in, write_in) = pipe();
        let (read_out, write_out) = pipe();
        let _input = unsafe { std::fs::File::from_raw_fd(write_in) };
        let _output = unsafe { std::fs::File::from_raw_fd(read_out) };
        let mut transport = ControlTransport::adopt(ControlTransportConfig {
            read_pipe: read_in as u64,
            write_pipe: write_out as u64,
        })
        .unwrap();
        let started = std::time::Instant::now();
        assert!(matches!(
            transport.read_frame_timeout(Duration::from_millis(30)),
            Err(ControlTransportError::Timeout)
        ));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[cfg(unix)]
    #[test]
    fn timed_read_accepts_fragmented_frame() {
        let (read_in, write_in) = pipe();
        let (read_out, write_out) = pipe();
        let mut input = unsafe { std::fs::File::from_raw_fd(write_in) };
        let _output = unsafe { std::fs::File::from_raw_fd(read_out) };
        let mut transport = ControlTransport::adopt(ControlTransportConfig {
            read_pipe: read_in as u64,
            write_pipe: write_out as u64,
        })
        .unwrap();
        let hello = encode_frame(MessageType::Hello, 0, None).unwrap();
        let writer = std::thread::spawn(move || {
            for chunk in hello.chunks(7) {
                input.write_all(chunk).unwrap();
                std::thread::sleep(Duration::from_millis(2));
            }
        });
        assert_eq!(
            transport
                .read_frame_timeout(Duration::from_secs(1))
                .unwrap()
                .header
                .message_type,
            MessageType::Hello
        );
        writer.join().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn timed_read_body_obeys_one_total_deadline() {
        let (read_in, write_in) = pipe();
        let (read_out, write_out) = pipe();
        let mut input = unsafe { std::fs::File::from_raw_fd(write_in) };
        let _output = unsafe { std::fs::File::from_raw_fd(read_out) };
        let mut transport = ControlTransport::adopt(ControlTransportConfig {
            read_pipe: read_in as u64,
            write_pipe: write_out as u64,
        })
        .unwrap();
        let body = json!({
            "format": "multiwfn-matterviz-control",
            "version": 1,
            "kind": "request",
            "request_id": 4,
        });
        let frame = encode_frame(MessageType::Request, 4, Some(&body)).unwrap();
        let writer = std::thread::spawn(move || {
            input.write_all(&frame[..HEADER_BYTES]).unwrap();
            std::thread::sleep(Duration::from_millis(40));
            input.write_all(&frame[HEADER_BYTES..]).unwrap();
        });
        let started = Instant::now();
        assert!(matches!(
            transport.read_frame_timeout(Duration::from_millis(25)),
            Err(ControlTransportError::Timeout)
        ));
        assert!(started.elapsed() < Duration::from_secs(1));
        writer.join().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn timed_read_distinguishes_eof_and_total_deadline() {
        let (read_in, write_in) = pipe();
        let (read_out, write_out) = pipe();
        let input = unsafe { std::fs::File::from_raw_fd(write_in) };
        let _output = unsafe { std::fs::File::from_raw_fd(read_out) };
        let mut transport = ControlTransport::adopt(ControlTransportConfig {
            read_pipe: read_in as u64,
            write_pipe: write_out as u64,
        })
        .unwrap();
        drop(input);
        assert!(matches!(
            transport.read_frame_timeout(Duration::from_secs(1)),
            Err(ControlTransportError::Io(error)) if error.kind() == io::ErrorKind::UnexpectedEof
        ));

        let (read_in, write_in) = pipe();
        let (read_out, write_out) = pipe();
        let mut input = unsafe { std::fs::File::from_raw_fd(write_in) };
        let _output = unsafe { std::fs::File::from_raw_fd(read_out) };
        let mut transport = ControlTransport::adopt(ControlTransportConfig {
            read_pipe: read_in as u64,
            write_pipe: write_out as u64,
        })
        .unwrap();
        let hello = encode_frame(MessageType::Hello, 0, None).unwrap();
        let writer = std::thread::spawn(move || {
            input.write_all(&hello[..1]).unwrap();
            std::thread::sleep(Duration::from_millis(100));
        });
        let started = Instant::now();
        assert!(matches!(
            transport.read_frame_timeout(Duration::from_millis(30)),
            Err(ControlTransportError::Timeout)
        ));
        assert!(started.elapsed() < Duration::from_secs(1));
        writer.join().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn startup_read_uses_a_separate_completion_deadline() {
        let (read_in, write_in) = pipe();
        let (read_out, write_out) = pipe();
        let mut input = unsafe { std::fs::File::from_raw_fd(write_in) };
        let _output = unsafe { std::fs::File::from_raw_fd(read_out) };
        let mut transport = ControlTransport::adopt(ControlTransportConfig {
            read_pipe: read_in as u64,
            write_pipe: write_out as u64,
        })
        .unwrap();
        let hello = encode_frame(MessageType::Hello, 0, None).unwrap();
        let writer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(40));
            input.write_all(&hello[..1]).unwrap();
            std::thread::sleep(Duration::from_millis(40));
            let _ = input.write_all(&hello[1..]);
        });
        assert!(matches!(
            transport.read_frame_startup(Duration::from_millis(100), Duration::from_millis(20)),
            Err(ControlTransportError::Timeout)
        ));
        writer.join().unwrap();
    }
}
