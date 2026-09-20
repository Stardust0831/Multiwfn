<script lang="ts">
  import { t } from './i18n'
  import { Plus, X } from '@lucide/svelte'
  import { MAX_COLOR_STOPS, color_stop_hex, color_stops_gradient, type ColorStop } from 'matterviz/colors/stops'
  import { COLOR_SCALE_PRESETS, normalize_color_scale, preset_color_scale, type ColorScale } from './color-scale'
  let { value, onchange }: { value: ColorScale; onchange: (value: ColorScale) => void } = $props()
  let error = $state('')
  const custom = $derived(value.preset === 'custom')
  const load_preset = (event: Event) => {
    const select = event.currentTarget as HTMLSelectElement
    if (!select.value) return
    error = ''
    onchange({ ...preset_color_scale(select.value), preset: 'custom' })
    select.value = ''
  }
  const commit = (stops: ColorStop[]) => {
    try { const next = normalize_color_scale({ preset: 'custom', stops }); error = ''; onchange(next); return true }
    catch (reason) { error = (reason as Error).message; return false }
  }
  const position = (event: Event, index: number) => {
    const input = event.currentTarget as HTMLInputElement
    if (!commit(value.stops.map((stop, i) => i === index ? { ...stop, position: input.valueAsNumber / 100 } : stop))) input.value = String(value.stops[index].position * 100)
  }
  const color = (event: Event, index: number) => {
    const input = event.currentTarget as HTMLInputElement
    if (!commit(value.stops.map((stop, i) => i === index ? { ...stop, color: input.value } : stop))) input.value = value.stops[index].color
  }
  const add = () => {
    const bounds = [0, ...value.stops.map((stop) => stop.position), 1]
    let widest = 0
    for (let i = 1; i < bounds.length - 1; i++) if (bounds[i + 1] - bounds[i] > bounds[widest + 1] - bounds[widest]) widest = i
    const at = (bounds[widest] + bounds[widest + 1]) / 2
    commit([...value.stops, { position: at, color: color_stop_hex(value.stops, at) }])
  }
</script>

<div class="color-scale-editor">
  <label class="rep-field"><span>{$t('Color scale')}</span><select value={value.preset} onchange={(event) => { error = ''; onchange(event.currentTarget.value === 'custom' ? { ...value, preset: 'custom' } : preset_color_scale(event.currentTarget.value)) }}>
    <option value="custom">{$t('Custom')}</option>
    {#each COLOR_SCALE_PRESETS as preset}<option value={`interpolate${preset.name}`}>{preset.name === 'TransFlag' ? $t('Pink · White · Blue') : preset.name}</option>{/each}
  </select></label>
  <div class="scale-preview" role="img" aria-label={$t('Color scale preview')} style:background={color_stops_gradient(value.stops)}>
    {#if custom}{#each value.stops as stop}<span class="scale-mark" style:left={`${stop.position * 100}%`}></span>{/each}{/if}
  </div>
  <div class="scale-endpoints"><span>0%</span><span>100%</span></div>
  {#if custom}
    <label class="rep-field"><span>{$t('Load preset')}</span><select value="" onchange={load_preset}>
      <option value="">{$t('Choose a preset…')}</option>
      {#each COLOR_SCALE_PRESETS as preset}<option value={`interpolate${preset.name}`}>{preset.name === 'TransFlag' ? $t('Pink · White · Blue') : preset.name}</option>{/each}
    </select></label>
    <p class="rep-help">{$t('Load a preset or edit color stops. 0% is the minimum; 100% is the maximum.')}</p>
    <div class="scale-stops" role="group" aria-label={$t('Color stops')}>
      {#each value.stops as stop, index}
        <div class="scale-stop">
          <input type="color" aria-label={$t('Color stop {index}', { index: index + 1 })} value={stop.color} oninput={(event) => color(event, index)} />
          <input class="scale-hex" aria-label={$t('Hex color of stop {index}', { index: index + 1 })} value={stop.color} maxlength="7" spellcheck="false" onchange={(event) => color(event, index)} />
          <label><input type="number" min="0" max="100" step="0.1" aria-label={$t('Position of color stop {index} (%)', { index: index + 1 })} value={Number((stop.position * 100).toFixed(6))} onchange={(event) => position(event, index)} /><span>%</span></label>
          <button class="rep-icon rep-delete" type="button" aria-label={$t('Remove color stop {index}', { index: index + 1 })} disabled={value.stops.length <= 2} onclick={() => commit(value.stops.filter((_, i) => i !== index))}><X size={14} /></button>
        </div>
      {/each}
    </div>
    <button class="rep-add" type="button" disabled={value.stops.length >= MAX_COLOR_STOPS} onclick={add}><Plus size={14} />{$t('Add color stop')}</button>
    {#if error}<p class="rep-error" role="alert">{$t(error)}</p>{/if}
  {/if}
</div>

<style>
  .color-scale-editor { display: grid; gap: 8px; min-width: 0; }
  .scale-preview { position: relative; height: 24px; margin: 4px 1px 0; border: 1px solid #cbd5df; border-radius: 4px; }
  .scale-mark { position: absolute; bottom: -3px; height: 8px; border-left: 2px solid #41566d; transform: translateX(-1px); }
  .scale-endpoints { display: flex; justify-content: space-between; color: #758498; font-size: 10px; }
  .scale-stops { display: grid; gap: 8px; max-height: 228px; overflow: auto; padding: 4px; }
  .scale-stop { display: grid; grid-template-columns: 32px minmax(54px, 1fr) 85px 28px; align-items: center; gap: 5px; }
  .scale-stop .scale-hex { font-family: monospace; font-size: 11px; color: #5b7085; padding-inline: 4px; }
  .scale-stop label { display: flex; align-items: center; gap: 3px; font-size: 10px; color: #5b7085; }
</style>
