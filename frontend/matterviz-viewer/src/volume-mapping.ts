import type { IsosurfaceLayer } from 'matterviz/isosurface'
import { normalize_color_stops } from 'matterviz/colors/stops'
import type { ManifestEntry } from './manifest.ts'

/** A surface and its coloring field are separate datasets; never infer a pair
 * from array order or from the sign/range of the sampled values. */
export const apply_manifest_color_mapping = (
  layers: IsosurfaceLayer[],
  entries: ManifestEntry[],
  compatible: (surface: number, color: number) => boolean,
): IsosurfaceLayer[] => layers.map((layer) => {
  const surfaceIdx = layer.volume_idx ?? 0
  const mapping = entries[surfaceIdx]?.colorMapping
  if (!mapping) return layer
  const colorIdx = entries.findIndex((entry) => entry.path === mapping.path)
  if (colorIdx < 0 || colorIdx === surfaceIdx || !compatible(surfaceIdx, colorIdx)) {
    throw new Error('The mapped surface needs a separate coloring dataset on the same grid')
  }
  const range = mapping.range
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] >= range[1]) {
    throw new Error('The mapped surface color range must have finite, increasing bounds')
  }
  return {
    ...layer,
    color_volume_idx: colorIdx,
    color_range: [...range],
    color_stops: normalize_color_stops(mapping.stops),
  }
})
