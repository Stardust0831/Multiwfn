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
  const x: number[] = [], y: number[] = []
  input.x.forEach((value, index) => { x.push(value, value, value); y.push(0, input.y[index], 0) })
  const stick_labels = input.labels?.flatMap((label) => [{}, label ? { text: label, auto_placement: true } : {}, {}])
  return { id: input.id, label: input.label, x, y, ...(stick_labels ? { markers: 'line+points' as const, point_style: { radius: 0, fill_opacity: 0, stroke_opacity: 0 }, point_label: stick_labels } : { markers: 'line' as const }), visible: input.visible, y_axis: input.axis === 'y2' ? 'y2' : 'y1', line_style: { stroke: input.color, stroke_width: input.lineWidth, line_dash: input.dash === 'dash' ? '6 4' : undefined } }
}
