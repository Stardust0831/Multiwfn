import { Matrix3, Vector3 } from 'three'
import { create_lattice_converters, min_image_displacement, type Matrix3x3 } from 'matterviz/math'
import type { PlotDataset } from './plot'

export const BOHR_TO_ANGSTROM = 0.529177210903
export const CP_NAMES = ['Unknown', '(3,-3)', '(3,-1)', '(3,+1)', '(3,+3)']
export const CP_COLORS = ['#777777', '#b800b8', '#ff8000', '#ffff00', '#00ff00']
export const AIM_DEFAULTS = { seeds: 15, distance: 1.5, gradient: 1e-6, displacement: 1e-7, cycles: 120, step: 0.03, pathPoints: 451 }
export type AimOptions = typeof AIM_DEFAULTS
export type TopologyPoint = { id: number; type: number; density: number; laplacian: number }
export type TopologyPath = { id: number; type: number; offset: number; count: number; start: number; end: number }
export type Topology = {
  version: 1; coordinateUnit: 'bohr'; functionId: number; datasetId: number; hasDensity: boolean
  eulerCount: number; missingPathDirections: number; criticalPoints: TopologyPoint[]; paths: TopologyPath[]
}
export type TopologyResult = { metadata: Topology; coordinates: Required<Pick<PlotDataset, 'x' | 'y' | 'z'>> }
export type TopologySelection = { kind: 'cp' | 'path'; id: number } | undefined
export type TopologyDisplay = { cpTypes: boolean[]; pathTypes: boolean[]; labels: boolean; radius: number; width: number }
export const topology_display_defaults = (): TopologyDisplay => ({ cpTypes: [true, true, true, true, true], pathTypes: [true, true, true, true], labels: false, radius: 0.09, width: 2 })

export const parse_topology = (value: unknown): Topology => {
  const fail = (): never => { throw new Error('Invalid topology result') }
  if (!value || typeof value !== 'object') fail()
  const data = value as Topology
  if (data.version !== 1 || data.coordinateUnit !== 'bohr' || !Number.isSafeInteger(data.datasetId) || data.datasetId < 0
    || !Number.isInteger(data.functionId) || typeof data.hasDensity !== 'boolean'
    || !Array.isArray(data.criticalPoints) || !Array.isArray(data.paths)
    || data.criticalPoints.length > 100000 || data.paths.length > 10000) fail()
  for (const [index, cp] of data.criticalPoints.entries()) {
    if (!cp || cp.id !== index + 1 || !Number.isInteger(cp.type) || cp.type < 0 || cp.type > 4
      || !Number.isFinite(cp.density) || !Number.isFinite(cp.laplacian)) fail()
  }
  let offset = data.criticalPoints.length
  for (const [index, path] of data.paths.entries()) {
    if (!path || path.id !== index + 1 || path.offset !== offset || !Number.isInteger(path.count) || path.count < 2 || path.count > 1500
      || !Number.isInteger(path.type) || path.type < 0 || path.type > 3
      || ![path.start, path.end].every((id) => Number.isInteger(id) && id >= 0 && id <= data.criticalPoints.length)) fail()
    offset += path.count
  }
  if (!Number.isInteger(data.eulerCount) || !Number.isInteger(data.missingPathDirections) || data.missingPathDirections < 0
    || (data.datasetId === 0) !== (offset === 0)) fail()
  return data
}

export const resolve_topology = async (value: unknown, resolver: (id: number) => Promise<PlotDataset>): Promise<TopologyResult> => {
  const metadata = parse_topology(value)
  const dataset = metadata.datasetId ? await resolver(metadata.datasetId) : { x: new Float64Array(), y: new Float64Array(), z: new Float64Array() }
  const length = metadata.criticalPoints.length + metadata.paths.reduce((sum, path) => sum + path.count, 0)
  for (const key of ['x', 'y', 'z'] as const) {
    if (!(dataset[key] instanceof Float64Array) || dataset[key]!.length !== length || !dataset[key]!.every(Number.isFinite)) throw new Error('Invalid topology coordinates')
  }
  return { metadata, coordinates: dataset as TopologyResult['coordinates'] }
}

export const topology_position = (result: TopologyResult, index: number): [number, number, number] =>
  [result.coordinates.x[index] * BOHR_TO_ANGSTROM, result.coordinates.y[index] * BOHR_TO_ANGSTROM, result.coordinates.z[index] * BOHR_TO_ANGSTROM]

/** Unwrap consecutive integration steps, never draw the periodic wrap as a long chord. */
export const topology_path_points = (result: TopologyResult, path: TopologyPath, cell?: number[][]): [number, number, number][] => {
  const points = Array.from({ length: path.count }, (_, index) => topology_position(result, path.offset + index))
  if (!cell) return points
  if (cell.length !== 3 || cell.some((row) => row.length !== 3 || !row.every(Number.isFinite))) throw new Error('Invalid topology cell')
  const lattice = cell as Matrix3x3
  const converters = create_lattice_converters(lattice)
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]
    const delta = min_image_displacement(previous, points[index], lattice, converters)
    points[index] = [previous[0] + delta[0], previous[1] + delta[1], previous[2] + delta[2]]
  }
  return points
}

export const topology_path_length = (points: number[][]): number => points.slice(1).reduce((sum, point, index) => sum + Math.hypot(...point.map((value, axis) => value - points[index][axis])), 0)

/** Boundary endpoint images keep the original CP identity and the unwrapped path connected. */
export const topology_scene_data = (result: TopologyResult, cell?: number[][]) => {
  const points = result.metadata.criticalPoints.map((cp) => ({ ...cp, position: topology_position(result, cp.id - 1) }))
  const paths = result.metadata.paths.map((path) => ({ ...path, points: topology_path_points(result, path, cell) }))
  if (cell) {
    const matrix = new Matrix3().set(cell[0][0], cell[1][0], cell[2][0], cell[0][1], cell[1][1], cell[2][1], cell[0][2], cell[1][2], cell[2][2])
    const inverse = matrix.clone().invert()
    for (const path of paths) for (const [id, endpoint] of [[path.start, path.points[0]], [path.end, path.points.at(-1)!]] as const) {
      if (!id) continue
      const cp = result.metadata.criticalPoints[id - 1]
      const original = new Vector3(...topology_position(result, id - 1))
      const shift = new Vector3(...endpoint).sub(original).applyMatrix3(inverse).round().applyMatrix3(matrix)
      if (shift.lengthSq() < 1e-12) continue
      const position = original.add(shift).toArray()
      if (!points.some((point) => point.id === id && point.position.every((value, axis) => Math.abs(value - position[axis]) < 1e-6))) points.push({ ...cp, position })
    }
  }
  return { points, paths }
}

export const normalize_topology_display = (value: unknown): TopologyDisplay => {
  const defaults = topology_display_defaults()
  if (!value || typeof value !== 'object') return defaults
  const input = value as Partial<TopologyDisplay>
  const flags = (value: unknown, fallback: boolean[]): boolean[] => Array.isArray(value) && value.length === fallback.length && value.every((flag) => typeof flag === 'boolean') ? [...value] : fallback
  return {
    cpTypes: flags(input.cpTypes, defaults.cpTypes), pathTypes: flags(input.pathTypes, defaults.pathTypes), labels: input.labels === true,
    radius: typeof input.radius === 'number' && Number.isFinite(input.radius) ? Math.max(.03, Math.min(.3, input.radius)) : defaults.radius,
    width: typeof input.width === 'number' && Number.isFinite(input.width) ? Math.max(1, Math.min(6, input.width)) : defaults.width,
  }
}

export const topology_document = (result: TopologyResult): string => JSON.stringify({
  format: 'multiwfn-topology', ...result.metadata,
  coordinates: Object.fromEntries(Object.entries(result.coordinates).map(([axis, values]) => [axis, Array.from(values)])),
}, null, 2)

export const topology_csv = (result: TopologyResult): string => {
  const rows = ['object,id,type,point_index,x_bohr,y_bohr,z_bohr,density_au,laplacian_au,start_cp,end_cp']
  const xyz = (index: number) => [result.coordinates.x[index], result.coordinates.y[index], result.coordinates.z[index]]
  for (const cp of result.metadata.criticalPoints) rows.push(['cp', cp.id, cp.type, 0, ...xyz(cp.id - 1), ...(result.metadata.hasDensity ? [cp.density, cp.laplacian] : ['', '']), '', ''].join(','))
  for (const path of result.metadata.paths) for (let index = 0; index < path.count; index++) rows.push(['path', path.id, path.type, index, ...xyz(path.offset + index), '', '', path.start, path.end].join(','))
  return rows.join('\n') + '\n'
}
