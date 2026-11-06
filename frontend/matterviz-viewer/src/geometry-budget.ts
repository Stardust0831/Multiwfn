import type { VolumetricData } from 'matterviz'

const MIB = 1024 ** 2

/** Count immutable source storage once, including shared views of one buffer. */
export const source_volume_bytes = (volumes: VolumetricData[]): number => {
  const seen = new Set<ArrayBufferLike>()
  return volumes.reduce((total, volume) => {
    if ('data' in volume.grid) {
      const buffer = volume.grid.data.buffer
      if (seen.has(buffer)) return total
      seen.add(buffer)
      return total + buffer.byteLength
    }
    return total + volume.grid_dims.reduce((a, b) => a * b, 32)
  }, 0)
}

/** Browser-only admission ceiling; never a grid-resolution switch or VRAM claim. */
export const browser_geometry_budget = (sourceBytes: number, deviceGiB?: number, heapRemaining?: number): number => {
  const pool = Number.isFinite(deviceGiB) && deviceGiB! > 0
    ? Math.min(512 * MIB, deviceGiB! * 1024 * MIB / 8) : 128 * MIB
  const limit = Number.isFinite(heapRemaining) && heapRemaining! >= 0 ? Math.min(pool, heapRemaining! / 4) : pool
  return Math.max(0, Math.floor(limit - sourceBytes))
}

export const request_geometry_budget = async (volumes: VolumetricData[], page = new URL(window.location.href)): Promise<number> => {
  const sourceBytes = source_volume_bytes(volumes)
  const cap = page.searchParams.get('cap')
  if (cap) {
    const url = new URL('/api/geometry-budget', page)
    url.search = new URLSearchParams({ cap, source_bytes: String(sourceBytes) }).toString()
    const response = await fetch(url, { cache: 'no-store' })
    const result = await response.json()
    if (!response.ok || !Number.isSafeInteger(result.geometry_budget_bytes) || result.geometry_budget_bytes < 0)
      throw new Error(result.message || 'Unable to obtain the geometry memory budget')
    return result.geometry_budget_bytes
  }
  const device = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  const heap = (performance as Performance & { memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number } }).memory
  return browser_geometry_budget(sourceBytes, device, heap ? Math.max(0, heap.jsHeapSizeLimit - heap.usedJSHeapSize) : undefined)
}
