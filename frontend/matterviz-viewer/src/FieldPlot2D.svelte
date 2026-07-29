<script lang="ts">
  import { ScatterPlot } from 'matterviz'
  import type { UserContentProps } from 'matterviz/plot'
  import { contour_geometry } from './field'
  import type { PlotDataset, PlotSceneAnnotation, PlotSceneAxis, PlotSceneLayer } from './plot'
  import { SCIENTIFIC_PLOT_LEGEND, SCIENTIFIC_PLOT_PADDING } from './scientific-plot'

  let {
    axes,
    series = [],
    field_layers,
    datasets,
    bar_series = [],
    fill_regions = [],
    error_bands = [],
    annotations = [],
    padding = SCIENTIFIC_PLOT_PADDING,
  }: {
    axes: { x1: PlotSceneAxis; y1: PlotSceneAxis; x2?: PlotSceneAxis; y2?: PlotSceneAxis }
    series?: unknown[]
    field_layers: PlotSceneLayer[]
    datasets: Map<number, PlotDataset>
    bar_series?: Array<{ id: string; x: Float64Array; y: Float64Array; baseline: Float64Array; color?: string; visible?: boolean; bar_width?: number }>
    fill_regions?: unknown[]
    error_bands?: unknown[]
    annotations?: PlotSceneAnnotation[]
    padding?: { t: number; b: number; l: number; r: number }
  } = $props()

  const axis_config = (axis: PlotSceneAxis) => ({ label: axis.label, unit: axis.unit, range: axis.range, scale_type: axis.scale, ticks: axis.ticks, format: axis.format })
  const path_for = (rings: number[][][]): string => rings.map((ring) => ring.length ? `M${ring.map((point) => `${point[0]},${point[1]}`).join('L')}Z` : '').join(' ')
  const z_for = (layer: PlotSceneLayer): { z: Float64Array; width: number; height: number } | undefined => {
    const z = datasets.get(layer.datasetId)?.z
    if (!z) return undefined
    const shape = layer.shape ?? [layer.width ?? Math.round(Math.sqrt(z.length)), layer.height ?? Math.round(Math.sqrt(z.length))]
    return { z, width: shape[0], height: shape[1] }
  }
  const interpolate_axis = (values: Float64Array | undefined, fraction: number, fallback: [number, number]): number => {
    if (!values?.length) return fallback[0] + fraction * (fallback[1] - fallback[0])
    if (values.length === 1) return values[0]
    const scaled = Math.max(0, Math.min(values.length - 1, fraction * (values.length - 1)))
    const lower = Math.floor(scaled)
    const upper = Math.min(values.length - 1, lower + 1)
    return values[lower] + (scaled - lower) * (values[upper] - values[lower])
  }
  const field_x = (layer: PlotSceneLayer, fraction: number): number => interpolate_axis(datasets.get(layer.datasetId)?.x, fraction, axes.x1.range)
  const field_y = (layer: PlotSceneLayer, fraction: number): number => interpolate_axis(datasets.get(layer.datasetId)?.y, fraction, axes.y1.range)
  const bar_width = (x: Float64Array, index: number, scale: (value: number) => number, requested?: number): number => {
    if (requested && requested > 0) return Math.max(1, Math.abs(scale(x[index] + requested / 2) - scale(x[index] - requested / 2)))
    if (x.length < 2) return 8
    const left = index > 0 ? Math.abs(scale(x[index]) - scale(x[index - 1])) : Infinity
    const right = index + 1 < x.length ? Math.abs(scale(x[index + 1]) - scale(x[index])) : Infinity
    return Math.max(1, Math.min(left, right) * 0.8)
  }
</script>

  {#snippet user_content({ width, height, x_scale_fn, y_scale_fn, pad }: UserContentProps)}
    <rect class="scientific-plot-frame" x={pad.l} y={pad.t} width={width - pad.l - pad.r} height={height - pad.t - pad.b} fill="none" stroke="#000" stroke-width="1" shape-rendering="crispEdges" pointer-events="none" />
    <g class="field-overlays" pointer-events="none">
      {#each bar_series as bars (bars.id)}
        {#if bars.visible !== false}
          {#each bars.x as x, index}
            {@const center = x_scale_fn(x)}
            {@const y0 = y_scale_fn(bars.baseline[index])}
            {@const y1 = y_scale_fn(bars.y[index])}
            {@const width_px = bar_width(bars.x, index, x_scale_fn, bars.bar_width)}
            <rect x={center - width_px / 2} y={Math.min(y0, y1)} width={width_px} height={Math.max(1, Math.abs(y1 - y0))} fill={bars.color ?? '#2563eb'} opacity="0.82" />
          {/each}
        {/if}
      {/each}
      {#each field_layers as layer (layer.id)}
        {@const field = z_for(layer)}
        {#if layer.type === 'contour' && field}
          {@const geometry = contour_geometry(field.z, field.width, field.height, layer.levels ?? [])}
          {#each geometry as contour}
            {#each contour.coordinates as polygon}
              <path d={path_for(polygon.map((ring) => ring.map((point) => [x_scale_fn(field_x(layer, point[0] / Math.max(1, field.width - 1))), y_scale_fn(field_y(layer, point[1] / Math.max(1, field.height - 1)))])))} fill="none" stroke={typeof layer.style?.color === 'string' ? layer.style.color : 'currentColor'} stroke-width={typeof layer.style?.width === 'number' ? layer.style.width : 1} opacity={layer.opacity ?? 0.8} />
            {/each}
          {/each}
        {/if}
      {/each}
      {#each annotations as annotation (annotation.id ?? `${annotation.text}:${annotation.x}:${annotation.y}`)}
        <text x={annotation.coordinateSpace === 'panel' ? annotation.x * width : x_scale_fn(annotation.x)} y={annotation.coordinateSpace === 'panel' ? annotation.y * height : y_scale_fn(annotation.y)} fill={typeof annotation.style?.color === 'string' ? annotation.style.color : 'currentColor'} font-size={typeof annotation.style?.fontSize === 'number' ? annotation.style.fontSize : 11} text-anchor="middle" dominant-baseline="middle">{annotation.text}</text>
      {/each}
    </g>
  {/snippet}

  <ScatterPlot
    class="scientific-scatter-plot"
    series={series as never[]}
    x_axis={axis_config(axes.x1)}
    y_axis={axis_config(axes.y1)}
    x2_axis={axes.x2 ? axis_config(axes.x2) : {}}
    y2_axis={axes.y2 ? axis_config(axes.y2) : {}}
    fill_regions={fill_regions as never[]}
    error_bands={error_bands as never[]}
    {padding}
    user_content={user_content}
    legend={SCIENTIFIC_PLOT_LEGEND}
    controls={{ show: true }}
    fullscreen_toggle={true}
    pan={{ enabled: true }}
  />
