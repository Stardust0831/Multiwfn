import {
  EPS,
  calc_lattice_params,
  create_cart_to_frac,
  det_3x3,
  type Matrix3x3,
  type Vec3,
} from 'matterviz/math'
import type { AnyStructure, LatticeType } from 'matterviz/structure'
import type { MultiwfnManifest } from './manifest'

export type FractionalRange = readonly [number, number]
export type FractionalRanges = readonly [FractionalRange, FractionalRange, FractionalRange]

export const PERIODIC_RANGE_LIMIT = 20

export const clamp_periodic_bound = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(-PERIODIC_RANGE_LIMIT, Math.min(PERIODIC_RANGE_LIMIT, parsed))
}

export type ManifestLatticeOptions = {
  /** Replace an existing structure lattice when set to true. */
  override?: boolean
}

const is_finite_vec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value)
  && value.length === 3
  && value.every((component) => typeof component === 'number' && Number.isFinite(component))

const manifest_cell_matrix = (manifest: MultiwfnManifest): Matrix3x3 | undefined => {
  if (manifest?.periodic?.enabled !== true) return undefined
  const cell = manifest.periodic.cell
  if (!cell || !is_finite_vec3(cell.a) || !is_finite_vec3(cell.b) || !is_finite_vec3(cell.c)) {
    return undefined
  }
  const matrix: Matrix3x3 = [
    [...cell.a],
    [...cell.b],
    [...cell.c],
  ]
  const determinant = det_3x3(matrix)
  return Number.isFinite(determinant) && Math.abs(determinant) > EPS ? matrix : undefined
}

const has_lattice = (structure: AnyStructure): boolean =>
  'lattice' in structure && structure.lattice !== undefined

/**
 * Apply a valid periodic cell from a Multiwfn manifest to a MatterViz structure.
 *
 * Cartesian site positions are retained, while fractional `abc` coordinates and
 * all lattice parameters are derived from the manifest's row vectors. Invalid or
 * singular cells leave the input object untouched. Existing lattices are also
 * left untouched unless `{ override: true }` is supplied.
 */
export const inject_manifest_lattice = (
  structure: AnyStructure,
  manifest: MultiwfnManifest,
  options: ManifestLatticeOptions = {},
): AnyStructure => {
  if (!structure || (has_lattice(structure) && options.override !== true)) return structure
  const matrix = manifest_cell_matrix(manifest)
  if (!matrix) return structure

  let cart_to_frac: (cart: Vec3) => Vec3
  let lattice_params: ReturnType<typeof calc_lattice_params>
  try {
    cart_to_frac = create_cart_to_frac(matrix)
    lattice_params = calc_lattice_params(matrix)
  } catch {
    return structure
  }
  if (Object.values(lattice_params).some((value) => !Number.isFinite(value))) return structure

  const sites = []
  for (const site of structure.sites) {
    if (!is_finite_vec3(site.xyz)) return structure
    const abc = cart_to_frac(site.xyz)
    if (!is_finite_vec3(abc)) return structure
    sites.push({ ...site, xyz: [...site.xyz] as Vec3, abc })
  }

  const lattice: LatticeType = {
    matrix,
    pbc: [true, true, true],
    ...lattice_params,
  }
  return { ...structure, sites, lattice }
}

const axis_supercell_size = (range: readonly [number, number]): number => {
  if (!Array.isArray(range) || range.length !== 2) return 1
  const [first, second] = range
  if (!Number.isFinite(first) || !Number.isFinite(second)) return 1
  const lower = Math.min(first, second)
  const upper = Math.max(first, second)
  return Math.max(1, Math.ceil(upper) - Math.floor(lower))
}

/**
 * Convert fractional display ranges into MatterViz's integer atom-supercell
 * input. This returns only the integer span count; it does not preserve a
 * shifted or negative range origin and therefore must not be used to align
 * atoms automatically with an independently positioned surface range.
 */
export const supercell_scaling_for_ranges = (ranges?: FractionalRanges): string => {
  const scaling = ranges?.map(axis_supercell_size) ?? [1, 1, 1]
  return `${scaling[0]}x${scaling[1]}x${scaling[2]}`
}
