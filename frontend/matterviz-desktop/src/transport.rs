use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread;

use crate::stream_broker::{StreamEvent, VolumeStreamBroker};
use crate::volume_protocol::{
    declared_volume_frame_len, decode_stream_volume_header, encode_ack, encode_ready,
    encode_stream_ack, protocol_major, Crc32c, PRELUDE_BYTES, STREAM_MAJOR, VOLUME_HEADER_BYTES,
};
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
    #[cfg(test)]
    pub fn start(
        config: TransportConfig,
        store: Arc<VolumeStore>,
        stop: Arc<AtomicBool>,
    ) -> Result<Self, String> {
        Self::start_with_broker(config, store, Arc::new(VolumeStreamBroker::default()), stop)
    }

    pub fn start_with_broker(
        config: TransportConfig,
        store: Arc<VolumeStore>,
        broker: Arc<VolumeStreamBroker>,
        stop: Arc<AtomicBool>,
    ) -> Result<Self, String> {
        let reader = platform::PipeReader::adopt(config.volume_read_pipe)
            .map_err(|error| format!("could not adopt volume read pipe: {error}"))?;
        let writer = platform::PipeWriter::adopt(config.volume_ack_pipe)
            .map_err(|error| format!("could not adopt volume ACK pipe: {error}"))?;
        let worker = thread::Builder::new()
            .name("matterviz-volume-reader".to_owned())
            .spawn(move || run(reader, writer, store, broker, stop))
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
    broker: Arc<VolumeStreamBroker>,
    stop: Arc<AtomicBool>,
) {
    if writer.write_all(&encode_ready()).is_err() {
        store.clear();
        stop.store(true, Ordering::Release);
        return;
    }
    while !stop.load(Ordering::Acquire) {
        let mut prelude = [0_u8; PRELUDE_BYTES];
        if read_exact(&mut reader, &mut prelude, &stop).is_err() {
            break;
        }
        let major = match protocol_major(&prelude) {
            Ok(value) => value,
            Err(_) => break,
        };
        let result = if major == STREAM_MAJOR {
            receive_stream_volume(&mut reader, &mut writer, &broker, &stop, prelude)
        } else {
            receive_buffered_volume(&mut reader, &mut writer, &store, &stop, prelude)
        };
        if result.is_err() {
            break;
        }
    }
    store.clear();
    broker.fail_all("MatterViz volume transport closed");
    stop.store(true, Ordering::Release);
}

fn receive_buffered_volume(
    reader: &mut platform::PipeReader,
    writer: &mut platform::PipeWriter,
    store: &VolumeStore,
    stop: &AtomicBool,
    prelude: [u8; PRELUDE_BYTES],
) -> Result<(), ()> {
    let frame_len = declared_volume_frame_len(&prelude).map_err(|_| ())?;
    let mut frame = vec![0_u8; frame_len];
    frame[..PRELUDE_BYTES].copy_from_slice(&prelude);
    read_exact(reader, &mut frame[PRELUDE_BYTES..], stop)?;
    let identity = frame_identity(&frame).ok_or(())?;
    let status = if store.insert(frame).is_ok() { 0 } else { 1 };
    let ack = encode_ack(identity.0, identity.1, status).map_err(|_| ())?;
    writer.write_all(&ack).map_err(|_| ())
}

fn receive_stream_volume(
    reader: &mut platform::PipeReader,
    writer: &mut platform::PipeWriter,
    broker: &VolumeStreamBroker,
    stop: &AtomicBool,
    prelude: [u8; PRELUDE_BYTES],
) -> Result<(), ()> {
    let mut header = [0_u8; VOLUME_HEADER_BYTES];
    header[..PRELUDE_BYTES].copy_from_slice(&prelude);
    read_exact(reader, &mut header[PRELUDE_BYTES..], stop)?;
    let metadata = decode_stream_volume_header(&header).map_err(|_| ())?;
    let request_id = metadata.request_id;
    let volume_id = metadata.volume_id;
    let expected_crc = metadata.body_crc32c;
    let mut sender = broker.sender(request_id);
    let mut accepted = sender.as_ref().is_some_and(|channel| {
        send_event(
            channel,
            StreamEvent::Begin(Box::new(metadata.clone()), Box::new(header)),
            stop,
        )
    });
    if !accepted {
        sender = None;
    }
    let mut remaining = metadata.body_bytes;
    let mut crc = Crc32c::new();
    while remaining > 0 {
        let length = usize::try_from(remaining.min(64 * 1024)).map_err(|_| ())?;
        let mut chunk = vec![0_u8; length];
        read_exact(reader, &mut chunk, stop)?;
        crc.update(&chunk);
        if let Some(channel) = sender.as_ref() {
            if !send_event(channel, StreamEvent::Chunk(chunk), stop) {
                sender = None;
                accepted = false;
            }
        }
        remaining -= length as u64;
    }
    let valid = crc.finish() == expected_crc;
    if let Some(channel) = sender.as_ref() {
        let event = if valid {
            StreamEvent::End
        } else {
            StreamEvent::Error("MatterViz volume body CRC mismatch".to_owned())
        };
        if !send_event(channel, event, stop) {
            accepted = false;
        }
    }
    broker.finish(request_id);
    let status = u32::from(!accepted || !valid);
    let ack = encode_stream_ack(request_id, volume_id, status).map_err(|_| ())?;
    writer.write_all(&ack).map_err(|_| ())
}

fn send_event(sender: &SyncSender<StreamEvent>, mut event: StreamEvent, stop: &AtomicBool) -> bool {
    loop {
        if stop.load(Ordering::Acquire) {
            return false;
        }
        match sender.try_send(event) {
            Ok(()) => return true,
            Err(TrySendError::Disconnected(_)) => return false,
            Err(TrySendError::Full(returned)) => {
                event = returned;
                thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    }
}

fn read_exact(
    reader: &mut platform::PipeReader,
    mut target: &mut [u8],
    stop: &AtomicBool,
) -> Result<(), ()> {
    while !target.is_empty() && !stop.load(Ordering::Acquire) {
        match reader.read_available(target) {
            Ok(platform::ReadState::Pending) => continue,
            Ok(platform::ReadState::Data(length)) => {
                let (_, remainder) = std::mem::take(&mut target).split_at_mut(length);
                target = remainder;
            }
            Ok(platform::ReadState::Eof) | Err(_) => return Err(()),
        }
    }
    target.is_empty().then_some(()).ok_or(())
}

fn frame_identity(frame: &[u8]) -> Option<(u64, u64)> {
    let request_id = u64::from_le_bytes(frame.get(20..28)?.try_into().ok()?);
    let volume_id = u64::from_le_bytes(frame.get(48..56)?.try_into().ok()?);
    (request_id != 0 && volume_id != 0).then_some((request_id, volume_id))
}

#[cfg(unix)]
mod platform {
    use crate::inherited_pipe;
    use std::fs::File;
    use std::io::{self, Read, Write};
    use std::os::fd::AsRawFd;
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
            let file = inherited_pipe::adopt(raw)?;
            let flags = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETFL) };
            if flags < 0
                || unsafe { libc::fcntl(file.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) }
                    < 0
            {
                return Err(io::Error::last_os_error());
            }
            Ok(Self(file))
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
            inherited_pipe::adopt(raw).map(Self)
        }

        pub fn write_all(&mut self, bytes: &[u8]) -> io::Result<()> {
            self.0.write_all(bytes)
        }
    }
}

#[cfg(windows)]
mod platform {
    use crate::inherited_pipe;
    use std::fs::File;
    use std::io;
    use std::os::windows::io::AsRawHandle;
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

    pub struct PipeReader(File);
    pub struct PipeWriter(File);

    impl PipeReader {
        pub fn adopt(raw: u64) -> io::Result<Self> {
            inherited_pipe::adopt(raw).map(Self)
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
            inherited_pipe::adopt(raw).map(Self)
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stream_broker::VolumeStreamBroker;
    use crate::volume_protocol::{decode_ack, decode_volume, encode_volume, Crc32c};
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

    #[cfg(unix)]
    fn clear_close_on_exec(fd: std::os::fd::RawFd) {
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
        assert!(flags >= 0);
        assert_eq!(
            unsafe { libc::fcntl(fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) },
            0
        );
    }

    #[cfg(unix)]
    fn assert_close_on_exec(fd: std::os::fd::RawFd) {
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
        assert!(flags >= 0);
        assert_ne!(flags & libc::FD_CLOEXEC, 0);
    }

    #[cfg(unix)]
    #[test]
    fn adopted_volume_descriptors_are_close_on_exec() {
        use std::os::fd::IntoRawFd;

        let (read_volume, _write_volume) = pipe_pair();
        let (_read_ack, write_ack) = pipe_pair();
        let read_fd = read_volume.into_raw_fd();
        let write_fd = write_ack.into_raw_fd();
        clear_close_on_exec(read_fd);
        clear_close_on_exec(write_fd);

        let _reader = platform::PipeReader::adopt(read_fd as u64).unwrap();
        let _writer = platform::PipeWriter::adopt(write_fd as u64).unwrap();

        assert_close_on_exec(read_fd);
        assert_close_on_exec(write_fd);
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

    fn stream_fixture() -> Vec<u8> {
        let mut frame = fixture();
        frame[8..10].copy_from_slice(&STREAM_MAJOR.to_le_bytes());
        frame[36..40].fill(0);
        let mut crc = Crc32c::new();
        crc.update(&frame[..VOLUME_HEADER_BYTES]);
        frame[36..40].copy_from_slice(&crc.finish().to_le_bytes());
        frame
    }

    fn set_stream_identity(frame: &mut [u8], request_id: u64, volume_id: u64) {
        frame[20..28].copy_from_slice(&request_id.to_le_bytes());
        frame[48..56].copy_from_slice(&volume_id.to_le_bytes());
        frame[36..40].fill(0);
        let mut crc = Crc32c::new();
        crc.update(&frame[..VOLUME_HEADER_BYTES]);
        frame[36..40].copy_from_slice(&crc.finish().to_le_bytes());
    }

    #[test]
    fn full_stream_channel_observes_stop_without_blocking() {
        let (sender, _receiver) = std::sync::mpsc::sync_channel(1);
        sender.send(StreamEvent::End).unwrap();
        let stop = AtomicBool::new(true);
        assert!(!send_event(&sender, StreamEvent::End, &stop));
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn major_two_frame_streams_through_broker_and_uses_major_two_ack() {
        let (volume_read, mut volume_write) = pipe_pair();
        let (mut ack_read, ack_write) = pipe_pair();
        let config = TransportConfig {
            volume_read_pipe: into_raw_pipe(volume_read),
            volume_ack_pipe: into_raw_pipe(ack_write),
        };
        let store = Arc::new(VolumeStore::new());
        let broker = Arc::new(VolumeStreamBroker::default());
        let registration = broker.register(42).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let transport =
            VolumeTransport::start_with_broker(config, store.clone(), broker.clone(), stop)
                .unwrap();
        let mut ready = [0_u8; PRELUDE_BYTES];
        ack_read.read_exact(&mut ready).unwrap();
        crate::volume_protocol::decode_ready(&ready).unwrap();

        let frame = stream_fixture();
        for chunk in frame.chunks(19) {
            volume_write.write_all(chunk).unwrap();
        }
        let (metadata, header) = match registration.receiver().recv().unwrap() {
            StreamEvent::Begin(metadata, header) => (metadata, header),
            _ => panic!("expected stream begin"),
        };
        assert_eq!(metadata.request_id, 42);
        assert_eq!(metadata.volume_id, 1001);
        assert_eq!(header.as_slice(), &frame[..VOLUME_HEADER_BYTES]);
        let mut body = Vec::new();
        loop {
            match registration.receiver().recv().unwrap() {
                StreamEvent::Chunk(chunk) => body.extend_from_slice(&chunk),
                StreamEvent::End => break,
                StreamEvent::Error(message) => panic!("unexpected stream error: {message}"),
                StreamEvent::Begin(_, _) => panic!("duplicate stream begin"),
            }
        }
        assert_eq!(body, frame[VOLUME_HEADER_BYTES..]);
        let mut ack = [0_u8; crate::volume_protocol::ACK_HEADER_BYTES];
        ack_read.read_exact(&mut ack).unwrap();
        assert_eq!(
            u16::from_le_bytes(ack[8..10].try_into().unwrap()),
            STREAM_MAJOR
        );
        assert_eq!(u64::from_le_bytes(ack[20..28].try_into().unwrap()), 42);
        assert_eq!(u64::from_le_bytes(ack[48..56].try_into().unwrap()), 1001);
        assert_eq!(u32::from_le_bytes(ack[56..60].try_into().unwrap()), 0);
        assert!(store.is_empty());

        drop(volume_write);
        transport.join();
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn rejected_stream_does_not_prevent_the_next_registered_request() {
        let (volume_read, mut volume_write) = pipe_pair();
        let (mut ack_read, ack_write) = pipe_pair();
        let config = TransportConfig {
            volume_read_pipe: into_raw_pipe(volume_read),
            volume_ack_pipe: into_raw_pipe(ack_write),
        };
        let store = Arc::new(VolumeStore::new());
        let broker = Arc::new(VolumeStreamBroker::default());
        let stop = Arc::new(AtomicBool::new(false));
        let transport =
            VolumeTransport::start_with_broker(config, store, broker.clone(), stop).unwrap();
        let mut ready = [0_u8; PRELUDE_BYTES];
        ack_read.read_exact(&mut ready).unwrap();

        let mut frame = stream_fixture();
        volume_write.write_all(&frame).unwrap();
        let mut ack = [0_u8; crate::volume_protocol::ACK_HEADER_BYTES];
        ack_read.read_exact(&mut ack).unwrap();
        assert_eq!(u32::from_le_bytes(ack[56..60].try_into().unwrap()), 1);

        set_stream_identity(&mut frame, 43, 1002);
        let registration = broker.register(43).unwrap();
        volume_write.write_all(&frame).unwrap();
        assert!(matches!(
            registration.receiver().recv().unwrap(),
            StreamEvent::Begin(_, _)
        ));
        loop {
            match registration.receiver().recv().unwrap() {
                StreamEvent::Chunk(_) => {}
                StreamEvent::End => break,
                event => panic!("unexpected stream event: {event:?}"),
            }
        }
        ack_read.read_exact(&mut ack).unwrap();
        assert_eq!(u64::from_le_bytes(ack[20..28].try_into().unwrap()), 43);
        assert_eq!(u32::from_le_bytes(ack[56..60].try_into().unwrap()), 0);

        drop(volume_write);
        transport.join();
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
            assert!(stop.load(Ordering::Acquire));
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
