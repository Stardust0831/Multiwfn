import type { IsosurfaceLayer } from 'matterviz'
import type { ManifestEntry } from './manifest'

type VolumeWithGrid = {
  grid?: unknown
}

export type VolumeCacheState<Volume extends VolumeWithGrid> = {
  volumes: Volume[]
  entries: ManifestEntry[]
  layers: IsosurfaceLayer[]
  active_volume_idx: number
}

export type VolumeCacheOptions = {
  remove_indices?: Iterable<number>
  retain_indices?: Iterable<number>
  retain_active_volume?: boolean
}

export type CompactedVolumeCache<Volume extends VolumeWithGrid> = VolumeCacheState<Volume> & {
  old_to_new: Map<number, number>
  released_volumes: Volume[]
  released_buffers: Set<ArrayBufferLike>
}

const volume_buffer = (volume: VolumeWithGrid): ArrayBufferLike | undefined => {
  const grid = volume.grid as { data?: { buffer?: ArrayBufferLike } } | undefined
  return grid?.data?.buffer
}

const valid_index = (value: unknown, length: number): value is number =>
  Number.isInteger(value) && Number(value) >= 0 && Number(value) < length

const is_orbital = (entry: ManifestEntry | undefined): boolean =>
  entry?.role?.toLowerCase() === 'orbital'

/** Keep non-orbital visibility intact while selecting at most one orbital layer. */
export const orbital_visibility = <Layer extends IsosurfaceLayer>(
  layers: Layer[],
  entries: ManifestEntry[],
  active_volume_idx: number | undefined,
): Layer[] => layers.map((layer) => {
  const volume_idx = layer.volume_idx ?? 0
  if (!is_orbital(entries[volume_idx])) return { ...layer }
  return { ...layer, visible: active_volume_idx === volume_idx }
})

/**
 * Drop unreferenced volume objects and rebuild every index in one atomic result.
 * Releasing means removing application strong references; JS owns the eventual
 * ArrayBuffer/SAB reclamation while MatterViz disposes derived GPU geometry.
 */
export const compact_volume_cache = <Volume extends VolumeWithGrid>(
  state: VolumeCacheState<Volume>,
  options: VolumeCacheOptions = {},
): CompactedVolumeCache<Volume> => {
  const length = Math.min(state.volumes.length, state.entries.length)
  const removed = new Set(
    [...(options.remove_indices ?? [])].filter((index) => valid_index(index, length)),
  )
  const retained = new Set<number>()
  const retain = (index: unknown): boolean => {
    if (!valid_index(index, length) || removed.has(index)) return false
    retained.add(index)
    return true
  }

  for (const index of options.retain_indices ?? []) retain(index)
  if (options.retain_active_volume !== false) retain(state.active_volume_idx)
  for (const layer of state.layers) {
    const volume_idx = layer.volume_idx ?? 0
    if (layer.visible !== false) retain(volume_idx)
  }

  // A retained surface owns its color source even when the source layer itself
  // is hidden. Iterate to a fixed point for future chained references.
  let changed = true
  while (changed) {
    changed = false
    for (const layer of state.layers) {
      const owner = layer.volume_idx ?? 0
      if (!retained.has(owner) || layer.color_volume_idx === undefined) continue
      const before = retained.size
      retain(layer.color_volume_idx)
      changed ||= retained.size !== before
    }
  }

  const old_to_new = new Map<number, number>()
  const volumes: Volume[] = []
  const entries: ManifestEntry[] = []
  for (let index = 0; index < length; index += 1) {
    if (!retained.has(index)) continue
    old_to_new.set(index, volumes.length)
    volumes.push(state.volumes[index])
    entries.push(state.entries[index])
  }

  const layers = state.layers.flatMap((layer) => {
    const volume_idx = old_to_new.get(layer.volume_idx ?? 0)
    if (volume_idx === undefined) return []
    const color_volume_idx = layer.color_volume_idx === undefined
      ? undefined
      : old_to_new.get(layer.color_volume_idx)
    return [{
      ...layer,
      volume_idx,
      ...(layer.color_volume_idx === undefined ? {} : { color_volume_idx }),
      ...(layer.color_volume_idx !== undefined && color_volume_idx === undefined
        ? { colormap: undefined, color_range: undefined }
        : {}),
    }]
  })

  const released_volumes = state.volumes.slice(0, length)
    .filter((_volume, index) => !retained.has(index))
  const retained_buffers = new Set(volumes.map(volume_buffer).filter((buffer) => buffer !== undefined))
  const released_buffers = new Set<ArrayBufferLike>()
  for (const volume of released_volumes) {
    const buffer = volume_buffer(volume)
    if (buffer && !retained_buffers.has(buffer)) released_buffers.add(buffer)
  }

  const mapped_active = old_to_new.get(state.active_volume_idx)
  return {
    volumes,
    entries,
    layers,
    active_volume_idx: mapped_active ?? Math.min(state.active_volume_idx, Math.max(0, volumes.length - 1)),
    old_to_new,
    released_volumes,
    released_buffers,
  }
}
