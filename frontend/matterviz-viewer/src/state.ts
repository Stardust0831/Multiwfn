import type { IsosurfaceSettings } from 'matterviz'
import type { ManifestEntry, MultiwfnManifest } from './manifest'

export type MatterVizWorkbenchState = {
  format: 'multiwfn-matterviz-workbench'
  version: 1
  sourceManifest?: string
  activeVolume: number
  volumes: Array<ManifestEntry & {
    volumeIndex: number
    isovalue?: number
    opacity?: number
    visible?: boolean
    color?: string
    negativeColor?: string
    showNegative?: boolean
    colorVolumeIndex?: number
    colormap?: string
    colorRange?: [number, number]
  }>
  periodic?: {
    displayRange?: [[number, number], [number, number], [number, number]]
    atomSupercell: string
    showBoundaryAtoms: boolean
    showUnitCell: boolean
  }
  session: Pick<MultiwfnManifest, 'multiwfnGui' | 'bondAnalysis' | 'espAnalysis' | 'analysis'>
}

export type WorkbenchStateInput = {
  manifest: MultiwfnManifest
  sourceManifest?: string
  entries: ManifestEntry[]
  isosurfaceSettings: IsosurfaceSettings
  activeVolume: number
  atomSupercell: string
  showBoundaryAtoms: boolean
  showUnitCell: boolean
}

const finite_pair = (value: unknown): [number, number] | undefined => {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const left = Number(value[0])
  const right = Number(value[1])
  return Number.isFinite(left) && Number.isFinite(right) ? [left, right] : undefined
}

export const create_workbench_state = (input: WorkbenchStateInput): MatterVizWorkbenchState => {
  const layers = input.isosurfaceSettings.layers ?? []
  const layerByVolume = new Map(layers.map((layer) => [layer.volume_idx ?? 0, layer]))
  const displayRange = input.isosurfaceSettings.display_range
    ?.map(finite_pair)
  const validDisplayRange = displayRange?.length === 3 && displayRange.every(Boolean)
    ? displayRange as [[number, number], [number, number], [number, number]]
    : undefined

  return {
    format: 'multiwfn-matterviz-workbench',
    version: 1,
    sourceManifest: input.sourceManifest,
    activeVolume: Math.min(
      Math.max(0, input.entries.length - 1),
      Math.max(0, Math.trunc(Number(input.activeVolume) || 0)),
    ),
    volumes: input.entries.map((entry, volumeIndex) => {
      const layer = layerByVolume.get(volumeIndex)
      const range = finite_pair(layer?.color_range)
      return {
        ...entry,
        volumeIndex,
        isovalue: layer?.isovalue,
        opacity: layer?.opacity,
        visible: layer?.visible,
        color: layer?.color,
        negativeColor: layer?.negative_color,
        showNegative: layer?.show_negative,
        colorVolumeIndex: layer?.color_volume_idx,
        colormap: typeof layer?.colormap === 'string' ? layer.colormap : undefined,
        colorRange: range,
      }
    }),
    periodic: input.manifest.periodic?.enabled ? {
      displayRange: validDisplayRange,
      atomSupercell: input.atomSupercell,
      showBoundaryAtoms: input.showBoundaryAtoms,
      showUnitCell: input.showUnitCell,
    } : undefined,
    session: {
      multiwfnGui: input.manifest.multiwfnGui,
      bondAnalysis: input.manifest.bondAnalysis,
      espAnalysis: input.manifest.espAnalysis,
      analysis: input.manifest.analysis,
    },
  }
}

export const download_workbench_state = (state: MatterVizWorkbenchState): void => {
  const blob = new Blob([`${JSON.stringify(state, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'multiwfn-matterviz-state.json'
  link.click()
  URL.revokeObjectURL(url)
}
