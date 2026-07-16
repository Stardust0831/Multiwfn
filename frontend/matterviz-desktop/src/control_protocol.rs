//! Codec for the MatterViz `MWFNCTL` v1 control stream.

use std::fmt;

use serde_json::Value;

pub const HEADER_BYTES: usize = 48;
pub const MAX_BODY_BYTES: u64 = 64 * 1024 * 1024;
pub const CONTROL_HEADER_BYTES: usize = HEADER_BYTES;
pub const CONTROL_MAX_BODY_BYTES: u64 = MAX_BODY_BYTES;
pub const PROTOCOL_MAJOR: u16 = 1;
pub const PROTOCOL_MINOR: u16 = 0;
pub const HEADER_CRC_FLAG: u16 = 0x0001;
pub const BODY_CRC_FLAG: u16 = 0x0002;

const MAGIC: &[u8; 8] = b"MWFNCTL\0";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum MessageType {
    Hello = 1,
    SessionInit = 2,
    Request = 3,
    Response = 4,
    Error = 5,
    Shutdown = 6,
}

pub type ControlMessageType = MessageType;

impl MessageType {
    pub fn from_wire(value: u16) -> Result<Self, ControlError> {
        match value {
            1 => Ok(Self::Hello),
            2 => Ok(Self::SessionInit),
            3 => Ok(Self::Request),
            4 => Ok(Self::Response),
            5 => Ok(Self::Error),
            6 => Ok(Self::Shutdown),
            _ => Err(ControlError::InvalidMessageType),
        }
    }

    pub(crate) fn kind(self) -> Option<&'static str> {
        match self {
            Self::Hello => None,
            Self::SessionInit => Some("session_init"),
            Self::Request => Some("request"),
            Self::Response => Some("response"),
            Self::Error => Some("error"),
            Self::Shutdown => Some("shutdown"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ControlHeader {
    pub message_type: MessageType,
    pub flags: u16,
    pub request_id: u64,
    pub body_bytes: u64,
    pub header_crc32c: u32,
    pub body_crc32c: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ControlFrame {
    pub header: ControlHeader,
    pub body: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlError {
    Truncated,
    TrailingBytes,
    InvalidMagic,
    UnsupportedVersion,
    InvalidMessageType,
    InvalidFlags,
    InvalidHeader,
    InvalidReserved,
    InvalidRequestId,
    Overflow,
    LimitExceeded,
    InvalidCrc,
    InvalidUtf8,
    InvalidJson,
    InvalidBody,
    InvalidEnvelope,
    InvalidKind,
    RequestIdMismatch,
}

impl fmt::Display for ControlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::Truncated => "truncated control frame",
            Self::TrailingBytes => "trailing bytes after control frame",
            Self::InvalidMagic => "invalid control magic",
            Self::UnsupportedVersion => "unsupported control version",
            Self::InvalidMessageType => "invalid control message type",
            Self::InvalidFlags => "invalid control flags",
            Self::InvalidHeader => "invalid control header",
            Self::InvalidReserved => "nonzero reserved field",
            Self::InvalidRequestId => "invalid control request ID",
            Self::Overflow => "control frame size arithmetic overflow",
            Self::LimitExceeded => "control body exceeds maximum size",
            Self::InvalidCrc => "control CRC32C mismatch",
            Self::InvalidUtf8 => "control body is not UTF-8",
            Self::InvalidJson => "control body is not valid JSON",
            Self::InvalidBody => "control body is invalid",
            Self::InvalidEnvelope => "control JSON envelope is invalid",
            Self::InvalidKind => "control JSON kind does not match message type",
            Self::RequestIdMismatch => "control JSON request ID does not match header",
        };
        f.write_str(message)
    }
}

impl std::error::Error for ControlError {}

/// Return the total frame size after checked conversion and addition.
pub fn checked_frame_len(body_bytes: u64) -> Result<usize, ControlError> {
    if body_bytes > MAX_BODY_BYTES {
        return Err(ControlError::LimitExceeded);
    }
    let body = usize::try_from(body_bytes).map_err(|_| ControlError::Overflow)?;
    HEADER_BYTES.checked_add(body).ok_or(ControlError::Overflow)
}

/// Compute CRC32C (Castagnoli) using the reflected polynomial.
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

/// Decode and validate the fixed header. Bytes after the first 48 are ignored,
/// which lets a streaming reader pass a buffer containing header plus payload.
pub fn decode_header(bytes: &[u8]) -> Result<ControlHeader, ControlError> {
    if bytes.len() < HEADER_BYTES {
        return Err(ControlError::Truncated);
    }
    let h = &bytes[..HEADER_BYTES];
    if &h[..8] != MAGIC {
        return Err(ControlError::InvalidMagic);
    }
    if u16_at(h, 8) != PROTOCOL_MAJOR || u16_at(h, 10) != PROTOCOL_MINOR {
        return Err(ControlError::UnsupportedVersion);
    }
    let message_type = MessageType::from_wire(u16_at(h, 12))?;
    let flags = u16_at(h, 14);
    if u32_at(h, 16) != HEADER_BYTES as u32 {
        return Err(ControlError::InvalidHeader);
    }
    if u32_at(h, 44) != 0 {
        return Err(ControlError::InvalidReserved);
    }
    let request_id = u64_at(h, 20);
    let body_bytes = u64_at(h, 28);
    checked_frame_len(body_bytes)?;
    let expected_flags = if body_bytes == 0 {
        HEADER_CRC_FLAG
    } else {
        HEADER_CRC_FLAG | BODY_CRC_FLAG
    };
    if flags != expected_flags {
        return Err(ControlError::InvalidFlags);
    }
    if body_bytes == 0 && u32_at(h, 40) != 0 {
        return Err(ControlError::InvalidHeader);
    }
    let requires_id = matches!(
        message_type,
        MessageType::Request | MessageType::Response | MessageType::Error
    );
    if message_type == MessageType::Hello {
        if request_id != 0 || body_bytes != 0 {
            return Err(ControlError::InvalidRequestId);
        }
    } else if matches!(
        message_type,
        MessageType::SessionInit | MessageType::Shutdown
    ) {
        if request_id != 0 || body_bytes == 0 {
            return if request_id != 0 {
                Err(ControlError::InvalidRequestId)
            } else {
                Err(ControlError::InvalidBody)
            };
        }
    } else if requires_id && request_id == 0 {
        return Err(ControlError::InvalidRequestId);
    }
    let expected = u32_at(h, 36);
    let mut copy = [0u8; HEADER_BYTES];
    copy.copy_from_slice(h);
    copy[36..40].fill(0);
    if crc32c(&copy) != expected {
        return Err(ControlError::InvalidCrc);
    }
    Ok(ControlHeader {
        message_type,
        flags,
        request_id,
        body_bytes,
        header_crc32c: expected,
        body_crc32c: u32_at(h, 40),
    })
}

pub fn decode_control_header(bytes: &[u8]) -> Result<ControlHeader, ControlError> {
    decode_header(bytes)
}

/// Decode a complete frame, validating length, CRCs and the JSON envelope.
pub fn decode_frame(frame: &[u8]) -> Result<ControlFrame, ControlError> {
    let header = decode_header(frame)?;
    let expected_len = checked_frame_len(header.body_bytes)?;
    if frame.len() < expected_len {
        return Err(ControlError::Truncated);
    }
    if frame.len() > expected_len {
        return Err(ControlError::TrailingBytes);
    }
    let body_bytes = header.body_bytes as usize;
    if body_bytes == 0 {
        return Ok(ControlFrame { header, body: None });
    }
    let body = &frame[HEADER_BYTES..];
    if crc32c(body) != header.body_crc32c {
        return Err(ControlError::InvalidCrc);
    }
    let text = std::str::from_utf8(body).map_err(|_| ControlError::InvalidUtf8)?;
    let value: Value = serde_json::from_str(text).map_err(|_| ControlError::InvalidJson)?;
    validate_envelope(&value, header.message_type, header.request_id)?;
    Ok(ControlFrame {
        header,
        body: Some(value),
    })
}

pub fn decode_control_frame(frame: &[u8]) -> Result<ControlFrame, ControlError> {
    decode_frame(frame)
}

/// Encode a frame from a JSON value. Hello is header-only and must pass `None`.
pub fn encode_frame(
    message_type: MessageType,
    request_id: u64,
    body: Option<&Value>,
) -> Result<Vec<u8>, ControlError> {
    let body_bytes = match body {
        Some(value) => {
            validate_envelope(value, message_type, request_id)?;
            let bytes = serde_json::to_vec(value).map_err(|_| ControlError::InvalidJson)?;
            if bytes.is_empty() {
                return Err(ControlError::InvalidBody);
            }
            if (bytes.len() as u64) > MAX_BODY_BYTES {
                return Err(ControlError::LimitExceeded);
            }
            bytes
        }
        None => {
            if message_type != MessageType::Hello || request_id != 0 {
                return Err(ControlError::InvalidBody);
            }
            Vec::new()
        }
    };
    encode_body_bytes(message_type, request_id, &body_bytes)
}

pub fn encode_control_frame(
    message_type: MessageType,
    request_id: u64,
    body: Option<&Value>,
) -> Result<Vec<u8>, ControlError> {
    encode_frame(message_type, request_id, body)
}

fn encode_body_bytes(
    message_type: MessageType,
    request_id: u64,
    body_bytes: &[u8],
) -> Result<Vec<u8>, ControlError> {
    let total = checked_frame_len(body_bytes.len() as u64)?;
    let mut frame = vec![0u8; total];
    frame[..8].copy_from_slice(MAGIC);
    put_u16(&mut frame, 8, PROTOCOL_MAJOR);
    put_u16(&mut frame, 10, PROTOCOL_MINOR);
    put_u16(&mut frame, 12, message_type as u16);
    put_u16(
        &mut frame,
        14,
        if body_bytes.is_empty() {
            HEADER_CRC_FLAG
        } else {
            HEADER_CRC_FLAG | BODY_CRC_FLAG
        },
    );
    put_u32(&mut frame, 16, HEADER_BYTES as u32);
    put_u64(&mut frame, 20, request_id);
    put_u64(&mut frame, 28, body_bytes.len() as u64);
    if !body_bytes.is_empty() {
        frame[HEADER_BYTES..].copy_from_slice(body_bytes);
        put_u32(&mut frame, 40, crc32c(body_bytes));
    }
    let crc = crc32c(&frame[..HEADER_BYTES]);
    put_u32(&mut frame, 36, crc);
    decode_header(&frame[..HEADER_BYTES])?;
    Ok(frame)
}

/// Encode a frame from already serialized JSON, validating UTF-8 and envelope.
pub fn encode_json(
    message_type: MessageType,
    request_id: u64,
    body: Option<&[u8]>,
) -> Result<Vec<u8>, ControlError> {
    match body {
        None => encode_frame(message_type, request_id, None),
        Some(bytes) => {
            if bytes.is_empty() {
                return Err(ControlError::InvalidBody);
            }
            if bytes.len() as u64 > MAX_BODY_BYTES {
                return Err(ControlError::LimitExceeded);
            }
            let text = std::str::from_utf8(bytes).map_err(|_| ControlError::InvalidUtf8)?;
            let value: Value = serde_json::from_str(text).map_err(|_| ControlError::InvalidJson)?;
            validate_envelope(&value, message_type, request_id)?;
            encode_body_bytes(message_type, request_id, bytes)
        }
    }
}

fn validate_envelope(
    value: &Value,
    message_type: MessageType,
    request_id: u64,
) -> Result<(), ControlError> {
    let object = value.as_object().ok_or(ControlError::InvalidEnvelope)?;
    if object.get("format").and_then(Value::as_str) != Some("multiwfn-matterviz-control")
        || object.get("version").and_then(Value::as_u64) != Some(1)
    {
        return Err(ControlError::InvalidEnvelope);
    }
    if object.get("kind").and_then(Value::as_str) != message_type.kind() {
        return Err(ControlError::InvalidKind);
    }
    if matches!(
        message_type,
        MessageType::Request | MessageType::Response | MessageType::Error
    ) {
        if object.get("request_id").and_then(Value::as_u64) != Some(request_id) {
            return Err(ControlError::RequestIdMismatch);
        }
    } else if object
        .get("request_id")
        .is_some_and(|id| id.as_u64() != Some(0))
    {
        return Err(ControlError::RequestIdMismatch);
    }
    Ok(())
}

fn u16_at(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("fixed offset"))
}

fn u64_at(bytes: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(bytes[offset..offset + 8].try_into().expect("fixed offset"))
}

fn put_u16(bytes: &mut [u8], offset: usize, value: u16) {
    bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn put_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn put_u64(bytes: &mut [u8], offset: usize, value: u64) {
    bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn body(kind: &str, id: Option<u64>) -> Value {
        let mut value = json!({"format":"multiwfn-matterviz-control","version":1,"kind":kind});
        if let Some(id) = id {
            value
                .as_object_mut()
                .unwrap()
                .insert("request_id".into(), json!(id));
        }
        value
    }

    #[test]
    fn round_trip_all_types() {
        let cases = [
            (MessageType::Hello, 0, None),
            (
                MessageType::SessionInit,
                0,
                Some(body("session_init", None)),
            ),
            (MessageType::Request, 7, Some(body("request", Some(7)))),
            (MessageType::Response, 7, Some(body("response", Some(7)))),
            (MessageType::Error, 7, Some(body("error", Some(7)))),
            (MessageType::Shutdown, 0, Some(body("shutdown", None))),
        ];
        for (kind, id, value) in cases {
            let frame = encode_frame(kind, id, value.as_ref()).unwrap();
            let decoded = decode_frame(&frame).unwrap();
            assert_eq!(decoded.header.message_type, kind);
            assert_eq!(decoded.header.request_id, id);
        }
    }

    #[test]
    fn fragmented_header() {
        let frame = encode_frame(MessageType::Hello, 0, None).unwrap();
        for n in 0..HEADER_BYTES {
            assert_eq!(decode_header(&frame[..n]), Err(ControlError::Truncated));
        }
        assert!(decode_header(&frame).is_ok());
    }

    #[test]
    fn checked_boundary() {
        assert_eq!(
            checked_frame_len(MAX_BODY_BYTES),
            Ok(HEADER_BYTES + MAX_BODY_BYTES as usize)
        );
        assert_eq!(
            checked_frame_len(MAX_BODY_BYTES + 1),
            Err(ControlError::LimitExceeded)
        );
    }

    #[test]
    fn rejects_crc_and_shape_errors() {
        let value = body("request", Some(1));
        let mut frame = encode_frame(MessageType::Request, 1, Some(&value)).unwrap();
        frame[48] ^= 1;
        assert_eq!(decode_frame(&frame), Err(ControlError::InvalidCrc));
        let mut frame = encode_frame(MessageType::Request, 1, Some(&value)).unwrap();
        frame[36..40].fill(0);
        assert_eq!(decode_frame(&frame), Err(ControlError::InvalidCrc));
    }

    #[test]
    fn rejects_json_encoding_and_identity_errors() {
        let value = body("request", Some(2));
        assert_eq!(
            encode_frame(MessageType::Request, 1, Some(&value)),
            Err(ControlError::RequestIdMismatch)
        );
        assert_eq!(
            encode_json(MessageType::Request, 1, Some(b"[]")),
            Err(ControlError::InvalidEnvelope)
        );
        assert_eq!(
            encode_json(MessageType::Request, 1, Some(&[0xff])),
            Err(ControlError::InvalidUtf8)
        );
        let missing_id = body("request", None);
        assert_eq!(
            encode_frame(MessageType::Request, 1, Some(&missing_id)),
            Err(ControlError::RequestIdMismatch)
        );
    }

    #[test]
    fn rejects_truncation_and_trailing_bytes() {
        let value = body("request", Some(1));
        let frame = encode_frame(MessageType::Request, 1, Some(&value)).unwrap();
        assert_eq!(
            decode_frame(&frame[..frame.len() - 1]),
            Err(ControlError::Truncated)
        );
        let mut trailing = frame.clone();
        trailing.push(0);
        assert_eq!(decode_frame(&trailing), Err(ControlError::TrailingBytes));
    }

    #[test]
    fn crc32c_known_vector() {
        assert_eq!(crc32c(b"123456789"), 0xe306_9283);
    }
}
