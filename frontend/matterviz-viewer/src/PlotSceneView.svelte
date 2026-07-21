<script lang="ts">
  import { BinnedScatterPlot, ScatterPlot } from 'matterviz'
  import type { UserContentProps } from 'matterviz/plot'
  import { to_matterviz_axis, to_matterviz_bar_series, to_matterviz_data_series, to_matterviz_error_band, to_matterviz_fill_region, materialize_plot_layer, parse_plot_scene, release_plot_scene, resolve_plot_scene, type PlotDataset, type PlotDatasetResolver, type PlotScene, type PlotSceneLayer, type PlotScenePanel, type ResolvedPlotScene } from './plot'
  import FieldPlot2D from './FieldPlot2D.svelte'

  let { scene, resolver, release, resolved: supplied }: { scene: PlotScene; resolver?: PlotDatasetResolver; release?: (datasetId: number, dataset: PlotDataset) => void; resolved?: ResolvedPlotScene } = $props()
  let loaded = $state<ResolvedPlotScene | undefined>()
  let load_error = $state<string | undefined>()
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
  const annotation_x = (annotation: NonNullable<PlotScenePanel['annotations']>[number], width: number, scale: (value: number) => number): number => annotation.coordinateSpace === 'panel' ? annotation.x * width : scale(annotation.x)
  const annotation_y = (annotation: NonNullable<PlotScenePanel['annotations']>[number], height: number, scale: (value: number) => number): number => annotation.coordinateSpace === 'panel' ? annotation.y * height : scale(annotation.y)
</script>

<main class="plot-scene" aria-label="Multiwfn generic plot scene" style={`aspect-ratio: ${scene.page.width} / ${scene.page.height}`}>
  <header class="plot-header"><strong>{scene.title}</strong>{#if scene.semanticKind}<span>{scene.semanticKind}</span>{/if}</header>
  {#if load_error}<p class="plot-error">{load_error}</p>{:else if !loaded}<p class="plot-loading">Loading plot data...</p>{:else}
    <section class="scene-page">
      {#each scene.panels as panel (panel.id)}
        {@const route = panel_route(panel)}
        <article class="scene-panel" style={`left:${panel.viewport[0] * 100}%;top:${panel.viewport[1] * 100}%;width:${panel.viewport[2] * 100}%;height:${panel.viewport[3] * 100}%`}>
          <div class="scene-plot">
            {#snippet annotations({ width, height, x_scale_fn, y_scale_fn }: UserContentProps)}
              <g class="scene-annotations" pointer-events="none">
                {#each panel.annotations ?? [] as annotation (annotation.id ?? `${annotation.text}:${annotation.x}:${annotation.y}`)}
                  <text x={annotation_x(annotation, width, x_scale_fn)} y={annotation_y(annotation, height, y_scale_fn)} fill={typeof annotation.style?.color === 'string' ? annotation.style.color : 'currentColor'} font-size={typeof annotation.style?.fontSize === 'number' ? annotation.style.fontSize : 11} text-anchor="middle" dominant-baseline="middle">{annotation.text}</text>
                {/each}
              </g>
            {/snippet}
            {#if route === 'field'}
              <FieldPlot2D axes={panel.axes} series={series(panel)} field_layers={field_layers(panel)} datasets={loaded.datasets} bar_series={bars(panel)} fill_regions={fills(panel)} error_bands={errors(panel)} annotations={panel.annotations ?? []} />
            {:else if route === 'binned-scatter'}
              <BinnedScatterPlot series={dense_points(panel)} x_axis={axis_config(panel.axes.x1)} y_axis={axis_config(panel.axes.y1)} density={{ auto_point_mode: { max_points: 50_000 } }} fullscreen_toggle={true} />
            {:else}
              <ScatterPlot series={series(panel) as never[]} x_axis={axis_config(panel.axes.x1)} y_axis={axis_config(panel.axes.y1)} x2_axis={panel.axes.x2 ? axis_config(panel.axes.x2) : {}} y2_axis={panel.axes.y2 ? axis_config(panel.axes.y2) : {}} fill_regions={fills(panel) as never[]} error_bands={errors(panel) as never[]} user_content={annotations} legend={{ draggable: true }} controls={{ show: true }} fullscreen_toggle={true} pan={{ enabled: true }} />
            {/if}
          </div>
        </article>
      {/each}
    </section>
  {/if}
</main>
