import type { AnyStructure, Site, StructureBond } from 'matterviz/structure'
import { Box3, Matrix3, Plane, Vector3 } from 'three'
import { valid_cell, valid_range, type Cell, type Rep, type RepPeriodic, type Vec } from './reps.ts'

export const MAX_REP_COPIES = 512
export const MAX_REP_ATOMS = 100_000
const EPSILON = 1e-8
export const translate_cell = (cell: Cell, abc: Vec): Vec => [0, 1, 2].map((axis) => abc.reduce((sum, n, i) => sum + n * cell[i][axis], 0)) as Vec
const inverse = (cell: Cell): Matrix3 => new Matrix3().set(
  cell[0][0], cell[1][0], cell[2][0], cell[0][1], cell[1][1], cell[2][1], cell[0][2], cell[1][2], cell[2][2],
).invert()

export const fractional_position = (cell: Cell, position: Vec, origin: Vec = [0, 0, 0]): Vec =>
  new Vector3(...position).sub(new Vector3(...origin)).applyMatrix3(inverse(cell)).toArray() as Vec

/** Six half spaces remain correct for skew and left-handed cells. */
export const rep_clip_planes = (periodic: RepPeriodic, cell?: Cell, origin: Vec = [0, 0, 0]): Plane[] => {
  if (!periodic.enabled) return []
  if (!valid_cell(cell)) throw new Error('Set valid lattice vectors before enabling periodic display')
  if (!valid_range(periodic.range)) throw new Error('Each periodic lower bound must be below its upper bound')
  const inv = inverse(cell).elements
  return periodic.axes.flatMap((enabled, axis) => {
    if (!enabled) return []
    const normal = new Vector3(inv[axis], inv[axis + 3], inv[axis + 6])
    const offset = normal.dot(new Vector3(...origin))
    return [new Plane(normal.clone(), -periodic.range[axis][0] - offset).normalize(),
      new Plane(normal.clone().negate(), periodic.range[axis][1] + offset).normalize()]
  })
}

export const rep_translations = (periodic: RepPeriodic, cell?: Cell): Vec[] => {
  if (!periodic.enabled) return [[0, 0, 0]]
  if (!valid_cell(cell) || !valid_range(periodic.range)) throw new Error('Invalid periodic cell or range')
  const bounds = periodic.range.map(([lo, hi], axis) => periodic.axes[axis] ? [Math.floor(lo), Math.ceil(hi)] : [0, 1])
  const count = bounds.reduce((n, [lo, hi]) => n * (hi - lo), 1)
  if (count > MAX_REP_COPIES) throw new Error(`Periodic display exceeds ${MAX_REP_COPIES} cells; reduce the range`)
  const copies: Vec[] = []
  for (let a = bounds[0][0]; a < bounds[0][1]; a++) for (let b = bounds[1][0]; b < bounds[1][1]; b++) for (let c = bounds[2][0]; c < bounds[2][1]; c++) copies.push(translate_cell(cell, [a, b, c]))
  return copies
}

/** Small explicit selection language, with 1-based indices matching Multiwfn. */
export const select_rep_sites = (structure: AnyStructure, expression: string): number[] => {
  const text = expression.trim()
  if (!text || text.toLowerCase() === 'all') return structure.sites.map((_, index) => index)
  const element = /^element\s+([A-Za-z\s,]+)$/i.exec(text)
  if (element) {
    const elements = new Set(element[1].split(/[\s,]+/).filter(Boolean).map((item) => item.toLowerCase()))
    return structure.sites.flatMap((site, index) => site.species.some((species) => elements.has(species.element.toLowerCase())) ? [index] : [])
  }
  const indices = /^index\s+([\d\s,\-]+)$/i.exec(text)
  if (indices) {
    const selected = new Set<number>()
    for (const token of indices[1].split(/[\s,]+/).filter(Boolean)) {
      const match = /^(\d+)(?:-(\d+))?$/.exec(token)
      if (!match) throw new Error('Use atom indices such as index 1-6, 9')
      const first = Number(match[1]), last = Number(match[2] ?? match[1])
      if (first < 1 || last < first || last > structure.sites.length) throw new Error('Atom selection is outside the source structure')
      for (let index = first; index <= last; index++) selected.add(index - 1)
    }
    return [...selected].sort((a, b) => a - b)
  }
  throw new Error('Use all, element C O, or index 1-6, 9')
}

export type RepStructure = { structure: AnyStructure; sourceIndices: number[]; shifts: Vec[] }

/** Expand positions, never mutate the source. The renderer computes finite bonds
 * between these explicit atoms rather than adding a second implicit PBC layer. */
export const rep_structure = (source: AnyStructure, rep: Rep, fallbackCell?: Cell): RepStructure => {
  const indices = select_rep_sites(source, rep.structure.selection)
  const cell = rep.periodic.cell ?? fallbackCell
  const periodic = rep.periodic.enabled
  if (periodic && (!valid_cell(cell) || !valid_range(rep.periodic.range))) throw new Error('Set valid lattice vectors and periodic ranges')
  const sites: Site[] = [], sourceIndices: number[] = [], shifts: Vec[] = []
  const siteMap = new Map<string, number>()
  // Include centers just outside a cut so spheres and bonds end at the plane.
  const inv = periodic ? inverse(cell!) : undefined
  const margin = [0, 1, 2].map((axis) => inv && rep.periodic.boundary === 'clip' ? Math.hypot(inv.elements[axis], inv.elements[axis + 3], inv.elements[axis + 6]) * (3 * rep.structure.radius + 2) : 0)
  for (const index of indices) {
    const site = source.sites[index]
    const frac = periodic ? fractional_position(cell!, site.xyz) : [0, 0, 0]
    const bounds = rep.periodic.range.map(([lo, hi], axis) => periodic && rep.periodic.axes[axis]
      ? [Math.ceil(lo - frac[axis] - margin[axis] - EPSILON), Math.floor(hi - frac[axis] + margin[axis] + (rep.periodic.boundary === 'none' ? -EPSILON : EPSILON))] : [0, 0])
    const count = bounds.reduce((n, [lo, hi]) => n * Math.max(0, hi - lo + 1), 1)
    if (sites.length + count > MAX_REP_ATOMS) throw new Error(`Periodic display exceeds ${MAX_REP_ATOMS} atoms; reduce the range`)
    for (let a = bounds[0][0]; a <= bounds[0][1]; a++) for (let b = bounds[1][0]; b <= bounds[1][1]; b++) for (let c = bounds[2][0]; c <= bounds[2][1]; c++) {
      const shift: Vec = [a, b, c], translation = periodic ? translate_cell(cell!, shift) : [0, 0, 0]
      const xyz = site.xyz.map((n, axis) => n + translation[axis]) as Vec
      siteMap.set(`${index}:${shift.join(',')}`, sites.length)
      sites.push({ ...site, xyz, abc: periodic ? fractional_position(cell!, xyz) : site.abc,
        properties: { ...site.properties, orig_unit_cell_idx: index, rep_source_index: index, rep_cell_shift: shift } })
      sourceIndices.push(index); shifts.push(shift)
    }
  }
  const bonds: StructureBond[] = []
  for (const [idx, original] of sourceIndices.entries()) {
    for (const bond of source.properties?.bonds ?? []) {
      if (bond.site_idx_1 !== original) continue
      const targetShift = shifts[idx].map((n, axis) => n + (periodic ? bond.cell_shift?.[axis] ?? 0 : 0)) as Vec
      const target = siteMap.get(`${bond.site_idx_2}:${targetShift.join(',')}`)
      if (target !== undefined) bonds.push({ ...bond, site_idx_1: idx, site_idx_2: target, cell_shift: [0, 0, 0] })
    }
  }
  const structure = { ...source, sites, ...(source.properties?.bonds ? { properties: { ...source.properties, bonds } } : {}) }
  // An explicit finite display is nonperiodic for bond detection. Its cell outline
  // is drawn separately so it is never mistaken for the scientific source cell.
  if ('lattice' in structure) structure.lattice = { ...structure.lattice, pbc: [false, false, false] }
  return { structure, sourceIndices, shifts }
}


/** Bounds of the visible convex region, including intersections between skew cuts. */
export const clipped_rep_bounds = (bounds: Box3, cuts: Plane[]): Box3 => {
  if (bounds.isEmpty() || !cuts.length) return bounds.clone()
  const planes = [...cuts, ...[0, 1, 2].flatMap((axis) => {
    const normal = new Vector3().setComponent(axis, 1)
    return [new Plane(normal, -bounds.min.getComponent(axis)),
      new Plane(normal.clone().negate(), bounds.max.getComponent(axis))]
  })]
  const result = new Box3()
  for (let a = 0; a < planes.length; a++) for (let b = a + 1; b < planes.length; b++) for (let c = b + 1; c < planes.length; c++) {
    const [p, q, r] = [planes[a], planes[b], planes[c]]
    const matrix = new Matrix3().set(...p.normal.toArray(), ...q.normal.toArray(), ...r.normal.toArray())
    if (Math.abs(matrix.determinant()) < 1e-10) continue
    const point = new Vector3(-p.constant, -q.constant, -r.constant).applyMatrix3(matrix.invert())
    if (planes.every((plane) => plane.distanceToPoint(point) >= -1e-7)) result.expandByPoint(point)
  }
  return result
}


export type RepBondEdits = { added: StructureBond[]; removed: StructureBond[]; overrides: StructureBond[] }

/** Native edit records use source indices. Expand each record into the same
 * finite display as the atoms, including independently translated Reps. */
export const rep_bonds = (display: RepStructure, bonds: StructureBond[], periodic: boolean): StructureBond[] => {
  const lookup = new Map(display.sourceIndices.map((index, n) => [`${index}:${display.shifts[n].join(',')}`, n]))
  const bySource = new Map<number, StructureBond[]>()
  for (const bond of bonds) bySource.set(bond.site_idx_1, [...(bySource.get(bond.site_idx_1) ?? []), bond])
  return display.sourceIndices.flatMap((sourceIndex, index) => (bySource.get(sourceIndex) ?? []).flatMap((bond) => {
    const shift = display.shifts[index].map((n, axis) => n + (periodic ? bond.cell_shift?.[axis] ?? 0 : 0))
    const target = lookup.get(`${bond.site_idx_2}:${shift.join(',')}`)
    return target === undefined ? [] : [{ ...bond, site_idx_1: index, site_idx_2: target, cell_shift: [0, 0, 0] as Vec }]
  }))
}
