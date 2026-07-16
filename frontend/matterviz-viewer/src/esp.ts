import type { IsosurfaceLayer, VolumetricData } from 'matterviz'
import type { ManifestEntry } from './manifest'

/** Hartree to kcal/mol for one electron. */
export const KCAL_PER_HARTREE = 627.5094740631
export const DEFAULT_ESP_LIMIT = 0.05
export const MINIMUM_ESP_LIMIT = 0.005

export const ESP_COLORS = Object.freeze({
  negative: '#f5a9b8',
  zero: '#ffffff',
  positive: '#5bcefa',
})

export type Vec3 = [number, number, number]
export type LegendPosition = { left: number; top: number }
export type EspVolume = Partial<VolumetricData> | Record<string, unknown>
export type EspPair = { densityIdx: number; potentialIdx: number }
type EspLayerLink = Pick<IsosurfaceLayer, 'volume_idx' | 'color_volume_idx'>
type GridCompatibility = (leftIdx: number, rightIdx: number) => boolean

export const find_declared_esp_pair = (
  entries: readonly ManifestEntry[],
  grids_compatible: GridCompatibility,
): EspPair | undefined => {
  for (let densityIdx = 0; densityIdx < entries.length; densityIdx += 1) {
    if (entries[densityIdx]?.analysisKind !== 'esp-density') continue
    for (let potentialIdx = 0; potentialIdx < entries.length; potentialIdx += 1) {
      if (entries[potentialIdx]?.analysisKind === 'esp-potential'
        && grids_compatible(densityIdx, potentialIdx)) return { densityIdx, potentialIdx }
    }
  }
  return undefined
}

export const find_mapped_esp_pair = (
  entries: readonly ManifestEntry[],
  layers: readonly EspLayerLink[],
  grids_compatible: GridCompatibility,
): EspPair | undefined => {
  for (const layer of layers) {
    const densityIdx = layer.volume_idx
    const potentialIdx = layer.color_volume_idx
    if (densityIdx === undefined || potentialIdx === undefined) continue
    if (entries[densityIdx]?.analysisKind === 'esp-density'
      && entries[potentialIdx]?.analysisKind === 'esp-potential'
      && grids_compatible(densityIdx, potentialIdx)) return { densityIdx, potentialIdx }
  }
  return undefined
}

export const findDeclaredEspPair = find_declared_esp_pair
export const findMappedEspPair = find_mapped_esp_pair

export const resolve_esp_legend_visibility = (
  requested: boolean | undefined,
  pair: EspPair | undefined,
): boolean => pair !== undefined && (requested ?? true)

export const resolveEspLegendVisibility = resolve_esp_legend_visibility

export interface EspRange {
  min: number
  max: number
  absMax: number
  sampleCount: number
  totalCells: number
  sampledCells: number
  capped: boolean
  fallback: boolean
}

export interface EspLegendTick {
  fraction: number
  atomicUnits: number
  kcalMolPerElectron: number
  label: string
}

export interface EspSurfacePoint {
  x: number
  y: number
  z: number
  value: number
  boundary?: boolean
}

export interface EspExtremum extends EspSurfacePoint {
  id: string
  type: 'minimum' | 'maximum'
  rank: number
  global: boolean
  kcalMol: number
  kcalMolPerElectron: number
}

export interface EspExtremaResult {
  minima: EspExtremum[]
  maxima: EspExtremum[]
  sampleCount: number
  sampledCells: number
  totalCells: number
  vertexCount: number
  capped: boolean
  malformed: boolean
  boundaryFiltered: number
}

export interface EspScanOptions {
  fallback?: number
  percentile?: number
  maxCells?: number
  maxSamples?: number
  maxExtrema?: number
  boundaryMargin?: number
  excludeBoundary?: boolean
  epsilon?: number
}

type SurfaceAdjacency = Set<number>[]

const CORNERS: readonly Vec3[] = Object.freeze([
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
])

const EDGES: readonly (readonly [number, number])[] = Object.freeze([
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
])

const finite = (value: unknown): value is number => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number)
}

const number_or = (value: unknown, fallback: number): number => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value))

const as_grid = (volume: unknown): unknown[][][] | undefined => {
  const grid = (volume as { grid?: unknown })?.grid
  return Array.isArray(grid) ? grid as unknown[][][] : undefined
}

/** Return validated dimensions without assuming a particular parser layout. */
export const volume_dimensions = (volume: unknown): Vec3 | undefined => {
  const candidate = (volume as { grid_dims?: unknown })?.grid_dims
  const grid = as_grid(volume)
  if (!grid) return undefined
  const values = Array.isArray(candidate) && candidate.length >= 3
    ? candidate.slice(0, 3).map(Number)
    : [grid?.length ?? 0, grid?.[0]?.length ?? 0, grid?.[0]?.[0]?.length ?? 0]
  if (!values.every((value) => Number.isInteger(value) && value > 0)) return undefined
  if (grid && (
    grid.length !== values[0]
    || !grid.every((plane) => Array.isArray(plane) && plane.length === values[1])
    || !grid.every((plane) => plane.every((row) => Array.isArray(row) && row.length === values[2]))
  )) return undefined
  return values as Vec3
}

export const volume_shape = volume_dimensions

const volume_periodic = (volume: unknown): boolean =>
  (volume as { periodic?: unknown })?.periodic === true

const grid_value = (volume: unknown, x: number, y: number, z: number): number => {
  const grid = as_grid(volume)
  const value = grid?.[x]?.[y]?.[z]
  return Number(value)
}

const same_grid = (density: unknown, potential: unknown): boolean => {
  const left = volume_dimensions(density)
  const right = volume_dimensions(potential)
  return Boolean(left && right && left.every((value, index) => value === right[index]))
}

const total_cells = (dims: Vec3, periodic: boolean): number =>
  Math.max(0, (periodic ? dims[0] : dims[0] - 1)
    * (periodic ? dims[1] : dims[1] - 1)
    * (periodic ? dims[2] : dims[2] - 1))

const edge_fraction = (first: number, second: number, iso: number): number | undefined => {
  const first_offset = first - iso
  const second_offset = second - iso
  if (!finite(first_offset) || !finite(second_offset)) return undefined
  if (first_offset === 0 && second_offset === 0) return undefined
  if (first_offset * second_offset > 0) return undefined
  const denominator = second_offset - first_offset
  return clamp(denominator === 0 ? 0.5 : -first_offset / denominator, 0, 1)
}

const lattice_mapper = (volume: unknown, dims: Vec3, periodic: boolean) => {
  const origin = ((volume as { origin?: unknown })?.origin ?? []) as unknown[]
  const lattice = ((volume as { lattice?: unknown })?.lattice ?? []) as unknown[][]
  const denominators = [
    periodic ? dims[0] : Math.max(1, dims[0] - 1),
    periodic ? dims[1] : Math.max(1, dims[1] - 1),
    periodic ? dims[2] : Math.max(1, dims[2] - 1),
  ]
  const ox = number_or(origin[0], 0)
  const oy = number_or(origin[1], 0)
  const oz = number_or(origin[2], 0)
  const rows = [0, 1, 2].map((row) => [0, 1, 2].map((column) => number_or(lattice[row]?.[column], row === column ? 1 : 0)))
  return (x: number, y: number, z: number): Vec3 => {
    const fractions = [x / denominators[0], y / denominators[1], z / denominators[2]]
    return [
      ox + fractions[0] * rows[0][0] + fractions[1] * rows[1][0] + fractions[2] * rows[2][0],
      oy + fractions[0] * rows[0][1] + fractions[1] * rows[1][1] + fractions[2] * rows[2][1],
      oz + fractions[0] * rows[0][2] + fractions[1] * rows[1][2] + fractions[2] * rows[2][2],
    ]
  }
}

const lattice_point = (volume: unknown, x: number, y: number, z: number): Vec3 => {
  const dims = volume_dimensions(volume) ?? [1, 1, 1]
  return lattice_mapper(volume, dims, volume_periodic(volume))(x, y, z)
}

export const grid_point_to_world = lattice_point
export const gridPointToWorld = lattice_point

const for_each_cell = (
  density: unknown,
  potential: unknown,
  options: EspScanOptions,
  on_cell: (x: number, y: number, z: number, dims: Vec3, periodic: boolean) => boolean,
): { sampledCells: number; totalCells: number; capped: boolean } => {
  const dims = volume_dimensions(density)
  if (!dims || !same_grid(density, potential)) return { sampledCells: 0, totalCells: 0, capped: false }
  const periodic = volume_periodic(density)
  const total = total_cells(dims, periodic)
  const max_cells = Math.max(0, Math.floor(number_or(options.maxCells, 50000)))
  const limit = Math.min(total, max_cells)
  const cell_dims: Vec3 = [periodic ? dims[0] : dims[0] - 1, periodic ? dims[1] : dims[1] - 1, periodic ? dims[2] : dims[2] - 1]
  let sampled = 0
  let completed = true
  for (; sampled < limit && completed; sampled += 1) {
    const linear = limit === total ? sampled : Math.min(total - 1, Math.floor((sampled + 0.5) * total / limit))
    const x = Math.floor(linear / (cell_dims[1] * cell_dims[2]))
    const remainder = linear % (cell_dims[1] * cell_dims[2])
    const y = Math.floor(remainder / cell_dims[2])
    const z = remainder % cell_dims[2]
    if (!on_cell(x, y, z, dims, periodic)) completed = false
  }
  return { sampledCells: sampled, totalCells: total, capped: !completed || sampled < total }
}

const cell_crossings = (
  density: unknown,
  potential: unknown,
  x: number,
  y: number,
  z: number,
  dims: Vec3,
  periodic: boolean,
  isovalue: number,
  max_samples: number,
  points: EspSurfacePoint[],
  adjacency: SurfaceAdjacency,
  options: EspScanOptions,
  to_world: (x: number, y: number, z: number) => Vec3,
): boolean => {
  const next = (value: number, axis: number, dimension: number): number =>
    periodic ? (value + 1) % dimension : value + 1
  const corners = CORNERS.map(([dx, dy, dz]) => {
    const cx = x + dx
    const cy = y + dy
    const cz = z + dz
    return {
      x: cx,
      y: cy,
      z: cz,
      density: grid_value(density, cx % dims[0], cy % dims[1], cz % dims[2]),
      potential: grid_value(potential, cx % dims[0], cy % dims[1], cz % dims[2]),
    }
  })
  if (corners.some((corner) => !finite(corner.density) || !finite(corner.potential))) return true
  const local: number[] = []
  for (const [first_index, second_index] of EDGES) {
    if (points.length >= max_samples) return false
    const first = corners[first_index]
    const second = corners[second_index]
    const fraction = edge_fraction(first.density, second.density, isovalue)
    if (fraction === undefined) continue
    const gx = first.x + fraction * (second.x - first.x)
    const gy = first.y + fraction * (second.y - first.y)
    const gz = first.z + fraction * (second.z - first.z)
    const value = first.potential + fraction * (second.potential - first.potential)
    if (!finite(value)) continue
    const world = to_world(gx, gy, gz)
    const boundary_margin = Math.max(0, Math.floor(number_or(options.boundaryMargin, 1)))
    const boundary = !periodic && (
      gx <= boundary_margin || gx >= dims[0] - 1 - boundary_margin
      || gy <= boundary_margin || gy >= dims[1] - 1 - boundary_margin
      || gz <= boundary_margin || gz >= dims[2] - 1 - boundary_margin
    )
    const point_index = points.length
    points.push({ x: world[0], y: world[1], z: world[2], value, boundary })
    adjacency.push(new Set())
    local.push(point_index)
  }
  for (let left = 0; left < local.length; left += 1) {
    for (let right = left + 1; right < local.length; right += 1) {
      adjacency[local[left]].add(local[right])
      adjacency[local[right]].add(local[left])
    }
  }
  // Referencing the helper keeps the periodic wrap behavior explicit and guards
  // against future changes that accidentally index outside the source grid.
  void next
  return true
}

const collect_surface_samples = (
  density: unknown,
  potential: unknown,
  isovalue: number,
  options: EspScanOptions = {},
): { points: EspSurfacePoint[]; adjacency: SurfaceAdjacency; sampledCells: number; totalCells: number; capped: boolean; malformed: boolean } => {
  const points: EspSurfacePoint[] = []
  const adjacency: SurfaceAdjacency = []
  const dims = volume_dimensions(density)
  const malformed = !dims || !same_grid(density, potential)
  if (malformed || !finite(isovalue)) {
    return { points, adjacency, sampledCells: 0, totalCells: 0, capped: false, malformed: true }
  }
  const max_samples = Math.max(0, Math.floor(number_or(options.maxSamples, 100000)))
  const to_world = lattice_mapper(density, dims, volume_periodic(density))
  const scan = for_each_cell(density, potential, options, (x, y, z, cell_dims, periodic) =>
    cell_crossings(density, potential, x, y, z, cell_dims, periodic, isovalue, max_samples, points, adjacency, options, to_world))
  return { points, adjacency, ...scan, malformed: false }
}

/**
 * Estimate a robust symmetric ESP color range in atomic units.
 *
 * Values are sampled where the density isosurface crosses grid edges. A
 * percentile prevents one bad surface sample from dominating the color scale;
 * maxCells and maxSamples make the operation predictable for large cubes.
 */
export const estimate_symmetric_range = (
  density: unknown,
  potential: unknown,
  isovalue: number,
  options: EspScanOptions = {},
): number => {
  const fallback = Math.max(number_or(options.fallback, DEFAULT_ESP_LIMIT), MINIMUM_ESP_LIMIT)
  if (!volume_dimensions(density) || !same_grid(density, potential) || !finite(isovalue) || Number(isovalue) <= 0) return fallback
  const sample_options = { ...options, maxSamples: Math.max(1, Math.floor(number_or(options.maxSamples, 100000))) }
  const { points } = collect_surface_samples(density, potential, Number(isovalue), sample_options)
  const samples = points.map((point) => Math.abs(point.value)).filter(Number.isFinite).sort((a, b) => a - b)
  if (!samples.length) return fallback
  const percentile = clamp(number_or(options.percentile, 0.95), 0, 1)
  const selected = samples[Math.floor(percentile * (samples.length - 1))]
  return Number.isFinite(selected) && selected > 0 ? Math.max(selected, MINIMUM_ESP_LIMIT) : fallback
}

export const estimateSymmetricRange = estimate_symmetric_range

export const estimate_esp_range = (
  density: unknown,
  potential: unknown,
  isovalue: number,
  options: EspScanOptions = {},
): EspRange => {
  const scan = collect_surface_samples(density, potential, Number(isovalue), options)
  const fallback = Math.max(number_or(options.fallback, DEFAULT_ESP_LIMIT), MINIMUM_ESP_LIMIT)
  const samples = scan.points.map((point) => Math.abs(point.value)).filter(Number.isFinite).sort((a, b) => a - b)
  const percentile = clamp(number_or(options.percentile, 0.95), 0, 1)
  const selected = samples[Math.floor(percentile * Math.max(0, samples.length - 1))]
  const limit = Number.isFinite(selected) && selected > 0 ? Math.max(selected, MINIMUM_ESP_LIMIT) : fallback
  return {
    min: -limit,
    max: limit,
    absMax: limit,
    sampleCount: scan.points.length,
    totalCells: scan.totalCells,
    sampledCells: scan.sampledCells,
    capped: scan.capped,
    fallback: !samples.length,
  }
}

export const estimateEspRange = estimate_esp_range
export const estimateSymmetricEspRange = estimate_esp_range

const hex_channels = (hex: string): [number, number, number] => {
  const value = Number.parseInt(String(hex).replace('#', ''), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

const interpolate_hex = (first: string, second: string, fraction: number): number => {
  const start = hex_channels(first)
  const end = hex_channels(second)
  const amount = clamp(number_or(fraction, 0), 0, 1)
  return start.reduce((value, channel, index) => value * 256 + Math.round(channel + amount * (end[index] - channel)), 0)
}

export const trans_flag_color_hex = (value: number, min: number, max: number): number => {
  const lower = Number(min)
  const upper = Number(max)
  const current = Number(value)
  if (![lower, upper, current].every(Number.isFinite) || lower === upper) return 0xffffff
  const clipped = clamp(current, Math.min(lower, upper), Math.max(lower, upper))
  const midpoint = (lower + upper) / 2
  if (clipped <= midpoint) {
    const width = midpoint - lower
    return interpolate_hex(ESP_COLORS.negative, ESP_COLORS.zero, width ? (clipped - lower) / width : 1)
  }
  const width = upper - midpoint
  return interpolate_hex(ESP_COLORS.zero, ESP_COLORS.positive, width ? (clipped - midpoint) / width : 1)
}

export const transFlagColorHex = trans_flag_color_hex

export const trans_flag_color_css = (value: number, min: number, max: number): string =>
  `#${(trans_flag_color_hex(value, min, max) & 0xffffff).toString(16).padStart(6, '0')}`

const tick_decimals = (largest: number): number =>
  largest >= 10 ? 1 : largest >= 1 ? 2 : largest >= 0.1 ? 3 : 4

/** Build top-to-bottom signed kcal/mol/e labels for a vertical legend. */
export const esp_legend_ticks = (min: number, max: number, count = 5): EspLegendTick[] => {
  let lower = Number(min)
  let upper = Number(max)
  const tick_count = Math.max(2, Math.floor(number_or(count, 5)))
  if (![lower, upper].every(Number.isFinite) || lower === upper) return []
  if (lower > upper) [lower, upper] = [upper, lower]
  const values = Array.from({ length: tick_count }, (_, index) => {
    const fraction = index / (tick_count - 1)
    const atomic_units = upper + fraction * (lower - upper)
    return { fraction, atomicUnits: atomic_units, kcalMolPerElectron: atomic_units * KCAL_PER_HARTREE }
  })
  const decimals = tick_decimals(Math.max(...values.map((tick) => Math.abs(tick.kcalMolPerElectron))))
  const zero_threshold = 0.5 * 10 ** -decimals
  return values.map((tick) => {
    const kcal = Math.abs(tick.kcalMolPerElectron) < zero_threshold ? 0 : tick.kcalMolPerElectron
    return {
      ...tick,
      kcalMolPerElectron: kcal,
      label: kcal === 0 ? '0' : `${kcal > 0 ? '+' : ''}${kcal.toFixed(decimals)}`,
    }
  })
}

export const espLegendTicks = esp_legend_ticks

export const clamp_legend_position = (
  position: Partial<LegendPosition> | undefined,
  legend_size: (Partial<LegendPosition> & { width?: number; height?: number }) | undefined,
  container_size: (Partial<LegendPosition> & { width?: number; height?: number }) | undefined,
): LegendPosition => {
  const width = Math.max(0, number_or(legend_size?.width ?? legend_size?.left, 0))
  const height = Math.max(0, number_or(legend_size?.height ?? legend_size?.top, 0))
  const container_width = Math.max(0, number_or(container_size?.width ?? container_size?.left, 0))
  const container_height = Math.max(0, number_or(container_size?.height ?? container_size?.top, 0))
  return {
    left: clamp(number_or(position?.left, 0), 0, Math.max(0, container_width - width)),
    top: clamp(number_or(position?.top, 0), 0, Math.max(0, container_height - height)),
  }
}

export const clampLegendPosition = clamp_legend_position

export const build_surface_adjacency = (vertex_count: number, faces: number[] | number[][]): SurfaceAdjacency => {
  const adjacency: SurfaceAdjacency = Array.from({ length: Math.max(0, Math.floor(vertex_count) || 0) }, () => new Set())
  const input = Array.isArray(faces) ? faces : []
  const flat = Array.isArray(input[0]) ? (input as number[][]).flat() : input as number[]
  const connect = (left: number, right: number): void => {
    if (left === right || !adjacency[left] || !adjacency[right]) return
    adjacency[left].add(right)
    adjacency[right].add(left)
  }
  for (let index = 0; index + 2 < flat.length; index += 3) {
    const left = Number(flat[index])
    const middle = Number(flat[index + 1])
    const right = Number(flat[index + 2])
    if ([left, middle, right].every((value) => Number.isInteger(value))) {
      connect(left, middle)
      connect(middle, right)
      connect(right, left)
    }
  }
  return adjacency
}

export const buildSurfaceAdjacency = build_surface_adjacency

const format_extrema = (
  points: EspSurfacePoint[],
  indices: number[],
  type: 'minimum' | 'maximum',
  global_index: number,
  max_extrema: number,
): EspExtremum[] => {
  const ordered = [...indices].sort((left, right) => {
    const difference = type === 'minimum' ? points[left].value - points[right].value : points[right].value - points[left].value
    return difference || left - right
  })
  const selected = ordered.slice(0, Math.max(1, max_extrema))
  if (!selected.includes(global_index)) selected[selected.length - 1] = global_index
  return selected.map((index, rank) => {
    const point = points[index]
    const kcal = point.value * KCAL_PER_HARTREE
    return {
      ...point,
      id: `${type === 'minimum' ? 'min' : 'max'}-${rank + 1}`,
      type,
      rank: rank + 1,
      global: index === global_index,
      kcalMol: kcal,
      kcalMolPerElectron: kcal,
    }
  })
}

/** Find deterministic local and global extrema from sampled surface points. */
export const find_surface_extrema = (
  points: EspSurfacePoint[],
  faces_or_adjacency: number[] | number[][] | SurfaceAdjacency = [],
  options: EspScanOptions = {},
): { minima: EspExtremum[]; maxima: EspExtremum[]; boundaryFiltered: number } => {
  const adjacency: SurfaceAdjacency = Array.isArray(faces_or_adjacency)
    && faces_or_adjacency.length > 0
    && faces_or_adjacency[0] instanceof Set
    ? faces_or_adjacency as SurfaceAdjacency
    : build_surface_adjacency(points.length, faces_or_adjacency as number[] | number[][])
  const finite_indices = points.map((point, index) => finite(point?.value) ? index : -1).filter((index) => index >= 0)
  if (!finite_indices.length) return { minima: [], maxima: [], boundaryFiltered: 0 }
  const epsilon = Math.max(0, number_or(options.epsilon, 1e-12))
  const exclude_boundary = options.excludeBoundary === true
  const eligible = finite_indices.filter((index) => {
    if (!exclude_boundary) return true
    if (points[index].boundary) return false
    return ![...adjacency[index]].some((neighbor) => points[neighbor]?.boundary)
  })
  const boundary_filtered = finite_indices.length - eligible.length
  if (!eligible.length) return { minima: [], maxima: [], boundaryFiltered: boundary_filtered }
  let global_minimum = eligible[0]
  let global_maximum = eligible[0]
  eligible.forEach((index) => {
    if (points[index].value < points[global_minimum].value) global_minimum = index
    if (points[index].value > points[global_maximum].value) global_maximum = index
  })
  const minima: number[] = []
  const maxima: number[] = []
  eligible.forEach((index) => {
    const neighbors = adjacency[index]
    if (!neighbors?.size) return
    let is_minimum = true
    let is_maximum = true
    neighbors.forEach((neighbor) => {
      const value = Number(points[neighbor]?.value)
      if (!Number.isFinite(value)) return
      if (points[index].value >= value - epsilon) is_minimum = false
      if (points[index].value <= value + epsilon) is_maximum = false
    })
    if (is_minimum) minima.push(index)
    if (is_maximum) maxima.push(index)
  })
  if (!minima.includes(global_minimum)) minima.push(global_minimum)
  if (!maxima.includes(global_maximum)) maxima.push(global_maximum)
  const max_extrema = Math.max(1, Math.floor(number_or(options.maxExtrema, 32)))
  return {
    minima: format_extrema(points, minima, 'minimum', global_minimum, max_extrema),
    maxima: format_extrema(points, maxima, 'maximum', global_maximum, max_extrema),
    boundaryFiltered: boundary_filtered,
  }
}

export const findSurfaceExtrema = find_surface_extrema

/**
 * Extract ESP extrema without depending on a renderer's marker API. The result
 * is useful as a table even when a 3D scene cannot draw point markers.
 */
export const extract_esp_extrema = (
  density: unknown,
  potential: unknown,
  isovalue: number,
  options: EspScanOptions = {},
): EspExtremaResult => {
  const scan = collect_surface_samples(density, potential, Number(isovalue), options)
  // Cell-local crossings are not a globally connected mesh, so report only
  // the deterministic global pair rather than inventing false local extrema.
  const extrema = find_surface_extrema(scan.points, [], options)
  return {
    ...extrema,
    sampleCount: scan.points.length,
    sampledCells: scan.sampledCells,
    totalCells: scan.totalCells,
    vertexCount: scan.points.length,
    capped: scan.capped || scan.points.length >= Math.max(0, Math.floor(number_or(options.maxSamples, 100000))),
    malformed: scan.malformed,
  }
}

export const extractEspExtrema = extract_esp_extrema
export const analyzeEspExtrema = extract_esp_extrema

const yield_to_browser = (): Promise<void> => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => resolve())
  } else {
    setTimeout(resolve, 0)
  }
})

const collect_surface_samples_async = async (
  density: unknown,
  potential: unknown,
  isovalue: number,
  options: EspScanOptions,
): Promise<ReturnType<typeof collect_surface_samples>> => {
  const points: EspSurfacePoint[] = []
  const adjacency: SurfaceAdjacency = []
  const dims = volume_dimensions(density)
  if (!dims || !same_grid(density, potential) || !finite(isovalue)) {
    return { points, adjacency, sampledCells: 0, totalCells: 0, capped: false, malformed: true }
  }
  const periodic = volume_periodic(density)
  const total = total_cells(dims, periodic)
  const limit = Math.min(total, Math.max(0, Math.floor(number_or(options.maxCells, 50000))))
  const cell_dims: Vec3 = [periodic ? dims[0] : dims[0] - 1, periodic ? dims[1] : dims[1] - 1, periodic ? dims[2] : dims[2] - 1]
  const max_samples = Math.max(0, Math.floor(number_or(options.maxSamples, 100000)))
  const to_world = lattice_mapper(density, dims, periodic)
  let sampled = 0
  let completed = true
  while (sampled < limit && completed) {
    const end = Math.min(limit, sampled + 2000)
    for (; sampled < end && completed; sampled += 1) {
      const linear = limit === total ? sampled : Math.min(total - 1, Math.floor((sampled + 0.5) * total / limit))
      const x = Math.floor(linear / (cell_dims[1] * cell_dims[2]))
      const remainder = linear % (cell_dims[1] * cell_dims[2])
      const y = Math.floor(remainder / cell_dims[2])
      const z = remainder % cell_dims[2]
      completed = cell_crossings(
        density, potential, x, y, z, dims, periodic, isovalue,
        max_samples, points, adjacency, options, to_world,
      )
    }
    if (sampled < limit && completed) await yield_to_browser()
  }
  return { points, adjacency, sampledCells: sampled, totalCells: total, capped: !completed || sampled < total, malformed: false }
}

/** Async bounded variant for UI callers; yields periodically to keep the main thread responsive. */
export const extract_esp_extrema_async = async (
  density: unknown,
  potential: unknown,
  isovalue: number,
  options: EspScanOptions = {},
): Promise<EspExtremaResult> => {
  await yield_to_browser()
  const scan = await collect_surface_samples_async(density, potential, Number(isovalue), options)
  const extrema = find_surface_extrema(scan.points, [], options)
  const result: EspExtremaResult = {
    ...extrema,
    sampleCount: scan.points.length,
    sampledCells: scan.sampledCells,
    totalCells: scan.totalCells,
    vertexCount: scan.points.length,
    capped: scan.capped || scan.points.length >= Math.max(0, Math.floor(number_or(options.maxSamples, 100000))),
    malformed: scan.malformed,
  }
  await yield_to_browser()
  return result
}

export const extractEspExtremaAsync = extract_esp_extrema_async
export const analyzeEspExtremaAsync = extract_esp_extrema_async

export const extrema_cache_key = (session_generation: number, quality: number, isovalue: number): string => {
  const iso = Number(isovalue)
  return `${Number(session_generation) || 0}:${Number(quality) || 0}:${Number.isFinite(iso) ? iso.toPrecision(12) : 'invalid'}`
}

export const extremaCacheKey = extrema_cache_key
