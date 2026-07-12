import type { CameraProjection, IsosurfaceLayer, IsosurfaceSettings, Vec3 } from 'matterviz'
import type { ManifestEntry, MultiwfnManifest } from './manifest'

export type WorkbenchCameraState = {
  position?: Vec3
  target?: Vec3
  projection?: CameraProjection
}

export type WorkbenchIsosurfaceAppearance = {
  wireframe?: boolean
  material?: IsosurfaceSettings['material']
  roughness?: number
  metalness?: number
  shininess?: number
  specular?: number
  halo?: number
}

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
  camera?: WorkbenchCameraState
  isosurface?: WorkbenchIsosurfaceAppearance
  session: Pick<MultiwfnManifest, 'multiwfnGui' | 'bondAnalysis' | 'espAnalysis'>
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
  camera?: WorkbenchCameraState
}

export type WorkbenchStateRestoration = {
  activeVolume: number
  isosurfaceSettings: IsosurfaceSettings
  periodic?: MatterVizWorkbenchState['periodic']
  camera?: WorkbenchCameraState
}

const as_record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

const record_or_undefined = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined

const finite_number = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const finite_integer = (value: unknown): number | undefined => {
  const number = finite_number(value)
  return number === undefined ? undefined : Math.trunc(number)
}

const finite_pair = (value: unknown): [number, number] | undefined => {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const left = finite_number(value[0])
  const right = finite_number(value[1])
  return left !== undefined && right !== undefined ? [left, right] : undefined
}

const finite_vec3 = (value: unknown): Vec3 | undefined => {
  if (!Array.isArray(value) || value.length < 3) return undefined
  const result = [finite_number(value[0]), finite_number(value[1]), finite_number(value[2])]
  return result.every((item) => item !== undefined) ? result as Vec3 : undefined
}

const normalize_camera = (value: unknown): WorkbenchCameraState | undefined => {
  const row = as_record(value)
  const position = finite_vec3(row.position)
  const target = finite_vec3(row.target)
  const projection = row.projection === 'perspective' || row.projection === 'orthographic'
    ? row.projection
    : undefined
  if (!position && !target && !projection) return undefined
  return { position, target, projection }
}

const normalize_appearance = (value: unknown): WorkbenchIsosurfaceAppearance | undefined => {
  const row = as_record(value)
  const appearance: WorkbenchIsosurfaceAppearance = {}
  if (typeof row.wireframe === 'boolean') appearance.wireframe = row.wireframe
  if (row.material === 'matte' || row.material === 'glossy' || row.material === 'pbr') appearance.material = row.material
  for (const key of ['roughness', 'metalness', 'shininess', 'specular', 'halo'] as const) {
    const number = finite_number(row[key])
    if (number !== undefined) appearance[key] = number
  }
  return Object.keys(appearance).length ? appearance : undefined
}

const normalize_color = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

const ISO_COLORMAPS = new Set([
  'interpolateViridis', 'interpolatePlasma', 'interpolateInferno', 'interpolateMagma',
  'interpolateCividis', 'interpolateTurbo', 'interpolateRdBu', 'interpolateRdYlBu',
  'interpolateSpectral', 'interpolatePiYG', 'interpolateBrBG', 'interpolatePuOr',
  'interpolateCool', 'interpolateWarm', 'interpolateRdYlGn', 'interpolateGreys',
])

const normalize_layer_snapshot = (value: unknown): MatterVizWorkbenchState['volumes'][number] | undefined => {
  const row = as_record(value)
  const path = typeof row.path === 'string' && row.path.trim() !== '' ? row.path : undefined
  const volumeIndex = finite_integer(row.volumeIndex)
  if (!path || volumeIndex === undefined || volumeIndex < 0) return undefined
  const entry: MatterVizWorkbenchState['volumes'][number] = { path, volumeIndex }
  for (const key of ['name', 'format', 'role', 'mode', 'analysisKind'] as const) {
    if (typeof row[key] === 'string') entry[key] = row[key]
  }
  for (const key of ['isovalue', 'opacity', 'orbitalIndex'] as const) {
    const number = finite_number(row[key])
    if (number !== undefined) entry[key] = number
  }
  if (typeof row.visible === 'boolean') entry.visible = row.visible
  const color = normalize_color(row.color)
  const negativeColor = normalize_color(row.negativeColor)
  if (color !== undefined) entry.color = color
  if (negativeColor !== undefined) entry.negativeColor = negativeColor
  if (typeof row.showNegative === 'boolean') entry.showNegative = row.showNegative
  const colorVolumeIndex = finite_integer(row.colorVolumeIndex)
  if (colorVolumeIndex !== undefined && colorVolumeIndex >= 0) entry.colorVolumeIndex = colorVolumeIndex
  const colormap = normalize_color(row.colormap)
  if (colormap !== undefined && ISO_COLORMAPS.has(colormap)) entry.colormap = colormap
  const colorRange = finite_pair(row.colorRange)
  if (colorRange) entry.colorRange = colorRange[0] <= colorRange[1] ? colorRange : [colorRange[1], colorRange[0]]
  return entry
}

export const create_workbench_state = (input: WorkbenchStateInput): MatterVizWorkbenchState => {
  const layers = input.isosurfaceSettings.layers ?? []
  const layerByVolume = new Map(layers.map((layer) => [layer.volume_idx ?? 0, layer]))
  const displayRange = input.isosurfaceSettings.display_range
    ?.map(finite_pair)
  const validDisplayRange = displayRange?.length === 3 && displayRange.every(Boolean)
    ? displayRange as [[number, number], [number, number], [number, number]]
    : undefined
  const appearance = normalize_appearance(input.isosurfaceSettings)

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
      colorRange: range && range[0] <= range[1] ? range : range ? [range[1], range[0]] : undefined,
      }
    }),
    periodic: input.manifest.periodic?.enabled ? {
      displayRange: validDisplayRange,
      atomSupercell: input.atomSupercell,
      showBoundaryAtoms: input.showBoundaryAtoms,
      showUnitCell: input.showUnitCell,
    } : undefined,
    camera: normalize_camera(input.camera),
    isosurface: appearance,
    session: {
      multiwfnGui: input.manifest.multiwfnGui,
      bondAnalysis: input.manifest.bondAnalysis,
      espAnalysis: input.manifest.espAnalysis,
    },
  }
}

/** Parse a version-1 workbench snapshot, rejecting unsupported required fields. */
export const parse_workbench_state = (value: unknown): MatterVizWorkbenchState => {
  const root = as_record(value)
  if (root.format !== 'multiwfn-matterviz-workbench') throw new Error('Unsupported workbench state format')
  if (root.version !== 1) throw new Error('Unsupported workbench state version')
  if (!Array.isArray(root.volumes)) throw new Error('Workbench state is missing volumes')

  const volumes = root.volumes
    .map(normalize_layer_snapshot)
    .filter((entry): entry is MatterVizWorkbenchState['volumes'][number] => Boolean(entry))
  const activeVolume = finite_integer(root.activeVolume) ?? 0
  const sourceManifest = typeof root.sourceManifest === 'string' ? root.sourceManifest : undefined

  const periodicRecord = as_record(root.periodic)
  const atomSupercell = typeof periodicRecord.atomSupercell === 'string' ? periodicRecord.atomSupercell : undefined
  const showBoundaryAtoms = typeof periodicRecord.showBoundaryAtoms === 'boolean'
    ? periodicRecord.showBoundaryAtoms : undefined
  const showUnitCell = typeof periodicRecord.showUnitCell === 'boolean' ? periodicRecord.showUnitCell : undefined
  const displayRangeValue = Array.isArray(periodicRecord.displayRange)
    ? periodicRecord.displayRange.map(finite_pair)
    : undefined
  const displayRange = displayRangeValue?.length === 3 && displayRangeValue.every(Boolean)
    ? displayRangeValue as [[number, number], [number, number], [number, number]]
    : undefined
  const periodic = atomSupercell !== undefined && showBoundaryAtoms !== undefined && showUnitCell !== undefined
    ? { displayRange, atomSupercell, showBoundaryAtoms, showUnitCell }
    : undefined

  const sessionRecord = as_record(root.session)
  const session = {
    multiwfnGui: record_or_undefined(sessionRecord.multiwfnGui) as MultiwfnManifest['multiwfnGui'],
    bondAnalysis: record_or_undefined(sessionRecord.bondAnalysis) as MultiwfnManifest['bondAnalysis'],
    espAnalysis: record_or_undefined(sessionRecord.espAnalysis) as MultiwfnManifest['espAnalysis'],
  }
  return {
    format: 'multiwfn-matterviz-workbench',
    version: 1,
    sourceManifest,
    activeVolume: Math.min(Math.max(0, volumes.length - 1), Math.max(0, activeVolume)),
    volumes,
    periodic,
    camera: normalize_camera(root.camera),
    isosurface: normalize_appearance(root.isosurface),
    session,
  }
}

const clamp_index = (value: number, count: number): number =>
  count > 0 ? Math.min(count - 1, Math.max(0, Math.trunc(value))) : 0

const restore_layer = (
  current: IsosurfaceLayer,
  snapshot: MatterVizWorkbenchState['volumes'][number] | undefined,
  volumeCount: number,
): IsosurfaceLayer => {
  if (!snapshot) return { ...current }
  const layer: IsosurfaceLayer = { ...current }
  if (snapshot.isovalue !== undefined && Number.isFinite(snapshot.isovalue)) layer.isovalue = snapshot.isovalue
  if (snapshot.opacity !== undefined && Number.isFinite(snapshot.opacity)) layer.opacity = Math.min(1, Math.max(0, snapshot.opacity))
  if (snapshot.visible !== undefined) layer.visible = snapshot.visible
  if (snapshot.color !== undefined) layer.color = snapshot.color
  if (snapshot.negativeColor !== undefined) layer.negative_color = snapshot.negativeColor
  if (snapshot.showNegative !== undefined) layer.show_negative = snapshot.showNegative
  if (snapshot.colormap !== undefined) layer.colormap = snapshot.colormap as IsosurfaceLayer['colormap']
  if (snapshot.colorRange !== undefined) layer.color_range = [...snapshot.colorRange] as IsosurfaceLayer['color_range']
  if (snapshot.colorVolumeIndex !== undefined && volumeCount > 0) {
    layer.color_volume_idx = clamp_index(snapshot.colorVolumeIndex, volumeCount)
  }
  return layer
}

/** Restore a snapshot's appearance and UI state onto currently loaded volumes. */
export const restore_workbench_state = (
  state: MatterVizWorkbenchState,
  input: { entries: ManifestEntry[]; isosurfaceSettings: IsosurfaceSettings },
): WorkbenchStateRestoration => {
  const snapshots = new Map(state.volumes.map((volume) => [volume.volumeIndex, volume]))
  const layers = (input.isosurfaceSettings.layers ?? []).map((layer, index) => {
    const volumeIndex = layer.volume_idx ?? index
    return restore_layer(layer, snapshots.get(volumeIndex), input.entries.length)
  })
  const isosurfaceSettings: IsosurfaceSettings = {
    ...input.isosurfaceSettings,
    layers,
  }
  const appearance = state.isosurface
  if (appearance) {
    if (appearance.wireframe !== undefined) isosurfaceSettings.wireframe = appearance.wireframe
    if (appearance.material !== undefined) isosurfaceSettings.material = appearance.material
    for (const key of ['roughness', 'metalness', 'shininess', 'specular', 'halo'] as const) {
      const value = appearance[key]
      if (value !== undefined && Number.isFinite(value)) isosurfaceSettings[key] = value
    }
  }
  return {
    activeVolume: clamp_index(state.activeVolume, input.entries.length),
    isosurfaceSettings,
    periodic: state.periodic,
    camera: state.camera,
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
