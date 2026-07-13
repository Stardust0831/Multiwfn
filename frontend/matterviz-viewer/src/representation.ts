export type RepresentationPreset = 'ballstick' | 'spacefill' | 'stick' | 'wire'

export type RepresentationSceneProps = Record<string, unknown>

export const REPRESENTATION_PRESETS: ReadonlyArray<{
  value: RepresentationPreset
  label: string
}> = [
  { value: 'ballstick', label: 'Ball+Stick' },
  { value: 'spacefill', label: 'Spacefill' },
  { value: 'stick', label: 'Stick' },
  { value: 'wire', label: 'Wire' },
]

const ATOM_MIN = 0.1
const ATOM_MAX = 3
const BOND_MIN = 0.01
const BOND_MAX = 1
const DEFAULT_ATOM_RADIUS = 0.7
const DEFAULT_BOND_THICKNESS = 0.07

const finite_number = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

const atom_radius = (value: unknown): number =>
  clamp(finite_number(value, DEFAULT_ATOM_RADIUS), ATOM_MIN, ATOM_MAX)

const bond_thickness = (value: unknown): number =>
  clamp(finite_number(value, DEFAULT_BOND_THICKNESS), BOND_MIN, BOND_MAX)

const preset_value = (value: unknown): RepresentationPreset | undefined =>
  value === 'ballstick' || value === 'spacefill' || value === 'stick' || value === 'wire'
    ? value
    : undefined

export const normalize_representation_preset = (value: unknown): RepresentationPreset =>
  preset_value(value) ?? 'ballstick'

/**
 * Detect a preset from authoritative scene props. The explicit marker is set by
 * apply_representation_preset and keeps manual refinement controls unambiguous;
 * the structural fallback also handles restored or externally supplied props.
 */
export const detect_representation_preset = (scene_props: RepresentationSceneProps): RepresentationPreset => {
  const marked = preset_value(scene_props.representation_preset)
  if (marked) return marked

  const show_atoms = scene_props.show_atoms !== false
  const show_bonds = scene_props.show_bonds
  if (show_atoms && show_bonds === 'never') return 'spacefill'
  if (!show_atoms && (show_bonds === undefined || show_bonds === 'always')) {
    // Wire is the only mode with a deliberately sub-bond-radius thickness at
    // the standard base. Keep this heuristic conservative for legacy props.
    return bond_thickness(scene_props.bond_thickness) <= 0.05 ? 'wire' : 'stick'
  }
  return 'ballstick'
}

const base_values = (scene_props: RepresentationSceneProps): {
  atom: number
  bond: number
} => {
  const current_preset = detect_representation_preset(scene_props)
  const current_atom = atom_radius(scene_props.atom_radius)
  const current_bond = bond_thickness(scene_props.bond_thickness)

  let atom = current_atom
  let bond = current_bond
  if (current_preset === 'spacefill') atom = current_atom / 1.85
  if (current_preset === 'stick') bond = current_bond / 1.18
  if (current_preset === 'wire') {
    // The wire preset has a visible lower bound. At the bound, retain the
    // user's refined value instead of manufacturing a larger base on every
    // switch.
    bond = current_bond <= 0.025 ? current_bond : current_bond / 0.28
  }
  return {
    atom: clamp(atom, ATOM_MIN, ATOM_MAX),
    bond: clamp(bond, BOND_MIN, BOND_MAX),
  }
}

/** Map a named representation to one atomic scene-props update. */
export const apply_representation_preset = (
  scene_props: RepresentationSceneProps,
  preset: RepresentationPreset,
): RepresentationSceneProps => {
  const normalized = normalize_representation_preset(preset)
  const base = base_values(scene_props)
  const atom = normalized === 'spacefill'
    ? clamp(base.atom * 1.85, ATOM_MIN, ATOM_MAX)
    : base.atom
  const bond = normalized === 'stick'
    ? clamp(base.bond * 1.18, BOND_MIN, BOND_MAX)
    : normalized === 'wire'
      ? clamp(Math.max(0.025, base.bond * 0.28), BOND_MIN, BOND_MAX)
      : base.bond

  return {
    ...scene_props,
    representation_preset: normalized,
    show_atoms: normalized === 'ballstick' || normalized === 'spacefill',
    show_bonds: normalized === 'spacefill' ? 'never' : 'always',
    atom_radius: atom,
    same_size_atoms: false,
    bond_thickness: bond,
  }
}

export const scene_props_for_representation = apply_representation_preset
export const representation_from_scene_props = detect_representation_preset
