// Vibrational normal-mode animation for the standalone MatterViz vibration page.
//
// The session payload (format "multiwfn-matterviz-vibration", version 1) is served as a
// MatterViz session constructed by the standalone launcher
// tools/multiwfn_vibration_viewer.py (the Fortran drawvibgui entry has been removed):
// mode frequencies/intensities inline in the manifest, displacement vectors as one flat
// MWFNP2D binary dataset in mode-major [mode][atom][xyz] order.
//
// The animation model follows the upstream MatterViz phonon components
// (src/lib/spectral/phonon-modes.ts): a displacement pattern is normalized so the
// largest per-atom excursion is exactly 1 Angstrom, then one phase cycle of frames is
// synthesized as xyz(t) = xyz0 + amplitude * u * cos(2 pi k / N) with the instantaneous
// displacement exposed as a per-site vector property for arrow overlays. Multiwfn
// vibrations are molecular Gamma-point modes, so no q-points, supercells or lattices
// are involved; the emitted payload stays consumable by the upstream PhononModeExplorer
// once the vendored matterviz dependency completes its 0.7 migration.
import type { AnyStructure } from 'matterviz/structure'
import type { TrajectoryFrame, TrajectoryType } from 'matterviz/trajectory'
import { read_plot_dataset_response } from './plot.ts'

export type Vec3 = [number, number, number]

export type VibrationMode = { index: number; frequency: number; intensity: number | null }

export type VibrationDisplacements = {
  datasetId: number
  format: string
  role: string
  layout: string
  shape: [number, number, number]
}

export type VibrationManifest = {
  format: string
  version: number
  generatedBy?: string
  multiwfnGui?: { entry?: string }
  structure?: { path?: string; format?: string } | null
  vibrations?: {
    sourceProgram?: string
    spectrumKind?: string | null
    atomCount: number
    modeCount: number
    coordinateUnit: string
    frequencyUnit: string
    intensityUnit?: string | null
    displacementConvention?: string
    modes: VibrationMode[]
    displacements: VibrationDisplacements
  }
}

export type VibrationSession = {
  manifest: VibrationManifest
  modes: VibrationMode[]
  structure: AnyStructure
  displacements: Float64Array
  shape: [number, number, number]
}

// Defaults mirror upstream DEFAULT_PHONON_AMPLITUDE / DEFAULT_PHONON_FRAMES /
// DEFAULT_PHONON_FPS in src/lib/spectral/phonon-modes.ts.
export const DEFAULT_VIBRATION_AMPLITUDE = 0.3 // Angstrom
export const DEFAULT_VIBRATION_FRAMES = 48
export const DEFAULT_VIBRATION_FPS = 24
export const CM_INV_PER_THZ = 33.3564095198152

// Issue #65: the viewer must open on a static frame; playback starts only when the
// user clicks Play. VibrationApp passes this to the vendored Trajectory's auto_play.
export const VIBRATION_AUTO_PLAY: boolean = false

export const vibration_fail = (message: string): never => {
  throw new Error(`Invalid vibration session: ${message}`)
}

export function vibration_assert(condition: unknown, message: string): asserts condition {
  if (!condition) vibration_fail(message)
}

export const is_imaginary_frequency = (frequency: number): boolean => frequency < 0

export const frequency_thz = (frequency_cm_inv: number): number => frequency_cm_inv / CM_INV_PER_THZ

const finite_number = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const positive_integer = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0

export const parse_vibration_manifest = (value: unknown): VibrationManifest => {
  vibration_assert(value && typeof value === 'object', 'manifest must be an object')
  const manifest = value as VibrationManifest
  vibration_assert(manifest.format === 'multiwfn-matterviz-vibration', 'unsupported manifest format')
  vibration_assert(manifest.version === 1, 'unsupported manifest version')
  const vibrations = manifest.vibrations
  vibration_assert(vibrations && typeof vibrations === 'object', 'vibrations must be an object')
  vibration_assert(positive_integer(vibrations.atomCount), 'atomCount must be a positive integer')
  vibration_assert(positive_integer(vibrations.modeCount), 'modeCount must be a positive integer')
  vibration_assert(vibrations.coordinateUnit === 'angstrom', 'coordinateUnit must be angstrom')
  vibration_assert(vibrations.frequencyUnit === 'cm^-1', 'frequencyUnit must be cm^-1')
  const { modes, displacements } = vibrations
  vibration_assert(Array.isArray(modes) && modes.length === vibrations.modeCount, 'modes must contain modeCount entries')
  for (const mode of modes) {
    vibration_assert(mode && typeof mode === 'object', 'modes entries must be objects')
    vibration_assert(finite_number(mode.frequency), 'mode frequency must be finite')
    vibration_assert(mode.intensity === null || finite_number(mode.intensity), 'mode intensity must be finite or null')
  }
  vibration_assert(displacements && typeof displacements === 'object', 'displacements must be an object')
  vibration_assert(positive_integer(displacements.datasetId), 'displacements.datasetId must be positive')
  vibration_assert(displacements.format === 'mwfn-plot-data-v1', 'displacements.format is unsupported')
  vibration_assert(displacements.role === 'u', 'displacements.role must be u')
  vibration_assert(displacements.layout === 'mode-major-atom-xyz', 'displacements.layout is unsupported')
  const shape = displacements.shape
  vibration_assert(
    Array.isArray(shape) && shape.length === 3 && shape.every(positive_integer),
    'displacements.shape must be three positive integers',
  )
  vibration_assert(
    shape[0] === vibrations.modeCount && shape[1] === vibrations.atomCount && shape[2] === 3,
    'displacements.shape must be [modeCount, atomCount, 3]',
  )
  return manifest
}

export const api_url = (path: string, page: URL = new URL(window.location.href)): URL => {
  const url = new URL(path, page)
  vibration_assert(url.origin === page.origin, 'session requests must remain same-origin')
  const capability = page.searchParams.get('cap')
  if (capability) url.searchParams.set('cap', capability)
  return url
}

const vibration_manifest_url = (page: URL): URL =>
  api_url(page.searchParams.get('manifest') || '/session/manifest.json', page)

// Load and validate the full vibration session: manifest, structure and the binary
// displacement dataset referenced by it.
export const load_vibration_session = async (
  page: URL = new URL(window.location.href),
  request: typeof fetch = fetch,
): Promise<VibrationSession> => {
  const manifest_endpoint = vibration_manifest_url(page)
  const manifest_response = await request(manifest_endpoint, { cache: 'no-store' })
  if (!manifest_response.ok) vibration_fail(`manifest request returned HTTP ${manifest_response.status}`)
  const manifest = parse_vibration_manifest(await manifest_response.json())
  const vibrations = manifest.vibrations!

  const manifest_base = new URL('.', manifest_endpoint)
  const structure_path = manifest.structure?.path ?? 'structure.json'
  const structure_endpoint = api_url(new URL(structure_path, manifest_base).href, page)
  const structure_response = await request(structure_endpoint, { cache: 'no-store' })
  if (!structure_response.ok) vibration_fail(`structure request returned HTTP ${structure_response.status}`)
  const structure = parse_vibration_structure(await structure_response.text(), vibrations.atomCount)
  // An explicitly empty bond list would suppress automatic bond detection; let the
  // renderer compute bonds for output files that carry no connectivity.
  if (structure.properties && Array.isArray(structure.properties.bonds) && structure.properties.bonds.length === 0) {
    delete structure.properties.bonds
  }

  const dataset_response = await request(api_url(`/api/plot-data/${displacements_dataset_id(vibrations)}`, page), { cache: 'no-store' })
  const dataset = await read_plot_dataset_response(dataset_response, displacements_dataset_id(vibrations))
  const displacements = dataset.u
  vibration_assert(displacements, 'displacement dataset has no u array')
  const [mode_count, atom_count, three] = vibrations.displacements.shape
  if (displacements.length !== mode_count * atom_count * three) {
    vibration_fail('displacement dataset length does not match its declared shape')
  }
  return { manifest, modes: vibrations.modes, structure, displacements, shape: vibrations.displacements.shape }
}

const displacements_dataset_id = (vibrations: NonNullable<VibrationManifest['vibrations']>): number =>
  vibrations.displacements.datasetId

// The session structure is emitted by the Fortran adapter in the pymatgen-style site
// shape the MatterViz structure renderer consumes; validate the essentials here so the
// page never renders a malformed molecule.
export const parse_vibration_structure = (text: string, atom_count: number): AnyStructure => {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    vibration_fail('structure is not valid JSON')
  }
  const structure = value as AnyStructure
  vibration_assert(
    structure && typeof structure === 'object' && Array.isArray(structure.sites),
    'structure must be an object with a sites array',
  )
  vibration_assert(structure.sites.length === atom_count, 'structure site count does not match vibrations.atomCount')
  for (const site of structure.sites) {
    const xyz = site?.xyz
    vibration_assert(
      Array.isArray(xyz) && xyz.length === 3 && xyz.every(finite_number),
      'structure sites must carry finite xyz coordinates',
    )
    const element = site.species?.[0]?.element
    vibration_assert(typeof element === 'string' && element.length > 0, 'structure sites must carry an element symbol')
  }
  return structure
}

// One mode's displacement pattern, normalized so the largest per-atom excursion is
// exactly 1 Angstrom (upstream phonon_mode_pattern for real Gamma-point eigenvectors).
export const normalized_mode_pattern = (
  displacements: Float64Array,
  shape: [number, number, number],
  mode_idx: number,
): Float64Array => {
  const [mode_count, atom_count] = shape
  if (!Number.isInteger(mode_idx) || mode_idx < 0 || mode_idx >= mode_count) {
    vibration_fail(`mode index ${mode_idx} is outside 0-${mode_count - 1}`)
  }
  const pattern = displacements.slice(mode_idx * atom_count * 3, (mode_idx + 1) * atom_count * 3)
  let max_excursion_sq = 0
  for (let atom = 0; atom < atom_count; atom += 1) {
    const offset = atom * 3
    const excursion_sq = pattern[offset] ** 2 + pattern[offset + 1] ** 2 + pattern[offset + 2] ** 2
    if (excursion_sq > max_excursion_sq) max_excursion_sq = excursion_sq
  }
  if (max_excursion_sq <= 0) vibration_fail(`mode ${mode_idx + 1} has a zero displacement vector`)
  const norm = 1 / Math.sqrt(max_excursion_sq)
  for (let index = 0; index < pattern.length; index += 1) pattern[index] *= norm
  return pattern
}

// One phase cycle of a mode as a trajectory, following upstream phonon_mode_run:
// u(phase) = amplitude * u * cos(phase), with the instantaneous displacement attached
// as the per-site `force` vector property for the arrow overlay.
//
// Every frame is re-centered so its mass-weighted center coincides bit-exactly with the
// equilibrium one: the structure renderer derives the camera rotation target and the
// un-translate group from the live center of mass, and rounded print precision of the
// displacement vectors would otherwise make the whole molecule jitter every frame.
export const synthesize_vibration_trajectory = (
  structure: AnyStructure,
  pattern: Float64Array,
  options: { amplitude?: number; n_frames?: number } = {},
): TrajectoryType => {
  const { amplitude = DEFAULT_VIBRATION_AMPLITUDE, n_frames = DEFAULT_VIBRATION_FRAMES } = options
  if (!Number.isFinite(amplitude) || amplitude <= 0) vibration_fail(`amplitude must be positive, got ${amplitude}`)
  if (!Number.isInteger(n_frames) || n_frames < 2) vibration_fail(`a vibration cycle needs at least 2 frames, got ${n_frames}`)
  const atom_count = structure.sites.length
  if (pattern.length !== atom_count * 3) vibration_fail('displacement pattern does not match the structure')

  const equilibrium_center = site_mass_center(structure.sites)
  const frames: TrajectoryFrame[] = []
  for (let frame_idx = 0; frame_idx < n_frames; frame_idx += 1) {
    const phase = (2 * Math.PI * frame_idx) / n_frames
    const scale = amplitude * Math.cos(phase)
    const sites = structure.sites.map((site, atom) => {
      const offset = atom * 3
      const delta: Vec3 = [
        pattern[offset] * scale,
        pattern[offset + 1] * scale,
        pattern[offset + 2] * scale,
      ]
      return {
        ...site,
        xyz: [site.xyz[0] + delta[0], site.xyz[1] + delta[1], site.xyz[2] + delta[2]] as Vec3,
        properties: { ...site.properties, force: delta },
      }
    })
    const frame_center = site_mass_center(sites)
    const shift: Vec3 = [
      equilibrium_center[0] - frame_center[0],
      equilibrium_center[1] - frame_center[1],
      equilibrium_center[2] - frame_center[2],
    ]
    if (Math.abs(shift[0]) + Math.abs(shift[1]) + Math.abs(shift[2]) > 0) {
      for (const site of sites) {
        site.xyz = [site.xyz[0] + shift[0], site.xyz[1] + shift[1], site.xyz[2] + shift[2]] as Vec3
      }
    }
    frames.push({ structure: { ...structure, sites }, step: frame_idx, metadata: { phase } })
  }
  return { frames, metadata: { amplitude, n_frames } }
}

// Standard atomic weights for the common organic/ab-initio elements; the closest
// integer mass otherwise. Only consistency between frames matters here.
const ELEMENT_MASSES: Record<string, number> = {
  H: 1.008, He: 4.003, Li: 6.94, Be: 9.012, B: 10.81, C: 12.011, N: 14.007, O: 15.999,
  F: 18.998, Ne: 20.18, Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974,
  S: 32.06, Cl: 35.45, Ar: 39.948, K: 39.098, Ca: 40.078, Ti: 47.867, V: 50.942,
  Cr: 51.996, Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38,
  Br: 79.904, Ag: 107.8682, I: 126.904, Pt: 195.084, Au: 196.967, Hg: 200.592, Pb: 207.2,
}

export const site_mass_center = (sites: AnyStructure['sites']): Vec3 => {
  const center: Vec3 = [0, 0, 0]
  let total_weight = 0
  for (const site of sites) {
    for (const species of site.species ?? []) {
      // Any deterministic positive mass is fine for unknown elements: only consistency
      // between the equilibrium and frame centers matters for the pinning.
      const weight = (ELEMENT_MASSES[species.element] ?? 20) * (species.occu ?? 1)
      center[0] += site.xyz[0] * weight
      center[1] += site.xyz[1] * weight
      center[2] += site.xyz[2] * weight
      total_weight += weight
    }
  }
  return total_weight > 0 ? [center[0] / total_weight, center[1] / total_weight, center[2] / total_weight] : [0, 0, 0]
}

// Save-to-disk routing for vendored downloads. The vendored matterviz download()
// helper (dist/io/fetch.js) defers to a globalThis.download override when one is
// installed, and the desktop shell's WKWebView silently swallows anchor downloads,
// so export payloads (WebM video, PNG stills, SVG) are posted to the local service,
// which shows a native save dialog and writes the bytes where the user chooses.
export type SaveFileResult = {
  ok: boolean
  path?: string
  cancelled?: boolean
  message?: string
}

export const sanitize_save_file_name = (filename: string | undefined): string => {
  const name = (filename ?? '').split(/[\\/]/).pop()?.trim() ?? ''
  const cleaned = [...name].filter((character) => {
    const code = character.codePointAt(0) ?? 0
    return code >= 0x20 && code !== 0x7f && character !== ':'
  }).join('')
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? 'export.bin' : cleaned
}

export const save_file_via_dialog = async (
  data: Blob | BlobPart,
  filename: string,
  page: URL = new URL(window.location.href),
  request: typeof fetch = fetch,
): Promise<SaveFileResult> => {
  const endpoint = api_url('/api/save-file', page)
  endpoint.searchParams.set('name', sanitize_save_file_name(filename))
  const blob = data instanceof Blob ? data : new Blob([data])
  const body = new Uint8Array(await blob.arrayBuffer())
  const response = await request(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
  })
  if (!response.ok) {
    const detail = (await response.text()).trim()
    return { ok: false, message: detail === '' ? `HTTP ${response.status}` : `HTTP ${response.status}: ${detail}` }
  }
  return (await response.json()) as SaveFileResult
}
