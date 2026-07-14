use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use crate::volume_protocol::{declared_volume_frame_len, encode_ack, encode_ready, PRELUDE_BYTES};
use crate::volume_store::VolumeStore;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TransportConfig {
    pub volume_read_pipe: u64,
    pub volume_ack_pipe: u64,
}

pub struct VolumeTransport {
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

impl VolumeTransport {
    pub fn start(
        config: TransportConfig,
        store: Arc<VolumeStore>,
        stop: Arc<AtomicBool>,
    ) -> Result<Self, String> {
        let reader = platform::PipeReader::adopt(config.volume_read_pipe)
            .map_err(|error| format!("could not adopt volume read pipe: {error}"))?;
        let writer = platform::PipeWriter::adopt(config.volume_ack_pipe)
            .map_err(|error| format!("could not adopt volume ACK pipe: {error}"))?;
        let worker = thread::Builder::new()
            .name("matterviz-volume-reader".to_owned())
            .spawn(move || run(reader, writer, store, stop))
            .map_err(|error| format!("could not start volume reader: {error}"))?;
        Ok(Self {
            worker: Mutex::new(Some(worker)),
        })
    }

    pub fn join(&self) {
        if let Some(worker) = self.worker.lock().expect("transport worker lock").take() {
            let _ = worker.join();
        }
    }
}

fn run(
    mut reader: platform::PipeReader,
    mut writer: platform::PipeWriter,
    store: Arc<VolumeStore>,
    stop: Arc<AtomicBool>,
) {
    if writer.write_all(&encode_ready()).is_err() {
        store.clear();
        return;
    }
    let mut buffered = Vec::new();
    let mut chunk = [0_u8; 64 * 1024];
    while !stop.load(Ordering::Acquire) {
        match reader.read_available(&mut chunk) {
            Ok(platform::ReadState::Pending) => continue,
            Ok(platform::ReadState::Eof) | Err(_) => break,
            Ok(platform::ReadState::Data(length)) => {
                buffered.extend_from_slice(&chunk[..length]);
            }
        }
        while buffered.len() >= PRELUDE_BYTES {
            let frame_len = match declared_volume_frame_len(&buffered[..PRELUDE_BYTES]) {
                Ok(value) => value,
                Err(_) => {
                    store.clear();
                    return;
                }
            };
            if buffered.len() < frame_len {
                break;
            }
            let remainder = buffered.split_off(frame_len);
            let frame = std::mem::replace(&mut buffered, remainder);
            let identity = frame_identity(&frame);
            let status = if store.insert(frame).is_ok() { 0 } else { 1 };
            let Some((request_id, volume_id)) = identity else {
                store.clear();
                return;
            };
            let ack = match encode_ack(request_id, volume_id, status) {
                Ok(value) => value,
                Err(_) => {
                    store.clear();
                    return;
                }
            };
            if writer.write_all(&ack).is_err() {
                store.clear();
                return;
            }
        }
    }
    store.clear();
}

fn frame_identity(frame: &[u8]) -> Option<(u64, u64)> {
    let request_id = u64::from_le_bytes(frame.get(20..28)?.try_into().ok()?);
    let volume_id = u64::from_le_bytes(frame.get(48..56)?.try_into().ok()?);
    (request_id != 0 && volume_id != 0).then_some((request_id, volume_id))
}

#[cfg(unix)]
mod platform {
    use std::fs::File;
    use std::io::{self, Read, Write};
    use std::os::fd::{FromRawFd, RawFd};
    use std::thread;
    use std::time::Duration;

    pub enum ReadState {
        Data(usize),
        Pending,
        Eof,
    }

    pub struct PipeReader(File);
    pub struct PipeWriter(File);

    impl PipeReader {
        pub fn adopt(raw: u64) -> io::Result<Self> {
            let raw = RawFd::try_from(raw)
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "pipe fd is too large"))?;
            let flags = unsafe { libc::fcntl(raw, libc::F_GETFL) };
            if flags < 0 || unsafe { libc::fcntl(raw, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
            {
                return Err(io::Error::last_os_error());
            }
            Ok(Self(unsafe { File::from_raw_fd(raw) }))
        }

        pub fn read_available(&mut self, buffer: &mut [u8]) -> io::Result<ReadState> {
            match self.0.read(buffer) {
                Ok(0) => Ok(ReadState::Eof),
                Ok(length) => Ok(ReadState::Data(length)),
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(20));
                    Ok(ReadState::Pending)
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => Ok(ReadState::Pending),
                Err(error) => Err(error),
            }
        }
    }

    impl PipeWriter {
        pub fn adopt(raw: u64) -> io::Result<Self> {
            let raw = RawFd::try_from(raw)
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "pipe fd is too large"))?;
            Ok(Self(unsafe { File::from_raw_fd(raw) }))
        }

        pub fn write_all(&mut self, bytes: &[u8]) -> io::Result<()> {
            self.0.write_all(bytes)
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::io;
    use std::os::windows::io::{FromRawHandle, OwnedHandle, RawHandle};
    use std::thread;
    use std::time::Duration;

    use windows_sys::Win32::Foundation::{ERROR_BROKEN_PIPE, HANDLE};
    use windows_sys::Win32::Storage::FileSystem::{ReadFile, WriteFile};
    use windows_sys::Win32::System::Pipes::PeekNamedPipe;

    pub enum ReadState {
        Data(usize),
        Pending,
        Eof,
    }

    pub struct PipeReader(OwnedHandle);
    pub struct PipeWriter(OwnedHandle);

    fn adopt(raw: u64) -> io::Result<OwnedHandle> {
        let raw = usize::try_from(raw)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "pipe handle is too large"))?;
        if raw == 0 || raw == usize::MAX {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid pipe handle",
            ));
        }
        Ok(unsafe { OwnedHandle::from_raw_handle(raw as RawHandle) })
    }

    impl PipeReader {
        pub fn adopt(raw: u64) -> io::Result<Self> {
            adopt(raw).map(Self)
        }

        pub fn read_available(&mut self, buffer: &mut [u8]) -> io::Result<ReadState> {
            let handle = self.0.as_raw_handle() as HANDLE;
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
                return if error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) {
                    Ok(ReadState::Eof)
                } else {
                    Err(error)
                };
            }
            if available == 0 {
                thread::sleep(Duration::from_millis(20));
                return Ok(ReadState::Pending);
            }
            let requested = buffer.len().min(available as usize) as u32;
            let mut read = 0_u32;
            let result = unsafe {
                ReadFile(
                    handle,
                    buffer.as_mut_ptr().cast(),
                    requested,
                    &mut read,
                    std::ptr::null_mut(),
                )
            };
            if result == 0 {
                let error = io::Error::last_os_error();
                return if error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) {
                    Ok(ReadState::Eof)
                } else {
                    Err(error)
                };
            }
            Ok(if read == 0 {
                ReadState::Eof
            } else {
                ReadState::Data(read as usize)
            })
        }
    }

    impl PipeWriter {
        pub fn adopt(raw: u64) -> io::Result<Self> {
            adopt(raw).map(Self)
        }

        pub fn write_all(&mut self, mut bytes: &[u8]) -> io::Result<()> {
            let handle = self.0.as_raw_handle() as HANDLE;
            while !bytes.is_empty() {
                let requested = bytes.len().min(u32::MAX as usize) as u32;
                let mut written = 0_u32;
                let result = unsafe {
                    WriteFile(
                        handle,
                        bytes.as_ptr().cast(),
                        requested,
                        &mut written,
                        std::ptr::null_mut(),
                    )
                };
                if result == 0 {
                    return Err(io::Error::last_os_error());
                }
                if written == 0 {
                    return Err(io::Error::new(
                        io::ErrorKind::WriteZero,
                        "volume ACK pipe wrote zero bytes",
                    ));
                }
                bytes = &bytes[written as usize..];
            }
            Ok(())
        }
    }

    use std::os::windows::io::AsRawHandle;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::volume_protocol::{decode_ack, decode_volume, encode_volume};
    use std::io::{Read, Write};
    use std::sync::atomic::AtomicBool;
    use std::time::{Duration, Instant};

    #[cfg(unix)]
    fn pipe_pair() -> (std::fs::File, std::fs::File) {
        use std::os::fd::FromRawFd;
        let mut ends = [0_i32; 2];
        assert_eq!(unsafe { libc::pipe(ends.as_mut_ptr()) }, 0);
        let read = unsafe { std::fs::File::from_raw_fd(ends[0]) };
        let write = unsafe { std::fs::File::from_raw_fd(ends[1]) };
        (read, write)
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

    fn fixture() -> Vec<u8> {
        include_str!("../../../tests/fixtures/matterviz-volume-v1-orbital.hex")
            .lines()
            .filter_map(|line| line.split('#').next())
            .flat_map(str::split_whitespace)
            .flat_map(|word| {
                (0..word.len())
                    .step_by(2)
                    .map(move |index| u8::from_str_radix(&word[index..index + 2], 16).unwrap())
            })
            .collect()
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn fragmented_and_multiple_frames_ack_after_insertion_and_reject_duplicates() {
        let (volume_read, mut volume_write) = pipe_pair();
        let (mut ack_read, ack_write) = pipe_pair();
        let config = TransportConfig {
            volume_read_pipe: into_raw_pipe(volume_read),
            volume_ack_pipe: into_raw_pipe(ack_write),
        };
        let store = Arc::new(VolumeStore::new());
        let stop = Arc::new(AtomicBool::new(false));
        let transport = VolumeTransport::start(config, store.clone(), stop.clone()).unwrap();
        let mut ready = [0_u8; PRELUDE_BYTES];
        ack_read.read_exact(&mut ready).unwrap();
        crate::volume_protocol::decode_ready(&ready).unwrap();

        let frame = fixture();
        for chunk in frame.chunks(17) {
            volume_write.write_all(chunk).unwrap();
        }
        let mut ack = [0_u8; crate::volume_protocol::ACK_HEADER_BYTES];
        ack_read.read_exact(&mut ack).unwrap();
        assert!(store.get(1001).is_some());
        assert_eq!(decode_ack(&ack).unwrap(), (42, 1001, 0));

        let mut second = decode_volume(&frame).unwrap();
        second.request_id = 43;
        second.volume_id = 1002;
        volume_write
            .write_all(&encode_volume(&second).unwrap())
            .unwrap();
        ack_read.read_exact(&mut ack).unwrap();
        assert_eq!(decode_ack(&ack).unwrap(), (43, 1002, 0));

        volume_write
            .write_all(&encode_volume(&second).unwrap())
            .unwrap();
        ack_read.read_exact(&mut ack).unwrap();
        assert_eq!(decode_ack(&ack).unwrap(), (43, 1002, 1));

        let mut corrupt = frame;
        corrupt[304] ^= 1;
        volume_write.write_all(&corrupt).unwrap();
        ack_read.read_exact(&mut ack).unwrap();
        assert_eq!(decode_ack(&ack).unwrap(), (42, 1001, 1));

        drop(volume_write);
        transport.join();
        assert!(store.is_empty());
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn partial_eof_and_idle_shutdown_exit_without_hanging() {
        for partial in [Some(97_usize), None] {
            let (volume_read, mut volume_write) = pipe_pair();
            let (mut ack_read, ack_write) = pipe_pair();
            let config = TransportConfig {
                volume_read_pipe: into_raw_pipe(volume_read),
                volume_ack_pipe: into_raw_pipe(ack_write),
            };
            let store = Arc::new(VolumeStore::new());
            let stop = Arc::new(AtomicBool::new(false));
            let transport = VolumeTransport::start(config, store.clone(), stop.clone()).unwrap();
            let mut ready = [0_u8; PRELUDE_BYTES];
            ack_read.read_exact(&mut ready).unwrap();
            crate::volume_protocol::decode_ready(&ready).unwrap();

            if let Some(length) = partial {
                volume_write.write_all(&fixture()[..length]).unwrap();
                drop(volume_write);
            } else {
                stop.store(true, Ordering::Release);
            }

            let started = Instant::now();
            transport.join();
            assert!(started.elapsed() < Duration::from_secs(2));
            assert!(store.is_empty());
        }
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
}
