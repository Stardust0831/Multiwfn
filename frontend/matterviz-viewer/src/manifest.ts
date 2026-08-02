export type ManifestEntry = {
  name?: string
  path: string
  format?: string
  role?: string
  mode?: string
  isovalue?: number
  opacity?: number
  orbitalIndex?: number
  gridQuality?: number
  visible?: boolean
  analysisKind?: string
}

export type PlotExport = {
  format: 'png' | 'pdf'
  path: string
  width?: number
  height?: number
}

export type MultiwfnGuiState = {
  orbitalCount?: number
  homoIndex?: number
  showMolecule?: boolean
  showBothSign?: boolean
  sur_value?: number
  sur_value_orb?: number
  planeBounds?: number[]
}

export type MultiwfnGui = {
  entry?: string
  guiMode?: number
  allowSetStyle?: number
  state?: MultiwfnGuiState
}

export type BondMethodCapability = {
  available?: boolean
  reason?: string
}

export type BondAnalysis = {
  periodicSupported?: boolean
  openShell?: boolean
  methods?: Record<string, BondMethodCapability>
}

export type MultiwfnManifest = {
  plotExport?: PlotExport
  multiwfnGui?: MultiwfnGui
  bondAnalysis?: BondAnalysis
  structure?: ManifestEntry | null
  cubes?: ManifestEntry[]
  layers?: ManifestEntry[]
  orbitals?: {
    count?: number
    homoIndex?: number
    items?: Array<{ index: number; energy?: number; occupation?: number }>
  }
  espAnalysis?: {
    available?: boolean
    reason?: string
    defaultQuality?: number
    defaultIsovalue?: number
    qualityLevels?: number[]
  }
  periodic?: {
    enabled?: boolean
    showUnitCell?: boolean
    tileCubes?: boolean
    cell?: { a?: number[]; b?: number[]; c?: number[] }
    ranges?: { a?: number[]; b?: number[]; c?: number[] }
  }
}

export const manifest_url = (): URL => {
  const query = new URL(window.location.href).searchParams.get('manifest')
  return new URL(query || '/session/manifest.json', window.location.href)
}

export const resolve_entry_url = (entry: ManifestEntry, base: URL): URL =>
  new URL(entry.path, base)

export const resolve_volume_entry_url = (
  entry: ManifestEntry,
  base: URL,
  page: URL = new URL(window.location.href),
): URL => {
  const url = resolve_entry_url(entry, base)
  if (entry.format !== 'mwfn-volume-v1'
    || url.origin !== page.origin
    || !url.pathname.startsWith('/api/volume/')) return url
  const capability = page.searchParams.get('cap')
  if (capability) url.searchParams.set('cap', capability)
  return url
}

export const cube_entries = (manifest: MultiwfnManifest): ManifestEntry[] =>
  Array.isArray(manifest?.cubes)
    ? manifest.cubes
    : Array.isArray(manifest?.layers)
      ? manifest.layers
      : []

export const plot_export = (manifest: MultiwfnManifest): PlotExport | undefined => {
  const value = manifest?.plotExport
  if (!value || (value.format !== 'png' && value.format !== 'pdf') || typeof value.path !== 'string' || !value.path.trim()) return undefined
  const dimensions = value.width === undefined && value.height === undefined
    ? {}
    : Number.isInteger(value.width) && Number.isInteger(value.height)
      && Number(value.width) > 0 && Number(value.height) > 0
      ? { width: Number(value.width), height: Number(value.height) }
      : undefined
  if (dimensions === undefined) return undefined
  return { format: value.format, path: value.path, ...dimensions }
}

export const display_range = (
  manifest: MultiwfnManifest,
): [[number, number], [number, number], [number, number]] | undefined => {
  if (manifest?.periodic?.enabled !== true) return undefined
  const ranges = manifest.periodic.ranges
  const finite_number = (value: unknown, fallback: number): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : fallback
    }
    return fallback
  }
  const normalize = (value?: number[]): [number, number] => {
    const pair = Array.isArray(value) ? value : []
    return [finite_number(pair[0], 0), finite_number(pair[1], 1)]
  }
  return [normalize(ranges?.a), normalize(ranges?.b), normalize(ranges?.c)]
}
