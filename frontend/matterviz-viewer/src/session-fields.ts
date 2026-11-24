import { BOHR_TO_ANGSTROM } from 'matterviz/constants'
import { ISO_COLORMAPS, parse_cube, parse_volumetric_file, type IsosurfaceLayer, type VolumetricData } from 'matterviz/isosurface'
import { get_d3_interpolator } from 'matterviz/colors'
import { add, create_cart_to_frac, scale, type Vec3 } from 'matterviz/math'
import { Color } from 'three'
import { estimate_esp_range, normalize_esp_volume } from './esp.ts'
import type { ManifestEntry } from './manifest.ts'
import { resolve_volume_entry_url } from './manifest.ts'
import { adapt_matterviz_volume, decode_matterviz_volume, read_matterviz_volume_response } from './volume.ts'

export type SessionField = { entry: ManifestEntry; volume: VolumetricData }

export function field_id(entry: ManifestEntry, slot = entry.datasetSlot ?? 0): string {
  // Streamed orbitals share an endpoint, and a single Cube can carry several fields.
  return JSON.stringify([entry.path, entry.orbitalIndex ?? null, slot])
}

export function parse_session_cube(text: string, periodic?: boolean) {
  const result = parse_cube(text, { periodic })
  // The upstream parser uses the Cube origin as zero for atoms and samples.
  // A separate Multiwfn XYZ and native fields use absolute Cartesian coordinates.
  const header = text.split(/\r?\n/, 4)
  const origin = scale(header[2].trim().split(/\s+/).slice(1, 4).map(Number) as Vec3,
    Number(header[3].trim().split(/\s+/, 1)[0]) > 0 ? BOHR_TO_ANGSTROM : 1)
  const to_fractional = create_cart_to_frac(result.structure.lattice.matrix)
  for (const site of result.structure.sites) {
    site.xyz = add(site.xyz, origin)
    site.abc = to_fractional(site.xyz)
  }
  for (const field of result.volumes) field.origin = origin
  return result
}

export async function load_field(entry: ManifestEntry, base: URL, periodic?: boolean) {
  const url = resolve_volume_entry_url(entry, base)
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${url.pathname}: HTTP ${response.status}`)
  if (entry.format === 'mwfn-volume-v1' || entry.format === 'mwfn-volume-v2') {
    const frame = decode_matterviz_volume(await read_matterviz_volume_response(response))
    const volume = adapt_matterviz_volume(frame, field_id(entry))
    volume.label = entry.name ?? entry.role
    return { fields: [{ entry, volume }] }
  }
  const text = await response.text()
  const parsed = entry.format === 'cube' || /\.cube?$/i.test(url.pathname)
    ? parse_session_cube(text, periodic)
    : parse_volumetric_file(text, entry.path)
  if (!parsed) throw new Error(`MatterViz could not parse ${entry.path}`)
  const fields = parsed.volumes.map((volume, index) => {
    const slot = (entry.datasetSlot ?? 0) + index
    volume.id = field_id(entry, slot)
    volume.source = entry.path
    volume.label = parsed.volumes.length === 1 ? entry.name ?? volume.label : volume.label
    return { entry: { ...entry, datasetSlot: slot }, volume: normalize_esp_volume(volume, entry) }
  })
  return { structure: parsed.structure, fields }
}

function same_grid(a: VolumetricData, b: VolumetricData) {
  const near = (x: number, y: number) => Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y))
  return a.periodic === b.periodic && a.dims.every((n, i) => n === b.dims[i])
    && a.origin.every((x, i) => near(x, b.origin[i]))
    && a.lattice.every((row, i) => row.every((x, j) => near(x, b.lattice[i][j])))
}

export function layer_for_field({ entry, volume }: SessionField, fields: SessionField[]): IsosurfaceLayer {
  const signed = entry.mode === 'signed' || entry.role === 'orbital'
  const layer: IsosurfaceLayer = {
    volume_id: volume.id, isovalue: entry.isovalue ?? (signed ? 0.02 : 0.001),
    color: signed ? '#2563eb' : '#9ca3af', negative_color: '#dc2626',
    visible: entry.visible !== false, show_negative: signed, opacity: entry.opacity ?? 0.82,
  }
  const mapping = entry.colorMapping
  if (!mapping && entry.analysisKind !== 'esp-density') return layer
  const color = fields.find(field => mapping ? field.entry.path === mapping.path
    : field.entry.analysisKind === 'esp-potential' && same_grid(volume, field.volume))
  if (!color && !mapping) return layer
  if (!color || color.volume.id === volume.id || !same_grid(volume, color.volume)) {
    throw new Error('The mapped surface needs a separate coloring dataset on the same grid')
  }
  layer.color_volume_id = color.volume.id
  if (!mapping) {
    const { min, max } = estimate_esp_range(volume, color.volume, layer.isovalue, { maxCells: 150000, maxSamples: 50000 })
    layer.color_scale = { scheme: 'interpolateRdBu', value_range: [min, max] }
    return layer
  }
  const { range, stops } = mapping
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] >= range[1]) {
    throw new Error('The mapped surface color range must have finite, increasing bounds')
  }
  if (!Array.isArray(stops) || stops.length < 2 || stops.some((stop, i) =>
    !Number.isFinite(stop.position) || stop.position < 0 || stop.position > 1 ||
    (i > 0 && stop.position <= stops[i - 1].position) || !/^#[0-9a-f]{6}$/i.test(stop.color))) {
    throw new Error('The mapped surface needs ordered color stops between 0 and 1')
  }
  // The native selector accepts named palettes. Match the declared stops in linear RGB
  // in both directions, without reversing the physical range or the sampled field.
  const targets = stops.map(s => ({ at: s.position, color: new Color(s.color) }))
  let best = Infinity
  for (const scheme of ISO_COLORMAPS) {
    const interpolate = get_d3_interpolator(scheme)
    for (const reverse of [false, true]) {
      let error = 0
      for (const { at, color } of targets) {
        const actual = new Color(interpolate(reverse ? 1 - at : at))
        error += (actual.r - color.r) ** 2 + (actual.g - color.g) ** 2 + (actual.b - color.b) ** 2
      }
      if (error >= best) continue
      best = error
      layer.color_scale = { value_range: range, scheme, palette_range: reverse ? [1, 0] : [0, 1] }
    }
  }
  return layer
}
