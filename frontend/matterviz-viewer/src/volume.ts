import type { VolumetricData } from 'matterviz/isosurface'

export type Vec3 = [number, number, number]
export type Matrix3 = [Vec3, Vec3, Vec3]
export type VolumeDataOrder = 'i_fastest_fortran' | 'k_fastest_cube'
export type QuantityKind = 'orbital' | 'electron_density' | 'electrostatic_potential'
export type CoordinateUnit = 'bohr' | 'angstrom'
export type ValueUnit = 'bohr^-3/2' | 'electron/bohr^3' | 'hartree/e'

export interface VolumeStatistics {
  min: number
  max: number
  mean: number
  abs_max: number
}

export interface MattervizVolumeV1 {
  protocol_major: 1 | 2
  request_id: bigint
  volume_id: bigint
  dimensions: Vec3
  scalar_type: 'f64'
  scalar_endian: 'little'
  data_order: VolumeDataOrder
  periodic_axes: [boolean, boolean, boolean]
  coordinate_unit: CoordinateUnit
  quantity_kind: QuantityKind
  value_unit: ValueUnit
  origin: Vec3
  voxel_axes: Matrix3
  lattice: Matrix3
  statistics: VolumeStatistics
  samples: Float64Array
}

const PRELUDE_BYTES = 48
const VOLUME_HEADER_BYTES = 304
const MAX_POINTS = 1_500_000n
const MAX_BODY_BYTES = 12_000_000n
const MAX_FRAME_BYTES = 12_000_304n
const BOHR_TO_ANGSTROM = 0.529177249
const NATIVE_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1
const VOLUME_MAGIC = [0x4d, 0x57, 0x46, 0x4e, 0x56, 0x4f, 0x4c, 0x00] as const

const CRC32C_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (value >>> 1) ^ 0x82f63b78 : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function invalid(reason: string): never {
  throw new Error(`Invalid MatterViz volume frame: ${reason}`)
}

function has_volume_magic(bytes: Uint8Array): boolean {
  for (let index = 0; index < VOLUME_MAGIC.length; index += 1) {
    if (bytes[index] !== VOLUME_MAGIC[index]) return false
  }
  return true
}

export async function read_matterviz_volume_response(response: Response): Promise<ArrayBufferLike> {
  const declared = response.headers.get('content-length')
  const length = declared === null ? Number.NaN : Number(declared)
  if (!Number.isSafeInteger(length) || length < VOLUME_HEADER_BYTES) {
    throw new Error('MatterViz volume response has an invalid Content-Length')
  }
  if (!response.body) {
    const fallback = await response.arrayBuffer()
    if (fallback.byteLength !== length) throw new Error('MatterViz volume response was truncated')
    return fallback
  }
  let buffer: ArrayBufferLike
  try {
    buffer = typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true
      ? new SharedArrayBuffer(length)
      : new ArrayBuffer(length)
  } catch {
    throw new Error(`Could not allocate ${length} bytes for the MatterViz volume`)
  }
  const target = new Uint8Array(buffer)
  const reader = response.body.getReader()
  let offset = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (offset > target.length - value.byteLength) {
        await reader.cancel('MatterViz volume response exceeded Content-Length')
        throw new Error('MatterViz volume response exceeded Content-Length')
      }
      target.set(value, offset)
      offset += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  if (offset !== target.length) throw new Error('MatterViz volume response was truncated')
  return buffer
}

function require_bytes(offset: number, size: number, length: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0
    || offset > length - size) {
    invalid('truncated frame')
  }
}

function crc32c(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC32C_TABLE[(crc ^ byte) & 0xff]!
  return (crc ^ 0xffffffff) >>> 0
}

function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) invalid(`${field} must be finite`)
  return value
}

function read_vec3(view: DataView, offset: number, field: string): Vec3 {
  const value: Vec3 = [
    finite(view.getFloat64(offset, true), `${field}[0]`),
    finite(view.getFloat64(offset + 8, true), `${field}[1]`),
    finite(view.getFloat64(offset + 16, true), `${field}[2]`),
  ]
  return value
}

function read_matrix3(view: DataView, offset: number, field: string): Matrix3 {
  return [
    read_vec3(view, offset, `${field}[0]`),
    read_vec3(view, offset + 24, `${field}[1]`),
    read_vec3(view, offset + 48, `${field}[2]`),
  ]
}

function close_enough(actual: number, stored: number): boolean {
  const tolerance = Math.max(1e-12, 1e-12 * Math.max(1, Math.abs(stored)))
  return Math.abs(actual - stored) <= tolerance
}

function unit_scale(unit: CoordinateUnit): number {
  return unit === 'bohr' ? BOHR_TO_ANGSTROM : 1
}

function scale_vec3(value: Vec3, scale: number): Vec3 {
  return [value[0] * scale, value[1] * scale, value[2] * scale]
}

/** Decode one exact MatterViz binary volume v1 frame. */
export function decode_matterviz_volume(input: ArrayBufferLike | Uint8Array): MattervizVolumeV1 {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.byteLength < PRELUDE_BYTES) invalid('truncated prelude')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  if (!has_volume_magic(bytes)) invalid('bad magic')
  const major = view.getUint16(8, true)
  if (major !== 1 && major !== 2) invalid(`unsupported major version ${major}`)
  const minor = view.getUint16(10, true)
  if (minor !== 0) invalid(`unsupported minor version ${minor}`)
  const message_type = view.getUint16(12, true)
  if (message_type !== 4) invalid('message type is not volume')
  const flags = view.getUint16(14, true)
  if (flags !== 0x0003) invalid('volume frame requires exactly the CRC32C flags')

  const header_bytes = view.getUint32(16, true)
  if (header_bytes !== VOLUME_HEADER_BYTES) invalid('unsupported header length')
  const request_id = view.getBigUint64(20, true)
  if (request_id === 0n) invalid('request_id must be nonzero')
  const body_bytes = view.getBigUint64(28, true)
  const header_crc = view.getUint32(36, true)
  const body_crc = view.getUint32(40, true)
  if (view.getUint32(44, true) !== 0) invalid('prelude reserved field is nonzero')

  if (major === 1 && body_bytes > MAX_BODY_BYTES) invalid('v1 body exceeds size limit')
  const expected_frame_bytes = BigInt(header_bytes) + body_bytes
  if (major === 1 && expected_frame_bytes > MAX_FRAME_BYTES) invalid('v1 frame exceeds size limit')
  if (expected_frame_bytes > BigInt(Number.MAX_SAFE_INTEGER)) invalid('frame exceeds JavaScript addressable size')
  if (expected_frame_bytes !== BigInt(bytes.byteLength)) invalid('frame length does not match header and body')
  require_bytes(0, header_bytes, bytes.byteLength)
  require_bytes(header_bytes, Number(body_bytes), bytes.byteLength)

  const header_for_crc = bytes.slice(0, header_bytes)
  header_for_crc.fill(0, 36, 40)
  if (crc32c(header_for_crc) !== header_crc) invalid('header CRC32C mismatch')
  if (crc32c(bytes.subarray(header_bytes)) !== body_crc) invalid('body CRC32C mismatch')

  const volume_id = view.getBigUint64(48, true)
  if (volume_id === 0n) invalid('volume_id must be nonzero')
  const nx = view.getUint32(56, true)
  const ny = view.getUint32(60, true)
  const nz = view.getUint32(64, true)
  if (nx === 0 || ny === 0 || nz === 0) invalid('dimensions must be nonzero')
  const sample_count_big = BigInt(nx) * BigInt(ny) * BigInt(nz)
  if (major === 1 && sample_count_big > MAX_POINTS) invalid('v1 sample count exceeds size limit')
  if (sample_count_big > BigInt(Number.MAX_SAFE_INTEGER)) invalid('sample count exceeds JavaScript addressable size')
  const sample_count = Number(sample_count_big)

  if (view.getUint8(68) !== 1) invalid('unsupported scalar type')
  if (view.getUint8(69) !== 1) invalid('unsupported scalar endian')
  const order_code = view.getUint8(70)
  if (order_code !== 1 && order_code !== 2) invalid('unsupported data order')
  const periodic_bits = view.getUint8(71)
  if ((periodic_bits & 0xf8) !== 0) invalid('invalid periodic axes')

  const coordinate_code = view.getUint16(72, true)
  if (coordinate_code !== 1 && coordinate_code !== 2) invalid('unsupported coordinate unit')
  const quantity_code = view.getUint16(74, true)
  const value_code = view.getUint16(76, true)
  if (view.getUint16(78, true) !== 0) invalid('volume header reserved field is nonzero')

  const coordinate_unit: CoordinateUnit = coordinate_code === 1 ? 'bohr' : 'angstrom'
  let quantity_kind: QuantityKind
  let value_unit: ValueUnit
  if (quantity_code === 1 && value_code === 1) {
    quantity_kind = 'orbital'
    value_unit = 'bohr^-3/2'
  } else if (quantity_code === 2 && value_code === 2) {
    quantity_kind = 'electron_density'
    value_unit = 'electron/bohr^3'
  } else if (quantity_code === 3 && value_code === 3) {
    quantity_kind = 'electrostatic_potential'
    value_unit = 'hartree/e'
  } else {
    invalid('quantity kind and value unit do not match')
  }

  const origin = read_vec3(view, 80, 'origin')
  const voxel_axes = read_matrix3(view, 104, 'voxel_axes')
  const lattice = read_matrix3(view, 176, 'lattice')

  if (view.getBigUint64(248, true) !== sample_count_big) invalid('sample_count does not match dimensions')
  const sample_bytes = view.getBigUint64(256, true)
  if (sample_bytes !== sample_count_big * 8n) invalid('sample_bytes does not match sample_count')
  if (body_bytes !== sample_bytes) invalid('body_bytes does not match sample_bytes')
  if (view.getBigUint64(296, true) !== 0n) invalid('volume header reserved field is nonzero')

  const statistics: VolumeStatistics = {
    min: finite(view.getFloat64(264, true), 'min'),
    max: finite(view.getFloat64(272, true), 'max'),
    mean: finite(view.getFloat64(280, true), 'mean'),
    abs_max: finite(view.getFloat64(288, true), 'abs_max'),
  }
  if (statistics.min > statistics.max) invalid('min is greater than max')

  const sample_offset = bytes.byteOffset + header_bytes
  const can_view_samples = NATIVE_LITTLE_ENDIAN
    && sample_offset % Float64Array.BYTES_PER_ELEMENT === 0
  const samples = can_view_samples
    ? new Float64Array(bytes.buffer, sample_offset, sample_count)
    : new Float64Array(sample_count)
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let abs_max = 0
  for (let index = 0; index < sample_count; index += 1) {
    const value = finite(view.getFloat64(header_bytes + index * 8, true), `sample[${index}]`)
    if (!can_view_samples) samples[index] = value
    min = Math.min(min, value)
    max = Math.max(max, value)
    sum += value
    abs_max = Math.max(abs_max, Math.abs(value))
  }
  const mean = sum / sample_count
  if (!close_enough(min, statistics.min)
    || !close_enough(max, statistics.max)
    || !close_enough(mean, statistics.mean)
    || !close_enough(abs_max, statistics.abs_max)) {
    invalid('stored statistics do not match samples')
  }

  return {
    protocol_major: major,
    request_id,
    volume_id,
    dimensions: [nx, ny, nz],
    scalar_type: 'f64',
    scalar_endian: 'little',
    data_order: order_code === 1 ? 'i_fastest_fortran' : 'k_fastest_cube',
    periodic_axes: [
      (periodic_bits & 0x01) !== 0,
      (periodic_bits & 0x02) !== 0,
      (periodic_bits & 0x04) !== 0,
    ],
    coordinate_unit,
    quantity_kind,
    value_unit,
    origin,
    voxel_axes,
    lattice,
    statistics,
    samples,
  }
}

/** Convert a decoded frame to MatterViz volumetric data without copying samples. */
export function adapt_matterviz_volume(volume: MattervizVolumeV1): VolumetricData {
  const [nx, ny, nz] = volume.dimensions
  const periodic_axis_count = volume.periodic_axes.filter(Boolean).length
  if (periodic_axis_count !== 0 && periodic_axis_count !== 3) {
    throw new Error('MatterViz does not support partially periodic volumetric grids')
  }
  const scale = unit_scale(volume.coordinate_unit)
  const grid_lattice = volume.voxel_axes.map((axis, index) =>
    scale_vec3(axis, volume.dimensions[index] * scale)) as Matrix3
  if (grid_lattice.flat().some((value) => !Number.isFinite(value))) {
    throw new Error('MatterViz volume grid lattice must be finite')
  }
  return {
    grid: {
      data: volume.samples,
      dimensions: volume.dimensions,
      order: volume.data_order === 'i_fastest_fortran' ? 'x-fastest' : 'z-fastest',
    },
    grid_dims: volume.dimensions,
    lattice: grid_lattice,
    origin: scale_vec3(volume.origin, scale),
    origin_mode: 'absolute',
    data_range: volume.statistics,
    data_order: volume.data_order === 'i_fastest_fortran' ? 'x_fastest' : 'z_fastest',
    periodic: periodic_axis_count === 3,
  }
}
