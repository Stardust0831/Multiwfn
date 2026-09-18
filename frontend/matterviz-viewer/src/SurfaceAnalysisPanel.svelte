<script lang="ts">
  import { t } from './i18n'
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

<aside class="surface-analysis-panel" aria-label={$t("Quantitative surface results")}>
  <header><strong>{$t("Quantitative surface")}</strong><button type="button" title={$t("Close panel")} aria-label={$t("Close surface results panel")} onclick={onclose}><Icon icon="Cross" width="16" /></button></header>
  <div class="body">
    <div><strong>{$t(mapped.name)}</strong><p>{$t(m.surfaceType === null ? 'Surface type not confirmed' : SURFACE_TYPES[m.surfaceType])} {$t("· iso")} {m.isovalue}</p></div>
    <fieldset disabled={busy}>
      <legend>{$t("Result types")}</legend>
      <label>{$t("Surface")}<select aria-label={$t("Surface type")} bind:value={surfaceType}><option value="" disabled>{$t("Not confirmed")}</option>{#each Object.entries(SURFACE_TYPES) as [value, label]}<option {value}>{$t(String(label))}</option>{/each}</select></label>
      <label>{$t("Calculated mapped function")}<select aria-label={$t("Calculated mapped function")} bind:value={mappedFunction} onchange={() => mappingCalculated = false}><option value="" disabled>{$t("Not confirmed")}</option><option value="none">{$t("None (geometry only)")}</option>{#each Object.entries(SURFACE_FUNCTIONS) as [value, label]}<option {value}>{$t(String(label))}</option>{/each}</select></label>
      {#if mappedFunction && mappedFunction !== 'none'}<label class="check"><input type="checkbox" bind:checked={mappingCalculated} />{$t("Mapping calculation completed")}</label>{/if}
      <button type="button" disabled={!surfaceType || !mappedFunction || (mappedFunction !== 'none' && !mappingCalculated)} onclick={() => onconfirm({ surfaceType: Number(surfaceType), mappedFunction: mappedFunction === 'none' ? null : Number(mappedFunction) })}>{$t("Confirm types")}</button>
      {#if m.metadataSource === 'user'}<p>{$t("Types: user-confirmed")}</p>{/if}
    </fieldset>
    <label class="check"><input type="checkbox" bind:checked={active} />{$t("Surface analysis view")}</label>
    <button type="button" onclick={onfit} disabled={!active}><Icon icon="ZoomOut" width="14" />{$t("Fit surface")}</button>
    <label class="check"><input type="checkbox" bind:checked={display.surface} />{$t("Show surface")}</label>
    <label class="field"><span>{$t("Opacity")} {Math.round(display.opacity * 100)}%</span><input aria-label={$t("Quantitative surface opacity")} type="range" min="0.05" max="1" step="0.01" bind:value={display.opacity} /></label>
    <label class="check"><input type="checkbox" bind:checked={display.wireframe} />{$t("Wireframe")}</label>
    {#if m.mapped}
      <div class="legend" aria-label={$t("Mapped range {min} to {max} {unit}", { min: range[0] * mapped.scale, max: range[1] * mapped.scale, unit: $t(mapped.unit) })}><div class="bar"></div><div class="ticks"><span>{format(range[0], mapped.scale)}</span><span>{format((range[0] + range[1]) / 2, mapped.scale)}</span><span>{format(range[1], mapped.scale)}</span></div><p>{$t(mapped.unit)}</p></div>
      <label class="check"><input type="checkbox" bind:checked={display.minima} />{$t("Minima ({count})", { count: result.extremeKind.filter((n) => n < 0).length })}</label>
      <label class="check"><input type="checkbox" bind:checked={display.maxima} />{$t("Maxima ({count})", { count: result.extremeKind.filter((n) => n > 0).length })}</label>
      <label class="field"><span>{$t("Inspect extreme")}</span><select aria-label={$t("Inspect surface extreme")} value={selection ?? ''} onchange={(event) => selection = event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value)}>
        <option value="">{$t("None")}</option>{#each result.extremeId as id, i}<option value={i}>{$t(result.extremeKind[i] < 0 ? 'Min' : 'Max')} {id}: {format(result.values[result.extremeVertex[i]], mapped.scale)}</option>{/each}
      </select></label>
      {#if selection !== undefined && selection < result.extremeId.length}
        {@const vertex = result.extremeVertex[selection]}
        <section class="readout"><strong>{$t(result.extremeKind[selection] < 0 ? 'Minimum' : 'Maximum')} {result.extremeId[selection]}</strong>
          <p>{format(result.values[vertex], mapped.scale)} {$t(mapped.unit)}</p><p>{$t("Vertex")} {result.vertexIds[vertex]}</p><p>{surface_position(result, vertex).map((v) => v.toFixed(6)).join(', ')} Å</p>
        </section>
      {/if}
    {/if}
    <dl>
      <dt>{$t("Volume (Å³)")}</dt><dd>{format(m.volume, m.bohrToAngstrom ** 3)}</dd>
      <dt>{$t("Area (Å²)")}</dt><dd>{format(stats.area, a2)}</dd>
      <dt>{$t("Mass density (g/cm³)")}</dt><dd>{format(m.massDensity)}</dd>
      {#if m.mapped}
        <dt>{$t("Minimum ({unit})", { unit: $t(mapped.unit) })}</dt><dd>{format(stats.minimum, mapped.scale)}</dd><dt>{$t("Maximum ({unit})", { unit: $t(mapped.unit) })}</dt><dd>{format(stats.maximum, mapped.scale)}</dd>
        <dt>{$t("Positive area (Å²)")}</dt><dd>{format(stats.positiveArea, a2)}</dd><dt>{$t("Negative area (Å²)")}</dt><dd>{format(stats.negativeArea, a2)}</dd>
        {#each [['Mean', stats.mean], ['Positive mean', stats.positiveMean], ['Negative mean', stats.negativeMean]] as [label, value]}<dt>{$t(String(label))} ({$t(mapped.unit)})</dt><dd>{format(value as number | null, mapped.scale)}</dd>{/each}
        {#each [['Total variance', stats.variance], ['Positive variance', stats.positiveVariance], ['Negative variance', stats.negativeVariance]] as [label, value]}<dt>{$t(String(label))} ({$t(mapped.unit)})²</dt><dd>{format(value as number, mapped.scale ** 2)}</dd>{/each}
        {#if mapped.esp}
          <dt>{$t("Charge balance (ν)")}</dt><dd>{format(stats.balance)}</dd><dt>σ²tot ν ({$t(mapped.unit)})²</dt><dd>{format(stats.varianceBalance, mapped.scale ** 2)}</dd>
          <dt>{$t("Charge separation (Π)")}</dt><dd>{format(stats.separation, mapped.scale)} {$t(mapped.unit)}</dd><dt>MPI</dt><dd>{format(stats.mpi, mapped.scale)} {$t(mapped.unit)}</dd>
          <dt>{$t("Nonpolar area (Å²)")}</dt><dd>{format(stats.nonpolarArea, a2)}</dd><dt>{$t("Polar area (Å²)")}</dt><dd>{format(stats.polarArea, a2)}</dd>
        {/if}
        <dt>{$t("Skewness")}</dt><dd>{format(stats.skewness)}</dd><dt>{$t("Positive skewness")}</dt><dd>{format(stats.positiveSkewness)}</dd><dt>{$t("Negative skewness")}</dt><dd>{format(stats.negativeSkewness)}</dd>
      {/if}
    </dl>
    <div class="log-import">
      <input hidden type="file" accept=".txt,.log,.out,text/plain" bind:this={logInput} onchange={onlog} />
      <button type="button" disabled={busy} onclick={() => logInput.click()}><Icon icon="ArrowUp" width="14" />{$t("Import statistics log")}</button>
      {#if m.statisticsSource}<button type="button" disabled={busy} title={$t("Clear imported statistics")} aria-label={$t("Clear imported statistics")} onclick={onclearlog}><Icon icon="Cross" width="14" /></button><p>{m.statisticsSource.filename} {$t("· printed precision")}</p>{:else if m.volume === null}<p>{$t("Volume / mass density: not provided")}</p>{/if}
    </div>
    <p>{result.values.length.toLocaleString()} {$t("vertices ·")} {result.areas.length.toLocaleString()} {$t("facets")}</p>
    <div class="exports"><button type="button" onclick={() => onexport('csv')}><Icon icon="Download" width="14" />CSV</button><button type="button" onclick={() => onexport('json')}><Icon icon="Download" width="14" />{$t("Surface JSON")}</button></div>
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
