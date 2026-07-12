/** Data contracts and bounded, dependency-free DOS calculations. */

export type DosSpin = 'alpha' | 'beta' | 'total'

export type DosLevel = {
  index?: number
  energy: number
  occupation?: number
  spin: DosSpin
  projections: Record<string, number>
  weight?: number
}

/** A sampled DOS/PDOS curve as emitted by multiwfn-analysis-data. */
export type DosSample = {
  id?: string
  label?: string
  energy: number[]
  density: number[]
  spin: DosSpin
  element?: string
  orbital?: string
}

export type DosPayload = {
  format: 'multiwfn-analysis-data'
  version: 1
  kind: 'dos'
  axes?: {
    x?: { label?: string; unit?: string; reversed?: boolean }
    y?: { label?: string; unit?: string }
  }
  series: {
    levels: DosLevel[]
    sampled: DosSample[]
    projections: DosSample[]
  }
  markers: unknown[]
  metadata: Record<string, unknown>
  controls: {
    defaultFwhm?: number
    projectionModes: string[]
    elements: string[]
  }
}

export type DosRange = [number, number]

export type GaussianOptions = {
  fwhm?: number
  min?: number
  max?: number
  samples?: number
  maxSamples?: number
  maxWork?: number
}

export type DosPlot = {
  energies: number[]
  tdos: number[]
  alpha?: number[]
  beta?: number[]
  projected: Record<string, number[]>
  range: DosRange
  fwhm: number
}

const MAX_SAMPLES = 20_000
const MAX_WORK = 8_000_000
const MAX_DIRECT_CURVES = 32
const MAX_DIRECT_POINTS = 5_000
const MIN_FWHM = 1e-6
const DEFAULT_FWHM = 1.3605693122994
const SQRT_TWO_PI = Math.sqrt(2 * Math.PI)
const COLOR_PALETTE = [
  '#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2',
  '#db2777', '#65a30d', '#4f46e5', '#ea580c', '#0f766e', '#9333ea',
]

const finite_number = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const as_record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

const normalized_spin = (value: unknown): DosSpin => {
  const spin = String(value ?? 'total').toLowerCase()
  if (spin === 'alpha' || spin === 'a' || spin === 'up' || spin === 'spin 1') return 'alpha'
  if (spin === 'beta' || spin === 'b' || spin === 'down' || spin === 'spin 2') return 'beta'
  return 'total'
}

const normalize_projections = (value: unknown): Record<string, number> => {
  const input = as_record(value)
  const output: Record<string, number> = {}
  for (const [key, raw] of Object.entries(input)) {
    const number = finite_number(raw)
    if (number !== undefined && number >= 0) output[key] = number
  }
  return output
}

const normalize_axis = (value: unknown): { label?: string; unit?: string; reversed?: boolean } => {
  const record = as_record(value)
  return {
    label: typeof record.label === 'string' ? record.label : undefined,
    unit: typeof record.unit === 'string' ? record.unit : undefined,
    reversed: record.reversed === true,
  }
}

const normalize_number_array = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const values = value.map(finite_number)
  if (values.some((item) => item === undefined)) return undefined
  return values as number[]
}

/** Normalize one sampled curve. Invalid optional rows are ignored by the caller. */
const normalize_sample = (value: unknown): DosSample | undefined => {
  const row = as_record(value)
  const energies = normalize_number_array(row.energy)
  const density = normalize_number_array(row.density ?? row.value)
  if (!energies || !density || energies.length === 0 || energies.length !== density.length) return undefined
  const sample_indices = energies.length <= MAX_DIRECT_POINTS
    ? energies.map((_, index) => index)
    : Array.from({ length: MAX_DIRECT_POINTS }, (_, index) =>
      Math.min(energies.length - 1, Math.floor(index * (energies.length - 1) / (MAX_DIRECT_POINTS - 1))))
  return {
    id: typeof row.id === 'string' ? row.id : undefined,
    label: typeof row.label === 'string' ? row.label : undefined,
    energy: sample_indices.map((index) => energies[index]),
    density: sample_indices.map((index) => density[index]),
    spin: normalized_spin(row.spin),
    element: typeof row.element === 'string' ? row.element : undefined,
    orbital: typeof row.orbital === 'string' ? row.orbital : undefined,
  }
}

/** Parse and validate a DOS artifact. Throws for malformed required data. */
export function validate_dos_payload(value: unknown): DosPayload {
  const root = as_record(value)
  if (root.format !== 'multiwfn-analysis-data') throw new Error('Unsupported analysis data format')
  if (root.version !== 1) throw new Error('Unsupported analysis data version')
  if (root.kind !== 'dos') throw new Error('Analysis artifact is not a DOS dataset')
  const series = as_record(root.series)
  if (!Array.isArray(series.levels) && !Array.isArray(series.sampled)) {
    throw new Error('DOS artifact is missing series.levels or series.sampled')
  }

  const levels: DosLevel[] = []
  for (const [position, item] of (Array.isArray(series.levels) ? series.levels : []).entries()) {
    const row = as_record(item)
    const energy = finite_number(row.energy)
    if (energy === undefined) throw new Error(`DOS level ${position + 1} has a non-finite energy`)
    const occupation = row.occupation === undefined ? undefined : finite_number(row.occupation)
    if (row.occupation !== undefined && occupation === undefined) {
      throw new Error(`DOS level ${position + 1} has a non-finite occupation`)
    }
    const weight = row.weight === undefined ? undefined : finite_number(row.weight)
    if (row.weight !== undefined && (weight === undefined || weight < 0)) {
      throw new Error(`DOS level ${position + 1} has an invalid weight`)
    }
    const index = row.index === undefined ? undefined : finite_number(row.index)
    levels.push({
      index: index === undefined ? undefined : Math.trunc(index),
      energy,
      occupation,
      spin: normalized_spin(row.spin),
      projections: normalize_projections(row.projections),
      weight,
    })
  }

  const sampled = (Array.isArray(series.sampled) ? series.sampled : [])
    .slice(0, MAX_DIRECT_CURVES)
    .map(normalize_sample)
    .filter((item): item is DosSample => item !== undefined)
  const projections = (Array.isArray(series.projections) ? series.projections : [])
    .slice(0, MAX_DIRECT_CURVES)
    .map(normalize_sample)
    .filter((item): item is DosSample => item !== undefined)
  if (levels.length === 0 && sampled.length === 0) throw new Error('DOS artifact contains no valid data')

  const controlsRecord = as_record(root.controls)
  const defaultFwhm = finite_number(controlsRecord.defaultFwhm)
  const elements = new Set<string>()
  for (const sample of projections) if (sample.element) elements.add(sample.element)
  for (const level of levels) for (const key of Object.keys(level.projections)) elements.add(key)
  const configuredElements = Array.isArray(controlsRecord.elements)
    ? controlsRecord.elements.filter((item): item is string => typeof item === 'string') : []
  return {
    format: 'multiwfn-analysis-data', version: 1, kind: 'dos',
    axes: { x: normalize_axis(as_record(root.axes).x), y: normalize_axis(as_record(root.axes).y) },
    series: { levels, sampled, projections },
    markers: Array.isArray(root.markers) ? root.markers : [],
    metadata: as_record(root.metadata),
    controls: {
      defaultFwhm: defaultFwhm !== undefined && defaultFwhm > 0 ? defaultFwhm : undefined,
      projectionModes: Array.isArray(controlsRecord.projectionModes)
        ? controlsRecord.projectionModes.filter((item): item is string => typeof item === 'string') : [],
      elements: configuredElements.length ? configuredElements : [...elements].sort(),
    },
  }
}

export const parse_dos_payload = validate_dos_payload
export const parse_analysis_payload = validate_dos_payload

const clamp_samples = (value: number, maxSamples: number): number =>
  Math.max(2, Math.min(MAX_SAMPLES, Math.min(maxSamples, Math.floor(Number.isFinite(value) ? value : 1600))))

/** Return finite bounds around all levels. Explicit bounds are retained when valid. */
export function finite_energy_range(levels: DosLevel[], fwhm = DEFAULT_FWHM, min?: number, max?: number): DosRange {
  const energies = levels.map((level) => level.energy).filter(Number.isFinite)
  const low = finite_number(min)
  const high = finite_number(max)
  let lower = low !== undefined ? low : Math.min(...energies)
  let upper = high !== undefined ? high : Math.max(...energies)
  const width = Math.max(MIN_FWHM, Number.isFinite(fwhm) ? Math.abs(fwhm) : DEFAULT_FWHM)
  const span = Number.isFinite(upper - lower) ? upper - lower : 0
  const pad = Math.max(width * 2, span * 0.04, 0.5)
  if (!Number.isFinite(lower)) lower = -pad
  if (!Number.isFinite(upper)) upper = pad
  if (lower === upper) return [lower - pad, upper + pad]
  if (lower > upper) [lower, upper] = [upper, lower]
  return [lower, upper]
}

export const finite_range = finite_energy_range

const add_gaussian = (target: number[], energies: number[], level: DosLevel, sigma: number, multiplier: number): void => {
  const base_weight = level.weight ?? 1
  if (base_weight <= 0 || !Number.isFinite(base_weight) || !Number.isFinite(multiplier)) return
  const weight = base_weight * multiplier
  const center = level.energy
  const normalization = weight / (sigma * SQRT_TWO_PI)
  for (let index = 0; index < energies.length; index += 1) {
    const z = (energies[index] - center) / sigma
    target[index] += normalization * Math.exp(-0.5 * z * z)
  }
}

/** Gaussian broaden orbital levels into TDOS, spin channels, and element PDOS. */
export function gaussian_broaden(levels: DosLevel[], options: GaussianOptions = {}): DosPlot {
  if (!Array.isArray(levels) || levels.length === 0) throw new Error('Cannot broaden an empty DOS level set')
  const fwhmValue = finite_number(options.fwhm) ?? DEFAULT_FWHM
  const fwhm = Math.max(MIN_FWHM, Math.abs(fwhmValue))
  const range = finite_energy_range(levels, fwhm, options.min, options.max)
  const maxSamples = Math.max(2, Math.min(MAX_SAMPLES, Math.floor(options.maxSamples ?? MAX_SAMPLES)))
  const requested = options.samples ?? Math.min(2400, maxSamples)
  const workCap = Math.max(1, Math.floor(options.maxWork ?? MAX_WORK))
  const samples = clamp_samples(Math.min(requested, Math.floor(workCap / Math.max(1, levels.length))), maxSamples)
  const step = (range[1] - range[0]) / (samples - 1)
  const energies = Array.from({ length: samples }, (_, index) => range[0] + index * step)
  const tdos = new Array<number>(samples).fill(0)
  const alpha = levels.some((level) => level.spin === 'alpha') ? new Array<number>(samples).fill(0) : undefined
  const beta = levels.some((level) => level.spin === 'beta') ? new Array<number>(samples).fill(0) : undefined
  const projected: Record<string, number[]> = {}
  const sigma = fwhm / (2 * Math.sqrt(2 * Math.log(2)))
  for (const level of levels) {
    add_gaussian(tdos, energies, level, sigma, 1)
    if (level.spin === 'alpha' && alpha) add_gaussian(alpha, energies, level, sigma, 1)
    if (level.spin === 'beta' && beta) add_gaussian(beta, energies, level, sigma, -1)
    for (const [element, projection] of Object.entries(level.projections)) {
      projected[element] ??= new Array<number>(samples).fill(0)
      add_gaussian(projected[element], energies, level, sigma, level.spin === 'beta' ? -projection : projection)
    }
  }
  return { energies, tdos, alpha, beta, projected, range, fwhm }
}

export const broaden_dos = gaussian_broaden
export const build_dos_series = gaussian_broaden

/** Deterministic color assignment for legends and element channels. */
export function stable_color(key: string, index = 0): string {
  let hash = 2166136261
  for (const character of String(key)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  const offset = Math.abs(hash + Math.trunc(index)) % COLOR_PALETTE.length
  return COLOR_PALETTE[offset]
}

export const color_for_series = stable_color
