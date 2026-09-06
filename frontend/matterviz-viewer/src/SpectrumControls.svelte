<script lang="ts">
  import { Icon } from 'matterviz'
  import type { SpectrumData, SpectrumSettings } from './spectra'
  let { data, datasets, options = $bindable(), busy, onpick, onupdate, onremove }: {
    data: SpectrumData; datasets: SpectrumData[]; options: SpectrumSettings; busy: boolean
    onpick: (id: string) => void; onupdate: () => void; onremove: () => void
  } = $props()
  const elements = $derived([...new Set(data.peaks.flatMap((p) => p.element ? [p.element] : []))].sort())
  const anharmonic = $derived(data.peaks.some((p) => p.category))
</script>

<div class="spectrum-controls" aria-label="Spectrum settings">
  <label>Dataset<select aria-label="Spectrum dataset" value={data.id} onchange={(event) => onpick(event.currentTarget.value)}>
    {#each datasets.filter((item) => item.kind === data.kind) as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
  </select></label>
  <label>Display<select bind:value={options.view} onchange={onupdate}><option value="both">Curve + sticks</option><option value="curve">Curve</option><option value="sticks">Sticks</option></select></label>
  <label>Broadening<select bind:value={options.shape} onchange={onupdate} disabled={options.view === 'sticks'}><option value="lorentzian">Lorentzian</option><option value="gaussian">Gaussian</option></select></label>
  <label>FWHM ({data.kind === 'uvvis' ? 'eV' : data.kind === 'nmr' ? 'ppm' : 'cm^-1'})<input aria-label="Spectrum FWHM" type="number" min="0.0001" max="10000" step={data.kind === 'uvvis' ? .05 : data.kind === 'nmr' ? .1 : 1} bind:value={options.fwhm} oninput={onupdate} disabled={options.view === 'sticks'} /></label>
  {#if data.kind === 'uvvis'}<label>Units<select bind:value={options.xUnit} onchange={onupdate}><option value="nm">nm</option><option value="eV">eV</option></select></label>{/if}
  {#if data.kind !== 'nmr'}<label>Frequency scale<input aria-label="Spectrum frequency scale" type="number" min="0.001" max="10" step="0.01" bind:value={options.scale} oninput={onupdate} /></label>{/if}
  {#if data.kind === 'nmr'}
    <label>Element<select bind:value={options.element} onchange={(event) => { if (!event.currentTarget.value) options.nmrMode = 'shielding'; onupdate() }}><option value="">All</option>{#each elements as element}<option value={element}>{element}</option>{/each}</select></label>
    <label>Quantity<select bind:value={options.nmrMode} onchange={onupdate}><option value="shielding">Absolute shielding</option><option value="reference" disabled={!options.element}>Reference - shielding</option><option value="linear" disabled={!options.element}>Intercept + slope * shielding</option></select></label>
    {#if options.nmrMode === 'reference'}<label>Reference (ppm)<input type="number" step="0.1" bind:value={options.reference} oninput={onupdate} /></label>{/if}
    {#if options.nmrMode === 'linear'}<label>Intercept<input type="number" step="0.1" bind:value={options.intercept} oninput={onupdate} /></label><label>Slope<input type="number" step="0.01" bind:value={options.slope} oninput={onupdate} /></label>{/if}
  {/if}
  {#if anharmonic}
    <label class="check"><input type="checkbox" bind:checked={options.fundamental} onchange={onupdate} />Fundamental</label>
    <label class="check"><input type="checkbox" bind:checked={options.overtone} onchange={onupdate} />Overtones</label>
    <label class="check"><input type="checkbox" bind:checked={options.combination} onchange={onupdate} />Combinations</label>
  {/if}
  <label class="check"><input type="checkbox" bind:checked={options.labels} />Peak labels</label>
  <span class="count" role="status">{busy ? 'Updating...' : `${data.peaks.length} transitions`}</span>
  <button type="button" title="Remove spectrum dataset" aria-label="Remove spectrum dataset" onclick={onremove}><Icon icon="Cross" width="16" /></button>
</div>

<style>
  .spectrum-controls{display:flex;flex-wrap:wrap;align-items:end;gap:8px 12px;padding:8px 12px;background:#fff;border-bottom:1px solid #dce2e5;color:#263238;font-size:11px;min-width:0}
  label{display:flex;flex-direction:column;gap:3px;min-width:0;max-width:100%}select,input{font:inherit;color:inherit;min-width:0;max-width:100%;height:28px;border:1px solid #cbd5dc;border-radius:4px;background:#fff;padding:3px 6px}select[aria-label="Spectrum dataset"]{width:220px}input[type=number]{width:88px}.check{flex-direction:row;align-items:center;height:28px}.check input{width:15px;height:15px;padding:0}.count{align-self:center;color:#596b75}button{width:28px;height:28px;padding:4px;border:1px solid #cbd5dc;border-radius:4px;background:#fff;color:inherit;cursor:pointer;flex:none}
  @media(max-width:480px){.spectrum-controls{max-height:230px;overflow:auto;gap:6px}select[aria-label="Spectrum dataset"]{width:190px}}
</style>
