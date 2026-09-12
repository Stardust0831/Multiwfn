<script lang="ts">
  import { Icon } from 'matterviz'
  import { SURFACE_TYPES, SURFACE_FUNCTIONS, surface_statistics, surface_function, surface_position, surface_range, type SurfaceResult, type SurfaceDisplay, type SurfaceConfirmation } from './surface-analysis'
  let { result, display = $bindable(), active = $bindable(false), selection = $bindable(), busy = false, onclose, onexport, onfit, onconfirm, onlog, onclearlog }:
    { result: SurfaceResult; display: SurfaceDisplay; active: boolean; selection: number | undefined; busy?: boolean; onclose: () => void; onexport: (format: 'json' | 'csv') => void; onfit: () => void; onconfirm: (value: SurfaceConfirmation) => void; onlog: (event: Event) => void; onclearlog: () => void } = $props()
  const stats = $derived(surface_statistics(result)), mapped = $derived(surface_function(result.metadata)), range = $derived(surface_range(result))
  const m = $derived(result.metadata), a2 = $derived(m.bohrToAngstrom ** 2)
  const format = (n: number | null, scale = 1) => n === null || !Number.isFinite(n) ? 'N/A' : (n * scale).toLocaleString('en-US', { maximumSignificantDigits: 8 })
  let surfaceType = $state(''), mappedFunction = $state(''), mappingCalculated = $state(false)
  let logInput: HTMLInputElement
  $effect(() => {
    surfaceType = m.surfaceType?.toString() ?? ''
    mappedFunction = m.mapped === null ? '' : m.mapped === false ? 'none' : m.mappedFunction?.toString() ?? ''
    mappingCalculated = m.mapped === true
  })
</script>

<aside class="surface-analysis-panel" aria-label="Quantitative surface results">
  <header><strong>Quantitative surface</strong><button type="button" title="Close panel" aria-label="Close surface results panel" onclick={onclose}><Icon icon="Cross" width="16" /></button></header>
  <div class="body">
    <div><strong>{mapped.name}</strong><p>{m.surfaceType === null ? 'Surface type not confirmed' : SURFACE_TYPES[m.surfaceType]} · iso {m.isovalue}</p></div>
    <fieldset disabled={busy}>
      <legend>Result types</legend>
      <label>Surface<select aria-label="Surface type" bind:value={surfaceType}><option value="" disabled>Not confirmed</option>{#each Object.entries(SURFACE_TYPES) as [value, label]}<option {value}>{label}</option>{/each}</select></label>
      <label>Calculated mapped function<select aria-label="Calculated mapped function" bind:value={mappedFunction} onchange={() => mappingCalculated = false}><option value="" disabled>Not confirmed</option><option value="none">None (geometry only)</option>{#each Object.entries(SURFACE_FUNCTIONS) as [value, label]}<option {value}>{label}</option>{/each}</select></label>
      {#if mappedFunction && mappedFunction !== 'none'}<label class="check"><input type="checkbox" bind:checked={mappingCalculated} />Mapping calculation completed</label>{/if}
      <button type="button" disabled={!surfaceType || !mappedFunction || (mappedFunction !== 'none' && !mappingCalculated)} onclick={() => onconfirm({ surfaceType: Number(surfaceType), mappedFunction: mappedFunction === 'none' ? null : Number(mappedFunction) })}>Confirm types</button>
      {#if m.metadataSource === 'user'}<p>Types: user-confirmed</p>{/if}
    </fieldset>
    <label class="check"><input type="checkbox" bind:checked={active} />Surface analysis view</label>
    <button type="button" onclick={onfit} disabled={!active}><Icon icon="ZoomOut" width="14" />Fit surface</button>
    <label class="check"><input type="checkbox" bind:checked={display.surface} />Show surface</label>
    <label class="field"><span>Opacity {Math.round(display.opacity * 100)}%</span><input aria-label="Quantitative surface opacity" type="range" min="0.05" max="1" step="0.01" bind:value={display.opacity} /></label>
    <label class="check"><input type="checkbox" bind:checked={display.wireframe} />Wireframe</label>
    {#if m.mapped}
      <div class="legend" aria-label={`Mapped range ${range[0] * mapped.scale} to ${range[1] * mapped.scale} ${mapped.unit}`}><div class="bar"></div><div class="ticks"><span>{format(range[0], mapped.scale)}</span><span>{format((range[0] + range[1]) / 2, mapped.scale)}</span><span>{format(range[1], mapped.scale)}</span></div><p>{mapped.unit}</p></div>
      <label class="check"><input type="checkbox" bind:checked={display.minima} />Minima ({result.extremeKind.filter((n) => n < 0).length})</label>
      <label class="check"><input type="checkbox" bind:checked={display.maxima} />Maxima ({result.extremeKind.filter((n) => n > 0).length})</label>
      <label class="field"><span>Inspect extreme</span><select aria-label="Inspect surface extreme" value={selection ?? ''} onchange={(event) => selection = event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value)}>
        <option value="">None</option>{#each result.extremeId as id, i}<option value={i}>{result.extremeKind[i] < 0 ? 'Min' : 'Max'} {id}: {format(result.values[result.extremeVertex[i]], mapped.scale)}</option>{/each}
      </select></label>
      {#if selection !== undefined && selection < result.extremeId.length}
        {@const vertex = result.extremeVertex[selection]}
        <section class="readout"><strong>{result.extremeKind[selection] < 0 ? 'Minimum' : 'Maximum'} {result.extremeId[selection]}</strong>
          <p>{format(result.values[vertex], mapped.scale)} {mapped.unit}</p><p>Vertex {result.vertexIds[vertex]}</p><p>{surface_position(result, vertex).map((v) => v.toFixed(6)).join(', ')} Å</p>
        </section>
      {/if}
    {/if}
    <dl>
      <dt>Volume (Å³)</dt><dd>{format(m.volume, m.bohrToAngstrom ** 3)}</dd>
      <dt>Area (Å²)</dt><dd>{format(stats.area, a2)}</dd>
      <dt>Mass density (g/cm³)</dt><dd>{format(m.massDensity)}</dd>
      {#if m.mapped}
        <dt>Minimum ({mapped.unit})</dt><dd>{format(stats.minimum, mapped.scale)}</dd><dt>Maximum ({mapped.unit})</dt><dd>{format(stats.maximum, mapped.scale)}</dd>
        <dt>Positive area (Å²)</dt><dd>{format(stats.positiveArea, a2)}</dd><dt>Negative area (Å²)</dt><dd>{format(stats.negativeArea, a2)}</dd>
        {#each [['Mean', stats.mean], ['Positive mean', stats.positiveMean], ['Negative mean', stats.negativeMean]] as [label, value]}<dt>{label} ({mapped.unit})</dt><dd>{format(value as number | null, mapped.scale)}</dd>{/each}
        {#each [['Total variance', stats.variance], ['Positive variance', stats.positiveVariance], ['Negative variance', stats.negativeVariance]] as [label, value]}<dt>{label} ({mapped.unit})²</dt><dd>{format(value as number, mapped.scale ** 2)}</dd>{/each}
        {#if mapped.esp}
          <dt>Charge balance (ν)</dt><dd>{format(stats.balance)}</dd><dt>σ²tot ν ({mapped.unit})²</dt><dd>{format(stats.varianceBalance, mapped.scale ** 2)}</dd>
          <dt>Charge separation (Π)</dt><dd>{format(stats.separation, mapped.scale)} {mapped.unit}</dd><dt>MPI</dt><dd>{format(stats.mpi, mapped.scale)} {mapped.unit}</dd>
          <dt>Nonpolar area (Å²)</dt><dd>{format(stats.nonpolarArea, a2)}</dd><dt>Polar area (Å²)</dt><dd>{format(stats.polarArea, a2)}</dd>
        {/if}
        <dt>Skewness</dt><dd>{format(stats.skewness)}</dd><dt>Positive skewness</dt><dd>{format(stats.positiveSkewness)}</dd><dt>Negative skewness</dt><dd>{format(stats.negativeSkewness)}</dd>
      {/if}
    </dl>
    <div class="log-import">
      <input hidden type="file" accept=".txt,.log,.out,text/plain" bind:this={logInput} onchange={onlog} />
      <button type="button" disabled={busy} onclick={() => logInput.click()}><Icon icon="ArrowUp" width="14" />Import statistics log</button>
      {#if m.statisticsSource}<button type="button" disabled={busy} title="Clear imported statistics" aria-label="Clear imported statistics" onclick={onclearlog}><Icon icon="Cross" width="14" /></button><p>{m.statisticsSource.filename} · printed precision</p>{:else if m.volume === null}<p>Volume / mass density: not provided</p>{/if}
    </div>
    <p>{result.values.length.toLocaleString()} vertices · {result.areas.length.toLocaleString()} facets</p>
    <div class="exports"><button type="button" onclick={() => onexport('csv')}><Icon icon="Download" width="14" />CSV</button><button type="button" onclick={() => onexport('json')}><Icon icon="Download" width="14" />Surface JSON</button></div>
  </div>
</aside>

<style>
  .surface-analysis-panel{width:288px;min-width:0;max-height:100%;overflow:auto;background:#fff;color:#263238;border-right:1px solid #dce2e5;font-size:12px}
  header{display:flex;align-items:center;justify-content:space-between;padding:12px;border-bottom:1px solid #dce2e5;gap:8px}header strong{font-size:13px}header button{width:28px;flex-shrink:0}
  button{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid #cdd5da;border-radius:4px;background:#f5f7f8;color:inherit;min-height:28px;cursor:pointer}
  .body{display:grid;gap:12px;padding:12px}.check{display:flex;align-items:center;gap:6px}.check input{width:16px;height:16px;margin:0}.field{display:grid;grid-template-columns:minmax(0,1fr) 114px;gap:8px;align-items:center}.field input,.field select{width:100%;min-width:0;box-sizing:border-box}select{font:inherit;padding:4px}
  p{font-size:11px;line-height:1.5;color:#57656c;margin:5px 0 0;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin:0;border-top:1px solid #dce2e5;padding-top:12px}dt,dd{overflow-wrap:anywhere}dt{color:#57656c}dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}.readout{border-block:1px solid #dce2e5;padding:10px 0;overflow-wrap:anywhere}.exports{display:flex;gap:8px}
  fieldset{display:grid;gap:8px;margin:0;padding:10px 0;border:0;border-block:1px solid #dce2e5;min-width:0}legend{font-weight:600}fieldset label:not(.check){display:grid;gap:5px}fieldset select{width:100%;min-width:0}button:disabled{cursor:default;opacity:.5}.log-import{display:flex;flex-wrap:wrap;gap:8px}.log-import p{flex-basis:100%}
  .bar{height:14px;border:1px solid #ccd4d9;background:linear-gradient(to right,#f5a9b8,#fff,#5bcefa)}.ticks{display:flex;justify-content:space-between;gap:4px;font-size:10px;font-variant-numeric:tabular-nums}.ticks span{min-width:0;overflow-wrap:anywhere}.legend p{text-align:center}
  @media(max-width:760px){.surface-analysis-panel{width:100%;max-height:42vh;border-right:0;border-bottom:1px solid #dce2e5}}
</style>
