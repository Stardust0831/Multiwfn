export type PlotKind = 'dos' | 'ir' | 'raman' | 'uvvis' | 'nmr'

export type PlotAxis = {
  label: string
  unit?: string
  range: [number, number]
}

export type PlotSeries = {
  id: string
  label?: string
  type: 'line' | 'sticks'
  x: number[]
  y: number[]
  axis?: 'y' | 'y2'
  color?: string
  lineWidth?: number
  dash?: 'solid' | 'dash'
  visible?: boolean
  labels?: Array<string | null>
}

export type PlotReferenceLine = {
  axis: 'x' | 'y' | 'y2'
  value: number
  label?: string
  color?: string
  dash?: 'solid' | 'dash'
}

export type PlotPanel = {
  id: string
  title?: string
  heightWeight?: number
  xAxis: PlotAxis
  yAxis: PlotAxis
  y2Axis?: PlotAxis
  series: PlotSeries[]
  referenceLines?: PlotReferenceLine[]
}

export type PlotArtifact = {
  format: 'multiwfn-matterviz-plot'
  version: 1
  kind: PlotKind
  title: string
  panels: PlotPanel[]
}

const fail = (message: string): never => { throw new Error(`Invalid plot artifact: ${message}`) }
const finite = (value: unknown, name: string): number => typeof value === 'number' && Number.isFinite(value) ? value : fail(`${name} must be finite`)
const string_value = (value: unknown, name: string): string => typeof value === 'string' && value.length > 0 ? value : fail(`${name} must be a non-empty string`)
const optional_string = (value: unknown, name: string): string | undefined => value === undefined ? undefined : string_value(value, name)

const axis = (value: unknown, name: string): PlotAxis => {
  if (!value || typeof value !== 'object') fail(`${name} must be an object`)
  const item = value as Record<string, unknown>
  const range = item.range
  if (!Array.isArray(range) || range.length !== 2) fail(`${name}.range must contain two values`)
  const bounds = range as unknown[]
  return { label: string_value(item.label, `${name}.label`), unit: optional_string(item.unit, `${name}.unit`), range: [finite(bounds[0], `${name}.range[0]`), finite(bounds[1], `${name}.range[1]`)] }
}

const number_array = (value: unknown, name: string): number[] => {
  if (!Array.isArray(value) || !value.length) fail(`${name} must be a non-empty array`)
  return (value as unknown[]).map((item, index) => finite(item, `${name}[${index}]`))
}

const series = (value: unknown, index: number): PlotSeries => {
  if (!value || typeof value !== 'object') fail(`series[${index}] must be an object`)
  const item = value as Record<string, unknown>
  const type = item.type === 'line' || item.type === 'sticks' ? item.type : fail(`series[${index}].type is invalid`)
  const x = number_array(item.x, `series[${index}].x`)
  const y = number_array(item.y, `series[${index}].y`)
  if (x.length !== y.length) fail(`series[${index}] x/y lengths differ`)
  const labels = item.labels === undefined ? undefined : (() => {
    if (!Array.isArray(item.labels) || item.labels.length !== x.length) fail(`series[${index}].labels length differs`)
    return (item.labels as unknown[]).map((label, labelIndex) => label === null ? null : string_value(label, `series[${index}].labels[${labelIndex}]`))
  })()
  return {
    id: string_value(item.id, `series[${index}].id`), label: optional_string(item.label, `series[${index}].label`), type, x, y,
    axis: item.axis === undefined ? undefined : item.axis === 'y' || item.axis === 'y2' ? item.axis : fail(`series[${index}].axis is invalid`),
    color: optional_string(item.color, `series[${index}].color`),
    lineWidth: item.lineWidth === undefined ? undefined : finite(item.lineWidth, `series[${index}].lineWidth`),
    dash: item.dash === undefined ? undefined : item.dash === 'solid' || item.dash === 'dash' ? item.dash : fail(`series[${index}].dash is invalid`),
    visible: item.visible === undefined ? undefined : typeof item.visible === 'boolean' ? item.visible : fail(`series[${index}].visible is invalid`), labels,
  }
}

const panel = (value: unknown, index: number): PlotPanel => {
  if (!value || typeof value !== 'object') fail(`panels[${index}] must be an object`)
  const item = value as Record<string, unknown>
  if (!Array.isArray(item.series) || !item.series.length) fail(`panels[${index}].series must be non-empty`)
  const references = item.referenceLines === undefined ? undefined : (() => {
    if (!Array.isArray(item.referenceLines)) fail(`panels[${index}].referenceLines must be an array`)
    return (item.referenceLines as unknown[]).map((raw, refIndex) => {
      if (!raw || typeof raw !== 'object') fail(`referenceLines[${refIndex}] must be an object`)
      const ref = raw as Record<string, unknown>
      const refAxis = ref.axis === 'x' || ref.axis === 'y' || ref.axis === 'y2' ? ref.axis : fail(`referenceLines[${refIndex}].axis is invalid`)
      return { axis: refAxis as PlotReferenceLine['axis'], value: finite(ref.value, `referenceLines[${refIndex}].value`), label: optional_string(ref.label, `referenceLines[${refIndex}].label`), color: optional_string(ref.color, `referenceLines[${refIndex}].color`), dash: ref.dash === undefined ? undefined : ref.dash === 'solid' || ref.dash === 'dash' ? ref.dash as PlotReferenceLine['dash'] : fail(`referenceLines[${refIndex}].dash is invalid`) }
    })
  })()
  return { id: string_value(item.id, `panels[${index}].id`), title: optional_string(item.title, `panels[${index}].title`), heightWeight: item.heightWeight === undefined ? undefined : finite(item.heightWeight, `panels[${index}].heightWeight`), xAxis: axis(item.xAxis, `panels[${index}].xAxis`), yAxis: axis(item.yAxis, `panels[${index}].yAxis`), y2Axis: item.y2Axis === undefined ? undefined : axis(item.y2Axis, `panels[${index}].y2Axis`), series: (item.series as unknown[]).map(series), referenceLines: references }
}

export const parse_plot_artifact = (value: unknown): PlotArtifact => {
  if (!value || typeof value !== 'object') fail('root must be an object')
  const item = value as Record<string, unknown>
  if (item.format !== 'multiwfn-matterviz-plot' || item.version !== 1) fail('unsupported format or version')
  if (!['dos', 'ir', 'raman', 'uvvis', 'nmr'].includes(String(item.kind))) fail('kind is invalid')
  if (!Array.isArray(item.panels) || !item.panels.length) fail('panels must be non-empty')
  return { format: 'multiwfn-matterviz-plot', version: 1, kind: item.kind as PlotKind, title: string_value(item.title, 'title'), panels: (item.panels as unknown[]).map(panel) }
}

export type MatterVizSeries = { id: string; label?: string; x: number[]; y: number[]; markers: 'line' | 'line+points'; visible?: boolean; y_axis?: 'y1' | 'y2'; line_style?: { stroke?: string; stroke_width?: number; line_dash?: string }; point_style?: { radius: number; fill_opacity: number; stroke_opacity: number }; point_label?: Array<{ text?: string; auto_placement?: boolean }> }
export const to_matterviz_series = (input: PlotSeries): MatterVizSeries => {
  const labels = input.labels?.map((label) => label ? { text: label, auto_placement: true } : {})
  const label_style = labels ? { markers: 'line+points' as const, point_style: { radius: 0, fill_opacity: 0, stroke_opacity: 0 }, point_label: labels } : { markers: 'line' as const }
  if (input.type === 'line') return { id: input.id, label: input.label, x: input.x, y: input.y, ...label_style, visible: input.visible, y_axis: input.axis === 'y2' ? 'y2' : 'y1', line_style: { stroke: input.color, stroke_width: input.lineWidth, line_dash: input.dash === 'dash' ? '6 4' : undefined } }
  const first = input.x[0]
  return { id: input.id, label: input.label, x: [first, first], y: [0, 0], markers: 'line', visible: input.visible, y_axis: input.axis === 'y2' ? 'y2' : 'y1', line_style: { stroke: input.color, stroke_width: input.lineWidth, line_dash: input.dash === 'dash' ? '6 4' : undefined } }
}

export const stick_path = (
  input: PlotSeries,
  x_scale: (value: number) => number,
  y_scale: (value: number) => number,
): string => input.x.map((value, index) => `M${x_scale(value)},${y_scale(0)}V${y_scale(input.y[index])}`).join('')

/** Generic PlotScene v2. The JSON artifact contains only metadata and dataset ids. */
export type PlotSceneAxisName = 'x1' | 'x2' | 'y1' | 'y2'
export type PlotSceneScale = 'linear' | 'log'
export type PlotSceneAxis = {
  label: string
  unit?: string
  range: [number, number]
  scale: PlotSceneScale
  ticks?: number[]
  format?: string
}
export type PlotSceneViewport = [number, number, number, number]
export type PlotSceneAxes = {
  x1: PlotSceneAxis
  y1: PlotSceneAxis
  x2?: PlotSceneAxis
  y2?: PlotSceneAxis
}
export type PlotSceneLayerType =
  | 'line' | 'scatter' | 'line+scatter' | 'bars' | 'error-bars' | 'fill'
  | 'contour'
export type PlotSceneDatasetRef = { datasetId: number }
export type PlotSceneStyle = Record<string, unknown>
export type PlotSceneLayer = PlotSceneDatasetRef & {
  id: string
  type: PlotSceneLayerType
  label?: string
  xAxis?: 'x1' | 'x2'
  yAxis?: 'y1' | 'y2'
  x_axis?: 'x1' | 'x2'
  y_axis?: 'y1' | 'y2'
  axis?: { x?: 'x1' | 'x2'; y?: 'y1' | 'y2' }
  style?: PlotSceneStyle
  levels?: number[]
  filled?: boolean
  width?: number
  height?: number
  shape?: [number, number]
  opacity?: number
  visible?: boolean
}
export type PlotSceneAnnotation = {
  id?: string
  text: string
  coordinateSpace: 'data' | 'panel'
  x: number
  y: number
  xAxis?: 'x1' | 'x2'
  yAxis?: 'y1' | 'y2'
  style?: PlotSceneStyle
}
export type PlotScenePanel = {
  id: string
  viewport: PlotSceneViewport
  axes: PlotSceneAxes
  layers: PlotSceneLayer[]
  annotations?: PlotSceneAnnotation[]
  legend?: { entries: Array<{ layerId: string; label: string }> }
}
export type PlotScene = {
  format: 'multiwfn-matterviz-plot'
  version: 2
  title: string
  semanticKind?: string
  page: { width: number; height: number }
  panels: PlotScenePanel[]
}

export type PlotArrayRole = 'x' | 'y' | 'z' | 'u' | 'v' | 'lower' | 'upper' | 'baseline'
export type PlotDataset = Partial<Record<PlotArrayRole, Float64Array>>
export type PlotDatasetResolver = (datasetId: number) => Promise<PlotDataset>
export type ResolvedPlotScene = { scene: PlotScene; datasets: Map<number, PlotDataset> }

const PLOT_DATA_MIME = 'application/vnd.multiwfn.matterviz-plot-data-v1'
const PLOT_DATA_MAGIC = 'MWFNP2D\0'
const PLOT_DATA_HEADER_BYTES = 80
const PLOT_DATA_ENTRY_BYTES = 32
const PLOT_ROLE: Record<number, PlotArrayRole> = { 1: 'x', 2: 'y', 3: 'z', 4: 'u', 5: 'v', 6: 'lower', 7: 'upper', 8: 'baseline' }

const crc32c = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0x82f63b78 & -(crc & 1))
  }
  return (~crc) >>> 0
}

export const decode_plot_dataset = (buffer: ArrayBuffer): { datasetId: number; dataset: PlotDataset } => {
  if (buffer.byteLength < PLOT_DATA_HEADER_BYTES) scene_fail('plot dataset is truncated')
  const bytes = new Uint8Array(buffer)
  const magic = new TextDecoder().decode(bytes.subarray(0, 8))
  const view = new DataView(buffer)
  if (magic !== PLOT_DATA_MAGIC || view.getUint16(8, true) !== 1 || view.getUint16(10, true) !== 0 || view.getUint16(12, true) !== 1 || view.getUint16(14, true) !== 1 || view.getUint32(16, true) !== PLOT_DATA_HEADER_BYTES) scene_fail('unsupported plot dataset frame')
  const datasetId = Number(view.getBigUint64(20, true))
  const count = view.getUint32(28, true)
  const directoryBytes = Number(view.getBigUint64(36, true))
  const bodyBytes = Number(view.getBigUint64(44, true))
  const totalElements = Number(view.getBigUint64(52, true))
  const totalBytes = Number(view.getBigUint64(72, true))
  if (!Number.isSafeInteger(datasetId) || datasetId <= 0 || count < 1 || count > 8 || !Number.isSafeInteger(totalElements) || totalElements <= 0 || view.getUint32(32, true) !== PLOT_DATA_ENTRY_BYTES || directoryBytes !== count * PLOT_DATA_ENTRY_BYTES || bodyBytes !== totalElements * 8 || totalBytes !== buffer.byteLength || PLOT_DATA_HEADER_BYTES + directoryBytes + bodyBytes !== totalBytes || view.getUint32(68, true) !== 0) scene_fail('invalid plot dataset header')
  const header = bytes.slice(0, PLOT_DATA_HEADER_BYTES)
  new DataView(header.buffer).setUint32(60, 0, true)
  if (crc32c(header) !== view.getUint32(60, true)) scene_fail('plot dataset header CRC mismatch')
  const bodyStart = PLOT_DATA_HEADER_BYTES + directoryBytes
  if (crc32c(bytes.subarray(bodyStart)) !== view.getUint32(64, true)) scene_fail('plot dataset body CRC mismatch')
  const dataset: PlotDataset = {}
  let expectedOffset = 0
  for (let index = 0; index < count; index += 1) {
    const entry = PLOT_DATA_HEADER_BYTES + index * PLOT_DATA_ENTRY_BYTES
    const role = PLOT_ROLE[view.getUint8(entry)]
    const elements = Number(view.getBigUint64(entry + 8, true))
    const offset = Number(view.getBigUint64(entry + 16, true))
    const arrayBytes = Number(view.getBigUint64(entry + 24, true))
    if (!role || dataset[role] || !Number.isSafeInteger(elements) || elements <= 0 || offset !== expectedOffset || arrayBytes !== elements * 8 || offset + arrayBytes > bodyBytes || bytes.subarray(entry + 1, entry + 8).some((byte) => byte !== 0)) scene_fail('invalid plot dataset directory')
    const values = new Float64Array(buffer, bodyStart + offset, elements)
    if (values.some((value) => !Number.isFinite(value))) scene_fail('plot dataset contains non-finite values')
    dataset[role] = values
    expectedOffset += arrayBytes
  }
  if (expectedOffset !== bodyBytes) scene_fail('plot dataset body is not contiguous')
  return { datasetId, dataset }
}

export const read_plot_dataset_response = async (response: Response, expectedId: number): Promise<PlotDataset> => {
  if (!response.ok) scene_fail(`plot dataset request returned HTTP ${response.status}`)
  if (response.headers.get('content-type')?.split(';')[0].trim() !== PLOT_DATA_MIME) scene_fail('plot dataset response has an invalid content type')
  const decoded = decode_plot_dataset(await response.arrayBuffer())
  if (decoded.datasetId !== expectedId) scene_fail('plot dataset ID does not match request')
  return decoded.dataset
}

const scene_fail = (message: string): never => { throw new Error(`Invalid plot scene: ${message}`) }
const finite_positive = (value: unknown, name: string): number => {
  const n = finite(value, name)
  return n > 0 ? n : scene_fail(`${name} must be greater than zero`)
}
const scene_axis = (value: unknown, name: string): PlotSceneAxis => {
  if (!value || typeof value !== 'object') scene_fail(`${name} must be an object`)
  const item = value as Record<string, unknown>
  const range = item.range
  if (!Array.isArray(range) || range.length !== 2) scene_fail(`${name}.range must contain two values`)
  const range_values = range as unknown[]
  const scale = (item.scale === undefined ? 'linear' : item.scale) as unknown
  if (scale !== 'linear' && scale !== 'log') scene_fail(`${name}.scale must be linear or log`)
  const ticks = item.ticks === undefined ? undefined : number_array(item.ticks, `${name}.ticks`)
  const parsed_range: [number, number] = [finite(range_values[0], `${name}.range[0]`), finite(range_values[1], `${name}.range[1]`)]
  if (parsed_range[0] === parsed_range[1]) scene_fail(`${name}.range values must differ`)
  if (scale === 'log' && (parsed_range[0] <= 0 || parsed_range[1] <= 0)) scene_fail(`${name}.range must be positive for log scale`)
  if (scale === 'log' && ticks?.some((tick) => tick <= 0)) scene_fail(`${name}.ticks must be positive for log scale`)
  return {
    label: string_value(item.label, `${name}.label`),
    unit: optional_string(item.unit, `${name}.unit`),
    range: parsed_range,
    scale: scale as PlotSceneScale,
    ticks,
    format: optional_string(item.format, `${name}.format`),
  }
}
const scene_dataset = (value: unknown, name: string): number => {
  if (!value || typeof value !== 'object') scene_fail(`${name} must be an object`)
  const id = (value as Record<string, unknown>).datasetId
  if (!Number.isInteger(id) || (id as number) <= 0) scene_fail(`${name}.datasetId must be a positive integer`)
  return id as number
}
const scene_ref_axis = (value: unknown, name: string, allowed: readonly string[]): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !allowed.includes(value)) scene_fail(`${name} is invalid`)
  return value as string
}
const scene_style = (value: unknown, name: string): PlotSceneStyle | undefined => {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) scene_fail(`${name} must be an object`)
  return value as PlotSceneStyle
}

const scene_layer = (value: unknown, index: number, axes: PlotSceneAxes): PlotSceneLayer => {
  if (!value || typeof value !== 'object') scene_fail(`layers[${index}] must be an object`)
  const item = value as Record<string, unknown>
  const type = item.type
  const valid_types: PlotSceneLayerType[] = ['line', 'scatter', 'line+scatter', 'bars', 'error-bars', 'fill', 'contour']
  if (!valid_types.includes(type as PlotSceneLayerType)) scene_fail(`layers[${index}].type is invalid`)
  const id = string_value(item.id, `layers[${index}].id`)
  const datasetId = scene_dataset(item.data, `layers[${index}].data`)
  if (item.axis !== undefined && (!item.axis || typeof item.axis !== 'object' || Array.isArray(item.axis))) scene_fail(`layers[${index}].axis must be an object`)
  const axis_item = item.axis === undefined ? undefined : item.axis as Record<string, unknown>
  const xAxis = (scene_ref_axis(item.xAxis ?? item.x_axis ?? axis_item?.x, `layers[${index}].xAxis`, ['x1', 'x2']) ?? 'x1') as 'x1' | 'x2'
  const yAxis = (scene_ref_axis(item.yAxis ?? item.y_axis ?? axis_item?.y, `layers[${index}].yAxis`, ['y1', 'y2']) ?? 'y1') as 'y1' | 'y2'
  if (xAxis === 'x2' && !axes.x2) scene_fail(`layers[${index}] references missing x2 axis`)
  if (yAxis === 'y2' && !axes.y2) scene_fail(`layers[${index}] references missing y2 axis`)
  const levels = item.levels === undefined ? undefined : number_array(item.levels, `layers[${index}].levels`)
  const field_type = type === 'contour'
  if (field_type && item.shape === undefined) scene_fail(`layers[${index}].shape is required for field layers`)
  const shape = item.shape === undefined ? undefined : (() => {
    const shape_value = item.shape as unknown
    if (!Array.isArray(shape_value) || shape_value.length !== 2) scene_fail(`layers[${index}].shape must contain two integer dimensions >= 2`)
    const shape_values = shape_value as unknown[]
    if (!Number.isInteger(shape_values[0]) || !Number.isInteger(shape_values[1]) || Number(shape_values[0]) < 2 || Number(shape_values[1]) < 2) scene_fail(`layers[${index}].shape must contain two integer dimensions >= 2`)
    return [Number(shape_values[0]), Number(shape_values[1])] as [number, number]
  })()
  return {
    id, type: type as PlotSceneLayerType, label: optional_string(item.label, `layers[${index}].label`), datasetId,
    xAxis, yAxis, x_axis: xAxis, y_axis: yAxis, axis: { x: xAxis, y: yAxis }, style: scene_style(item.style, `layers[${index}].style`), levels,
    filled: item.filled === undefined || item.filled === false ? undefined : scene_fail(`layers[${index}].filled contours are unsupported`),
    width: item.width === undefined ? undefined : finite_positive(item.width, `layers[${index}].width`),
    height: item.height === undefined ? undefined : finite_positive(item.height, `layers[${index}].height`), shape,
    opacity: item.opacity === undefined ? undefined : finite(item.opacity, `layers[${index}].opacity`),
    visible: item.visible === undefined ? undefined : typeof item.visible === 'boolean' ? item.visible : scene_fail(`layers[${index}].visible is invalid`),
  }
}
const scene_annotation = (value: unknown, name: string): PlotSceneAnnotation => {
  if (!value || typeof value !== 'object') scene_fail(`${name} must be an object`)
  const item = value as Record<string, unknown>
  const space = item.coordinateSpace
  if (space !== 'data' && space !== 'panel') scene_fail(`${name}.coordinateSpace is invalid`)
  const xAxis = scene_ref_axis(item.xAxis, `${name}.xAxis`, ['x1', 'x2']) as 'x1' | 'x2' | undefined
  const yAxis = scene_ref_axis(item.yAxis, `${name}.yAxis`, ['y1', 'y2']) as 'y1' | 'y2' | undefined
  return { id: item.id === undefined ? undefined : string_value(item.id, `${name}.id`), text: string_value(item.text, `${name}.text`), coordinateSpace: space as 'data' | 'panel', x: finite(item.x, `${name}.x`), y: finite(item.y, `${name}.y`), xAxis, yAxis, style: scene_style(item.style, `${name}.style`) }
}

export const parse_plot_scene = (value: unknown): PlotScene => {
  if (!value || typeof value !== 'object') scene_fail('root must be an object')
  const item = value as Record<string, unknown>
  if (item.format !== 'multiwfn-matterviz-plot' || item.version !== 2) scene_fail('unsupported format or version')
  const page_value = item.page
  if (!page_value || typeof page_value !== 'object') scene_fail('page must be an object')
  const page = page_value as Record<string, unknown>
  if (!Array.isArray(item.panels) || !item.panels.length) scene_fail('panels must be non-empty')
  const panels = (item.panels as unknown[]).map((raw, panel_index): PlotScenePanel => {
    if (!raw || typeof raw !== 'object') scene_fail(`panels[${panel_index}] must be an object`)
    const p = raw as Record<string, unknown>
    const viewport = p.viewport
    if (!Array.isArray(viewport) || viewport.length !== 4 || viewport.some((n) => typeof n !== 'number' || !Number.isFinite(n))) scene_fail(`panels[${panel_index}].viewport must contain four finite numbers`)
    const vp = viewport as number[]
    if (vp[2] <= 0 || vp[3] <= 0 || vp[0] < 0 || vp[1] < 0 || vp[0] + vp[2] > 1 || vp[1] + vp[3] > 1) scene_fail(`panels[${panel_index}].viewport must be normalized within page`)
    if (!p.axes || typeof p.axes !== 'object') scene_fail(`panels[${panel_index}].axes must be an object`)
    const raw_axes = p.axes as Record<string, unknown>
    if (!raw_axes.x1 || !raw_axes.y1) scene_fail(`panels[${panel_index}] requires x1 and y1 axes`)
    const axes: PlotSceneAxes = { x1: scene_axis(raw_axes.x1, `panels[${panel_index}].axes.x1`), y1: scene_axis(raw_axes.y1, `panels[${panel_index}].axes.y1`), x2: raw_axes.x2 === undefined ? undefined : scene_axis(raw_axes.x2, `panels[${panel_index}].axes.x2`), y2: raw_axes.y2 === undefined ? undefined : scene_axis(raw_axes.y2, `panels[${panel_index}].axes.y2`) }
    if (!Array.isArray(p.layers) || !p.layers.length) scene_fail(`panels[${panel_index}].layers must be non-empty`)
    const annotations = p.annotations === undefined ? undefined : (() => { if (!Array.isArray(p.annotations)) scene_fail(`panels[${panel_index}].annotations must be an array`); return (p.annotations as unknown[]).map((a, i) => scene_annotation(a, `panels[${panel_index}].annotations[${i}]`)) })()
    annotations?.forEach((annotation, annotation_index) => {
      if (annotation.xAxis === 'x2' && !axes.x2) scene_fail(`panels[${panel_index}].annotations[${annotation_index}] references missing x2 axis`)
      if (annotation.yAxis === 'y2' && !axes.y2) scene_fail(`panels[${panel_index}].annotations[${annotation_index}] references missing y2 axis`)
      if (annotation.xAxis === 'x2' || annotation.yAxis === 'y2') scene_fail(`panels[${panel_index}].annotations[${annotation_index}] cannot use secondary axes`)
      if (annotation.coordinateSpace === 'data' && axes.x1.scale === 'log' && annotation.x <= 0) scene_fail(`panels[${panel_index}].annotations[${annotation_index}].x must be positive for log scale`)
      if (annotation.coordinateSpace === 'data' && axes.y1.scale === 'log' && annotation.y <= 0) scene_fail(`panels[${panel_index}].annotations[${annotation_index}].y must be positive for log scale`)
    })
    const legend = p.legend === undefined ? undefined : (() => { if (!p.legend || typeof p.legend !== 'object') scene_fail(`panels[${panel_index}].legend must be an object`); const entries = (p.legend as Record<string, unknown>).entries; if (!Array.isArray(entries)) scene_fail(`panels[${panel_index}].legend.entries must be an array`); return { entries: (entries as unknown[]).map((e, i) => { if (!e || typeof e !== 'object') scene_fail(`legend.entries[${i}] must be an object`); const entry = e as Record<string, unknown>; return { layerId: string_value(entry.layerId, `legend.entries[${i}].layerId`), label: string_value(entry.label, `legend.entries[${i}].label`) } }) } })()
    const layers = (p.layers as unknown[]).map((layer, i) => scene_layer(layer, i, axes))
    const layer_ids = new Set<string>()
    for (const layer of layers) { if (layer_ids.has(layer.id)) scene_fail(`panels[${panel_index}] has duplicate layer id ${layer.id}`); layer_ids.add(layer.id) }
    legend?.entries.forEach((entry, entry_index) => { if (!layer_ids.has(entry.layerId)) scene_fail(`panels[${panel_index}].legend.entries[${entry_index}] references unknown layer ${entry.layerId}`) })
    return { id: string_value(p.id, `panels[${panel_index}].id`), viewport: [vp[0], vp[1], vp[2], vp[3]], axes, layers, annotations, legend }
  })
  const panel_ids = new Set<string>()
  for (const panel of panels) { if (panel_ids.has(panel.id)) scene_fail(`duplicate panel id ${panel.id}`); panel_ids.add(panel.id) }
  return { format: 'multiwfn-matterviz-plot', version: 2, title: string_value(item.title, 'title'), semanticKind: optional_string(item.semanticKind, 'semanticKind'), page: { width: finite_positive(page.width, 'page.width'), height: finite_positive(page.height, 'page.height') }, panels }
}

/** Unified entry point for callers that accept both protocol generations. */
export const parse_plot = (value: unknown): PlotArtifact | PlotScene => {
  if (value && typeof value === 'object' && (value as Record<string, unknown>).version === 2) return parse_plot_scene(value)
  return parse_plot_artifact(value)
}

const dataset_array = (value: unknown, role: PlotArrayRole, datasetId: number): Float64Array | undefined => {
  if (value === undefined || value === null) return undefined
  if (value instanceof Float64Array) return value
  if (ArrayBuffer.isView(value) && value instanceof Float64Array) return value
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const result = Float64Array.from(value as ArrayLike<number>)
    if (result.some((n) => !Number.isFinite(n))) scene_fail(`dataset ${datasetId} role ${role} contains non-finite values`)
    return result
  }
  scene_fail(`dataset ${datasetId} role ${role} must be a Float64Array`)
}

export const resolve_plot_scene = async (scene: PlotScene, resolver: PlotDatasetResolver): Promise<ResolvedPlotScene> => {
  const ids = new Set<number>()
  scene.panels.forEach((panel) => panel.layers.forEach((layer) => ids.add(layer.datasetId)))
  const datasets = new Map<number, PlotDataset>()
  for (const id of ids) {
    const loaded = await resolver(id)
    if (!loaded || typeof loaded !== 'object') scene_fail(`resolver returned no dataset ${id}`)
    const normalized: PlotDataset = {}
    for (const role of ['x', 'y', 'z', 'u', 'v', 'lower', 'upper', 'baseline'] as PlotArrayRole[]) normalized[role] = dataset_array(loaded[role], role, id)
    const require_role = (layer: PlotSceneLayer, role: PlotArrayRole): void => {
      if (!normalized[role]) scene_fail(`dataset ${id} is missing ${role} role for ${layer.id}`)
    }
    for (const panel of scene.panels) for (const layer of panel.layers.filter((item) => item.datasetId === id)) {
      if (['line', 'scatter', 'line+scatter', 'bars', 'error-bars', 'fill'].includes(layer.type)) {
        require_role(layer, 'x')
        require_role(layer, 'y')
      }
      if (layer.type === 'bars') require_role(layer, 'baseline')
      if (layer.type === 'error-bars') { require_role(layer, 'lower'); require_role(layer, 'upper') }
      if (layer.type === 'fill') require_role(layer, 'lower')
      if (layer.type === 'contour') require_role(layer, 'z')
      const same_length = (roles: PlotArrayRole[]): void => {
        const lengths = roles.map((role) => normalized[role]?.length).filter((length): length is number => length !== undefined)
        if (new Set(lengths).size > 1) scene_fail(`dataset ${id} roles ${roles.join('/')} have different lengths for ${layer.id}`)
      }
      if (['line', 'scatter', 'line+scatter'].includes(layer.type)) same_length(['x', 'y'])
      if (layer.type === 'bars') same_length(['x', 'y', 'baseline'])
      if (layer.type === 'error-bars') same_length(['x', 'y', 'lower', 'upper'])
      if (layer.type === 'fill') {
        same_length(['x', 'y'])
        if (normalized.lower && normalized.baseline && normalized.lower.length !== normalized.baseline.length) scene_fail(`dataset ${id} lower/baseline lengths differ for ${layer.id}`)
      }
      if (layer.shape) {
        const [width, height] = layer.shape
        const cells = width * height
        if (!Number.isSafeInteger(cells)) scene_fail(`dataset ${id} shape overflows for ${layer.id}`)
        if (normalized.z?.length !== cells) scene_fail(`dataset ${id} role z length does not match shape for ${layer.id}`)
        if (normalized.x && normalized.x.length !== width) scene_fail(`dataset ${id} x coordinates do not match shape for ${layer.id}`)
        if (normalized.y && normalized.y.length !== height) scene_fail(`dataset ${id} y coordinates do not match shape for ${layer.id}`)
      }
      if ((layer.xAxis === 'x2' || layer.yAxis === 'y2') && ['bars', 'fill', 'error-bars', 'contour'].includes(layer.type)) scene_fail(`${layer.type} layer ${layer.id} cannot use secondary axes`)
      const x_axis = layer.xAxis === 'x2' ? panel.axes.x2 : panel.axes.x1
      const y_axis = layer.yAxis === 'y2' ? panel.axes.y2 : panel.axes.y1
      const positive = (values: Float64Array | undefined, axis: PlotSceneAxis | undefined, role: string): void => {
        if (axis?.scale === 'log' && values?.some((value) => value <= 0)) scene_fail(`dataset ${id} role ${role} contains nonpositive values for log axis in ${layer.id}`)
      }
      positive(normalized.x, x_axis, 'x')
      positive(normalized.y, y_axis, 'y')
      if (layer.type === 'bars') positive(normalized.baseline, y_axis, 'baseline')
      if (layer.type === 'error-bars') { positive(normalized.lower, y_axis, 'lower'); positive(normalized.upper, y_axis, 'upper') }
      if (layer.type === 'fill') positive(normalized.lower, y_axis, 'lower')
    }
    datasets.set(id, normalized)
  }
  for (const panel of scene.panels) {
    const point_layers = panel.layers.filter((layer) => ['line', 'scatter', 'line+scatter'].includes(layer.type))
    const point_count = point_layers.reduce((sum, layer) => sum + (datasets.get(layer.datasetId)?.x?.length ?? 0), 0)
    if (point_count > 50_000 && point_layers.every((layer) => layer.type === 'scatter') && point_layers.some((layer) => layer.xAxis === 'x2' || layer.yAxis === 'y2')) scene_fail(`dense scatter panel ${panel.id} cannot use secondary axes`)
  }
  return { scene, datasets }
}

export const release_plot_scene = (resolved: ResolvedPlotScene | undefined, release?: (datasetId: number, dataset: PlotDataset) => void): void => {
  if (!resolved) return
  if (release) for (const [id, dataset] of resolved.datasets) release(id, dataset)
  resolved.datasets.clear()
}

export type PlotLayerRoute = 'scatter' | 'binned-scatter' | 'bars' | 'field'
export const route_plot_layer = (layer: PlotSceneLayer, pointCount: number): PlotLayerRoute => {
  if (layer.type === 'bars') return 'bars'
  if (layer.type === 'contour') return 'field'
  if (layer.type === 'scatter' && pointCount > 50_000) return 'binned-scatter'
  return 'scatter'
}

export const materialize_plot_layer = (layer: PlotSceneLayer, dataset: PlotDataset): { x: Float64Array; y: Float64Array } => {
  const x_raw = dataset.x
  const y_raw = dataset.y
  if (!x_raw || !y_raw) scene_fail(`dataset ${layer.datasetId} is missing x/y roles for ${layer.id}`)
  const x = x_raw as Float64Array
  const y = y_raw as Float64Array
  if (x.length !== y.length) scene_fail(`dataset ${layer.datasetId} x/y lengths differ for ${layer.id}`)
  return { x, y }
}

export const to_matterviz_axis = (axis: PlotSceneAxis): { label: string; unit?: string; range: [number, number]; scale_type: PlotSceneScale; ticks?: number[]; format?: string } => ({
  label: axis.label, unit: axis.unit, range: axis.range, scale_type: axis.scale, ticks: axis.ticks, format: axis.format,
})

export const to_matterviz_data_series = (layer: PlotSceneLayer, dataset: PlotDataset): { id: string; label?: string; x: Float64Array; y: Float64Array; markers: 'line' | 'points' | 'line+points'; x_axis: 'x1' | 'x2'; y_axis: 'y1' | 'y2'; visible?: boolean; line_style?: { stroke?: string; stroke_width?: number; line_dash?: string }; point_style?: { radius?: number; fill?: string; fill_opacity?: number; stroke?: string; stroke_opacity?: number } } => {
  const points = materialize_plot_layer(layer, dataset)
  const style = layer.style ?? {}
  const markers = layer.type === 'line' ? 'line' : layer.type === 'scatter' ? 'points' : 'line+points'
  return {
    id: layer.id, label: layer.label, x: points.x, y: points.y, markers, x_axis: layer.xAxis ?? 'x1', y_axis: layer.yAxis ?? 'y1', visible: layer.visible,
    line_style: { stroke: typeof style.color === 'string' ? style.color : undefined, stroke_width: typeof style.width === 'number' ? style.width : undefined, line_dash: typeof style.dash === 'string' ? style.dash : undefined },
    point_style: { radius: typeof style.markerSize === 'number' ? Math.max(1, style.markerSize / 10) : typeof style.radius === 'number' ? style.radius : undefined, fill: typeof style.color === 'string' ? style.color : undefined, fill_opacity: typeof style.opacity === 'number' ? style.opacity : undefined },
  }
}

export const to_matterviz_bar_series = (layer: PlotSceneLayer, dataset: PlotDataset): { id: string; label?: string; x: Float64Array; y: Float64Array; baseline: Float64Array; x_axis: 'x1' | 'x2'; y_axis: 'y1' | 'y2'; color?: string; visible?: boolean; bar_width?: number } => {
  const points = materialize_plot_layer(layer, dataset)
  const baseline_raw = dataset.baseline
  if (!baseline_raw || baseline_raw.length !== points.y.length) scene_fail(`dataset ${layer.datasetId} is missing a matching baseline role for ${layer.id}`)
  const baseline = baseline_raw as Float64Array
  const style = layer.style ?? {}
  return { id: layer.id, label: layer.label, x: points.x, y: points.y, baseline, x_axis: layer.xAxis ?? 'x1', y_axis: layer.yAxis ?? 'y1', color: typeof style.color === 'string' ? style.color : undefined, visible: layer.visible, bar_width: layer.width }
}

export const to_matterviz_fill_region = (layer: PlotSceneLayer, dataset: PlotDataset): { id: string; label?: string; upper: { type: 'data'; values: Float64Array; x: Float64Array }; lower: { type: 'data'; values: Float64Array; x: Float64Array }; fill?: string; fill_opacity?: number; visible?: boolean } => {
  const points = materialize_plot_layer(layer, dataset)
  const lower_raw = dataset.lower
  const upper_raw = dataset.upper ?? points.y
  if (!lower_raw || lower_raw.length !== (dataset.baseline ?? points.x).length || upper_raw.length !== points.x.length) scene_fail(`dataset ${layer.datasetId} has invalid fill roles for ${layer.id}`)
  const lower = lower_raw as Float64Array
  const upper = upper_raw as Float64Array
  const style = layer.style ?? {}
  const lower_x = dataset.baseline ?? points.x
  if (lower_x.length !== lower.length) scene_fail(`dataset ${layer.datasetId} lower x/y lengths differ for ${layer.id}`)
  return { id: layer.id, label: layer.label, upper: { type: 'data', values: upper, x: points.x }, lower: { type: 'data', values: lower, x: lower_x }, fill: typeof style.color === 'string' ? style.color : undefined, fill_opacity: typeof style.opacity === 'number' ? style.opacity : undefined, visible: layer.visible }
}

export const to_matterviz_error_band = (layer: PlotSceneLayer, dataset: PlotDataset): { id: string; label?: string; series: { series_id: string }; error: { upper: Float64Array; lower: Float64Array }; fill?: string; fill_opacity?: number } => {
  const points = materialize_plot_layer(layer, dataset)
  const lower_raw = dataset.lower
  const upper_raw = dataset.upper
  if (!lower_raw || !upper_raw || lower_raw.length !== points.x.length || upper_raw.length !== points.x.length) scene_fail(`dataset ${layer.datasetId} is missing lower/upper roles for ${layer.id}`)
  const lower = lower_raw as Float64Array
  const upper = upper_raw as Float64Array
  const style = layer.style ?? {}
  return { id: layer.id, label: layer.label, series: { series_id: layer.id }, error: { upper, lower }, fill: typeof style.color === 'string' ? style.color : undefined, fill_opacity: typeof style.opacity === 'number' ? style.opacity : undefined }
}
