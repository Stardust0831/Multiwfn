<script lang="ts">
  import { ScatterPlot } from 'matterviz'
  import type { RefLine } from 'matterviz/plot'
  import { untrack } from 'svelte'
  import { to_matterviz_series, type PlotArtifact, type PlotPanel } from './plot'
  import PlotSceneView from './PlotSceneView.svelte'
  import type { PlotDataset, PlotDatasetResolver, PlotScene } from './plot'

  let { artifact, resolver, release }: { artifact: PlotArtifact | PlotScene; resolver?: PlotDatasetResolver; release?: (datasetId: number, dataset: PlotDataset) => void } = $props()
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
  <PlotSceneView scene={artifact as PlotScene} {resolver} {release} />
{:else}
<main class="plot-only" aria-label="Multiwfn plot viewer">
  <header class="plot-header">
    <strong>{v1_artifact.title}</strong>
    <span>{v1_artifact.kind.toUpperCase()}</span>
  </header>
  <section class="plot-panels">
    {#each panels as view (view.panel.id)}
      <article class="plot-panel" style={`--plot-height: ${view.panel.heightWeight ?? 1}`}>
        {#if view.panel.title}<h2>{view.panel.title}</h2>{/if}
        <div class="plot-canvas">
          <ScatterPlot
            bind:series={view.series}
            bind:x_axis={view.x_axis}
            bind:y_axis={view.y_axis}
            bind:y2_axis={view.y2_axis}
            bind:ref_lines={view.ref_lines}
            bind:display={view.display}
            legend={{ draggable: true }}
            controls={{ show: true }}
            fullscreen_toggle={true}
            pan={{ enabled: true }}
          />
        </div>
      </article>
    {/each}
  </section>
</main>
{/if}
