import {
  parse_plot, resolve_plot_scene, type PlotArtifact, type PlotArrayRole,
  type PlotDataset, type PlotDatasetResolver, type PlotScene,
} from './plot.ts'

export type WorkbenchPlot = {
  id: string
  artifact: PlotArtifact | PlotScene
  resolver: PlotDatasetResolver
  native?: boolean
}
export const PLOT_FILE_LIMIT = 32 * 1024 * 1024
export const PLOT_RESULT_LIMIT = 8
const roles: PlotArrayRole[] = ['x', 'y', 'z', 'u', 'v', 'lower', 'upper', 'baseline']

export const cached_plot_resolver = (load: PlotDatasetResolver): PlotDatasetResolver => {
  const cache = new Map<number, Promise<PlotDataset>>()
  return (id) => {
    let pending = cache.get(id)
    if (!pending) {
      pending = Promise.resolve().then(() => load(id)).catch((error) => { cache.delete(id); throw error })
      cache.set(id, pending)
    }
    return pending
  }
}

const bounds = (values: number[]): [number, number] => {
  let min = Infinity, max = -Infinity
  for (const value of values) { min = Math.min(min, value); max = Math.max(max, value) }
  const pad = min === max ? Math.max(Math.abs(min) * 0.05, 1) : (max - min) * 0.03
  return [min - pad, max + pad]
}

// Deliberately accept only rectangular numeric tables, never arbitrary program logs.
export const parse_numeric_plot = (text: string, title: string): Pick<WorkbenchPlot, 'artifact' | 'resolver'> => {
  const columns: number[][] = []
  let header: string[] | undefined
  let samples = 0
  let blockEnded = false
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (!line) { if (columns.length) blockEnded = true; continue }
    if (/^[#!;]/.test(line)) continue
    if (blockEnded) throw new Error('Separate numeric blocks must be opened as separate curves')
    const cells = line.includes(',') ? line.split(',').map((cell) => cell.trim()) : line.split(/\s+/)
    const numbers = cells.map((cell) => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/.test(cell)
      ? Number(cell.replace(/[dD]/, 'e')) : NaN)
    if (numbers.some((value) => !Number.isFinite(value))) {
      if (!columns.length && !header && cells.length >= 2 && cells.every((cell) => /^[A-Za-z][^\x00-\x1f]*$/.test(cell))) {
        header = cells
        continue
      }
      throw new Error(`Line ${index + 1} is not a finite numeric row`)
    }
    if (numbers.length < 2 || numbers.length > 32) throw new Error('A curve table needs 2 to 32 columns')
    if (!columns.length) {
      if (header && header.length !== numbers.length) throw new Error('Column header and data widths differ')
      numbers.forEach(() => columns.push([]))
    }
    if (columns.length !== numbers.length) throw new Error(`Line ${index + 1} has a different number of columns`)
    samples += numbers.length
    if (samples > 2_000_000) throw new Error('Curve table exceeds 2 million numeric values')
    numbers.forEach((value, column) => columns[column].push(value))
  }
  if (!columns.length || columns[0].length < 2) throw new Error('A curve table needs at least two numeric rows')
  const data = new Map<number, PlotDataset>()
  const x = new Float64Array(columns[0])
  columns.slice(1).forEach((values, index) => data.set(index + 1, { x, y: new Float64Array(values) }))
  const yranges = columns.slice(1).map(bounds)
  const artifact: PlotScene = {
    format: 'multiwfn-matterviz-plot', version: 2, title, semanticKind: 'curve',
    page: { width: 1200, height: 800 },
    panels: [{ id: 'curve', viewport: [0.07, 0.10, 0.80, 0.78],
      axes: {
        x1: { label: header?.[0] || 'X', range: bounds(columns[0]), scale: 'linear' },
        y1: { label: columns.length === 2 ? header?.[1] || 'Y' : 'Value',
          range: [Math.min(...yranges.map(([low]) => low)), Math.max(...yranges.map(([, high]) => high))], scale: 'linear' },
      },
      layers: columns.slice(1).map((_, index) => ({ id: `column-${index + 2}`, datasetId: index + 1,
        type: 'line', label: header?.[index + 1] || `Column ${index + 2}` })),
    }],
  }
  return { artifact, resolver: async (id) => {
    const dataset = data.get(id)
    if (!dataset) throw new Error(`Missing plot dataset ${id}`)
    return dataset
  } }
}

export const import_plot_document = async (text: string, filename: string): Promise<Pick<WorkbenchPlot, 'artifact' | 'resolver'>> => {
  if (text.includes('\0')) throw new Error('Binary files are not supported by Open plot')
  if (!text.trimStart().startsWith('{')) return parse_numeric_plot(text, filename)
  const raw = JSON.parse(text)
  const bundle = raw.format === 'multiwfn-plot-document' && raw.version === 1
  const artifact = parse_plot(bundle ? raw.plot : raw)
  const resolver = cached_plot_resolver(async (id) => {
    const dataset = bundle ? raw.datasets?.[String(id)] : undefined
    if (!dataset || typeof dataset !== 'object') throw new Error(`Missing embedded dataset ${id}; open a self-contained plot document`)
    const result: PlotDataset = {}
    for (const role of roles) {
      const values = dataset[role]
      if (values === undefined) continue
      if (!Array.isArray(values) || values.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value))) {
        throw new Error(`Dataset ${id} contains invalid ${role} values`)
      }
      result[role] = new Float64Array(values)
    }
    return result
  })
  if (artifact.version === 2) await resolve_plot_scene(artifact, resolver)
  return { artifact, resolver }
}

export const serialize_plot_document = async (plot: WorkbenchPlot): Promise<string> => {
  const datasets: Record<string, Record<string, number[]>> = {}
  if (plot.artifact.version === 2) {
    const resolved = await resolve_plot_scene(plot.artifact, plot.resolver)
    for (const [id, dataset] of resolved.datasets) {
      datasets[id] = Object.fromEntries(roles.filter((role) => dataset[role]).map((role) => [role, Array.from(dataset[role]!)]))
    }
  }
  // The wire format nests dataset references under `data`; the parsed model flattens them.
  const artifact = plot.artifact.version === 1 ? plot.artifact : {
    ...plot.artifact,
    panels: plot.artifact.panels.map((panel) => ({ ...panel,
      layers: panel.layers.map(({ datasetId, ...layer }) => ({ ...layer, data: { datasetId } })),
    })),
  }
  return JSON.stringify({ format: 'multiwfn-plot-document', version: 1, plot: artifact, datasets })
}

const csv_cell = (value: string | number): string => {
  if (typeof value === 'number') return String(value)
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export const plot_data_csv = async (plot: WorkbenchPlot): Promise<string> => {
  const rows = ['panel,layer,type,role,index,value']
  const append = (panel: string, layer: string, type: string, role: string, values: ArrayLike<number>): void => {
    for (let index = 0; index < values.length; index++) rows.push([panel, layer, type, role, index, values[index]].map(csv_cell).join(','))
  }
  if (plot.artifact.version === 1) {
    for (const panel of plot.artifact.panels) for (const series of panel.series) {
      append(panel.id, series.label || series.id, series.type, 'x', series.x)
      append(panel.id, series.label || series.id, series.type, 'y', series.y)
    }
  } else {
    const resolved = await resolve_plot_scene(plot.artifact, plot.resolver)
    for (const panel of plot.artifact.panels) for (const layer of panel.layers) {
      const dataset = resolved.datasets.get(layer.datasetId)!
      for (const role of roles) if (dataset[role]) append(panel.id, layer.label || layer.id, layer.type, role, dataset[role]!)
    }
  }
  return `${rows.join('\r\n')}\r\n`
}

export const download_blob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
