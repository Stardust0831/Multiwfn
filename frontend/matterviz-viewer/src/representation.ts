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
const ATOM_BASE_KEY = 'representation_atom_base'
const BOND_BASE_KEY = 'representation_bond_base'

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

const marker_matches_visibility = (
  scene_props: RepresentationSceneProps,
  preset: RepresentationPreset,
): boolean => {
  const expected_atoms = preset === 'ballstick' || preset === 'spacefill'
  const expected_bonds = preset === 'spacefill' ? 'never' : 'always'
  return (scene_props.show_atoms === undefined || scene_props.show_atoms === expected_atoms)
    && (scene_props.show_bonds === undefined || scene_props.show_bonds === expected_bonds)
}

export const normalize_representation_preset = (value: unknown): RepresentationPreset =>
  preset_value(value) ?? 'ballstick'

/**
 * Detect a preset from authoritative scene props. The explicit marker is set by
 * apply_representation_preset and keeps manual refinement controls unambiguous;
 * the structural fallback also handles restored or externally supplied props.
 */
export const detect_representation_preset = (scene_props: RepresentationSceneProps): RepresentationPreset => {
  const marked = preset_value(scene_props.representation_preset)
  if (marked && marker_matches_visibility(scene_props, marked)) return marked

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

  const marker = preset_value(scene_props.representation_preset)
  const marker_is_current = marker !== undefined && marker === current_preset
    && marker_matches_visibility(scene_props, marker)
  let atom = marker_is_current
    ? clamp(finite_number(scene_props[ATOM_BASE_KEY], current_atom), ATOM_MIN, ATOM_MAX)
    : current_atom
  let bond = marker_is_current
    ? clamp(finite_number(scene_props[BOND_BASE_KEY], current_bond), BOND_MIN, BOND_MAX)
    : current_bond
  if (!marker_is_current && current_preset === 'spacefill') atom = current_atom / 1.85
  if (!marker_is_current && current_preset === 'stick') bond = current_bond / 1.18
  if (!marker_is_current && current_preset === 'wire') {
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
    [ATOM_BASE_KEY]: base.atom,
    [BOND_BASE_KEY]: base.bond,
    show_atoms: normalized === 'ballstick' || normalized === 'spacefill',
    show_bonds: normalized === 'spacefill' ? 'never' : 'always',
    atom_radius: atom,
    same_size_atoms: false,
    bond_thickness: bond,
  }
}

const close_enough = (left: number, right: number): boolean =>
  Math.abs(left - right) <= 1e-9

/** Refine one displayed dimension while retaining its untransformed base. */
export const refine_representation = (
  scene_props: RepresentationSceneProps,
  key: 'atom_radius' | 'bond_thickness',
  value: unknown,
): RepresentationSceneProps => {
  const preset = detect_representation_preset(scene_props)
  const next_value = key === 'atom_radius'
    ? atom_radius(value)
    : bond_thickness(value)
  const base = base_values(scene_props)
  const marker = preset_value(scene_props.representation_preset)
  const marker_is_current = marker !== undefined && marker === preset
    && marker_matches_visibility(scene_props, marker)
  const marked_base = key === 'atom_radius'
    ? clamp(finite_number(scene_props[ATOM_BASE_KEY], base.atom), ATOM_MIN, ATOM_MAX)
    : clamp(finite_number(scene_props[BOND_BASE_KEY], base.bond), BOND_MIN, BOND_MAX)
  const ratio = key === 'atom_radius' && preset === 'spacefill'
    ? 1.85
    : key === 'bond_thickness' && preset === 'stick'
      ? 1.18
      : key === 'bond_thickness' && preset === 'wire'
        ? 0.28
        : 1
  const projected = key === 'atom_radius'
    ? clamp(marked_base * ratio, ATOM_MIN, ATOM_MAX)
    : clamp(preset === 'wire' ? Math.max(0.025, marked_base * ratio) : marked_base * ratio, BOND_MIN, BOND_MAX)
  const next_base = marker_is_current && close_enough(projected, next_value)
    ? marked_base
    : key === 'bond_thickness' && preset === 'wire' && next_value <= 0.025
      ? next_value
      : clamp(next_value / ratio, key === 'atom_radius' ? ATOM_MIN : BOND_MIN, key === 'atom_radius' ? ATOM_MAX : BOND_MAX)
  return {
    ...scene_props,
    [key]: next_value,
    ...(marker_is_current
      ? { [key === 'atom_radius' ? ATOM_BASE_KEY : BOND_BASE_KEY]: next_base }
      : {}),
  }
}

export const scene_props_for_representation = apply_representation_preset
export const representation_from_scene_props = detect_representation_preset
