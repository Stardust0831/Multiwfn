<script lang="ts">
  import { BinnedScatterPlot, ScatterPlot } from 'matterviz'
  import type { UserContentProps } from 'matterviz/plot'
  import { to_matterviz_axis, to_matterviz_bar_series, to_matterviz_data_series, to_matterviz_error_band, to_matterviz_fill_region, materialize_plot_layer, parse_plot_scene, release_plot_scene, resolve_plot_scene, type PlotDataset, type PlotDatasetResolver, type PlotScene, type PlotSceneLayer, type PlotScenePanel, type ResolvedPlotScene } from './plot'
  import FieldPlot2D from './FieldPlot2D.svelte'
  import { IRI_COLOR_RANGE, iri_interaction_color } from './iri-plot'
  import { native_viewport_padding, SCIENTIFIC_PLOT_LEGEND, SCIENTIFIC_PLOT_PADDING } from './scientific-plot'

  let { scene, resolver, release, resolved: supplied }: { scene: PlotScene; resolver?: PlotDatasetResolver; release?: (datasetId: number, dataset: PlotDataset) => void; resolved?: ResolvedPlotScene } = $props()
  let loaded = $state<ResolvedPlotScene | undefined>()
  let load_error = $state<string | undefined>()
  let page_width = $state(0)
  let page_height = $state(0)
  let generation = 0

  $effect(() => {
    const current = ++generation
    load_error = undefined
    if (supplied) {
      loaded = supplied
      return () => { generation += 1 }
    }
    if (!resolver) {
      loaded = undefined
      load_error = 'Plot data resolver is required for this scene'
      return () => { generation += 1 }
    }
    let active: ResolvedPlotScene | undefined
    void resolve_plot_scene(scene, resolver).then((result) => {
      if (current !== generation) { release_plot_scene(result, release); return }
      active = result
      loaded = result
    }).catch((error: unknown) => {
      if (current === generation) load_error = error instanceof Error ? error.message : String(error)
    })
    return () => {
      generation += 1
      if (active) release_plot_scene(active, release)
    }
  })

  const axis_config = (axis: PlotScenePanel['axes']['x1']) => to_matterviz_axis(axis)
  const line_layers = (panel: PlotScenePanel): PlotSceneLayer[] => panel.layers.filter((layer) => ['line', 'scatter', 'line+scatter'].includes(layer.type))
  const series_layers = (panel: PlotScenePanel): PlotSceneLayer[] => panel.layers.filter((layer) => ['line', 'scatter', 'line+scatter', 'error-bars'].includes(layer.type))
  const field_layers = (panel: PlotScenePanel): PlotSceneLayer[] => panel.layers.filter((layer) => layer.type === 'contour')
  const bar_layers = (panel: PlotScenePanel): PlotSceneLayer[] => panel.layers.filter((layer) => layer.type === 'bars')
  const fill_layers = (panel: PlotScenePanel): PlotSceneLayer[] => panel.layers.filter((layer) => layer.type === 'fill')
  const error_layers = (panel: PlotScenePanel): PlotSceneLayer[] => panel.layers.filter((layer) => layer.type === 'error-bars')
  const data = (layer: PlotSceneLayer): PlotDataset => loaded?.datasets.get(layer.datasetId) ?? {}
  const series = (panel: PlotScenePanel) => series_layers(panel).map((layer) => to_matterviz_data_series(layer, data(layer)))
  const bars = (panel: PlotScenePanel) => bar_layers(panel).map((layer) => to_matterviz_bar_series(layer, data(layer)))
  const fills = (panel: PlotScenePanel) => fill_layers(panel).map((layer) => to_matterviz_fill_region(layer, data(layer)))
  const errors = (panel: PlotScenePanel) => error_layers(panel).map((layer) => to_matterviz_error_band(layer, data(layer)))
  const dense_points = (panel: PlotScenePanel) => line_layers(panel).flatMap((layer) => {
    const points = materialize_plot_layer(layer, data(layer))
    return [{ id: layer.id, label: layer.label, x: points.x, y: points.y, color: typeof layer.style?.color === 'string' ? layer.style.color : undefined }]
  })
  const panel_route = (panel: PlotScenePanel): 'scatter' | 'binned-scatter' | 'field' => {
    if (field_layers(panel).length) return 'field'
    if (bar_layers(panel).length) return 'field'
    const count = line_layers(panel).reduce((sum, layer) => { const value = data(layer); return sum + (value.x?.length ?? 0) }, 0)
    if (line_layers(panel).length > 0 && line_layers(panel).every((layer) => layer.type === 'scatter') && count > 50_000) return 'binned-scatter'
    return 'scatter'
  }
  const panel_padding = (panel: PlotScenePanel) => scene.panels.length === 1 && page_width > 0 && page_height > 0
    ? native_viewport_padding(panel.viewport, page_width, page_height)
    : SCIENTIFIC_PLOT_PADDING
  const panel_style = (panel: PlotScenePanel): string => scene.panels.length === 1
    ? 'left:0;top:0;width:100%;height:100%;padding:0;'
    : `left:${panel.viewport[0] * 100}%;top:${panel.viewport[1] * 100}%;width:${panel.viewport[2] * 100}%;height:${panel.viewport[3] * 100}%`
  const dense_config = () => scene.semanticKind === 'iri'
    ? {
        color_by: 'x' as const,
        color_fn: iri_interaction_color,
        color_scale: { value_range: IRI_COLOR_RANGE },
        color_bar: {
          title: 'sign(lambda2)rho (a.u.)',
          tick_labels: [-0.04, 0, 0.02],
          tick_format: '.2f',
          orientation: 'vertical' as const,
          bar_style: 'width:12px;height:150px;',
          title_side: 'top' as const,
          title_style: 'max-width:145px;font-size:10px;',
        },
        auto_point_mode: false as const,
      }
    : { auto_point_mode: { max_points: 50_000 }, color_bar: { title: 'Density', orientation: 'vertical' as const, bar_style: 'width:12px;height:150px;', title_side: 'top' as const, title_style: 'max-width:145px;font-size:10px;' } }
  const annotation_x = (annotation: NonNullable<PlotScenePanel['annotations']>[number], width: number, scale: (value: number) => number): number => annotation.coordinateSpace === 'panel' ? annotation.x * width : scale(annotation.x)
  const annotation_y = (annotation: NonNullable<PlotScenePanel['annotations']>[number], height: number, scale: (value: number) => number): number => annotation.coordinateSpace === 'panel' ? annotation.y * height : scale(annotation.y)
</script>

<main class="plot-scene" aria-label="Multiwfn generic plot scene" style={`aspect-ratio: ${scene.page.width} / ${scene.page.height}`}>
  <header class="plot-header"><strong>{scene.title}</strong>{#if scene.semanticKind}<span>{scene.semanticKind}</span>{/if}</header>
  {#if load_error}<p class="plot-error">{load_error}</p>{:else if !loaded}<p class="plot-loading">Loading plot data...</p>{:else}
    <section class="scene-page" bind:clientWidth={page_width} bind:clientHeight={page_height}>
      {#each scene.panels as panel (panel.id)}
        {@const route = panel_route(panel)}
        {@const padding = panel_padding(panel)}
        <article class="scene-panel" style={panel_style(panel)}>
          <div class="scene-plot">
            {#snippet annotations({ width, height, x_scale_fn, y_scale_fn }: UserContentProps)}
              <rect class="scientific-plot-frame" x={padding.l} y={padding.t} width={width - padding.l - padding.r} height={height - padding.t - padding.b} fill="none" stroke="#000" stroke-width="1" shape-rendering="crispEdges" pointer-events="none" />
              <g class="scene-annotations" pointer-events="none">
                {#each panel.annotations ?? [] as annotation (annotation.id ?? `${annotation.text}:${annotation.x}:${annotation.y}`)}
                  <text x={annotation_x(annotation, width, x_scale_fn)} y={annotation_y(annotation, height, y_scale_fn)} fill={typeof annotation.style?.color === 'string' ? annotation.style.color : 'currentColor'} font-size={typeof annotation.style?.fontSize === 'number' ? annotation.style.fontSize : 11} text-anchor="middle" dominant-baseline="middle">{annotation.text}</text>
                {/each}
              </g>
            {/snippet}
            {#snippet binned_frame({ width, height }: { width: number; height: number; fullscreen: boolean })}
              <div class="scientific-plot-frame" style={`position:absolute;left:${padding.l}px;top:${padding.t}px;width:${width - padding.l - padding.r}px;height:${height - padding.t - padding.b}px;border:1px solid #000;box-sizing:border-box;pointer-events:none;`} aria-hidden="true"></div>
            {/snippet}
            {#if route === 'field'}
              <FieldPlot2D axes={panel.axes} series={series(panel)} field_layers={field_layers(panel)} datasets={loaded.datasets} bar_series={bars(panel)} fill_regions={fills(panel)} error_bands={errors(panel)} annotations={panel.annotations ?? []} {padding} />
            {:else if route === 'binned-scatter'}
              <BinnedScatterPlot class="scientific-binned-plot" series={dense_points(panel)} x_axis={axis_config(panel.axes.x1)} y_axis={axis_config(panel.axes.y1)} {padding} density={dense_config()} children={binned_frame} fullscreen_toggle={true} />
            {:else}
              <ScatterPlot class="scientific-scatter-plot" series={series(panel) as never[]} x_axis={axis_config(panel.axes.x1)} y_axis={axis_config(panel.axes.y1)} x2_axis={panel.axes.x2 ? axis_config(panel.axes.x2) : {}} y2_axis={panel.axes.y2 ? axis_config(panel.axes.y2) : {}} fill_regions={fills(panel) as never[]} error_bands={errors(panel) as never[]} {padding} user_content={annotations} legend={SCIENTIFIC_PLOT_LEGEND} controls={{ show: true }} fullscreen_toggle={true} pan={{ enabled: true }} />
            {/if}
          </div>
        </article>
      {/each}
    </section>
  {/if}
</main>
