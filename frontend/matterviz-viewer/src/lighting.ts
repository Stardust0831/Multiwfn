export const LIGHTING_DEFAULTS = { ambient_light: 0.72, directional_light: 1.2 } as const
export const TMIM_LIGHTING_DEFAULTS = {
  ambient_light: 1.25, directional_light: 1.55, fill_light: 0.85, rim_light: 0.42,
} as const
export type LightingKey = 'ambient_light' | 'directional_light' | 'fill_light' | 'rim_light'
export type LightingRig = 'default' | 'tmim'
export type SceneToneMapping = 'agx' | 'none'
export type LightingSettings = Partial<Record<LightingKey, number>> & {
  lighting_rig?: LightingRig
  scene_tone_mapping?: SceneToneMapping
}

export const normalize_light_intensity = (value: unknown): number | undefined => {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  return Number.isFinite(number) ? Math.min(4, Math.max(0, number)) : undefined
}

/** Accept scene props and saved workbench names; absent fields retain the current lighting. */
export const normalize_lighting = (value: unknown): LightingSettings => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const row = value as Record<string, unknown>
  const settings: LightingSettings = {}
  const ambient = normalize_light_intensity(row.ambientLight ?? row.ambient_light)
  const directional = normalize_light_intensity(row.directionalLight ?? row.directional_light)
  const fill = normalize_light_intensity(row.fillLight ?? row.fill_light)
  const rim = normalize_light_intensity(row.rimLight ?? row.rim_light)
  if (ambient !== undefined) settings.ambient_light = ambient
  if (directional !== undefined) settings.directional_light = directional
  if (fill !== undefined) settings.fill_light = fill
  if (rim !== undefined) settings.rim_light = rim
  const rig = row.lightingRig ?? row.lighting_rig
  if (rig === 'default' || rig === 'tmim') settings.lighting_rig = rig
  const tone = row.sceneToneMapping ?? row.scene_tone_mapping
  if (tone === 'agx' || tone === 'none') settings.scene_tone_mapping = tone
  return settings
}
