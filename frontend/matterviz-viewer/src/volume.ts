import type { VolumetricData } from 'matterviz/isosurface'
import { create_cart_to_frac } from 'matterviz/math'
import type { AnyStructure } from 'matterviz/structure'

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
  throw new Error(`Invalid MatterViz volume v1 frame: ${reason}`)
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

const finite_vec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value)
  && value.length === 3
  && value.every((component) => typeof component === 'number' && Number.isFinite(component))

/**
 * Move a structure between MatterViz volume coordinate frames.
 *
 * MatterViz's Cube parser subtracts the first volume origin from atom
 * coordinates and renders the first isosurface at the resulting grid origin.
 * Native structure JSON therefore needs the same translation when volumes are
 * supplied independently instead of embedded in a Cube file.
 */
export function translate_structure_volume_frame(
  structure: AnyStructure,
  previous_origin: Vec3,
  next_origin: Vec3,
): AnyStructure {
  if (!finite_vec3(previous_origin) || !finite_vec3(next_origin)) {
    throw new Error('MatterViz volume frame origins must be finite 3-vectors')
  }
  const delta: Vec3 = [
    previous_origin[0] - next_origin[0],
    previous_origin[1] - next_origin[1],
    previous_origin[2] - next_origin[2],
  ]
  if (delta.every((component) => component === 0)) return structure

  let cart_to_frac: ((cart: Vec3) => Vec3) | undefined
  if ('lattice' in structure && structure.lattice?.matrix) {
    try {
      cart_to_frac = create_cart_to_frac(structure.lattice.matrix)
    } catch {
      throw new Error('MatterViz cannot align a volume to a singular structure lattice')
    }
  }
  const sites = structure.sites.map((site) => {
    if (!finite_vec3(site.xyz)) throw new Error('MatterViz structure site coordinates must be finite')
    const xyz: Vec3 = [
      site.xyz[0] + delta[0],
      site.xyz[1] + delta[1],
      site.xyz[2] + delta[2],
    ]
    return { ...site, xyz, abc: cart_to_frac ? cart_to_frac(xyz) : [...xyz] as Vec3 }
  })
  return { ...structure, sites }
}

/** Decode one exact MatterViz binary volume v1 frame. */
export function decode_matterviz_volume(input: ArrayBuffer | Uint8Array): MattervizVolumeV1 {
  const bytes = input instanceof Uint8Array ? new Uint8Array(input) : new Uint8Array(input)
  if (bytes.byteLength < PRELUDE_BYTES) invalid('truncated prelude')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const magic = new TextDecoder().decode(bytes.subarray(0, 8))
  if (magic !== 'MWFNVOL\0') invalid('bad magic')
  const major = view.getUint16(8, true)
  if (major !== 1) invalid(`unsupported major version ${major}`)
  const minor = view.getUint16(10, true)
  if (minor !== 0) invalid(`unsupported minor version ${minor}`)
  const message_type = view.getUint16(12, true)
  if (message_type !== 4) invalid('message type is not volume')
  const flags = view.getUint16(14, true)
  if (flags !== 0x0003) invalid('v1.0 requires exactly the CRC32C flags')

  const header_bytes = view.getUint32(16, true)
  if (header_bytes !== VOLUME_HEADER_BYTES) invalid('header length is not v1.0')
  const request_id = view.getBigUint64(20, true)
  if (request_id === 0n) invalid('request_id must be nonzero')
  const body_bytes = view.getBigUint64(28, true)
  const header_crc = view.getUint32(36, true)
  const body_crc = view.getUint32(40, true)
  if (view.getUint32(44, true) !== 0) invalid('prelude reserved field is nonzero')

  if (body_bytes > MAX_BODY_BYTES) invalid('body exceeds size limit')
  const expected_frame_bytes = BigInt(header_bytes) + body_bytes
  if (expected_frame_bytes > MAX_FRAME_BYTES) invalid('frame exceeds size limit')
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
  if (sample_count_big > MAX_POINTS) invalid('sample count exceeds size limit')
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

  const samples = new Float64Array(sample_count)
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let abs_max = 0
  for (let index = 0; index < sample_count; index += 1) {
    const value = finite(view.getFloat64(header_bytes + index * 8, true), `sample[${index}]`)
    samples[index] = value
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

/** Convert a decoded frame to MatterViz's nested grid representation. */
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
  const grid = Array.from({ length: nx }, () =>
    Array.from({ length: ny }, () => new Array<number>(nz)))
  let sample_index = 0
  if (volume.data_order === 'i_fastest_fortran') {
    for (let iz = 0; iz < nz; iz += 1) {
      for (let iy = 0; iy < ny; iy += 1) {
        for (let ix = 0; ix < nx; ix += 1) {
          grid[ix]![iy]![iz] = volume.samples[sample_index++]!
        }
      }
    }
  } else {
    for (let ix = 0; ix < nx; ix += 1) {
      for (let iy = 0; iy < ny; iy += 1) {
        for (let iz = 0; iz < nz; iz += 1) {
          grid[ix]![iy]![iz] = volume.samples[sample_index++]!
        }
      }
    }
  }
  return {
    grid,
    grid_dims: volume.dimensions,
    lattice: grid_lattice,
    origin: scale_vec3(volume.origin, scale),
    data_range: volume.statistics,
    data_order: volume.data_order === 'i_fastest_fortran' ? 'x_fastest' : 'z_fastest',
    periodic: periodic_axis_count === 3,
  }
}
