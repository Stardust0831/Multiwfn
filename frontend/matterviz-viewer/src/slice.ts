import type { SliceResult, VolumetricData } from 'matterviz/isosurface'
import type { Vec3 } from 'matterviz/math'

export type SliceAxis = 'xy' | 'xz' | 'yz'
export type SliceRange = readonly [number, number]
export type NormalizedSlice = {
  data: Float64Array
  width: number
  height: number
  min: number
  max: number
}
export const SLICE_COLORMAPS = ['Viridis', 'RdBu', 'Jet', 'Portland'] as const
export type SliceColormap = (typeof SLICE_COLORMAPS)[number]
export type SliceSampler = (
  volume: VolumetricData,
  miller_indices: Vec3,
  distance: number,
  n_points?: number,
) => SliceResult | null

export const AXIS_PRESETS: Readonly<Record<SliceAxis, readonly [number, number, number]>> = {
  xy: [0, 0, 1],
  xz: [0, 1, 0],
  yz: [1, 0, 0],
}

export const AXIS_LABELS: Readonly<Record<SliceAxis, string>> = {
  xy: 'XY (001)',
  xz: 'XZ (010)',
  yz: 'YZ (100)',
}

const finite_number = (value: unknown): number | undefined => {
  if (typeof value === 'string' && value.trim() === '') return undefined
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

export const clamp01 = (value: unknown): number => {
  const number = finite_number(value)
  if (number === undefined) return 0.5
  return Math.min(1, Math.max(0, number))
}

export const axis_to_miller = (axis: SliceAxis): Vec3 => [...(AXIS_PRESETS[axis] ?? AXIS_PRESETS.xy)] as Vec3

export const normalize_miller_indices = (value: unknown): Vec3 => {
  const source = Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value as ArrayLike<unknown>) : []
  return [0, 1, 2].map((index) => {
    const number = finite_number(source[index])
    return number === undefined ? 0 : Math.round(number)
  }) as Vec3
}

const integer_dimension = (value: unknown): number | undefined => {
  const number = finite_number(value)
  if (number === undefined || number < 1) return undefined
  return Math.max(1, Math.floor(number))
}

export const normalize_slice_resolution = (value: unknown): number => {
  const number = integer_dimension(value) ?? 128
  return Math.min(512, Math.max(2, number))
}

const finite_data_range = (values: ArrayLike<number>): SliceRange => {
  let min = Infinity
  let max = -Infinity
  for (let index = 0; index < values.length; index += 1) {
    const value = finite_number(values[index])
    if (value === undefined) continue
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : [0, 1]
}

/** Convert a MatterViz slice result into a safe, finite-dimension result.
 * Missing cells are represented by NaN so they do not affect the data range.
 */
export const normalize_slice_result = (result: unknown): NormalizedSlice | null => {
  if (!result || typeof result !== 'object') return null
  const candidate = result as Partial<SliceResult> & { data?: ArrayLike<number> }
  const width = integer_dimension(candidate.width)
  const height = integer_dimension(candidate.height)
  if (!width || !height || !candidate.data || typeof candidate.data.length !== 'number') return null

  const data = new Float64Array(width * height)
  data.fill(Number.NaN)
  const source = candidate.data
  const copied = Math.min(data.length, source.length)
  for (let index = 0; index < copied; index += 1) {
    const value = finite_number(source[index])
    if (value !== undefined) data[index] = value
  }
  const [min, max] = finite_data_range(data)
  return { data, width, height, min, max }
}

export const sample_slice_with = (
  sampler: SliceSampler,
  volume: VolumetricData | undefined,
  miller_indices: unknown,
  distance: unknown,
  resolution: unknown = undefined,
): NormalizedSlice | null => {
  if (!volume) return null
  const miller = normalize_miller_indices(miller_indices)
  if (miller.every((value) => value === 0)) return null
  const points = resolution === undefined ? undefined : normalize_slice_resolution(resolution)
  try {
    return normalize_slice_result(sampler(volume, miller, clamp01(distance), points))
  } catch {
    return null
  }
}

/** Resolve an automatic or manual color range. Non-finite bounds fall back to data. */
export const resolve_slice_range = (
  values: ArrayLike<number> | NormalizedSlice,
  manual_min?: unknown,
  manual_max?: unknown,
): SliceRange => {
  const data = 'data' in values ? values.data : values
  const [automatic_min, automatic_max] = finite_data_range(data)
  const min = finite_number(manual_min) ?? automatic_min
  const max = finite_number(manual_max) ?? automatic_max
  return min <= max ? [min, max] : [max, min]
}

export const normalize_scalar = (value: unknown, range: SliceRange): number => {
  const number = finite_number(value)
  if (number === undefined) return Number.NaN
  const [minimum, maximum] = range
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return 0.5
  if (minimum === maximum) return 0.5
  return Math.min(1, Math.max(0, (number - minimum) / (maximum - minimum)))
}

const COLOR_STOPS: Record<SliceColormap, readonly [number, number, number][]> = {
  Viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  RdBu: [[5, 48, 97], [67, 147, 195], [247, 247, 247], [214, 96, 77], [103, 0, 31]],
  Jet: [[0, 0, 128], [0, 128, 255], [128, 255, 128], [255, 128, 0], [128, 0, 0]],
  Portland: [[12, 51, 131], [10, 136, 186], [242, 211, 56], [242, 143, 56], [217, 30, 30]],
}

const interpolate_color = (value: number, colormap: SliceColormap): [number, number, number] => {
  const stops = COLOR_STOPS[colormap]
  const scaled = value * (stops.length - 1)
  const lower = Math.min(stops.length - 1, Math.floor(scaled))
  const upper = Math.min(stops.length - 1, lower + 1)
  const fraction = scaled - lower
  return stops[lower].map((channel, index) =>
    Math.round(channel + (stops[upper][index] - channel) * fraction)) as [number, number, number]
}

export const scalar_to_rgba = (
  value: unknown,
  range: SliceRange,
  colormap: SliceColormap | string = 'Viridis',
): [number, number, number, number] => {
  const normalized = normalize_scalar(value, range)
  if (!Number.isFinite(normalized)) return [0, 0, 0, 0]
  const selected = SLICE_COLORMAPS.includes(colormap as SliceColormap)
    ? colormap as SliceColormap
    : 'Viridis'
  const [red, green, blue] = interpolate_color(normalized, selected)
  return [red, green, blue, 255]
}

export const slice_to_rgba = (
  slice: NormalizedSlice | null,
  range?: SliceRange,
  colormap: SliceColormap | string = 'Viridis',
): Uint8ClampedArray => {
  if (!slice) return new Uint8ClampedArray()
  const resolved = range ?? resolve_slice_range(slice)
  const rgba = new Uint8ClampedArray(slice.data.length * 4)
  for (let index = 0; index < slice.data.length; index += 1) {
    const color = scalar_to_rgba(slice.data[index], resolved, colormap)
    rgba.set(color, index * 4)
  }
  return rgba
}

// Descriptive aliases make the helpers convenient to consume from plain tests and hosts.
export const normalize_sample_result = normalize_slice_result
export const colorize_slice = slice_to_rgba
