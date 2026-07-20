//! Versioned binary transport for immutable two-dimensional plot datasets.
//!
//! A frame is deliberately self describing and uses offsets rather than Rust
//! layout.  The decoder validates the entire frame before exposing any values.

use std::fmt;

pub const MAGIC: &[u8; 8] = b"MWFNP2D\0";
pub const VERSION: u16 = 1;
pub const HEADER_BYTES: usize = 80;
pub const ACK_BYTES: usize = 64;
pub const DIRECTORY_ENTRY_BYTES: usize = 32;
pub const MAX_ARRAYS: usize = 8;

const MESSAGE_DATASET: u16 = 1;
const FLAGS: u16 = 1;
const MESSAGE_ACK: u16 = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlotRole {
    X = 1,
    Y = 2,
    Z = 3,
    U = 4,
    V = 5,
    Lower = 6,
    Upper = 7,
    Baseline = 8,
}

impl PlotRole {
    pub fn from_wire(value: u8) -> Result<Self, PlotError> {
        match value {
            1 => Ok(Self::X),
            2 => Ok(Self::Y),
            3 => Ok(Self::Z),
            4 => Ok(Self::U),
            5 => Ok(Self::V),
            6 => Ok(Self::Lower),
            7 => Ok(Self::Upper),
            8 => Ok(Self::Baseline),
            _ => Err(PlotError::InvalidRole),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlotArrayView {
    pub role: PlotRole,
    pub count: u64,
    pub body_offset: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlotDataView {
    pub dataset_id: u64,
    pub arrays: Vec<PlotArrayView>,
}

#[cfg(test)]
#[derive(Debug, Clone)]
pub struct PlotArray {
    pub role: PlotRole,
    pub values: Vec<f64>,
    pub body_offset: u64,
}

#[cfg(test)]
#[derive(Debug, Clone)]
pub struct PlotData {
    pub dataset_id: u64,
    pub arrays: Vec<PlotArray>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlotError {
    Truncated,
    TrailingBytes,
    InvalidMagic,
    UnsupportedVersion,
    InvalidMessageType,
    InvalidFlags,
    InvalidHeader,
    InvalidDirectory,
    InvalidRole,
    DuplicateRole,
    InvalidId,
    InvalidCount,
    InvalidOffset,
    Overflow,
    LimitExceeded,
    InvalidCrc,
    NonFinite,
}

impl fmt::Display for PlotError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::Truncated => "truncated plot data frame",
            Self::TrailingBytes => "trailing bytes after plot data frame",
            Self::InvalidMagic => "invalid plot data magic",
            Self::UnsupportedVersion => "unsupported plot data version",
            Self::InvalidMessageType => "invalid plot data message type",
            Self::InvalidFlags => "invalid plot data flags",
            Self::InvalidHeader => "invalid plot data header",
            Self::InvalidDirectory => "invalid plot data directory",
            Self::InvalidRole => "invalid plot data array role",
            Self::DuplicateRole => "duplicate plot data array role",
            Self::InvalidId => "plot dataset ID must be nonzero",
            Self::InvalidCount => "invalid plot data array count",
            Self::InvalidOffset => "invalid plot data array offset",
            Self::Overflow => "plot data size arithmetic overflow",
            Self::LimitExceeded => "plot data frame exceeds limits",
            Self::InvalidCrc => "plot data CRC32C mismatch",
            Self::NonFinite => "plot data contains a nonfinite value",
        };
        f.write_str(message)
    }
}

impl std::error::Error for PlotError {}

pub fn declared_frame_len(prelude: &[u8]) -> Result<usize, PlotError> {
    if prelude.len() < HEADER_BYTES {
        return Err(PlotError::Truncated);
    }
    validate_header_prelude(prelude)?;
    let total = get_u64(prelude, 72)?;
    checked_frame_len(total)
}

pub fn encode_ack(
    request_id: u64,
    dataset_id: u64,
    status: u32,
) -> Result<[u8; ACK_BYTES], PlotError> {
    if request_id == 0 || dataset_id == 0 {
        return Err(PlotError::InvalidId);
    }
    let mut frame = [0_u8; ACK_BYTES];
    frame[..8].copy_from_slice(MAGIC);
    put_u16(&mut frame, 8, VERSION);
    put_u16(&mut frame, 12, MESSAGE_ACK);
    put_u16(&mut frame, 14, FLAGS);
    put_u32(&mut frame, 16, ACK_BYTES as u32);
    put_u64(&mut frame, 20, request_id);
    put_u64(&mut frame, 48, dataset_id);
    put_u32(&mut frame, 56, status);
    put_u32(&mut frame, 36, 0);
    let crc = crc32c(&frame);
    put_u32(&mut frame, 36, crc);
    Ok(frame)
}

pub fn validate(frame: &[u8]) -> Result<PlotDataView, PlotError> {
    if frame.len() < HEADER_BYTES {
        return Err(PlotError::Truncated);
    }
    validate_header_prelude(frame)?;
    let total = get_u64(frame, 72)?;
    let total = checked_frame_len(total)?;
    if frame.len() < total {
        return Err(PlotError::Truncated);
    }
    if frame.len() != total {
        return Err(PlotError::TrailingBytes);
    }
    let dataset_id = get_u64(frame, 20)?;
    let array_count = usize::try_from(get_u32(frame, 28)?).map_err(|_| PlotError::Overflow)?;
    let directory_bytes = usize::try_from(get_u64(frame, 36)?).map_err(|_| PlotError::Overflow)?;
    let body_bytes = usize::try_from(get_u64(frame, 44)?).map_err(|_| PlotError::Overflow)?;
    let total_elements = get_u64(frame, 52)?;
    if array_count == 0 || array_count > MAX_ARRAYS {
        return Err(PlotError::InvalidCount);
    }
    if directory_bytes != array_count * DIRECTORY_ENTRY_BYTES
        || HEADER_BYTES
            .checked_add(directory_bytes)
            .ok_or(PlotError::Overflow)?
            > total
    {
        return Err(PlotError::InvalidDirectory);
    }
    let body_start = HEADER_BYTES + directory_bytes;
    if !body_start.is_multiple_of(8)
        || body_start
            .checked_add(body_bytes)
            .ok_or(PlotError::Overflow)?
            != total
    {
        return Err(PlotError::InvalidHeader);
    }
    let expected_elements = body_bytes as u64 / 8;
    if body_bytes % 8 != 0 || expected_elements != total_elements || total_elements == 0 {
        return Err(PlotError::InvalidCount);
    }
    if crc32c(&frame[body_start..]) != get_u32(frame, 64)? {
        return Err(PlotError::InvalidCrc);
    }
    let mut arrays = Vec::with_capacity(array_count);
    let mut roles = 0_u16;
    let mut expected_offset = 0_u64;
    for index in 0..array_count {
        let offset = HEADER_BYTES + index * DIRECTORY_ENTRY_BYTES;
        if frame[offset + 1..offset + 8].iter().any(|byte| *byte != 0)
            || get_u64(frame, offset + 8)? == 0
            || get_u64(frame, offset + 24)? == 0
        {
            return Err(PlotError::InvalidDirectory);
        }
        let role = PlotRole::from_wire(frame[offset])?;
        let bit = 1_u16 << (role as u8 - 1);
        if roles & bit != 0 {
            return Err(PlotError::DuplicateRole);
        }
        roles |= bit;
        let count = get_u64(frame, offset + 8)?;
        let body_offset = get_u64(frame, offset + 16)?;
        let array_bytes = get_u64(frame, offset + 24)?;
        if count.checked_mul(8) != Some(array_bytes)
            || body_offset != expected_offset
            || body_offset % 8 != 0
            || body_offset
                .checked_add(array_bytes)
                .is_none_or(|end| end > body_bytes as u64)
        {
            return Err(PlotError::InvalidOffset);
        }
        let start = body_start + usize::try_from(body_offset).map_err(|_| PlotError::Overflow)?;
        let end = start + usize::try_from(array_bytes).map_err(|_| PlotError::Overflow)?;
        for chunk in frame[start..end].chunks_exact(8) {
            let value = f64::from_le_bytes(chunk.try_into().expect("chunks_exact(8)"));
            if !value.is_finite() {
                return Err(PlotError::NonFinite);
            }
        }
        expected_offset = expected_offset
            .checked_add(array_bytes)
            .ok_or(PlotError::Overflow)?;
        arrays.push(PlotArrayView {
            role,
            count,
            body_offset,
        });
    }
    if expected_offset != body_bytes as u64 {
        return Err(PlotError::InvalidOffset);
    }
    Ok(PlotDataView { dataset_id, arrays })
}

#[cfg(test)]
pub fn decode_header(frame: &[u8]) -> Result<(u64, u64), PlotError> {
    if frame.len() < HEADER_BYTES {
        return Err(PlotError::Truncated);
    }
    validate_header_prelude(frame)?;
    Ok((get_u64(frame, 20)?, get_u64(frame, 72)?))
}

#[cfg(test)]
pub fn encode(data: &PlotData) -> Result<Vec<u8>, PlotError> {
    if data.dataset_id == 0 || data.arrays.is_empty() || data.arrays.len() > MAX_ARRAYS {
        return Err(if data.dataset_id == 0 {
            PlotError::InvalidId
        } else {
            PlotError::InvalidCount
        });
    }
    let mut roles = 0_u16;
    let mut body_bytes = 0_u64;
    let mut total_elements = 0_u64;
    for array in &data.arrays {
        let bit = 1_u16 << (array.role as u8 - 1);
        if roles & bit != 0 {
            return Err(PlotError::DuplicateRole);
        }
        roles |= bit;
        let count = u64::try_from(array.values.len()).map_err(|_| PlotError::Overflow)?;
        if count == 0 {
            return Err(PlotError::InvalidCount);
        }
        body_bytes = body_bytes
            .checked_add(count.checked_mul(8).ok_or(PlotError::Overflow)?)
            .ok_or(PlotError::Overflow)?;
        total_elements = total_elements
            .checked_add(count)
            .ok_or(PlotError::Overflow)?;
    }
    let directory_bytes = u64::try_from(data.arrays.len() * DIRECTORY_ENTRY_BYTES)
        .map_err(|_| PlotError::Overflow)?;
    let total = (HEADER_BYTES as u64)
        .checked_add(directory_bytes)
        .and_then(|value| value.checked_add(body_bytes))
        .ok_or(PlotError::Overflow)?;
    let mut frame = vec![0_u8; usize::try_from(total).map_err(|_| PlotError::Overflow)?];
    frame[..8].copy_from_slice(MAGIC);
    put_u16(&mut frame, 8, VERSION);
    put_u16(&mut frame, 12, MESSAGE_DATASET);
    put_u16(&mut frame, 14, FLAGS);
    put_u32(&mut frame, 16, HEADER_BYTES as u32);
    put_u64(&mut frame, 20, data.dataset_id);
    put_u32(&mut frame, 28, data.arrays.len() as u32);
    put_u32(&mut frame, 32, DIRECTORY_ENTRY_BYTES as u32);
    put_u64(&mut frame, 36, directory_bytes);
    put_u64(&mut frame, 44, body_bytes);
    put_u64(&mut frame, 52, total_elements);
    put_u64(&mut frame, 72, total);
    let body_start = HEADER_BYTES + directory_bytes as usize;
    let mut body_offset = 0_u64;
    for (index, array) in data.arrays.iter().enumerate() {
        let offset = HEADER_BYTES + index * DIRECTORY_ENTRY_BYTES;
        frame[offset] = array.role as u8;
        let count = array.values.len() as u64;
        put_u64(&mut frame, offset + 8, count);
        put_u64(&mut frame, offset + 16, body_offset);
        put_u64(&mut frame, offset + 24, count * 8);
        let start = body_start + body_offset as usize;
        for (sample, bytes) in array.values.iter().zip(frame[start..].chunks_exact_mut(8)) {
            bytes.copy_from_slice(&sample.to_le_bytes());
        }
        body_offset += count * 8;
    }
    let body_crc = crc32c(&frame[body_start..]);
    put_u32(&mut frame, 64, body_crc);
    put_u32(&mut frame, 60, 0);
    let header_crc = crc32c(&frame[..HEADER_BYTES]);
    put_u32(&mut frame, 60, header_crc);
    Ok(frame)
}

fn validate_header_prelude(frame: &[u8]) -> Result<(), PlotError> {
    if &frame[..8] != MAGIC {
        return Err(PlotError::InvalidMagic);
    }
    if get_u16(frame, 8)? != VERSION || get_u16(frame, 10)? != 0 {
        return Err(PlotError::UnsupportedVersion);
    }
    if get_u16(frame, 12)? != MESSAGE_DATASET {
        return Err(PlotError::InvalidMessageType);
    }
    if get_u16(frame, 14)? != FLAGS
        || get_u32(frame, 16)? as usize != HEADER_BYTES
        || get_u32(frame, 68)? != 0
    {
        return Err(PlotError::InvalidFlags);
    }
    let expected = get_u32(frame, 60)?;
    let mut header = frame[..HEADER_BYTES].to_vec();
    header[60..64].fill(0);
    if crc32c(&header) != expected {
        return Err(PlotError::InvalidCrc);
    }
    if get_u64(frame, 20)? == 0 {
        return Err(PlotError::InvalidId);
    }
    Ok(())
}

fn checked_frame_len(value: u64) -> Result<usize, PlotError> {
    if value < HEADER_BYTES as u64 {
        return Err(PlotError::LimitExceeded);
    }
    usize::try_from(value).map_err(|_| PlotError::Overflow)
}

fn crc32c(bytes: &[u8]) -> u32 {
    let mut crc = !0_u32;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            let mask = 0_u32.wrapping_sub(crc & 1);
            crc = (crc >> 1) ^ (0x82f6_3b78 & mask);
        }
    }
    !crc
}

fn get_u16(bytes: &[u8], offset: usize) -> Result<u16, PlotError> {
    bytes
        .get(offset..offset + 2)
        .ok_or(PlotError::Truncated)
        .map(|value| u16::from_le_bytes(value.try_into().unwrap()))
}
fn get_u32(bytes: &[u8], offset: usize) -> Result<u32, PlotError> {
    bytes
        .get(offset..offset + 4)
        .ok_or(PlotError::Truncated)
        .map(|value| u32::from_le_bytes(value.try_into().unwrap()))
}
fn get_u64(bytes: &[u8], offset: usize) -> Result<u64, PlotError> {
    bytes
        .get(offset..offset + 8)
        .ok_or(PlotError::Truncated)
        .map(|value| u64::from_le_bytes(value.try_into().unwrap()))
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

    fn fixture() -> PlotData {
        PlotData {
            dataset_id: 42,
            arrays: vec![
                PlotArray {
                    role: PlotRole::X,
                    values: vec![-1.0, 0.0, 2.5],
                    body_offset: 0,
                },
                PlotArray {
                    role: PlotRole::Y,
                    values: vec![3.0, 4.0, 5.0],
                    body_offset: 24,
                },
            ],
        }
    }

    #[test]
    fn golden_roundtrip() {
        let frame = encode(&fixture()).unwrap();
        assert_eq!(&frame[..8], b"MWFNP2D\0");
        assert_eq!(&frame[8..16], &[1, 0, 0, 0, 1, 0, 1, 0]);
        assert_eq!(frame.len(), 80 + 64 + 48);
        assert_eq!(
            validate(&frame).unwrap(),
            PlotDataView {
                dataset_id: 42,
                arrays: vec![
                    PlotArrayView {
                        role: PlotRole::X,
                        count: 3,
                        body_offset: 0
                    },
                    PlotArrayView {
                        role: PlotRole::Y,
                        count: 3,
                        body_offset: 24
                    },
                ],
            }
        );
    }

    #[test]
    fn ack_uses_the_shared_control_header_crc_layout() {
        let ack = encode_ack(42, 42, 0).unwrap();
        assert_eq!(&ack[..8], MAGIC);
        assert_eq!(get_u32(&ack, 60), Ok(0));
        let expected_crc = get_u32(&ack, 36).unwrap();
        let mut header = ack;
        header[36..40].fill(0);
        assert_eq!(crc32c(&header), expected_crc);
    }

    #[test]
    fn rejects_crc_offsets_and_nonfinite_values() {
        let frame = encode(&fixture()).unwrap();
        let mut bad = frame.clone();
        let last = bad.len() - 1;
        bad[last] ^= 1;
        assert_eq!(validate(&bad), Err(PlotError::InvalidCrc));
        let mut bad = frame.clone();
        bad[80 + 16..80 + 24].copy_from_slice(&8_u64.to_le_bytes());
        let mut header = bad[..HEADER_BYTES].to_vec();
        header[60..64].fill(0);
        bad[60..64].copy_from_slice(&crc32c(&header).to_le_bytes());
        assert!(matches!(validate(&bad), Err(PlotError::InvalidOffset)));
        let mut bad = frame.clone();
        bad[80 + 8..80 + 16].copy_from_slice(&4_u64.to_le_bytes());
        assert!(validate(&bad).is_err());
    }
}
