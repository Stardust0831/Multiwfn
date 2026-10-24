import { element_data } from 'matterviz/element'
import { bonding_strategies, make_site, type Molecule } from 'matterviz/structure'
import type { Vec3 } from 'matterviz/math'
import type { TrajectoryFrame, TrajectoryType } from 'matterviz/trajectory'

export const FREQUENCY_FILE_LIMIT = 16 * 1024 * 1024
export const FREQUENCY_FRAMES = 48
export const DEFAULT_FREQUENCY_AMPLITUDE = 0.3

export interface FrequencyMode {
  number: number
  frequency: number // cm^-1, including the source's negative sign for imaginary modes
  displacement: Vec3[] // cclib vibdisps: Cartesian, already mass-unweighted
  ir?: number // km/mol
}

export interface FrequencyData {
  structure: Molecule
  modes: FrequencyMode[]
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}

const numbers = (value: unknown, length: number | undefined, label: string): number[] => {
  if (!Array.isArray(value) || !value.length || (length !== undefined && value.length !== length)
      || !value.every(item => typeof item === 'number' && Number.isFinite(item))) {
    throw new Error(`Invalid ${label}: expected ${length ?? 'a nonempty array of'} finite numbers.`)
  }
  return value
}

/** Adapt cclib's existing CJSON export; quantum-chemistry output parsing stays in cclib.
 * This is intentionally not a general CJSON/Avogadro importer: displacement conventions
 * must be those documented for cclib vibdisps. See docs/frequency-viewer.md.
 */
export function read_frequency_cjson(text: string): FrequencyData {
  if (new TextEncoder().encode(text).byteLength > FREQUENCY_FILE_LIMIT) {
    throw new Error('Frequency file exceeds the 16 MiB limit.')
  }
  const data = object(JSON.parse(text))
  if (data['chemical json'] !== 0) throw new Error('Open a CJSON file exported by cclib (chemical json: 0).')
  if (data['unit cell']) throw new Error('This viewer accepts molecular modes without a periodic cell.')
  const atoms = object(data.atoms)
  const atomicNumbers = numbers(object(atoms.elements).number, undefined, 'atomic numbers')
  if (atomicNumbers.length > 2000) throw new Error('Frequency viewing is limited to 2000 atoms.')
  const coords = numbers(object(atoms.coords)['3d'], atomicNumbers.length * 3, 'Cartesian coordinates')
  const sites = atomicNumbers.map((number, index) => {
    const element = element_data.find(element => element.number === number)
    if (!element) throw new Error(`Unknown atomic number at atom ${index + 1}: ${number}.`)
    const xyz = coords.slice(index * 3, index * 3 + 3) as Vec3
    return make_site(element.symbol, [0, 0, 0], xyz, `${element.symbol}${index + 1}`)
  })
  const vibrations = object(data.vibrations)
  const frequencies = numbers(vibrations.frequencies, undefined, 'frequencies (cm^-1)')
  if (frequencies.length > 3 * sites.length) throw new Error('More than 3N modes: export one complete frequency calculation.')
  const displacement = vibrations.displacement
  if (!Array.isArray(displacement) || displacement.length !== frequencies.length) {
    throw new Error('Missing or incomplete normal-mode displacements. Export a calculation containing Cartesian mode vectors with cclib.')
  }
  const rawIR = object(vibrations.intensities).IR
  if (rawIR !== undefined && (!Array.isArray(rawIR) || rawIR.length !== frequencies.length)) {
    throw new Error('IR intensities do not match the mode count.')
  }
  const modes = frequencies.map((frequency, index): FrequencyMode => {
    const vector = displacement[index]
    if (!Array.isArray(vector) || vector.length !== sites.length) {
      throw new Error(`Mode ${index + 1}: displacement atom count does not match the geometry.`)
    }
    const components = vector.map((row, atom) => numbers(row, 3, `mode ${index + 1}, atom ${atom + 1} displacement`) as Vec3)
    if (components.every(row => row.every(value => value === 0))) {
      throw new Error(`Mode ${index + 1} has no nonzero displacement.`)
    }
    if (components.some(row => !Number.isFinite(Math.hypot(...row)))) {
      throw new Error(`Mode ${index + 1}: displacement magnitude is not finite.`)
    }
    const ir = Array.isArray(rawIR) ? rawIR[index] : undefined
    if (ir !== undefined && ir !== null && (typeof ir !== 'number' || !Number.isFinite(ir) || ir < 0)) {
      throw new Error(`Mode ${index + 1}: invalid IR intensity.`)
    }
    return { number: index + 1, frequency, displacement: components, ...(typeof ir === 'number' ? { ir } : {}) }
  })
  // Infer bonds once at equilibrium with MatterViz, then keep them fixed throughout playback.
  const bonds = bonding_strategies.compute_bonds({ sites }, 'electroneg_ratio')
    .map(({ site_idx_1, site_idx_2, bond_order }) => bonding_strategies.normalize_structure_bond(site_idx_1, site_idx_2, bond_order ?? 1))
  const structure: Molecule = { sites, properties: { bonds } }
  return { structure, modes }
}

/** Presentation-only adapter for MatterViz's public on-demand trajectory API.
 * A single visual phase cycle, not dynamics or a frequency calculation. Cartesian
 * vectors retain their relative lengths: never divide cclib vibdisps by sqrt(mass).
 * The global scale makes amplitude the largest atomic excursion in Å.
 */
export function frequency_trajectory(data: FrequencyData, modeIndex: number, amplitude = DEFAULT_FREQUENCY_AMPLITUDE): TrajectoryType {
  const mode = data.modes[modeIndex]
  if (!mode) throw new Error('Select an available normal mode.')
  if (!Number.isFinite(amplitude) || amplitude <= 0 || amplitude > 2) {
    throw new Error('Visual amplitude must be greater than 0 and at most 2 Å.')
  }
  const extent = Math.max(...mode.displacement.map(vector => Math.hypot(...vector)))
  const frame = (index: number): TrajectoryFrame => {
    if (!Number.isInteger(index) || index < 0 || index >= FREQUENCY_FRAMES) throw new Error('Invalid vibration frame.')
    // Start at the equilibrium geometry. FPS controls visual playback independently of cm^-1.
    const excursion = amplitude * Math.sin(2 * Math.PI * index / FREQUENCY_FRAMES)
    return {
      structure: {
        ...data.structure,
        sites: data.structure.sites.map((site, atom) => ({
          ...site,
          xyz: site.xyz.map((coordinate, axis) => coordinate + excursion * (mode.displacement[atom][axis] / extent)) as Vec3,
        })),
      },
      step: index,
    }
  }
  return {
    frames: [frame(0)],
    total_frames: FREQUENCY_FRAMES,
    metadata: { frequency_cm_1: mode.frequency, mode: mode.number, amplitude_angstrom: amplitude },
    frame_loader: {
      load_frame: async (_data, index) => frame(index),
      get_total_frames: async () => FREQUENCY_FRAMES,
      build_frame_index: async () => [],
      extract_plot_metadata: async () => [],
    },
  }
}
