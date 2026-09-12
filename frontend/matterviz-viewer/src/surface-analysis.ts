import type { PlotDataset, PlotDatasetResolver } from './plot'

export type SurfaceMetadata = {
  version: 1; coordinateUnit: 'bohr'; vertices: number; facets: number; extrema: number
  surfaceType: number | null; mappedFunction: number | null; mapped: boolean | null; isovalue: number; volume: number | null
  massDensity: number | null; bohrToAngstrom: number; hartreeToKcal: number; hartreeToEv: number
  metadataSource?: 'unconfirmed' | 'user'
  statisticsSource?: { source: 'log'; filename: string; precision: 'printed' }
}
export const SURFACE_TYPES: Record<number, string> = { 1: 'Electron-density surface', 2: 'Real-space function surface', 5: 'Hirshfeld surface', 6: 'Becke surface', 10: 'Grid isosurface' }
export const SURFACE_FUNCTIONS: Record<number, string> = { '-1': 'User-defined function', 0: 'External mapped values', 1: 'Electrostatic potential', 2: 'Average local ionization energy', 3: 'ESP from atomic charges', 4: 'Local electron affinity', '-4': 'Local electron attachment energy', 5: 'Electron delocalization range', 6: 'Orbital overlap distance', 10: 'Pair density', 11: 'Electron density', 12: 'Sign(lambda2) rho', 20: 'd_i', 21: 'd_e', 22: 'd_norm' }
export type SurfaceConfirmation = { surfaceType: number; mappedFunction: number | null }
export type SurfaceResult = {
  metadata: SurfaceMetadata; xyz: Float64Array; values: Float64Array; vertexIds: Float64Array
  indices: Float64Array; areas: Float64Array; facetValues: Float64Array; facetIds: Float64Array
  extremeVertex: Float64Array; extremeKind: Float64Array; extremeId: Float64Array
}
export const surface_display_defaults = () => ({ opacity: 0.68, surface: true, minima: true, maxima: true, wireframe: false })
export type SurfaceDisplay = ReturnType<typeof surface_display_defaults>
const invalid = (): never => { throw new Error('Invalid quantitative surface analysis result') }
const integers = (values: Float64Array, min: number, max = Number.MAX_SAFE_INTEGER) => values.every((n) => Number.isSafeInteger(n) && n >= min && n <= max)
export const parse_surface_metadata = (value: unknown): SurfaceMetadata => {
  if (!value || typeof value !== 'object') invalid()
  const m = value as SurfaceMetadata
  if (m.version !== 1 || m.coordinateUnit !== 'bohr' || (m.mapped !== null && typeof m.mapped !== 'boolean')
    || ![m.vertices, m.facets].every((id) => Number.isSafeInteger(id) && id > 0)
    || !Number.isSafeInteger(m.extrema) || m.extrema < 0 || new Set([m.vertices, m.facets, m.extrema]).size !== 3
    || (m.surfaceType !== null && (!Number.isInteger(m.surfaceType) || !(m.surfaceType in SURFACE_TYPES)))
    || (m.mappedFunction !== null && (!Number.isInteger(m.mappedFunction) || !(m.mappedFunction in SURFACE_FUNCTIONS)))
    || (m.mapped === true && m.mappedFunction === null)
    || !Number.isFinite(m.isovalue)
    || (m.massDensity !== null && (!Number.isFinite(m.massDensity) || m.massDensity < 0))
    || (m.volume !== null && (!Number.isFinite(m.volume) || m.volume <= 0))
    || ![m.bohrToAngstrom, m.hartreeToKcal, m.hartreeToEv].every((n) => Number.isFinite(n) && n > 0)
    || (m.metadataSource !== undefined && !['unconfirmed', 'user'].includes(m.metadataSource))) invalid()
  return m
}
export const resolve_surface = async (value: unknown, resolver: PlotDatasetResolver): Promise<SurfaceResult> => {
  const metadata = parse_surface_metadata(value)
  const vertex = await resolver(metadata.vertices)
  const facet = await resolver(metadata.facets)
  const extreme = metadata.extrema ? await resolver(metadata.extrema) : { x: new Float64Array(), y: new Float64Array(), z: new Float64Array() }
  const array = (data: PlotDataset, key: keyof PlotDataset): Float64Array => {
    if (!(data[key] instanceof Float64Array) || !data[key]!.every(Number.isFinite)) invalid()
    return data[key]!
  }
  const result: SurfaceResult = { metadata, xyz: array(vertex, 'x'), values: array(vertex, 'y'), vertexIds: array(vertex, 'z'),
    indices: array(facet, 'x'), areas: array(facet, 'y'), facetValues: array(facet, 'z'), facetIds: array(facet, 'u'),
    extremeVertex: array(extreme, 'x'), extremeKind: array(extreme, 'y'), extremeId: array(extreme, 'z') }
  const n = result.values.length, t = result.areas.length, e = result.extremeVertex.length
  if (!n || !t || result.xyz.length !== 3 * n || result.vertexIds.length !== n || result.indices.length !== 3 * t
    || result.facetValues.length !== t || result.facetIds.length !== t || result.extremeKind.length !== e || result.extremeId.length !== e
    || !integers(result.indices, 0, n - 1) || !integers(result.vertexIds, 1) || !integers(result.facetIds, 1)
    || !integers(result.extremeVertex, 0, n - 1) || !integers(result.extremeId, 1)
    || !result.extremeKind.every((n) => n === -1 || n === 1) || (!metadata.mapped && e > 0)
    || result.areas.some((a) => a < 0) || !result.areas.some((a) => a > 0)
    || Object.values(result).reduce((sum, value) => sum + (value instanceof Float64Array ? value.byteLength : 0), 0) > 256 * 1024 ** 2) invalid()
  for (const ids of [result.vertexIds, result.facetIds]) if (ids.some((id, i) => i > 0 && id <= ids[i - 1])) invalid()
  if (new Set(Array.from(result.extremeId, (id, i) => `${result.extremeKind[i]}:${id}`)).size !== e) invalid()
  return result
}
export const surface_function = (m: SurfaceMetadata) => {
  const esp = m.mapped === true && m.mappedFunction !== null && [1, 3].includes(m.mappedFunction)
  const energy = m.mapped === true && m.mappedFunction !== null && [2, 4, -4].includes(m.mappedFunction)
  return { name: m.mapped === null ? 'Mapping not confirmed' : m.mapped && m.mappedFunction !== null ? SURFACE_FUNCTIONS[m.mappedFunction] : 'Unmapped surface',
    esp, scale: esp ? m.hartreeToKcal : energy ? m.hartreeToEv : 1, unit: esp ? 'kcal/mol/e' : energy ? 'eV' : 'native units' }
}
export const surface_position = (r: SurfaceResult, vertex: number): [number, number, number] =>
  [r.xyz[3 * vertex] * r.metadata.bohrToAngstrom, r.xyz[3 * vertex + 1] * r.metadata.bohrToAngstrom, r.xyz[3 * vertex + 2] * r.metadata.bohrToAngstrom]

/** Same facet-area weighting and sigma_tot = sigma_pos + sigma_neg as surfana.f90. */
export const surface_statistics = (r: SurfaceResult) => {
  let area = 0, positiveArea = 0, negativeArea = 0, positiveSum = 0, negativeSum = 0, nonpolarArea = 0
  for (let i = 0; i < r.areas.length; i++) {
    const a = r.areas[i], v = r.facetValues[i]; area += a
    if (v >= 0) { positiveArea += a; positiveSum += v * a } else { negativeArea += a; negativeSum += v * a }
    if (Math.abs(v * r.metadata.hartreeToKcal) <= 10) nonpolarArea += a
  }
  const mean = (positiveSum + negativeSum) / area
  const positiveMean = positiveArea ? positiveSum / positiveArea : null, negativeMean = negativeArea ? negativeSum / negativeArea : null
  let positiveVariance = 0, negativeVariance = 0, separation = 0, mpi = 0, third = 0, positiveThird = 0, negativeThird = 0
  for (let i = 0; i < r.areas.length; i++) {
    const a = r.areas[i], v = r.facetValues[i]
    if (v >= 0) { positiveVariance += a * (v - (positiveMean ?? 0)) ** 2; positiveThird += a * (v - (positiveMean ?? 0)) ** 3 }
    else { negativeVariance += a * (v - (negativeMean ?? 0)) ** 2; negativeThird += a * (v - (negativeMean ?? 0)) ** 3 }
    separation += Math.abs(v - mean) * a; mpi += Math.abs(v) * a; third += a * (v - mean) ** 3
  }
  if (positiveArea) positiveVariance /= positiveArea
  if (negativeArea) negativeVariance /= negativeArea
  const variance = positiveVariance + negativeVariance
  const balance = variance ? positiveVariance * negativeVariance / variance ** 2 : null
  const minimum = r.values.reduce((a, b) => Math.min(a, b), Infinity), maximum = r.values.reduce((a, b) => Math.max(a, b), -Infinity)
  return { area, positiveArea, negativeArea, nonpolarArea, polarArea: area - nonpolarArea, mean, positiveMean, negativeMean,
    minimum, maximum, positiveVariance, negativeVariance, variance, balance, varianceBalance: balance === null ? null : variance * balance,
    separation: separation / area, mpi: mpi / area, skewness: variance ? third / area / variance ** 1.5 : null,
    positiveSkewness: positiveVariance ? positiveThird / positiveArea / positiveVariance ** 1.5 : null,
    negativeSkewness: negativeVariance ? negativeThird / negativeArea / negativeVariance ** 1.5 : null }
}
export const surface_range = (r: SurfaceResult): [number, number] => {
  let min = Infinity, max = -Infinity
  for (const value of r.values) { min = Math.min(min, value); max = Math.max(max, value) }
  if (surface_function(r.metadata).esp) { const extent = Math.max(Math.abs(min), Math.abs(max), 1e-12); return [-extent, extent] }
  return min === max ? [min - .5, max + .5] : [min, max]
}
export const surface_color = (value: number, range: [number, number]): string => {
  const t = Math.max(0, Math.min(1, (value - range[0]) / (range[1] - range[0])))
  const endpoint = t < .5 ? [245, 169, 184] : [91, 206, 250], weight = Math.abs(t * 2 - 1)
  return `rgb(${endpoint.map((channel) => Math.round(255 + (channel - 255) * weight)).join(', ')})`
}
/** Original facets are unoriented. Orient a rendering copy, keeping scientific indices intact. */
export const surface_render_indices = (r: SurfaceResult): Uint32Array => {
  const indices = Uint32Array.from(r.indices), count = indices.length / 3, vertices = r.values.length
  const keys = new Float64Array(indices.length), order = new Uint32Array(indices.length)
  for (let edge = 0; edge < indices.length; edge++) {
    const base = edge - edge % 3, a = indices[edge], b = indices[base + (edge % 3 + 1) % 3]
    keys[edge] = Math.min(a, b) * vertices + Math.max(a, b); order[edge] = edge
  }
  order.sort((a, b) => keys[a] - keys[b])
  const neighbors = new Int32Array(indices.length).fill(-1), invert = new Uint8Array(indices.length)
  for (let i = 0; i < order.length;) {
    let end = i + 1
    while (end < order.length && keys[order[end]] === keys[order[i]]) end++
    if (end - i === 2) {
      const a = order[i], b = order[i + 1], same = Number(indices[a] === indices[b])
      neighbors[a] = Math.floor(b / 3); neighbors[b] = Math.floor(a / 3); invert[a] = same; invert[b] = same
    }
    i = end
  }
  const flips = new Int8Array(count).fill(-1), queue = new Uint32Array(count)
  for (let seed = 0; seed < count; seed++) {
    if (flips[seed] !== -1) continue
    let head = 0, tail = 1, volume = 0
    queue[0] = seed; flips[seed] = 0
    while (head < tail) {
      const face = queue[head++]
      for (let e = 0; e < 3; e++) {
        const edge = face * 3 + e, other = neighbors[edge]
        if (other >= 0 && flips[other] === -1) { flips[other] = flips[face] ^ invert[edge]; queue[tail++] = other }
      }
      const a = indices[face * 3] * 3, b = indices[face * 3 + 1] * 3, c = indices[face * 3 + 2] * 3, p = r.xyz
      volume += (flips[face] ? -1 : 1) * (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]))
    }
    if (volume < 0) for (let i = 0; i < tail; i++) flips[queue[i]] ^= 1
  }
  for (let i = 0; i < count; i++) if (flips[i]) [indices[3 * i + 1], indices[3 * i + 2]] = [indices[3 * i + 2], indices[3 * i + 1]]
  return indices
}
export const surface_document = (r: SurfaceResult): string => JSON.stringify({ format: 'multiwfn-quantitative-surface', ...r.metadata,
  statistics: r.metadata.mapped ? surface_statistics(r) : { area: surface_statistics(r).area },
  data: Object.fromEntries(Object.entries(r).filter(([, value]) => value instanceof Float64Array).map(([key, value]) => [key, Array.from(value as Float64Array)])),
}, null, 2)
export const surface_csv = (r: SurfaceResult): string => {
  const rows = ['object,id,x_bohr,y_bohr,z_bohr,value_native,area_bohr2,vertex1,vertex2,vertex3']
  for (let i = 0; i < r.values.length; i++) rows.push(['vertex', r.vertexIds[i], ...r.xyz.slice(3 * i, 3 * i + 3), r.metadata.mapped ? r.values[i] : '', '', '', '', ''].join(','))
  for (let i = 0; i < r.areas.length; i++) rows.push(['facet', r.facetIds[i], '', '', '', r.metadata.mapped ? r.facetValues[i] : '', r.areas[i], ...r.indices.slice(3 * i, 3 * i + 3).map((index) => r.vertexIds[index])].join(','))
  for (let i = 0; i < r.extremeId.length; i++) { const v = r.extremeVertex[i]; rows.push([r.extremeKind[i] < 0 ? 'minimum' : 'maximum', r.extremeId[i], ...r.xyz.slice(3 * v, 3 * v + 3), r.values[v], '', r.vertexIds[v], '', ''].join(',')) }
  return rows.join('\n') + '\n'
}
