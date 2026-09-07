import { surface_statistics, type SurfaceResult } from './surface-analysis.ts'

export const SURFACE_LOG_LIMIT = 8 * 1024 ** 2
export type SurfaceLogStatistics = { volume: number | null; massDensity: number | null }

/** Import printed metadata only; never replace the original mesh or its weighted statistics. */
export function parse_surface_log(text: string, result: SurfaceResult): SurfaceLogStatistics {
  if (text.length > SURFACE_LOG_LIMIT || /[\x00-\x08\x0e-\x1f]/.test(text)) throw new Error('Invalid or oversized surface log')
  const parts = text.split(/=+\s*Summary of surface analysis\s*=+/)
  if (parts.length < 2) throw new Error('No Multiwfn surface-analysis summary found')
  const block = parts.at(-1)!.split(/-{3,}\s*Post-processing menu/)[0]
  const numeric = (value: string) => {
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/.test(value)) throw new Error('Invalid printed surface statistic')
    const n = Number(value.replace(/[dD]/, 'e'))
    if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid printed surface statistic')
    return n
  }
  const field = (pattern: RegExp): number | null => {
    const matches = [...block.matchAll(pattern)]
    if (matches.length > 1) throw new Error('Ambiguous surface-analysis summary')
    return matches.length ? numeric(matches[0][1]) : null
  }
  const area = field(/^\s*Overall surface area:\s+(\S+)\s+Bohr\^2\b/gm)
  const expected = surface_statistics(result).area
  if (area === null || Math.abs(area - expected) > Math.max(.000011, expected * 1e-10)) {
    throw new Error('The log surface area does not match the current mesh')
  }
  const volume = field(/^\s*Volume:\s+(\S+)\s+Bohr\^3\b/gm)
  const massDensity = field(/^\s*Estimated density according to mass and volume \(M\/V\):\s+(\S+)\s+g\/cm\^3\b/gm)
  if (volume === null && massDensity === null) throw new Error('No volume or mass density found in this summary')
  return { volume, massDensity }
}
