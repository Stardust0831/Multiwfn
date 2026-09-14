export type AtomStyle = 'current' | 'goodsell' | 'edgy' | 'glass' | 'metallic' | 'matte'

export type AtomStyleSettings = {
  atom_style?: AtomStyle
  atom_roughness?: number
  atom_metalness?: number
  atom_opacity?: number
  atom_outline?: number
  atom_outline_width?: number
}

export const ATOM_STYLE_PRESETS: ReadonlyArray<{ value: AtomStyle; label: string; roughness: number; metalness: number; opacity: number; outline: number; outlineWidth: number }> = [
  { value: 'current', label: 'Current', roughness: .5, metalness: .07, opacity: 1, outline: .10, outlineWidth: .6 },
  { value: 'goodsell', label: 'Goodsell', roughness: .7, metalness: 0, opacity: 1, outline: .10, outlineWidth: .6 },
  { value: 'edgy', label: 'Edgy', roughness: .25, metalness: 0, opacity: 1, outline: .50, outlineWidth: .9 },
  { value: 'glass', label: 'Glass', roughness: .05, metalness: 0, opacity: .55, outline: .05, outlineWidth: .6 },
  { value: 'metallic', label: 'Metallic', roughness: .28, metalness: .80, opacity: 1, outline: .05, outlineWidth: .6 },
  { value: 'matte', label: 'Matte', roughness: .92, metalness: 0, opacity: 1, outline: 0, outlineWidth: .6 },
]

const clamp = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined
}

export const normalize_atom_style = (value: unknown): AtomStyleSettings => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const row = value as Record<string, unknown>
  const result: AtomStyleSettings = {}
  const style = row.atomStyle ?? row.atom_style
  if (ATOM_STYLE_PRESETS.some((p) => p.value === style)) result.atom_style = style as AtomStyle
  const roughness = clamp(row.atomRoughness ?? row.atom_roughness, 0, 1)
  const metalness = clamp(row.atomMetalness ?? row.atom_metalness, 0, 1)
  const opacity = clamp(row.atomOpacity ?? row.atom_opacity, 0, 1)
  const outline = clamp(row.atomOutline ?? row.atom_outline, 0, 1)
  const width = clamp(row.atomOutlineWidth ?? row.atom_outline_width, 0, 1)
  if (roughness !== undefined) result.atom_roughness = roughness
  if (metalness !== undefined) result.atom_metalness = metalness
  if (opacity !== undefined) result.atom_opacity = opacity
  if (outline !== undefined) result.atom_outline = outline
  if (width !== undefined) result.atom_outline_width = width
  return result
}

export const apply_atom_style = (scene: Record<string, unknown>, style: AtomStyle): Record<string, unknown> => {
  const preset = ATOM_STYLE_PRESETS.find((p) => p.value === style)
  // TMIM's original atom renderer used MeshStandardMaterial for every finish;
  // preserve that shading model while varying the PBR parameters.
  const material = 'pbr'
  return preset ? { ...scene, atom_style: style, atom_material: material, atom_roughness: preset.roughness, atom_metalness: preset.metalness, atom_opacity: preset.opacity, atom_outline: preset.outline, atom_outline_width: preset.outlineWidth } : scene
}

export const atom_style_values = (scene: Record<string, unknown>) => {
  const normalized = normalize_atom_style(scene)
  const preset = ATOM_STYLE_PRESETS.find((p) => p.value === normalized.atom_style)
  return { ...preset, ...normalized }
}
