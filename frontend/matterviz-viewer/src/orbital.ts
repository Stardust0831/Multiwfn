import type { ManifestEntry } from './manifest'

type VisibilityLayer = { visible?: boolean; volume_idx?: number }

const orbital_index = (entry: ManifestEntry): number | undefined => {
  const index = Number(entry.orbitalIndex)
  return Number.isInteger(index) && index > 0 ? index : undefined
}

const is_orbital_entry = (entry: ManifestEntry): boolean =>
  entry.role?.toLowerCase() === 'orbital'

/** Pick the original GUI's initial layer: HOMO, first orbital, then first volume. */
export const initial_orbital_volume_index = (
  entries: ManifestEntry[],
  homoIndex: unknown,
): number | undefined => {
  const homo = Number(homoIndex)
  if (Number.isInteger(homo) && homo > 0) {
    const homoVolume = entries.findIndex((entry) => orbital_index(entry) === homo)
    if (homoVolume >= 0) return homoVolume
  }
  const firstOrbital = entries.findIndex(is_orbital_entry)
  if (firstOrbital >= 0) return firstOrbital
  return entries.length ? 0 : undefined
}

/** Find the first already-loaded volume for a 1-based orbital index. */
export const loaded_orbital_volume_index = (
  entries: ManifestEntry[],
  requestedIndex: unknown,
): number | undefined => {
  const requested = Number(requestedIndex)
  if (!Number.isInteger(requested) || requested <= 0) return undefined
  const volumeIndex = entries.findIndex((entry) => orbital_index(entry) === requested)
  return volumeIndex >= 0 ? volumeIndex : undefined
}

/** Preserve layer settings while making only the selected volume visible. */
export const exclusive_volume_visibility = <Layer extends VisibilityLayer>(
  layers: Layer[],
  activeVolumeIndex: number | undefined,
): Layer[] => layers.map((layer, index) => ({
  ...layer,
  visible: activeVolumeIndex !== undefined && (layer.volume_idx ?? index) === activeVolumeIndex,
}))
