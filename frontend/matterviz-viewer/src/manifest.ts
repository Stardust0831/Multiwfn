export type ManifestEntry = {
  name?: string
  path: string
  format?: string
  role?: string
  mode?: string
  isovalue?: number
  opacity?: number
  orbitalIndex?: number
  visible?: boolean
  analysisKind?: string
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

export type AnalysisCapability = {
  available?: boolean
  format?: string
  reason?: string
  features?: Record<string, boolean>
}

export type AnalysisDataset = {
  path?: string
  dataset?: string
  kind?: string
  pdos?: boolean
}

export type AnalysisManifest = {
  capabilities?: Record<string, AnalysisCapability>
  primaryDos?: AnalysisDataset
  datasets?: AnalysisDataset[]
}

export type MultiwfnManifest = {
  multiwfnGui?: MultiwfnGui
  bondAnalysis?: BondAnalysis
  analysis?: AnalysisManifest
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

export const cube_entries = (manifest: MultiwfnManifest): ManifestEntry[] =>
  Array.isArray(manifest?.cubes)
    ? manifest.cubes
    : Array.isArray(manifest?.layers)
      ? manifest.layers
      : []

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
