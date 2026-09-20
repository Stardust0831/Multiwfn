import type { IsosurfaceLayer, IsosurfaceSettings } from 'matterviz'
import { SURFACE_DEFAULTS, SURFACE_PRESETS } from './material.ts'
import { detect_representation_preset, type RepresentationPreset } from './representation.ts'
import { legacy_color_scale, normalize_color_scale, preset_color_scale, volume_color_scale, type ColorScale } from './color-scale.ts'

export type Vec = [number, number, number]
export type Cell = [Vec, Vec, Vec]
export type RepRange = [[number, number], [number, number], [number, number]]
export type RepMaterial = {
  model: 'matte' | 'glossy' | 'pbr' | 'unlit'
  opacity: number
  diffuse: number
  saturation: number
  specular: number
  shininess: number
  roughness: number
  metalness: number
  outline: number
  outlineWidth: number
  angleOpacity: boolean
  faceted: boolean
}
export type RepPeriodic = {
  enabled: boolean
  axes: [boolean, boolean, boolean]
  range: RepRange
  cell?: Cell
  showCell: boolean
  boundary: 'clip' | 'atoms' | 'none'
}
export type Rep = {
  id: string
  name: string
  visible: boolean
  followData?: boolean
  source: { kind: 'structure' } | { kind: 'volume'; index: number; path?: string; slot?: number }
  structure: { style: RepresentationPreset; selection: string; radius: number; bondRadius: number; labels: boolean; indices: boolean }
  volume: IsosurfaceLayer & { wireframe: boolean; colorSourcePath?: string; colorSourceSlot?: number; colorScale?: ColorScale }
  material: RepMaterial
  periodic: RepPeriodic
}
export type RepCollection = { items: Rep[]; selectedId: string }
export const MAX_REPS = 32
export const dataset_source = (entries: Array<{ path: string; datasetSlot?: number }>, index: number): Extract<Rep['source'], { kind: 'volume' }> => ({
  kind: 'volume', index, path: entries[index]?.path,
  slot: entries[index]?.datasetSlot ?? entries.slice(0, index).filter((entry) => entry.path === entries[index]?.path).length,
})
export const dataset_key = (entries: Array<{ path: string; datasetSlot?: number }>, index: number): string => {
  const source = dataset_source(entries, index)
  return JSON.stringify([source.path ?? `index:${index}`, source.slot])
}
export const DEFAULT_REP_MATERIAL: RepMaterial = {
  model: 'glossy', opacity: 1, diffuse: 1, saturation: 1, specular: 0.28, shininess: 42,
  roughness: 0.5, metalness: 0, outline: 0, outlineWidth: 0.6,
  angleOpacity: false, faceted: false,
}
export const unit_range = (): RepRange => [[0, 1], [0, 1], [0, 1]]
export const create_rep = (source: Rep['source'], id: string = crypto.randomUUID()): Rep => ({
  id, name: source.kind === 'structure' ? 'Structure' : `Volume ${source.index + 1}`, visible: true, source: { ...source },
  structure: { style: 'ballstick', selection: 'all', radius: 0.7, bondRadius: 0.07, labels: false, indices: false },
  volume: { isovalue: 0.02, opacity: 1, color: '#3177ba', negative_color: '#ce5588', show_negative: true, visible: true, wireframe: false, volume_idx: source.kind === 'volume' ? source.index : 0, colorScale: preset_color_scale('interpolateTransFlag') },
  material: { ...DEFAULT_REP_MATERIAL },
  periodic: { enabled: false, axes: [true, true, true], range: unit_range(), showCell: false, boundary: 'clip' },
})

export const copy_rep = (rep: Rep, id: string = crypto.randomUUID()): Rep => ({ ...structuredClone(rep), id, followData: false, name: `${rep.name} · 2` })
const number = (value: unknown, fallback: number, lo: number, hi: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const bool = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback
const color = (value: unknown, fallback: string): string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback

export const valid_cell = (value: unknown): value is Cell => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n)))) return false
  const [a, b, c] = value as Cell
  const determinant = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
  const scale = Math.hypot(...a) * Math.hypot(...b) * Math.hypot(...c)
  return scale > 1e-12 && Math.abs(determinant) > scale * 1e-8
}
export const valid_range = (value: unknown): value is RepRange =>
  Array.isArray(value) && value.length === 3 && value.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 20) && pair[0] < pair[1])

export const normalize_rep = (value: unknown): Rep | undefined => {
  const row = record(value), source = record(row.source)
  if (typeof row.id !== 'string' || !row.id || (source.kind !== 'structure' && source.kind !== 'volume')) return
  if (source.kind === 'volume' && (!Number.isInteger(source.index) || ((source.index as number) < 0 && !(source.index === -1 && typeof source.path === 'string')))) return
  const rep = create_rep(source.kind === 'structure' ? { kind: 'structure' } : { kind: 'volume', index: source.index as number, ...(typeof source.path === 'string' ? { path: source.path } : {}), slot: Math.floor(number(source.slot, 0, 0, 100000)) }, row.id)
  if (typeof row.name === 'string') rep.name = row.name.slice(0, 120)
  rep.visible = bool(row.visible, true)
  rep.followData = bool(row.followData, false)
  const structure = record(row.structure), material = record(row.material), periodic = record(row.periodic), volume = record(row.volume)
  if (['ballstick', 'spacefill', 'stick', 'wire'].includes(String(structure.style))) rep.structure.style = structure.style as RepresentationPreset
  if (typeof structure.selection === 'string') rep.structure.selection = structure.selection.slice(0, 2000)
  rep.structure.radius = number(structure.radius, 0.7, 0.1, 3)
  rep.structure.bondRadius = number(structure.bondRadius, 0.07, 0.01, 1)
  rep.structure.labels = bool(structure.labels, false); rep.structure.indices = bool(structure.indices, false)
  if (['matte', 'glossy', 'pbr', 'unlit'].includes(String(material.model))) rep.material.model = material.model as RepMaterial['model']
  for (const key of ['opacity', 'specular', 'roughness', 'metalness', 'outline', 'outlineWidth'] as const) rep.material[key] = number(material[key], rep.material[key], 0, 1)
  for (const key of ['diffuse', 'saturation'] as const) rep.material[key] = number(material[key], 1, 0, 3)
  rep.material.shininess = number(material.shininess, 42, 1, 120)
  rep.material.angleOpacity = bool(material.angleOpacity, false); rep.material.faceted = bool(material.faceted, false)
  if (['clip', 'atoms', 'none'].includes(String(periodic.boundary))) rep.periodic.boundary = periodic.boundary as RepPeriodic['boundary']
  rep.periodic.enabled = bool(periodic.enabled, false); rep.periodic.showCell = bool(periodic.showCell, false)
  if (Array.isArray(periodic.axes) && periodic.axes.length === 3 && periodic.axes.every((v) => typeof v === 'boolean')) rep.periodic.axes = [...periodic.axes] as RepPeriodic['axes']
  // Do not silently render a different cell/range when restoring malformed input.
  if (periodic.cell !== undefined && !valid_cell(periodic.cell)) throw new Error('Invalid Rep lattice: vectors must form a nonsingular cell')
  if (periodic.range !== undefined && !valid_range(periodic.range)) throw new Error('Invalid Rep range: each lower bound must be below its upper bound, within −20…20')
  if (periodic.cell) rep.periodic.cell = (periodic.cell as Cell).map((vector) => [...vector]) as Cell
  if (periodic.range) rep.periodic.range = (periodic.range as RepRange).map((pair) => [...pair]) as RepRange
  rep.volume.isovalue = number(volume.isovalue, 0.02, -1e10, 1e10)
  rep.volume.color = color(volume.color, rep.volume.color); rep.volume.negative_color = color(volume.negative_color, rep.volume.negative_color)
  rep.volume.opacity = rep.material.opacity
  rep.volume.show_negative = bool(volume.show_negative, true); rep.volume.wireframe = bool(volume.wireframe, false)
  if (typeof volume.colormap === 'string' && /^interpolate[A-Za-z]+$/.test(volume.colormap)) rep.volume.colormap = volume.colormap as IsosurfaceLayer['colormap']
  if (Number.isInteger(volume.color_volume_idx) && (volume.color_volume_idx as number) >= 0) rep.volume.color_volume_idx = volume.color_volume_idx as number
  if (typeof volume.colorSourcePath === 'string') rep.volume.colorSourcePath = volume.colorSourcePath
  if (typeof volume.colorSourceSlot === 'number') rep.volume.colorSourceSlot = Math.floor(number(volume.colorSourceSlot, 0, 0, 100000))
  if (Array.isArray(volume.color_range) && volume.color_range.length === 2 && volume.color_range.every((n) => typeof n === 'number' && Number.isFinite(n))) rep.volume.color_range = [...volume.color_range].sort((a, b) => a - b) as [number, number]
  rep.volume.colorScale = volume.colorScale !== undefined ? normalize_color_scale(volume.colorScale)
    : volume.color_stops !== undefined ? normalize_color_scale({ stops: volume.color_stops })
    : legacy_color_scale(rep.volume.colormap, rep.volume.color_range)
  return rep
}

export const normalize_reps = (value: unknown): RepCollection | undefined => {
  const row = record(value)
  if (value === undefined) return
  if (!Array.isArray(row.items)) throw new Error('Invalid representations in saved scene')
  if (row.items.length > MAX_REPS) throw new Error(`A scene supports at most ${MAX_REPS} representations`)
  const items = row.items.map(normalize_rep)
  if (items.some((rep) => !rep)) throw new Error('Invalid representation in saved scene')
  const valid = items as Rep[]
  if (new Set(valid.map((rep) => rep.id)).size !== valid.length) throw new Error('Duplicate representation identities in saved scene')
  return { items: valid, selectedId: valid.some((rep) => rep.id === row.selectedId) ? row.selectedId as string : valid[0]?.id ?? '' }
}

export const rep_surface_settings = (rep: Rep, budget?: number): IsosurfaceSettings => ({
  ...SURFACE_DEFAULTS, isovalue: rep.volume.isovalue, opacity: rep.material.opacity,
  positive_color: rep.volume.color, negative_color: rep.volume.negative_color,
  show_negative: rep.volume.show_negative, wireframe: rep.volume.wireframe, halo: 0,
  material: rep.material.model, roughness: rep.material.roughness, metalness: rep.material.metalness,
  shininess: rep.material.shininess, specular: rep.material.specular, outline: rep.material.outline,
  outlineWidth: rep.material.outlineWidth, transmode: rep.material.angleOpacity ? 1 : 0, flat_shading: rep.material.faceted,
  layers: [{ ...rep.volume, color_stops: volume_color_scale(rep.volume).stops,
    color_range: rep.volume.color_range ? [...rep.volume.color_range].sort((a, b) => a - b) as [number, number] : undefined,
    volume_idx: rep.source.kind === 'volume' ? rep.source.index : 0, opacity: rep.material.opacity, visible: rep.visible }],
  geometry_memory_budget_bytes: budget,
})

export const rep_scene_props = (rep: Rep): Record<string, unknown> => ({
  show_atoms: rep.structure.style === 'ballstick' || rep.structure.style === 'spacefill',
  show_bonds: rep.structure.style === 'spacefill' ? 'never' : 'always',
  atom_radius: rep.structure.radius, bond_thickness: rep.structure.bondRadius, same_size_atoms: false,
  atom_material: rep.material.model, atom_opacity: rep.material.opacity, atom_roughness: rep.material.roughness,
  atom_metalness: rep.material.metalness, atom_shininess: rep.material.shininess, atom_specular: rep.material.specular,
  atom_outline: rep.material.outline, atom_outline_width: rep.material.outlineWidth,
  atom_transmode: rep.material.angleOpacity ? 1 : 0,
  show_site_labels: rep.structure.labels, show_site_indices: rep.structure.indices,
  outline_enabled: false,
})

export const material_preset = (material: RepMaterial, preset: string): RepMaterial => {
  const definition = SURFACE_PRESETS.find((item) => item.value === preset)
  if (!definition) return material
  const appearance = { ...SURFACE_DEFAULTS, ...definition.appearance }
  return { ...material, opacity: preset.includes('glass') ? 0.35 : 1, model: appearance.material ?? 'matte', diffuse: 1, saturation: 1, specular: appearance.specular,
    shininess: appearance.shininess, roughness: appearance.roughness, metalness: appearance.metalness,
    outline: appearance.outline, outlineWidth: appearance.outlineWidth,
    angleOpacity: appearance.transmode === 1, faceted: appearance.flat_shading }
}

/** Migration is explicit; subsequent edits are owned only by the selected Rep. */
export const migrate_reps = (scene: Record<string, unknown>, settings: IsosurfaceSettings, entries: Array<{ path: string; name?: string; datasetSlot?: number }>, periodic = false, legacy?: { atomSupercell?: string; showBoundaryAtoms?: boolean; showUnitCell?: boolean }): RepCollection => {
  const structure = create_rep({ kind: 'structure' }, 'structure-1')
  structure.visible = scene.show_atoms !== false || scene.show_bonds !== 'never'
  structure.structure = { ...structure.structure, style: detect_representation_preset(scene), radius: Number(scene.atom_radius) || 0.7, bondRadius: Number(scene.bond_thickness) || 0.07, labels: scene.show_site_labels === true, indices: scene.show_site_indices === true }
  structure.material = { ...structure.material, model: (scene.atom_material as RepMaterial['model']) ?? 'glossy', opacity: typeof scene.atom_opacity === 'number' ? scene.atom_opacity : 1, roughness: Number(scene.atom_roughness ?? 0.32), metalness: Number(scene.atom_metalness ?? 0), specular: Number(scene.atom_specular ?? 0.28), shininess: Number(scene.atom_shininess ?? 42), outline: Number(scene.atom_outline ?? 0), outlineWidth: Number(scene.atom_outline_width ?? 0.6) }
  structure.periodic.enabled = periodic; structure.periodic.showCell = periodic && legacy?.showUnitCell !== false
  if (periodic) {
    const scaling = legacy?.atomSupercell?.split(/[x×]/).map(Number)
    if (scaling?.length === 3 && scaling.every((n) => Number.isInteger(n) && n > 0 && n <= 20)) structure.periodic.range = scaling.map((n) => [0, n]) as RepRange
    structure.periodic.boundary = legacy?.showBoundaryAtoms === false ? 'none' : 'atoms'
  }
  const volumes = (settings.layers ?? []).slice(0, MAX_REPS - 1).map((layer, index) => {
    const volumeIdx = layer.volume_idx ?? index
    const rep = create_rep(dataset_source(entries, volumeIdx), `volume-${index + 1}`)
    rep.followData = true
    rep.name = entries[volumeIdx]?.name ?? `Volume ${volumeIdx + 1}`
    rep.volume = { ...layer, colorScale: volume_color_scale(layer), wireframe: settings.wireframe, colorSourcePath: layer.color_volume_idx === undefined ? undefined : entries[layer.color_volume_idx]?.path,
      colorSourceSlot: layer.color_volume_idx === undefined ? undefined : dataset_source(entries, layer.color_volume_idx).slot }
    const appearance = { ...SURFACE_DEFAULTS, ...settings }
    rep.material = { ...rep.material, model: appearance.material ?? 'matte', opacity: layer.opacity,
      roughness: appearance.roughness!, metalness: appearance.metalness!, shininess: appearance.shininess!, specular: appearance.specular!,
      outline: appearance.outline!, outlineWidth: appearance.outlineWidth!, angleOpacity: appearance.transmode === 1, faceted: appearance.flat_shading! }
    rep.visible = layer.visible
    rep.periodic.enabled = periodic
    if (valid_range(settings.display_range)) rep.periodic.range = settings.display_range.map((pair) => [...pair]) as RepRange
    return rep
  })
  return { items: [structure, ...volumes], selectedId: structure.id }
}

/** Resolve by saved path when available. A missing source never falls back to another dataset. */
export const remap_rep_sources = (collection: RepCollection, entries: Array<{ path: string; datasetSlot?: number }>): RepCollection => ({
  ...collection, items: collection.items.map((rep) => {
    if (rep.source.kind !== 'volume') return rep
    const path = rep.source.path
    const match = (path: string, slot = 0) => entries.findIndex((entry, index) => entry.path === path && dataset_source(entries, index).slot === slot)
    const index = path ? match(path, rep.source.slot) : rep.source.index
    const colorIndex = rep.volume.colorSourcePath ? match(rep.volume.colorSourcePath, rep.volume.colorSourceSlot) : rep.volume.color_volume_idx
    return { ...rep, source: { ...rep.source, index }, volume: { ...rep.volume, volume_idx: index, color_volume_idx: colorIndex } }
  }),
})
