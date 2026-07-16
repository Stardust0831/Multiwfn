//! Codec and inherited-pipe writer for the native file picker result.

use std::fmt;
use std::io::{self, Write};

pub const HEADER_BYTES: usize = 32;
pub const MAX_BODY_BYTES: usize = 32 * 1024;
pub const PROTOCOL_MAJOR: u16 = 1;
pub const PROTOCOL_MINOR: u16 = 0;
pub const HEADER_CRC_FLAG: u16 = 0x0001;
pub const BODY_CRC_FLAG: u16 = 0x0002;

const MAGIC: &[u8; 8] = b"MWFNPICK";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum PickerStatus {
    Cancel = 0,
    Selected = 1,
    Error = 2,
}

impl PickerStatus {
    #[cfg(test)]
    fn from_wire(value: u16) -> Result<Self, PickerError> {
        match value {
            0 => Ok(Self::Cancel),
            1 => Ok(Self::Selected),
            2 => Ok(Self::Error),
            _ => Err(PickerError::InvalidStatus),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg(test)]
pub struct PickerHeader {
    pub status: PickerStatus,
    pub flags: u16,
    pub body_bytes: u32,
    pub body_crc32c: u32,
    pub header_crc32c: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg(test)]
pub struct PickerFrame {
    pub header: PickerHeader,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PickerError {
    #[cfg(test)]
    Truncated,
    #[cfg(test)]
    TrailingBytes,
    #[cfg(test)]
    InvalidMagic,
    #[cfg(test)]
    UnsupportedVersion,
    #[cfg(test)]
    InvalidStatus,
    #[cfg(test)]
    InvalidFlags,
    #[cfg(test)]
    InvalidHeader,
    LimitExceeded,
    #[cfg(test)]
    InvalidCrc,
    InvalidUtf8,
    InvalidBody,
    NulByte,
    Overflow,
    InvalidHandle(&'static str),
    Io,
}

impl fmt::Display for PickerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            #[cfg(test)]
            Self::Truncated => "truncated picker result frame",
            #[cfg(test)]
            Self::TrailingBytes => "trailing bytes after picker result frame",
            #[cfg(test)]
            Self::InvalidMagic => "invalid picker result magic",
            #[cfg(test)]
            Self::UnsupportedVersion => "unsupported picker result version",
            #[cfg(test)]
            Self::InvalidStatus => "invalid picker result status",
            #[cfg(test)]
            Self::InvalidFlags => "invalid picker result flags",
            #[cfg(test)]
            Self::InvalidHeader => "invalid picker result header",
            Self::LimitExceeded => "picker result body exceeds maximum size",
            #[cfg(test)]
            Self::InvalidCrc => "picker result CRC32C mismatch",
            Self::InvalidUtf8 => "picker result body is not UTF-8",
            Self::InvalidBody => "invalid picker result body",
            Self::NulByte => "picker result body contains NUL",
            Self::Overflow => "picker result frame size overflow",
            Self::InvalidHandle(message) => message,
            Self::Io => "picker result pipe I/O failed",
        };
        f.write_str(message)
    }
}

impl std::error::Error for PickerError {}

pub fn crc32c(data: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for &byte in data {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            let mask = 0u32.wrapping_sub(crc & 1);
            crc = (crc >> 1) ^ (0x82f6_3b78 & mask);
        }
    }
    !crc
}

pub fn checked_frame_len(body_bytes: u32) -> Result<usize, PickerError> {
    if body_bytes as usize > MAX_BODY_BYTES {
        return Err(PickerError::LimitExceeded);
    }
    HEADER_BYTES
        .checked_add(body_bytes as usize)
        .ok_or(PickerError::Overflow)
}

pub fn encode(status: PickerStatus, body: &[u8]) -> Result<Vec<u8>, PickerError> {
    validate_body(status, body)?;
    let total = checked_frame_len(body.len() as u32)?;
    let mut frame = vec![0_u8; total];
    frame[..8].copy_from_slice(MAGIC);
    put_u16(&mut frame, 8, PROTOCOL_MAJOR);
    put_u16(&mut frame, 10, PROTOCOL_MINOR);
    put_u16(&mut frame, 12, status as u16);
    put_u16(
        &mut frame,
        14,
        HEADER_CRC_FLAG | if body.is_empty() { 0 } else { BODY_CRC_FLAG },
    );
    put_u32(&mut frame, 16, HEADER_BYTES as u32);
    put_u32(&mut frame, 20, body.len() as u32);
    if !body.is_empty() {
        frame[HEADER_BYTES..].copy_from_slice(body);
        put_u32(&mut frame, 24, crc32c(body));
    }
    let mut header_for_crc = [0_u8; HEADER_BYTES];
    header_for_crc.copy_from_slice(&frame[..HEADER_BYTES]);
    header_for_crc[28..].fill(0);
    let header_crc = crc32c(&header_for_crc);
    put_u32(&mut frame, 28, header_crc);
    Ok(frame)
}

pub fn encode_selected(path: &str) -> Result<Vec<u8>, PickerError> {
    encode(PickerStatus::Selected, path.as_bytes())
}

pub fn encode_cancel() -> Result<Vec<u8>, PickerError> {
    encode(PickerStatus::Cancel, &[])
}

pub fn encode_error(message: &str) -> Result<Vec<u8>, PickerError> {
    encode(PickerStatus::Error, message.as_bytes())
}

#[cfg(test)]
pub fn decode_header(bytes: &[u8]) -> Result<PickerHeader, PickerError> {
    if bytes.len() < HEADER_BYTES {
        return Err(PickerError::Truncated);
    }
    let h = &bytes[..HEADER_BYTES];
    if &h[..8] != MAGIC {
        return Err(PickerError::InvalidMagic);
    }
    if u16_at(h, 8) != PROTOCOL_MAJOR || u16_at(h, 10) != PROTOCOL_MINOR {
        return Err(PickerError::UnsupportedVersion);
    }
    if u32_at(h, 16) != HEADER_BYTES as u32 {
        return Err(PickerError::InvalidHeader);
    }
    let status = PickerStatus::from_wire(u16_at(h, 12))?;
    let flags = u16_at(h, 14);
    let body_bytes = u32_at(h, 20);
    checked_frame_len(body_bytes)?;
    let expected_flags = HEADER_CRC_FLAG | if body_bytes == 0 { 0 } else { BODY_CRC_FLAG };
    if flags != expected_flags {
        return Err(PickerError::InvalidFlags);
    }
    if body_bytes == 0 && u32_at(h, 24) != 0 {
        return Err(PickerError::InvalidHeader);
    }
    let expected = u32_at(h, 28);
    let mut header_for_crc = [0_u8; HEADER_BYTES];
    header_for_crc.copy_from_slice(h);
    header_for_crc[28..].fill(0);
    if crc32c(&header_for_crc) != expected {
        return Err(PickerError::InvalidCrc);
    }
    Ok(PickerHeader {
        status,
        flags,
        body_bytes,
        body_crc32c: u32_at(h, 24),
        header_crc32c: expected,
    })
}

#[cfg(test)]
pub fn decode(frame: &[u8]) -> Result<PickerFrame, PickerError> {
    let header = decode_header(frame)?;
    let expected_len = checked_frame_len(header.body_bytes)?;
    if frame.len() < expected_len {
        return Err(PickerError::Truncated);
    }
    if frame.len() > expected_len {
        return Err(PickerError::TrailingBytes);
    }
    let body = frame[HEADER_BYTES..].to_vec();
    validate_body(header.status, &body)?;
    if !body.is_empty() && crc32c(&body) != header.body_crc32c {
        return Err(PickerError::InvalidCrc);
    }
    Ok(PickerFrame { header, body })
}

pub struct ResultPipeWriter {
    inner: platform::PipeWriter,
}

impl ResultPipeWriter {
    pub fn adopt(raw: u64) -> Result<Self, PickerError> {
        Ok(Self {
            inner: platform::PipeWriter::adopt(raw)?,
        })
    }

    pub fn write_frame(&mut self, frame: &[u8]) -> Result<(), PickerError> {
        self.inner.write_all(frame).map_err(|_| PickerError::Io)?;
        self.inner.flush().map_err(|_| PickerError::Io)
    }
}

fn validate_body(status: PickerStatus, body: &[u8]) -> Result<(), PickerError> {
    if body.len() > MAX_BODY_BYTES {
        return Err(PickerError::LimitExceeded);
    }
    if body.contains(&0) {
        return Err(PickerError::NulByte);
    }
    match status {
        PickerStatus::Cancel => {
            if !body.is_empty() {
                return Err(PickerError::InvalidBody);
            }
        }
        PickerStatus::Selected | PickerStatus::Error => {
            if body.is_empty() {
                return Err(PickerError::InvalidBody);
            }
            std::str::from_utf8(body).map_err(|_| PickerError::InvalidUtf8)?;
        }
    }
    Ok(())
}

#[cfg(test)]
fn u16_at(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

#[cfg(test)]
fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("fixed offset"))
}

fn put_u16(bytes: &mut [u8], offset: usize, value: u16) {
    bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn put_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

#[cfg(unix)]
mod platform {
    use super::*;
    use std::fs::File;
    use std::os::fd::{FromRawFd, RawFd};

    pub struct PipeWriter(File);

    impl PipeWriter {
        pub fn adopt(raw: u64) -> Result<Self, PickerError> {
            let fd = i32::try_from(raw).map_err(|_| {
                PickerError::InvalidHandle("result pipe is not a POSIX file descriptor")
            })?;
            if fd < 0 {
                return Err(PickerError::InvalidHandle("result pipe is invalid"));
            }
            // SAFETY: the launcher transfers ownership of this inherited descriptor.
            Ok(Self(unsafe { File::from_raw_fd(fd as RawFd) }))
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
    use std::fs::File;
    use std::os::windows::io::FromRawHandle;

    pub struct PipeWriter(File);

    impl PipeWriter {
        pub fn adopt(raw: u64) -> Result<Self, PickerError> {
            if raw == 0 || raw == u64::MAX {
                return Err(PickerError::InvalidHandle("result pipe handle is invalid"));
            }
            // SAFETY: the launcher transfers ownership of this inherited handle.
            Ok(Self(unsafe {
                File::from_raw_handle(raw as usize as *mut std::ffi::c_void)
            }))
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

    #[test]
    fn roundtrips_statuses() {
        for (status, body) in [
            (PickerStatus::Cancel, &[][..]),
            (PickerStatus::Selected, b"/tmp/a"[..].as_ref()),
            (PickerStatus::Error, b"oops"[..].as_ref()),
        ] {
            let frame = encode(status, body).unwrap();
            let decoded = decode(&frame).unwrap();
            assert_eq!(decoded.header.status, status);
            assert_eq!(decoded.body, body);
        }
    }

    #[test]
    fn rejects_bounds_nul_crc_and_malformed() {
        assert!(matches!(
            encode(PickerStatus::Error, &vec![b'x'; MAX_BODY_BYTES + 1]),
            Err(PickerError::LimitExceeded)
        ));
        assert!(matches!(encode_selected("a\0b"), Err(PickerError::NulByte)));
        let mut frame = encode_selected("path").unwrap();
        frame[24] ^= 1;
        assert!(matches!(
            decode(&frame),
            Err(PickerError::InvalidCrc | PickerError::InvalidHeader)
        ));
        assert!(matches!(
            decode(&[0; HEADER_BYTES - 1]),
            Err(PickerError::Truncated)
        ));
        let mut frame = encode_cancel().unwrap();
        frame[12] = 9;
        assert!(decode(&frame).is_err());
    }
}
