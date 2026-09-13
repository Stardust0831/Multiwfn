export const LIGHTING_DEFAULTS = { ambient_light: 0.72, directional_light: 1.2 } as const
export type LightingKey = keyof typeof LIGHTING_DEFAULTS
export type LightingSettings = Partial<Record<LightingKey, number>>

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
  if (ambient !== undefined) settings.ambient_light = ambient
  if (directional !== undefined) settings.directional_light = directional
  return settings
}
