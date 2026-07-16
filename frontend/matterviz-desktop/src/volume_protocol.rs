//! MatterViz binary volume protocol codecs for buffered v1 and streamed v2.
//!
//! This module intentionally uses explicit byte reads and writes.  The wire
//! format is fixed-width little-endian, so casting Rust structs would make the
//! codec dependent on alignment and platform layout.

use std::fmt;

pub const PRELUDE_BYTES: usize = 48;
pub const VOLUME_HEADER_BYTES: usize = 304;
pub const ACK_HEADER_BYTES: usize = 64;
pub const STREAM_MAJOR: u16 = 2;
pub const MAX_SAMPLES: u64 = 1_500_000;
pub const MAX_BODY_BYTES: u64 = 12_000_000;
pub const MAX_FRAME_BYTES: u64 = 12_000_304;

const MAGIC: &[u8; 8] = b"MWFNVOL\0";
const MESSAGE_VOLUME: u16 = 4;
const MESSAGE_HELLO: u16 = 1;
const MESSAGE_ACK: u16 = 8;
const REQUIRED_FLAGS: u16 = 0x0003;
const CONTROL_FLAGS: u16 = 0x0001;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VolumeError {
    Truncated,
    TrailingBytes,
    InvalidMagic,
    UnsupportedVersion,
    InvalidMessageType,
    InvalidFlags,
    InvalidReserved,
    InvalidHeader,
    InvalidEnum,
    InvalidDimensions,
    InvalidId,
    Overflow,
    LimitExceeded,
    InvalidCrc,
    NonFinite,
    InconsistentStatistics,
    InconsistentByteCount,
}

impl fmt::Display for VolumeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::Truncated => "truncated volume frame",
            Self::TrailingBytes => "trailing bytes after volume frame",
            Self::InvalidMagic => "invalid volume magic",
            Self::UnsupportedVersion => "unsupported volume version",
            Self::InvalidMessageType => "invalid volume message type",
            Self::InvalidFlags => "invalid volume flags",
            Self::InvalidReserved => "nonzero reserved field",
            Self::InvalidHeader => "invalid volume header length",
            Self::InvalidEnum => "invalid volume enum",
            Self::InvalidDimensions => "invalid volume dimensions",
            Self::InvalidId => "volume and request IDs must be nonzero",
            Self::Overflow => "volume size arithmetic overflow",
            Self::LimitExceeded => "volume size limit exceeded",
            Self::InvalidCrc => "volume CRC32C mismatch",
            Self::NonFinite => "volume contains a nonfinite value",
            Self::InconsistentStatistics => "volume statistics do not match samples",
            Self::InconsistentByteCount => "volume byte count does not match dimensions",
        };
        f.write_str(message)
    }
}

impl std::error::Error for VolumeError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataOrder {
    IFastestFortran = 1,
    KFastestCube = 2,
}

impl DataOrder {
    fn from_wire(value: u8) -> Result<Self, VolumeError> {
        match value {
            1 => Ok(Self::IFastestFortran),
            2 => Ok(Self::KFastestCube),
            _ => Err(VolumeError::InvalidEnum),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoordinateUnit {
    Bohr = 1,
    Angstrom = 2,
}

impl CoordinateUnit {
    fn from_wire(value: u16) -> Result<Self, VolumeError> {
        match value {
            1 => Ok(Self::Bohr),
            2 => Ok(Self::Angstrom),
            _ => Err(VolumeError::InvalidEnum),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuantityKind {
    Orbital = 1,
    ElectronDensity = 2,
    ElectrostaticPotential = 3,
    GenericScalar = 4,
}

impl QuantityKind {
    fn from_wire(value: u16) -> Result<Self, VolumeError> {
        match value {
            1 => Ok(Self::Orbital),
            2 => Ok(Self::ElectronDensity),
            3 => Ok(Self::ElectrostaticPotential),
            4 => Ok(Self::GenericScalar),
            _ => Err(VolumeError::InvalidEnum),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValueUnit {
    BohrMinusThreeHalves = 1,
    ElectronPerBohr3 = 2,
    HartreePerElectron = 3,
    Dimensionless = 4,
}

impl ValueUnit {
    fn from_wire(value: u16) -> Result<Self, VolumeError> {
        match value {
            1 => Ok(Self::BohrMinusThreeHalves),
            2 => Ok(Self::ElectronPerBohr3),
            3 => Ok(Self::HartreePerElectron),
            4 => Ok(Self::Dimensionless),
            _ => Err(VolumeError::InvalidEnum),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Statistics {
    pub min: f64,
    pub max: f64,
    pub mean: f64,
    pub abs_max: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Volume {
    pub request_id: u64,
    pub volume_id: u64,
    pub dimensions: [u32; 3],
    pub data_order: DataOrder,
    pub periodic_axes: [bool; 3],
    pub coordinate_unit: CoordinateUnit,
    pub quantity_kind: QuantityKind,
    pub value_unit: ValueUnit,
    pub origin: [f64; 3],
    pub voxel_axes: [[f64; 3]; 3],
    pub lattice: [[f64; 3]; 3],
    pub statistics: Statistics,
    /// Samples in the declared wire order.  Use [`Volume::sample_at`] to
    /// access a value by logical `(i, j, k)` coordinates.
    pub samples: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StreamVolumeHeader {
    pub request_id: u64,
    pub volume_id: u64,
    pub body_bytes: u64,
    pub body_crc32c: u32,
    pub dimensions: [u32; 3],
    pub data_order: DataOrder,
    pub periodic_axes: [bool; 3],
    pub coordinate_unit: CoordinateUnit,
    pub quantity_kind: QuantityKind,
    pub value_unit: ValueUnit,
    pub origin: [f64; 3],
    pub voxel_axes: [[f64; 3]; 3],
    pub lattice: [[f64; 3]; 3],
    pub statistics: Statistics,
}

pub fn protocol_major(prelude: &[u8]) -> Result<u16, VolumeError> {
    if prelude.len() < PRELUDE_BYTES {
        return Err(VolumeError::Truncated);
    }
    if &prelude[..8] != MAGIC {
        return Err(VolumeError::InvalidMagic);
    }
    get_u16(prelude, 8)
}

pub fn decode_stream_volume_header(frame: &[u8]) -> Result<StreamVolumeHeader, VolumeError> {
    if frame.len() != VOLUME_HEADER_BYTES {
        return Err(VolumeError::InvalidHeader);
    }
    if protocol_major(frame)? != STREAM_MAJOR || get_u16(frame, 10)? != 0 {
        return Err(VolumeError::UnsupportedVersion);
    }
    if get_u16(frame, 12)? != MESSAGE_VOLUME || get_u16(frame, 14)? != REQUIRED_FLAGS {
        return Err(VolumeError::InvalidMessageType);
    }
    if get_u32(frame, 16)? as usize != VOLUME_HEADER_BYTES || get_u32(frame, 44)? != 0 {
        return Err(VolumeError::InvalidHeader);
    }
    let mut header = frame.to_vec();
    let expected_header_crc = get_u32(frame, 36)?;
    header[36..40].fill(0);
    if crc32c(&header) != expected_header_crc {
        return Err(VolumeError::InvalidCrc);
    }
    let request_id = get_u64(frame, 20)?;
    let body_bytes = get_u64(frame, 28)?;
    let volume_id = get_u64(frame, 48)?;
    if request_id == 0 || volume_id == 0 {
        return Err(VolumeError::InvalidId);
    }
    let dimensions = [
        get_u32(frame, 56)?,
        get_u32(frame, 60)?,
        get_u32(frame, 64)?,
    ];
    let sample_count = dimensions.iter().try_fold(1_u64, |count, &dimension| {
        if dimension == 0 {
            return Err(VolumeError::InvalidDimensions);
        }
        count
            .checked_mul(u64::from(dimension))
            .ok_or(VolumeError::Overflow)
    })?;
    if body_bytes != sample_count.checked_mul(8).ok_or(VolumeError::Overflow)?
        || get_u64(frame, 248)? != sample_count
        || get_u64(frame, 256)? != body_bytes
    {
        return Err(VolumeError::InconsistentByteCount);
    }
    if get_u8(frame, 68)? != 1
        || get_u8(frame, 69)? != 1
        || get_u16(frame, 78)? != 0
        || get_u64(frame, 296)? != 0
    {
        return Err(VolumeError::InvalidEnum);
    }
    let data_order = DataOrder::from_wire(get_u8(frame, 70)?)?;
    let periodic = get_u8(frame, 71)?;
    if periodic & !0x07 != 0 {
        return Err(VolumeError::InvalidEnum);
    }
    let coordinate_unit = CoordinateUnit::from_wire(get_u16(frame, 72)?)?;
    let quantity_kind = QuantityKind::from_wire(get_u16(frame, 74)?)?;
    let value_unit = ValueUnit::from_wire(get_u16(frame, 76)?)?;
    if !units_match(quantity_kind, value_unit) {
        return Err(VolumeError::InvalidEnum);
    }
    let statistics = Statistics {
        min: get_f64(frame, 264)?,
        max: get_f64(frame, 272)?,
        mean: get_f64(frame, 280)?,
        abs_max: get_f64(frame, 288)?,
    };
    validate_finite(
        read_vec3(frame, 80)?,
        read_mat3(frame, 104)?,
        read_mat3(frame, 176)?,
        statistics,
    )?;
    Ok(StreamVolumeHeader {
        request_id,
        volume_id,
        body_bytes,
        body_crc32c: get_u32(frame, 40)?,
        dimensions,
        data_order,
        periodic_axes: [periodic & 1 != 0, periodic & 2 != 0, periodic & 4 != 0],
        coordinate_unit,
        quantity_kind,
        value_unit,
        origin: read_vec3(frame, 80)?,
        voxel_axes: read_mat3(frame, 104)?,
        lattice: read_mat3(frame, 176)?,
        statistics,
    })
}

pub struct Crc32c(u32);

impl Default for Crc32c {
    fn default() -> Self {
        Self::new()
    }
}

impl Crc32c {
    pub fn new() -> Self {
        Self(!0_u32)
    }

    pub fn update(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            self.0 ^= u32::from(byte);
            for _ in 0..8 {
                let mask = 0_u32.wrapping_sub(self.0 & 1);
                self.0 = (self.0 >> 1) ^ (0x82f6_3b78 & mask);
            }
        }
    }

    pub fn finish(self) -> u32 {
        !self.0
    }
}

pub fn declared_volume_frame_len(prelude: &[u8]) -> Result<usize, VolumeError> {
    if prelude.len() < PRELUDE_BYTES {
        return Err(VolumeError::Truncated);
    }
    if &prelude[..8] != MAGIC {
        return Err(VolumeError::InvalidMagic);
    }
    if get_u16(prelude, 8)? != 1 || get_u16(prelude, 10)? != 0 {
        return Err(VolumeError::UnsupportedVersion);
    }
    if get_u16(prelude, 12)? != MESSAGE_VOLUME {
        return Err(VolumeError::InvalidMessageType);
    }
    if get_u16(prelude, 14)? != REQUIRED_FLAGS {
        return Err(VolumeError::InvalidFlags);
    }
    let header_bytes = u64::from(get_u32(prelude, 16)?);
    if header_bytes != VOLUME_HEADER_BYTES as u64 {
        return Err(VolumeError::InvalidHeader);
    }
    if get_u64(prelude, 20)? == 0 {
        return Err(VolumeError::InvalidId);
    }
    let body_bytes = get_u64(prelude, 28)?;
    if body_bytes > MAX_BODY_BYTES || get_u32(prelude, 44)? != 0 {
        return Err(if body_bytes > MAX_BODY_BYTES {
            VolumeError::LimitExceeded
        } else {
            VolumeError::InvalidReserved
        });
    }
    let frame_bytes = header_bytes
        .checked_add(body_bytes)
        .ok_or(VolumeError::Overflow)?;
    if frame_bytes > MAX_FRAME_BYTES {
        return Err(VolumeError::LimitExceeded);
    }
    usize::try_from(frame_bytes).map_err(|_| VolumeError::Overflow)
}

pub fn encode_ready() -> [u8; PRELUDE_BYTES] {
    let mut frame = [0_u8; PRELUDE_BYTES];
    write_control_header(&mut frame, MESSAGE_HELLO, 0);
    frame
}

pub fn decode_ready(frame: &[u8]) -> Result<(), VolumeError> {
    validate_control_header(frame, PRELUDE_BYTES, MESSAGE_HELLO, false)?;
    Ok(())
}

pub fn encode_ack(
    request_id: u64,
    volume_id: u64,
    status: u32,
) -> Result<[u8; ACK_HEADER_BYTES], VolumeError> {
    encode_ack_for_major(1, request_id, volume_id, status)
}

pub fn encode_stream_ack(
    request_id: u64,
    volume_id: u64,
    status: u32,
) -> Result<[u8; ACK_HEADER_BYTES], VolumeError> {
    encode_ack_for_major(STREAM_MAJOR, request_id, volume_id, status)
}

fn encode_ack_for_major(
    major: u16,
    request_id: u64,
    volume_id: u64,
    status: u32,
) -> Result<[u8; ACK_HEADER_BYTES], VolumeError> {
    if request_id == 0 || volume_id == 0 {
        return Err(VolumeError::InvalidId);
    }
    let mut frame = [0_u8; ACK_HEADER_BYTES];
    write_control_header_major(&mut frame, major, MESSAGE_ACK, request_id);
    put_u64(&mut frame, 48, volume_id);
    put_u32(&mut frame, 56, status);
    refresh_control_crc(&mut frame);
    Ok(frame)
}

pub fn decode_ack(frame: &[u8]) -> Result<(u64, u64, u32), VolumeError> {
    validate_control_header(frame, ACK_HEADER_BYTES, MESSAGE_ACK, true)?;
    let request_id = get_u64(frame, 20)?;
    let volume_id = get_u64(frame, 48)?;
    if volume_id == 0 || get_u32(frame, 60)? != 0 {
        return Err(if volume_id == 0 {
            VolumeError::InvalidId
        } else {
            VolumeError::InvalidReserved
        });
    }
    Ok((request_id, volume_id, get_u32(frame, 56)?))
}

impl Volume {
    pub fn sample_at(&self, i: u32, j: u32, k: u32) -> Option<f64> {
        let [nx, ny, nz] = self.dimensions;
        if i >= nx || j >= ny || k >= nz {
            return None;
        }
        let index = match self.data_order {
            DataOrder::IFastestFortran => {
                i as usize + nx as usize * (j as usize + ny as usize * k as usize)
            }
            DataOrder::KFastestCube => {
                k as usize + nz as usize * (j as usize + ny as usize * i as usize)
            }
        };
        self.samples.get(index).copied()
    }
}

pub fn decode_volume(frame: &[u8]) -> Result<Volume, VolumeError> {
    let frame_len_usize = declared_volume_frame_len(frame)?;
    let header_bytes = get_u32(frame, 16)? as u64;
    let request_id = get_u64(frame, 20)?;
    let body_bytes = get_u64(frame, 28)?;
    let expected_header_crc = get_u32(frame, 36)?;
    let expected_body_crc = get_u32(frame, 40)?;
    if frame.len() < frame_len_usize {
        return Err(VolumeError::Truncated);
    }
    if frame.len() != frame_len_usize {
        return Err(VolumeError::TrailingBytes);
    }
    let header_len = usize::try_from(header_bytes).map_err(|_| VolumeError::Overflow)?;
    let mut header = frame[..header_len].to_vec();
    header[36..40].fill(0);
    if crc32c(&header) != expected_header_crc {
        return Err(VolumeError::InvalidCrc);
    }
    let body_start = header_len;
    let body_end = body_start
        .checked_add(usize::try_from(body_bytes).map_err(|_| VolumeError::Overflow)?)
        .ok_or(VolumeError::Overflow)?;
    let body = &frame[body_start..body_end];
    if crc32c(body) != expected_body_crc {
        return Err(VolumeError::InvalidCrc);
    }

    let volume_id = get_u64(frame, 48)?;
    if volume_id == 0 {
        return Err(VolumeError::InvalidId);
    }
    let dimensions = [
        get_u32(frame, 56)?,
        get_u32(frame, 60)?,
        get_u32(frame, 64)?,
    ];
    let sample_count = checked_count(dimensions)?;
    if sample_count > MAX_SAMPLES {
        return Err(VolumeError::LimitExceeded);
    }
    let expected_sample_bytes = sample_count.checked_mul(8).ok_or(VolumeError::Overflow)?;
    if body_bytes != expected_sample_bytes {
        return Err(VolumeError::InconsistentByteCount);
    }
    if get_u8(frame, 68)? != 1 || get_u8(frame, 69)? != 1 {
        return Err(VolumeError::InvalidEnum);
    }
    let data_order = DataOrder::from_wire(get_u8(frame, 70)?)?;
    let periodic = get_u8(frame, 71)?;
    if periodic & !0x07 != 0 {
        return Err(VolumeError::InvalidEnum);
    }
    let coordinate_unit = CoordinateUnit::from_wire(get_u16(frame, 72)?)?;
    let quantity_kind = QuantityKind::from_wire(get_u16(frame, 74)?)?;
    let value_unit = ValueUnit::from_wire(get_u16(frame, 76)?)?;
    if get_u16(frame, 78)? != 0 || get_u64(frame, 296)? != 0 {
        return Err(VolumeError::InvalidReserved);
    }
    if !units_match(quantity_kind, value_unit) {
        return Err(VolumeError::InvalidEnum);
    }
    let origin = read_vec3(frame, 80)?;
    let voxel_axes = read_mat3(frame, 104)?;
    let lattice = read_mat3(frame, 176)?;
    let stored_count = get_u64(frame, 248)?;
    let stored_bytes = get_u64(frame, 256)?;
    if stored_count != sample_count || stored_bytes != expected_sample_bytes {
        return Err(VolumeError::InconsistentByteCount);
    }
    let statistics = Statistics {
        min: get_f64(frame, 264)?,
        max: get_f64(frame, 272)?,
        mean: get_f64(frame, 280)?,
        abs_max: get_f64(frame, 288)?,
    };
    let mut samples =
        Vec::with_capacity(usize::try_from(sample_count).map_err(|_| VolumeError::Overflow)?);
    for chunk in body.chunks_exact(8) {
        let value = f64::from_le_bytes(chunk.try_into().expect("chunks_exact(8)"));
        if !value.is_finite() {
            return Err(VolumeError::NonFinite);
        }
        samples.push(value);
    }
    validate_finite(origin, voxel_axes, lattice, statistics)?;
    validate_statistics(statistics, &samples)?;
    Ok(Volume {
        request_id,
        volume_id,
        dimensions,
        data_order,
        periodic_axes: [periodic & 1 != 0, periodic & 2 != 0, periodic & 4 != 0],
        coordinate_unit,
        quantity_kind,
        value_unit,
        origin,
        voxel_axes,
        lattice,
        statistics,
        samples,
    })
}

pub fn encode_volume(volume: &Volume) -> Result<Vec<u8>, VolumeError> {
    if volume.request_id == 0 || volume.volume_id == 0 {
        return Err(VolumeError::InvalidId);
    }
    let sample_count = checked_count(volume.dimensions)?;
    if sample_count > MAX_SAMPLES || volume.samples.len() as u64 != sample_count {
        return Err(if sample_count > MAX_SAMPLES {
            VolumeError::LimitExceeded
        } else {
            VolumeError::InconsistentByteCount
        });
    }
    let body_bytes = sample_count.checked_mul(8).ok_or(VolumeError::Overflow)?;
    if body_bytes > MAX_BODY_BYTES {
        return Err(VolumeError::LimitExceeded);
    }
    if !units_match(volume.quantity_kind, volume.value_unit) {
        return Err(VolumeError::InvalidEnum);
    }
    validate_finite(
        volume.origin,
        volume.voxel_axes,
        volume.lattice,
        volume.statistics,
    )?;
    validate_statistics(volume.statistics, &volume.samples)?;
    let frame_bytes = (VOLUME_HEADER_BYTES as u64)
        .checked_add(body_bytes)
        .ok_or(VolumeError::Overflow)?;
    if frame_bytes > MAX_FRAME_BYTES {
        return Err(VolumeError::LimitExceeded);
    }
    let mut frame = vec![0_u8; usize::try_from(frame_bytes).map_err(|_| VolumeError::Overflow)?];
    frame[..8].copy_from_slice(MAGIC);
    put_u16(&mut frame, 8, 1);
    put_u16(&mut frame, 10, 0);
    put_u16(&mut frame, 12, MESSAGE_VOLUME);
    put_u16(&mut frame, 14, REQUIRED_FLAGS);
    put_u32(&mut frame, 16, VOLUME_HEADER_BYTES as u32);
    put_u64(&mut frame, 20, volume.request_id);
    put_u64(&mut frame, 28, body_bytes);
    put_u32(&mut frame, 40, 0);
    put_u64(&mut frame, 48, volume.volume_id);
    for (offset, value) in volume.dimensions.iter().copied().enumerate() {
        put_u32(&mut frame, 56 + offset * 4, value);
    }
    frame[68] = 1;
    frame[69] = 1;
    frame[70] = volume.data_order as u8;
    frame[71] = volume
        .periodic_axes
        .iter()
        .enumerate()
        .fold(0_u8, |bits, (index, set)| bits | ((*set as u8) << index));
    put_u16(&mut frame, 72, volume.coordinate_unit as u16);
    put_u16(&mut frame, 74, volume.quantity_kind as u16);
    put_u16(&mut frame, 76, volume.value_unit as u16);
    write_vec3(&mut frame, 80, volume.origin);
    write_mat3(&mut frame, 104, volume.voxel_axes);
    write_mat3(&mut frame, 176, volume.lattice);
    put_u64(&mut frame, 248, sample_count);
    put_u64(&mut frame, 256, body_bytes);
    put_f64(&mut frame, 264, volume.statistics.min);
    put_f64(&mut frame, 272, volume.statistics.max);
    put_f64(&mut frame, 280, volume.statistics.mean);
    put_f64(&mut frame, 288, volume.statistics.abs_max);
    let body_start = VOLUME_HEADER_BYTES;
    for (index, sample) in volume.samples.iter().copied().enumerate() {
        put_f64(&mut frame, body_start + index * 8, sample);
    }
    let body_crc = crc32c(&frame[body_start..]);
    put_u32(&mut frame, 40, body_crc);
    let mut header = frame[..VOLUME_HEADER_BYTES].to_vec();
    header[36..40].fill(0);
    put_u32(&mut frame, 36, crc32c(&header));
    Ok(frame)
}

fn checked_count(dimensions: [u32; 3]) -> Result<u64, VolumeError> {
    if dimensions.contains(&0) {
        return Err(VolumeError::InvalidDimensions);
    }
    u64::from(dimensions[0])
        .checked_mul(u64::from(dimensions[1]))
        .and_then(|value| value.checked_mul(u64::from(dimensions[2])))
        .ok_or(VolumeError::Overflow)
}

fn units_match(quantity: QuantityKind, value: ValueUnit) -> bool {
    matches!(
        (quantity, value),
        (QuantityKind::Orbital, ValueUnit::BohrMinusThreeHalves)
            | (QuantityKind::ElectronDensity, ValueUnit::ElectronPerBohr3)
            | (
                QuantityKind::ElectrostaticPotential,
                ValueUnit::HartreePerElectron
            )
            | (QuantityKind::GenericScalar, ValueUnit::Dimensionless)
    )
}

fn validate_finite(
    origin: [f64; 3],
    voxel_axes: [[f64; 3]; 3],
    lattice: [[f64; 3]; 3],
    statistics: Statistics,
) -> Result<(), VolumeError> {
    if origin
        .iter()
        .chain(voxel_axes.iter().flatten())
        .chain(lattice.iter().flatten())
        .chain(
            [
                statistics.min,
                statistics.max,
                statistics.mean,
                statistics.abs_max,
            ]
            .iter(),
        )
        .any(|value| !value.is_finite())
    {
        return Err(VolumeError::NonFinite);
    }
    Ok(())
}

fn validate_statistics(stored: Statistics, samples: &[f64]) -> Result<(), VolumeError> {
    if samples.is_empty() || samples.iter().any(|value| !value.is_finite()) {
        return Err(VolumeError::NonFinite);
    }
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    let mut abs_max: f64 = 0.0;
    let mut sum = 0.0;
    for &value in samples {
        min = min.min(value);
        max = max.max(value);
        abs_max = abs_max.max(value.abs());
        sum += value;
    }
    let mean = sum / samples.len() as f64;
    for (actual, expected) in [
        (stored.min, min),
        (stored.max, max),
        (stored.mean, mean),
        (stored.abs_max, abs_max),
    ] {
        let tolerance = (1e-12_f64).max(1e-12 * actual.abs().max(1.0));
        if (actual - expected).abs() > tolerance {
            return Err(VolumeError::InconsistentStatistics);
        }
    }
    Ok(())
}

fn crc32c(bytes: &[u8]) -> u32 {
    let mut crc = Crc32c::new();
    crc.update(bytes);
    crc.finish()
}

fn write_control_header(frame: &mut [u8], message_type: u16, request_id: u64) {
    write_control_header_major(frame, 1, message_type, request_id)
}

fn write_control_header_major(frame: &mut [u8], major: u16, message_type: u16, request_id: u64) {
    let header_bytes = frame.len() as u32;
    frame[..8].copy_from_slice(MAGIC);
    put_u16(frame, 8, major);
    put_u16(frame, 10, 0);
    put_u16(frame, 12, message_type);
    put_u16(frame, 14, CONTROL_FLAGS);
    put_u32(frame, 16, header_bytes);
    put_u64(frame, 20, request_id);
    put_u64(frame, 28, 0);
    refresh_control_crc(frame);
}

fn refresh_control_crc(frame: &mut [u8]) {
    put_u32(frame, 36, 0);
    put_u32(frame, 40, 0);
    let crc = crc32c(frame);
    put_u32(frame, 36, crc);
}

fn validate_control_header(
    frame: &[u8],
    header_bytes: usize,
    message_type: u16,
    require_request_id: bool,
) -> Result<(), VolumeError> {
    if frame.len() < header_bytes {
        return Err(VolumeError::Truncated);
    }
    if frame.len() != header_bytes {
        return Err(VolumeError::TrailingBytes);
    }
    if &frame[..8] != MAGIC {
        return Err(VolumeError::InvalidMagic);
    }
    if get_u16(frame, 8)? != 1 || get_u16(frame, 10)? != 0 {
        return Err(VolumeError::UnsupportedVersion);
    }
    if get_u16(frame, 12)? != message_type {
        return Err(VolumeError::InvalidMessageType);
    }
    if get_u16(frame, 14)? != CONTROL_FLAGS
        || get_u32(frame, 16)? as usize != header_bytes
        || get_u64(frame, 28)? != 0
        || get_u32(frame, 40)? != 0
        || get_u32(frame, 44)? != 0
    {
        return Err(VolumeError::InvalidHeader);
    }
    let request_id = get_u64(frame, 20)?;
    if require_request_id == (request_id == 0) {
        return Err(VolumeError::InvalidId);
    }
    let expected_crc = get_u32(frame, 36)?;
    let mut header = frame.to_vec();
    header[36..40].fill(0);
    if crc32c(&header) != expected_crc {
        return Err(VolumeError::InvalidCrc);
    }
    Ok(())
}

fn get_u8(bytes: &[u8], offset: usize) -> Result<u8, VolumeError> {
    bytes.get(offset).copied().ok_or(VolumeError::Truncated)
}
fn get_u16(bytes: &[u8], offset: usize) -> Result<u16, VolumeError> {
    let bytes = bytes
        .get(offset..offset + 2)
        .ok_or(VolumeError::Truncated)?;
    Ok(u16::from_le_bytes(
        bytes.try_into().expect("slice length checked"),
    ))
}
fn get_u32(bytes: &[u8], offset: usize) -> Result<u32, VolumeError> {
    let bytes = bytes
        .get(offset..offset + 4)
        .ok_or(VolumeError::Truncated)?;
    Ok(u32::from_le_bytes(
        bytes.try_into().expect("slice length checked"),
    ))
}
fn get_u64(bytes: &[u8], offset: usize) -> Result<u64, VolumeError> {
    let bytes = bytes
        .get(offset..offset + 8)
        .ok_or(VolumeError::Truncated)?;
    Ok(u64::from_le_bytes(
        bytes.try_into().expect("slice length checked"),
    ))
}
fn get_f64(bytes: &[u8], offset: usize) -> Result<f64, VolumeError> {
    Ok(f64::from_bits(get_u64(bytes, offset)?))
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
fn put_f64(bytes: &mut [u8], offset: usize, value: f64) {
    put_u64(bytes, offset, value.to_bits());
}
fn read_vec3(bytes: &[u8], offset: usize) -> Result<[f64; 3], VolumeError> {
    Ok([
        get_f64(bytes, offset)?,
        get_f64(bytes, offset + 8)?,
        get_f64(bytes, offset + 16)?,
    ])
}
fn write_vec3(bytes: &mut [u8], offset: usize, values: [f64; 3]) {
    for (index, value) in values.into_iter().enumerate() {
        put_f64(bytes, offset + index * 8, value);
    }
}
fn read_mat3(bytes: &[u8], offset: usize) -> Result<[[f64; 3]; 3], VolumeError> {
    Ok([
        read_vec3(bytes, offset)?,
        read_vec3(bytes, offset + 24)?,
        read_vec3(bytes, offset + 48)?,
    ])
}
fn write_mat3(bytes: &mut [u8], offset: usize, values: [[f64; 3]; 3]) {
    for (index, value) in values.into_iter().enumerate() {
        write_vec3(bytes, offset + index * 24, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<u8> {
        tests_fixture_hex(include_str!(
            "../../../tests/fixtures/matterviz-volume-v1-orbital.hex"
        ))
    }

    fn tests_fixture_hex(source: &str) -> Vec<u8> {
        source
            .lines()
            .filter_map(|line| line.split('#').next())
            .flat_map(|line| line.split_whitespace())
            .flat_map(|word| {
                (0..word.len())
                    .step_by(2)
                    .map(move |i| u8::from_str_radix(&word[i..i + 2], 16).unwrap())
            })
            .collect()
    }

    fn refresh_header_crc(frame: &mut [u8]) {
        let mut header = frame[..VOLUME_HEADER_BYTES].to_vec();
        header[36..40].fill(0);
        put_u32(frame, 36, crc32c(&header));
    }

    #[test]
    fn golden_frame_decodes() {
        let volume = decode_volume(&fixture()).unwrap();
        assert_eq!(volume.request_id, 42);
        assert_eq!(volume.volume_id, 1001);
        assert_eq!(volume.dimensions, [2, 2, 3]);
        assert_eq!(volume.data_order, DataOrder::IFastestFortran);
        assert_eq!(volume.periodic_axes, [true, false, true]);
        assert_eq!(volume.quantity_kind, QuantityKind::Orbital);
        assert_eq!(volume.value_unit, ValueUnit::BohrMinusThreeHalves);
        assert_eq!(volume.samples, (1..=12).map(f64::from).collect::<Vec<_>>());
        assert_eq!(volume.sample_at(1, 0, 0), Some(2.0));
        assert_eq!(volume.sample_at(0, 0, 1), Some(5.0));
    }

    #[test]
    fn golden_frame_round_trips() {
        let frame = fixture();
        let volume = decode_volume(&frame).unwrap();
        assert_eq!(encode_volume(&volume).unwrap(), frame);
    }

    #[test]
    fn ready_and_ack_control_frames_round_trip() {
        let ready = encode_ready();
        assert_eq!(ready.len(), PRELUDE_BYTES);
        decode_ready(&ready).unwrap();

        let ack = encode_ack(42, 1001, 0).unwrap();
        assert_eq!(ack.len(), ACK_HEADER_BYTES);
        assert_eq!(decode_ack(&ack).unwrap(), (42, 1001, 0));
        let mut corrupt = ack;
        corrupt[60] = 1;
        refresh_control_crc(&mut corrupt);
        assert_eq!(decode_ack(&corrupt), Err(VolumeError::InvalidReserved));
        assert_eq!(encode_ack(0, 1001, 0), Err(VolumeError::InvalidId));
    }

    #[test]
    fn cube_order_indexing() {
        let mut volume = decode_volume(&fixture()).unwrap();
        volume.data_order = DataOrder::KFastestCube;
        volume.samples = (1..=12).map(f64::from).collect();
        volume.statistics = Statistics {
            min: 1.0,
            max: 12.0,
            mean: 6.5,
            abs_max: 12.0,
        };
        assert_eq!(volume.sample_at(0, 0, 0), Some(1.0));
        assert_eq!(volume.sample_at(0, 0, 1), Some(2.0));
        assert_eq!(volume.sample_at(0, 1, 0), Some(4.0));
        assert_eq!(volume.sample_at(1, 0, 0), Some(7.0));
    }

    #[test]
    fn round_trips_signed_samples_and_all_quantity_units() {
        let mut volume = decode_volume(&fixture()).unwrap();
        volume.samples = (1..=12).map(|value| -f64::from(value)).collect();
        volume.statistics = Statistics {
            min: -12.0,
            max: -1.0,
            mean: -6.5,
            abs_max: 12.0,
        };
        for (quantity_kind, value_unit) in [
            (QuantityKind::Orbital, ValueUnit::BohrMinusThreeHalves),
            (QuantityKind::ElectronDensity, ValueUnit::ElectronPerBohr3),
            (
                QuantityKind::ElectrostaticPotential,
                ValueUnit::HartreePerElectron,
            ),
            (QuantityKind::GenericScalar, ValueUnit::Dimensionless),
        ] {
            volume.quantity_kind = quantity_kind;
            volume.value_unit = value_unit;
            let decoded = decode_volume(&encode_volume(&volume).unwrap()).unwrap();
            assert_eq!(decoded.quantity_kind, quantity_kind);
            assert_eq!(decoded.value_unit, value_unit);
            assert_eq!(decoded.statistics.abs_max, 12.0);
            assert_eq!(decoded.samples[0], -1.0);
            assert_eq!(decoded.samples[11], -12.0);
        }
    }

    #[test]
    fn rejects_generic_scalar_unit_mismatches() {
        let mut volume = decode_volume(&fixture()).unwrap();
        for value_unit in [
            ValueUnit::BohrMinusThreeHalves,
            ValueUnit::ElectronPerBohr3,
            ValueUnit::HartreePerElectron,
        ] {
            volume.quantity_kind = QuantityKind::GenericScalar;
            volume.value_unit = value_unit;
            assert_eq!(encode_volume(&volume), Err(VolumeError::InvalidEnum));
        }

        let mut frame = fixture();
        put_u16(&mut frame, 74, QuantityKind::GenericScalar as u16);
        put_u16(&mut frame, 76, ValueUnit::HartreePerElectron as u16);
        refresh_header_crc(&mut frame);
        assert_eq!(decode_volume(&frame), Err(VolumeError::InvalidEnum));
    }

    #[test]
    fn rejects_corruption_and_truncation() {
        let mut frame = fixture();
        frame[0] ^= 1;
        assert_eq!(decode_volume(&frame), Err(VolumeError::InvalidMagic));
        let frame = fixture();
        assert_eq!(
            decode_volume(&frame[..frame.len() - 1]),
            Err(VolumeError::Truncated)
        );
        let mut frame = fixture();
        frame[100] ^= 1;
        assert_eq!(decode_volume(&frame), Err(VolumeError::InvalidCrc));
    }

    #[test]
    fn rejects_bad_prelude_flags_reserved_and_enums() {
        let mut frame = fixture();
        put_u16(&mut frame, 8, 2);
        assert_eq!(decode_volume(&frame), Err(VolumeError::UnsupportedVersion));
        let mut frame = fixture();
        put_u16(&mut frame, 10, 1);
        assert_eq!(decode_volume(&frame), Err(VolumeError::UnsupportedVersion));
        let mut frame = fixture();
        put_u32(&mut frame, 16, 312);
        assert_eq!(decode_volume(&frame), Err(VolumeError::InvalidHeader));
        let mut frame = fixture();
        put_u16(&mut frame, 12, 3);
        assert_eq!(decode_volume(&frame), Err(VolumeError::InvalidMessageType));
        let mut frame = fixture();
        put_u16(&mut frame, 14, 0x0007);
        assert_eq!(decode_volume(&frame), Err(VolumeError::InvalidFlags));
        let mut frame = fixture();
        put_u32(&mut frame, 44, 1);
        assert_eq!(decode_volume(&frame), Err(VolumeError::InvalidReserved));
        let mut frame = fixture();
        frame[70] = 9;
        refresh_header_crc(&mut frame);
        assert_eq!(decode_volume(&frame), Err(VolumeError::InvalidEnum));
        let mut frame = fixture();
        put_u16(&mut frame, 74, 2);
        refresh_header_crc(&mut frame);
        assert_eq!(decode_volume(&frame), Err(VolumeError::InvalidEnum));
        let mut frame = fixture();
        put_u16(&mut frame, 78, 1);
        refresh_header_crc(&mut frame);
        assert_eq!(decode_volume(&frame), Err(VolumeError::InvalidReserved));
    }

    #[test]
    fn rejects_bounds_counts_and_trailing_bytes() {
        let mut frame = fixture();
        put_u32(&mut frame, 56, 0);
        refresh_header_crc(&mut frame);
        assert_eq!(decode_volume(&frame), Err(VolumeError::InvalidDimensions));
        let mut frame = fixture();
        put_u64(&mut frame, 248, 11);
        refresh_header_crc(&mut frame);
        assert_eq!(
            decode_volume(&frame),
            Err(VolumeError::InconsistentByteCount)
        );
        let mut frame = fixture();
        frame.push(0);
        assert_eq!(decode_volume(&frame), Err(VolumeError::TrailingBytes));
        let volume = Volume {
            request_id: 1,
            volume_id: 1,
            dimensions: [1_500_001, 1, 1],
            data_order: DataOrder::IFastestFortran,
            periodic_axes: [false; 3],
            coordinate_unit: CoordinateUnit::Bohr,
            quantity_kind: QuantityKind::Orbital,
            value_unit: ValueUnit::BohrMinusThreeHalves,
            origin: [0.0; 3],
            voxel_axes: [[0.0; 3]; 3],
            lattice: [[0.0; 3]; 3],
            statistics: Statistics {
                min: 0.0,
                max: 0.0,
                mean: 0.0,
                abs_max: 0.0,
            },
            samples: Vec::new(),
        };
        assert_eq!(encode_volume(&volume), Err(VolumeError::LimitExceeded));
    }

    #[test]
    fn rejects_nonfinite_and_bad_statistics() {
        let mut volume = decode_volume(&fixture()).unwrap();
        volume.samples[0] = f64::NAN;
        assert_eq!(encode_volume(&volume), Err(VolumeError::NonFinite));
        let mut volume = decode_volume(&fixture()).unwrap();
        volume.statistics.mean = 99.0;
        assert_eq!(
            encode_volume(&volume),
            Err(VolumeError::InconsistentStatistics)
        );
    }
}
