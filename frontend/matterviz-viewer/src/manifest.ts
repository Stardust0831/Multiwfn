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

export type MultiwfnManifest = {
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
  manifest.cubes ?? manifest.layers ?? []

export const display_range = (
  manifest: MultiwfnManifest,
): [[number, number], [number, number], [number, number]] | undefined => {
  if (!manifest.periodic?.enabled) return undefined
  const ranges = manifest.periodic.ranges
  const normalize = (value?: number[]): [number, number] => [
    Number(value?.[0] ?? 0),
    Number(value?.[1] ?? 1),
  ]
  return [normalize(ranges?.a), normalize(ranges?.b), normalize(ranges?.c)]
}
