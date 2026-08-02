<script lang="ts">
  import { ScatterPlot } from 'matterviz'
  import type { RefLine, UserContentProps } from 'matterviz/plot'
  import { tick, untrack } from 'svelte'
  import { stick_path, to_matterviz_series, type PlotArtifact, type PlotPanel } from './plot'
  import PlotSceneView from './PlotSceneView.svelte'
  import type { PlotDataset, PlotDatasetResolver, PlotScene } from './plot'
  import { SCIENTIFIC_PLOT_LEGEND, SCIENTIFIC_PLOT_PADDING, scientific_series_color } from './scientific-plot'
  import { export_plot_document, wait_for_plot_ready, type PlotExportRequest } from './plot-export'

  let { artifact, resolver, release, exportConfig, onExported, onExportError }: { artifact: PlotArtifact | PlotScene; resolver?: PlotDatasetResolver; release?: (datasetId: number, dataset: PlotDataset) => void; exportConfig?: PlotExportRequest; onExported?: () => void; onExportError?: (error: unknown) => void } = $props()
  let plotRoot = $state<HTMLElement | undefined>()
  let exportStarted = false
  let exportError = $state<string | undefined>()
  $effect(() => {
    const config = exportConfig
    const root = plotRoot
    if (!config || !root || exportStarted) return
    exportStarted = true
    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        await tick()
        await wait_for_plot_ready(root)
        if (cancelled) return
        await export_plot_document(root, config)
        if (!cancelled) onExported?.()
      } catch (error) {
        if (cancelled) return
        exportError = error instanceof Error ? error.message : String(error)
        onExportError?.(error)
      }
    }
    void run()
    return () => { cancelled = true }
  })
  const v1_artifact = $derived(artifact as PlotArtifact)

  const axis_label = (axis: { label: string; unit?: string }): string => axis.unit ? `${axis.label} (${axis.unit})` : axis.label
  const panel_refs = (panel: PlotPanel): RefLine[] => (panel.referenceLines ?? []).map((line) => ({
    type: line.axis === 'x' ? 'vertical' : 'horizontal',
    ...(line.axis === 'x' ? { x: line.value } : { y: line.value }),
    label: line.label,
    style: { color: line.color, dash: line.dash === 'dash' ? '6 4' : undefined },
    annotation: line.label ? { text: line.label } : undefined,
    y_axis: line.axis === 'y2' ? 'y2' : 'y1',
  })) as RefLine[]

  let panels = $state(untrack(() => artifact.version === 1 ? v1_artifact.panels.map((panel) => ({
    panel,
    series: panel.series.map(to_matterviz_series),
    x_axis: { label: axis_label(panel.xAxis), range: panel.xAxis.range },
    y_axis: { label: axis_label(panel.yAxis), range: panel.yAxis.range },
    y2_axis: panel.y2Axis ? { label: axis_label(panel.y2Axis), range: panel.y2Axis.range } : {},
    ref_lines: panel_refs(panel),
    display: { x_grid: true, y_grid: true, y2_grid: true },
  })) : []))
</script>

{#if artifact.version === 2}
  <div bind:this={plotRoot} data-plot-document data-export-width={(artifact as PlotScene).page.width} data-export-height={(artifact as PlotScene).page.height} style="width:100%;height:100%;">
    <PlotSceneView scene={artifact as PlotScene} {resolver} {release} />
    {#if exportError}<div class="plot-error" role="alert"><span>{exportError}</span>{#if onExported}<button type="button" onclick={onExported}>Return to Multiwfn</button>{/if}</div>{/if}
  </div>
{:else}
<main bind:this={plotRoot} class="plot-only" data-plot-document data-export-width="1600" data-export-height="900" aria-label="Multiwfn plot viewer">
  <header class="plot-header">
    <strong>{v1_artifact.title}</strong>
    <span>{v1_artifact.kind.toUpperCase()}</span>
  </header>
  <section class="plot-panels">
    {#each panels as view, panel_index (view.panel.id)}
      <article class="plot-panel" style={`--plot-height: ${view.panel.heightWeight ?? 1}`}>
        {#if view.panel.title}<h2>{view.panel.title}</h2>{/if}
        <div class="plot-canvas">
          {#snippet scientific_content({ width, height, x_scale_fn, y_scale_fn, y2_scale_fn, pad }: UserContentProps)}
            {@const clip_id = `spectrum-sticks-${panel_index}`}
            <defs><clipPath id={clip_id}><rect x={pad.l} y={pad.t} width={width - pad.l - pad.r} height={height - pad.t - pad.b} /></clipPath></defs>
            <rect class="scientific-plot-frame" x={pad.l} y={pad.t} width={width - pad.l - pad.r} height={height - pad.t - pad.b} fill="none" stroke="#000" stroke-width="1" shape-rendering="crispEdges" pointer-events="none" />
            <g class="spectrum-sticks" clip-path={`url(#${clip_id})`} pointer-events="none">
              {#each view.panel.series as source, series_index (source.id)}
                {#if source.type === 'sticks' && view.series[series_index]?.visible !== false}
                  {@const y_scale = source.axis === 'y2' && y2_scale_fn ? y2_scale_fn : y_scale_fn}
                  <path d={stick_path(source, x_scale_fn, y_scale)} fill="none" stroke={scientific_series_color(source.color, series_index)} stroke-width={source.lineWidth ?? 2} stroke-dasharray={source.dash === 'dash' ? '6 4' : undefined} />
                  {#each source.labels ?? [] as label, label_index}
                    {#if label}<text x={x_scale_fn(source.x[label_index])} y={y_scale(source.y[label_index]) - 5} text-anchor="middle" fill={scientific_series_color(source.color, series_index)} font-size="11">{label}</text>{/if}
                  {/each}
                {/if}
              {/each}
            </g>
          {/snippet}
          <ScatterPlot
            class="scientific-scatter-plot"
            bind:series={view.series}
            bind:x_axis={view.x_axis}
            bind:y_axis={view.y_axis}
            bind:y2_axis={view.y2_axis}
            bind:ref_lines={view.ref_lines}
            bind:display={view.display}
            padding={SCIENTIFIC_PLOT_PADDING}
            user_content={scientific_content}
            legend={SCIENTIFIC_PLOT_LEGEND}
            controls={{ show: true }}
            fullscreen_toggle={true}
            pan={{ enabled: true }}
          />
        </div>
      </article>
    {/each}
  </section>
  {#if exportError}<div class="plot-error" role="alert"><span>{exportError}</span>{#if onExported}<button type="button" onclick={onExported}>Return to Multiwfn</button>{/if}</div>{/if}
</main>
{/if}
