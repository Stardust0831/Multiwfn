import type { IsosurfaceSettings } from 'matterviz'

export type SurfaceAppearance = Partial<Pick<IsosurfaceSettings,
  'wireframe' | 'material' | 'roughness' | 'metalness' | 'shininess' | 'specular' | 'flat_shading' | 'halo'
  | 'outline' | 'outlineWidth' | 'transmode'
>>

export const SURFACE_NUMBER_LIMITS = {
  roughness: [0, 1],
  metalness: [0, 1],
  shininess: [1, 120],
  specular: [0, 1],
  halo: [0, 1],
  outline: [0, 1],
  outlineWidth: [0, 1],
} as const

export type SurfaceNumber = keyof typeof SURFACE_NUMBER_LIMITS

// Keep unset controls consistent with the bundled MatterViz renderer.
export const SURFACE_DEFAULTS = {
  material: 'matte',
  roughness: 0.7,
  metalness: 0,
  shininess: 18,
  specular: 0.12,
  wireframe: false,
  flat_shading: false,
  halo: 0,
  outline: 0,
  outlineWidth: 0.6,
  transmode: 0,
} as const

export const normalize_surface_number = (key: SurfaceNumber, value: unknown): number | undefined => {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  if (!Number.isFinite(number)) return undefined
  const [minimum, maximum] = SURFACE_NUMBER_LIMITS[key]
  return Math.min(maximum, Math.max(minimum, number))
}

/** Read only appearance fields, without introducing defaults into older snapshots. */
export const normalize_surface_appearance = (value: unknown): SurfaceAppearance => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const row = value as Record<string, unknown>
  const appearance: SurfaceAppearance = {}
  if (row.material === 'matte' || row.material === 'glossy' || row.material === 'pbr' || row.material === 'unlit') {
    appearance.material = row.material
  }
  for (const key of ['wireframe', 'flat_shading'] as const) {
    if (typeof row[key] === 'boolean') appearance[key] = row[key]
  }
  for (const key of Object.keys(SURFACE_NUMBER_LIMITS) as SurfaceNumber[]) {
    const number = normalize_surface_number(key, row[key])
    if (number !== undefined) appearance[key] = number
  }
  if (row.transmode === 0 || row.transmode === 1) appearance.transmode = row.transmode
  return appearance
}

export type SurfacePreset = 'matte' | 'soft-gloss' | 'satin' | 'unlit'

type SurfacePresetDefinition = {
  value: SurfacePreset
  label: string
  description: string
  appearance: Omit<SurfaceAppearance, 'halo'>
}

const SMOOTH_FINISH = {
  wireframe: false,
  flat_shading: false,
  outline: 0,
  outlineWidth: 0.6,
  transmode: 0,
} as const

export const SURFACE_PRESETS: ReadonlyArray<SurfacePresetDefinition> = [
  {
    value: 'matte',
    label: 'Matte',
    description: 'Diffuse shading with no specular highlights.',
    appearance: { ...SMOOTH_FINISH, material: 'matte' },
  },
  {
    value: 'soft-gloss',
    label: 'Soft gloss',
    description: 'Gentle highlights bring out the surface curvature.',
    appearance: { ...SMOOTH_FINISH, material: 'glossy', shininess: 24, specular: 0.16 },
  },
  {
    value: 'satin',
    label: 'Satin',
    description: 'A smooth, nonmetallic finish with broad highlights.',
    appearance: { ...SMOOTH_FINISH, material: 'pbr', roughness: 0.48, metalness: 0 },
  },
  {
    value: 'unlit',
    label: 'Unlit color',
    description: 'Colors stay independent of lighting and surface orientation.',
    appearance: { ...SMOOTH_FINISH, material: 'unlit' },
  },
]

/** Presets change shading only; layer data and periodic geometry retain their identities. */
export const apply_surface_preset = (settings: IsosurfaceSettings, preset: SurfacePreset): IsosurfaceSettings => {
  const definition = SURFACE_PRESETS.find((item) => item.value === preset)
  return definition ? { ...settings, ...definition.appearance } : settings
}

/** Derive the selection from active renderer values so manual edits cannot leave a stale marker. */
export const detect_surface_preset = (settings: SurfaceAppearance): SurfacePreset | 'custom' => {
  const effective = { ...SURFACE_DEFAULTS, ...normalize_surface_appearance(settings) }
  const definition = SURFACE_PRESETS.find(({ appearance }) =>
    (Object.keys(appearance) as Array<keyof typeof appearance>).every((key) => {
      if (effective.material === 'unlit' && key !== 'material' && key !== 'wireframe') return true
      if (key === 'outlineWidth' && effective.outline === 0) return true
      const expected = appearance[key]
      const actual = effective[key]
      return typeof expected === 'number' && typeof actual === 'number'
        ? Math.abs(expected - actual) < 1e-9
        : expected === actual
    }),
  )
  return definition?.value ?? 'custom'
}
