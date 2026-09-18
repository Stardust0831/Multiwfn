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
  | 'diffuse' | 'goodsell' | 'edgy' | 'edgy-shiny' | 'ao-shiny' | 'ao-chalky'
  | 'glass1' | 'glass-bubble' | 'edgy-glass' | 'brushed-metal' | 'metallic' | 'pbr'

type SurfacePresetDefinition = {
  value: SurfacePreset
  label: string
  description: string
  group?: 'legacy'
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
  // Original MaterialPanel combinations. Preserve their parameter values and
  // familiar names, while keeping the existing four finishes as the primary set.
  {
    value: 'diffuse', label: 'Diffuse', group: 'legacy',
    description: 'Diffuse shading with no specular highlights, like Matte.',
    appearance: { ...SMOOTH_FINISH, material: 'matte', outline: 0, outlineWidth: 0.6, transmode: 0 },
  },
  {
    value: 'goodsell', label: 'Goodsell', group: 'legacy',
    description: 'The original smooth matte finish with no specular highlights.',
    appearance: {
      ...SMOOTH_FINISH, material: 'matte', roughness: 0.7, metalness: 0, shininess: 18,
      specular: 0.12, outline: 0, outlineWidth: 0.6, transmode: 0,
    },
  },
  {
    value: 'edgy', label: 'Edgy', group: 'legacy',
    description: 'Glossy highlights with a strong, broad dark rim.',
    appearance: { ...SMOOTH_FINISH, material: 'glossy', shininess: 50, specular: 0.5, outline: 0.5, outlineWidth: 0.9, transmode: 0 },
  },
  {
    value: 'edgy-shiny', label: 'EdgyShiny', group: 'legacy',
    description: 'Bright, tight highlights with a pronounced dark rim.',
    appearance: { ...SMOOTH_FINISH, material: 'glossy', shininess: 70, specular: 0.85, outline: 0.6, outlineWidth: 0.92, transmode: 0 },
  },
  {
    value: 'ao-shiny', label: 'AOShiny', group: 'legacy',
    description: 'Glossy shading with a subtle rim; the original name does not add ambient occlusion.',
    appearance: { ...SMOOTH_FINISH, material: 'glossy', shininess: 45, specular: 0.55, outline: 0.15, outlineWidth: 0.7, transmode: 0 },
  },
  {
    value: 'ao-chalky', label: 'AOChalky', group: 'legacy',
    description: 'Soft highlights with a subtle rim; the original name does not add ambient occlusion.',
    appearance: { ...SMOOTH_FINISH, material: 'glossy', shininess: 20, specular: 0.2, outline: 0.1, outlineWidth: 0.6, transmode: 0 },
  },
  {
    value: 'glass1', label: 'Glass1', group: 'legacy',
    description: 'Glossy highlights with stronger grazing edges on transparent layers.',
    appearance: { ...SMOOTH_FINISH, material: 'glossy', shininess: 55, specular: 0.65, outline: 0.05, outlineWidth: 0.6, transmode: 1 },
  },
  {
    value: 'glass-bubble', label: 'GlassBubble', group: 'legacy',
    description: 'Bright, tight highlights with stronger edges on transparent layers.',
    appearance: { ...SMOOTH_FINISH, material: 'glossy', shininess: 90, specular: 0.95, outline: 0.05, outlineWidth: 0.6, transmode: 1 },
  },
  {
    value: 'edgy-glass', label: 'EdgyGlass', group: 'legacy',
    description: 'Glossy shading and a broad dark rim with stronger edges on transparent layers.',
    appearance: { ...SMOOTH_FINISH, material: 'glossy', shininess: 70, specular: 0.6, outline: 0.5, outlineWidth: 0.9, transmode: 1 },
  },
  {
    value: 'brushed-metal', label: 'BrushedMetal', group: 'legacy',
    description: 'A rough metallic finish with a subtle dark rim.',
    appearance: { ...SMOOTH_FINISH, material: 'pbr', metalness: 0.75, roughness: 0.35, specular: 0.3, outline: 0.05, outlineWidth: 0.6, transmode: 0 },
  },
  {
    value: 'metallic', label: 'Metallic', group: 'legacy',
    description: 'A smooth metallic finish with a subtle dark rim.',
    appearance: { ...SMOOTH_FINISH, material: 'pbr', metalness: 0.8, roughness: 0.28, specular: 0.3, outline: 0.05, outlineWidth: 0.6, transmode: 0 },
  },
  {
    value: 'pbr', label: 'PBR', group: 'legacy',
    description: 'A moderately rough finish with mild metalness and rim contrast.',
    appearance: { ...SMOOTH_FINISH, material: 'pbr', metalness: 0.2, roughness: 0.5, specular: 0.2, outline: 0.15, outlineWidth: 0.6, transmode: 0 },
  },
]

/** Presets change shading only; layer data and periodic geometry retain their identities. */
export const apply_surface_preset = (settings: IsosurfaceSettings, preset: SurfacePreset): IsosurfaceSettings => {
  const definition = SURFACE_PRESETS.find((item) => item.value === preset)
  return definition ? { ...settings, ...definition.appearance } : settings
}

/** Match rendered effects, not click history. Diffuse and Goodsell resolve to Matte. */
export const detect_surface_preset = (settings: SurfaceAppearance): SurfacePreset | 'custom' => {
  const effective = { ...SURFACE_DEFAULTS, ...normalize_surface_appearance(settings) }
  const definition = SURFACE_PRESETS.find(({ appearance }) =>
    (Object.keys(appearance) as Array<keyof typeof appearance>).every((key) => {
      if (effective.material === 'unlit' && key !== 'material' && key !== 'wireframe') return true
      if ((key === 'roughness' || key === 'metalness') && effective.material !== 'pbr') return true
      if ((key === 'shininess' || key === 'specular') && effective.material !== 'glossy') return true
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
