/**
 * Surface/color volume compatibility for cross-volume coloring.
 *
 * MatterViz colors isosurface vertices by sampling the color volume at their
 * Cartesian positions, so two volumes need not share grid dimensions. This
 * module decides when a pair is *meant* to share a frame: identical grids are
 * `exact`; finite grids with the same origin, parallel axes and coverage that
 * differs only by grid-count rounding are `resampled`. Anything else (shifted,
 * rotated, singular, periodic-mismatched or unrelated boxes) is rejected.
 *
 * Only plain objects are inspected here so the module stays renderer-free and
 * testable in Node; the Cartesian sampler mirrors MatterViz's
 * `create_volume_sampler(volume, { out_of_bounds: 'fallback' })`.
 */

export type Vec3 = [number, number, number]
type Lattice = [Vec3, Vec3, Vec3]

export type ColorGridCompatibility =
  | { ok: true; mode: 'exact' }
  | { ok: true; mode: 'resampled'; shortfall: Vec3 }
  | { ok: false; reason: string }

/** Matches MatterViz `compare_volume_grids` (Å, per voxel vector). */
export const EXACT_GRID_TOLERANCE = 1e-4
/** Maximum origin offset (Å) for independently sampled grids of one job. */
export const ORIGIN_TOLERANCE = 1e-3
/** Minimum cosine between corresponding lattice axes. */
export const AXIS_COSINE_TOLERANCE = 1e-6
/** Fractional overshoot accepted at finite boundaries (MatterViz OOB_TOL). */
const BOUNDARY_TOLERANCE = 1e-6

interface GridLike {
  dims: Vec3
  origin: Vec3
  lattice: Lattice
  periodic: boolean
}

const finite_vec3 = (value: unknown): Vec3 | undefined => {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return undefined
  const numbers = Array.from(value as ArrayLike<unknown>).slice(0, 3).map(Number)
  return numbers.length === 3 && numbers.every(Number.isFinite) ? numbers as Vec3 : undefined
}

const grid_like = (volume: unknown): GridLike | undefined => {
  const record = volume as { grid_dims?: unknown; origin?: unknown; lattice?: unknown; periodic?: unknown } | undefined
  if (!record || typeof record.periodic !== 'boolean') return undefined
  const dims = finite_vec3(record.grid_dims)
  const origin = finite_vec3(record.origin)
  const rows = Array.isArray(record.lattice) && record.lattice.length >= 3
    ? record.lattice.slice(0, 3).map(finite_vec3) : []
  if (!dims || !dims.every((n) => Number.isInteger(n) && n > 0) || !origin || rows.length !== 3 || rows.some((row) => !row)) return undefined
  return { dims, origin, lattice: rows as Lattice, periodic: record.periodic }
}

const length = (vector: Vec3): number => Math.hypot(vector[0], vector[1], vector[2])
const dot = (left: Vec3, right: Vec3): number => left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
const determinant = ([a, b, c]: Lattice): number =>
  a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])

const singular = (lattice: Lattice): boolean => {
  const scale = lattice.reduce((product, row) => product * length(row), 1)
  return !(scale > 0) || Math.abs(determinant(lattice)) <= 1e-9 * scale
}

const divisor = (grid: GridLike, axis: number): number =>
  Math.max(grid.periodic ? grid.dims[axis] : grid.dims[axis] - 1, 1)

const format = (value: number): string => String(Number(value.toPrecision(4)))

/** Same acceptance as MatterViz `compare_volume_grids`. */
const exact_match = (surface: GridLike, color: GridLike): boolean =>
  surface.dims.every((n, axis) => n === color.dims[axis])
  && surface.periodic === color.periodic
  && surface.origin.every((value, axis) => Math.abs(value - color.origin[axis]) <= EXACT_GRID_TOLERANCE)
  && surface.lattice.every((row, axis) => row.every((value, component) =>
    Math.abs(value - color.lattice[axis][component]) / divisor(surface, axis) <= EXACT_GRID_TOLERANCE))

export const color_grid_compatibility = (surface: unknown, color: unknown): ColorGridCompatibility => {
  const left = grid_like(surface)
  const right = grid_like(color)
  if (!left || !right) return { ok: false, reason: 'grid metadata is incomplete' }
  if (singular(left.lattice) || singular(right.lattice)) return { ok: false, reason: 'grid axes are singular' }
  if (exact_match(left, right)) return { ok: true, mode: 'exact' }
  if (left.periodic !== right.periodic) return { ok: false, reason: 'boundary modes differ' }
  if (left.periodic) return { ok: false, reason: 'periodic grids must match exactly' }
  const offset = Math.max(...left.origin.map((value, axis) => Math.abs(value - right.origin[axis])))
  if (offset > ORIGIN_TOLERANCE) return { ok: false, reason: `origins differ by ${format(offset)} Å` }
  const shortfall: Vec3 = [0, 0, 0]
  for (let axis = 0; axis < 3; axis += 1) {
    const surface_length = length(left.lattice[axis])
    const color_length = length(right.lattice[axis])
    if (dot(left.lattice[axis], right.lattice[axis]) < (1 - AXIS_COSINE_TOLERANCE) * surface_length * color_length) {
      return { ok: false, reason: `axis ${axis + 1} directions differ` }
    }
    // Independently rounded grid counts move the far boundary by less than one
    // voxel of the coarser grid; anything larger is a different region.
    const coarse = Math.max(surface_length / divisor(left, axis), color_length / divisor(right, axis))
    const missing = Math.max(0, surface_length - color_length)
    if (missing > coarse + ORIGIN_TOLERANCE) {
      return { ok: false, reason: `color grid covers ${format(color_length)} of ${format(surface_length)} Å along axis ${axis + 1}` }
    }
    shortfall[axis] = missing
  }
  return { ok: true, mode: 'resampled', shortfall }
}

const invert = ([a, b, c]: Lattice): Lattice | undefined => {
  // Cartesian = origin + fa*a + fb*b + fc*c, i.e. p = M^T f with rows a, b, c.
  const det = determinant([a, b, c])
  if (!Number.isFinite(det) || det === 0) return undefined
  // inverse(M^T) rows give fractional coordinates.
  return [
    [(b[1] * c[2] - b[2] * c[1]) / det, (b[2] * c[0] - b[0] * c[2]) / det, (b[0] * c[1] - b[1] * c[0]) / det],
    [(a[2] * c[1] - a[1] * c[2]) / det, (a[0] * c[2] - a[2] * c[0]) / det, (a[1] * c[0] - a[0] * c[1]) / det],
    [(a[1] * b[2] - a[2] * b[1]) / det, (a[2] * b[0] - a[0] * b[2]) / det, (a[0] * b[1] - a[1] * b[0]) / det],
  ]
}

/**
 * Trilinear sampler at absolute Cartesian positions for a finite nested-array
 * grid. Positions outside the box (beyond rounding tolerance) return NaN.
 */
const grid_reader = (grid: unknown, dims: Vec3): ((x: number, y: number, z: number) => number) | undefined => {
  if (Array.isArray(grid)) {
    const values = grid as ArrayLike<ArrayLike<number>>[]
    return (x, y, z) => Number(values[x]?.[y]?.[z])
  }
  // MatterViz typed scalar grid: { data, dimensions, order }.
  const typed = grid as { data?: ArrayLike<number>; dimensions?: unknown; order?: unknown } | undefined
  const shape = finite_vec3(typed?.dimensions)
  if (!typed?.data || !shape || !shape.every((n, axis) => n === dims[axis])) return undefined
  const [nx, ny, nz] = dims
  const data = typed.data
  return typed.order === 'x-fastest'
    ? (x, y, z) => Number(data[x + nx * (y + ny * z)])
    : (x, y, z) => Number(data[z + nz * (y + ny * x)])
}

export const create_cartesian_sampler = (volume: unknown): ((position: Vec3) => number) | undefined => {
  const meta = grid_like(volume)
  if (!meta || meta.periodic || meta.dims.some((n) => n < 2)) return undefined
  const at = grid_reader((volume as { grid?: unknown })?.grid, meta.dims)
  const inverse = invert(meta.lattice)
  if (!at || !inverse) return undefined
  const [nx, ny, nz] = meta.dims
  const [ox, oy, oz] = meta.origin
  return (position) => {
    const cx = position[0] - ox
    const cy = position[1] - oy
    const cz = position[2] - oz
    let fx = inverse[0][0] * cx + inverse[0][1] * cy + inverse[0][2] * cz
    let fy = inverse[1][0] * cx + inverse[1][1] * cy + inverse[1][2] * cz
    let fz = inverse[2][0] * cx + inverse[2][1] * cy + inverse[2][2] * cz
    if (fx < -BOUNDARY_TOLERANCE || fx > 1 + BOUNDARY_TOLERANCE
      || fy < -BOUNDARY_TOLERANCE || fy > 1 + BOUNDARY_TOLERANCE
      || fz < -BOUNDARY_TOLERANCE || fz > 1 + BOUNDARY_TOLERANCE) return Number.NaN
    fx = Math.min(1, Math.max(0, fx)) * (nx - 1)
    fy = Math.min(1, Math.max(0, fy)) * (ny - 1)
    fz = Math.min(1, Math.max(0, fz)) * (nz - 1)
    const x0 = Math.max(0, Math.min(Math.floor(fx), nx - 2))
    const y0 = Math.max(0, Math.min(Math.floor(fy), ny - 2))
    const z0 = Math.max(0, Math.min(Math.floor(fz), nz - 2))
    const x1 = Math.min(x0 + 1, nx - 1)
    const y1 = Math.min(y0 + 1, ny - 1)
    const z1 = Math.min(z0 + 1, nz - 1)
    const xd = fx - x0
    const yd = fy - y0
    const zd = fz - z0
    const c00 = at(x0, y0, z0) + (at(x1, y0, z0) - at(x0, y0, z0)) * xd
    const c01 = at(x0, y0, z1) + (at(x1, y0, z1) - at(x0, y0, z1)) * xd
    const c10 = at(x0, y1, z0) + (at(x1, y1, z0) - at(x0, y1, z0)) * xd
    const c11 = at(x0, y1, z1) + (at(x1, y1, z1) - at(x0, y1, z1)) * xd
    const c0 = c00 + (c10 - c00) * yd
    const c1 = c01 + (c11 - c01) * yd
    return c0 + (c1 - c0) * zd
  }
}
