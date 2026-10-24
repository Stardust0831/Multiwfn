<script lang="ts">
  import { onMount } from 'svelte'
  import { Trajectory } from 'matterviz/trajectory'
  import { get_center_of_mass } from 'matterviz/structure'
  import { FolderOpen, X } from '@lucide/svelte'
  import { t } from './i18n'
  import {
    read_frequency_cjson, frequency_trajectory, FREQUENCY_FILE_LIMIT,
    DEFAULT_FREQUENCY_AMPLITUDE, type FrequencyData,
  } from './frequency'

  let { onclose }: { onclose: () => void } = $props()
  let dialog: HTMLDialogElement
  let input: HTMLInputElement
  let data = $state.raw<FrequencyData>()
  let filename = $state('')
  let error = $state('')
  let loading = $state(false)
  let modeIndex = $state(0)
  let amplitude = $state(DEFAULT_FREQUENCY_AMPLITUDE)
  let step = $state(0)
  let generation = 0
  let disposed = false
  const mode = $derived(data?.modes[modeIndex])
  const trajectory = $derived(data && frequency_trajectory(data, modeIndex, amplitude))
  // An explicit, stable orbit target uses MatterViz's public scene API. No camera reset
  // or DOM access is needed as frames, mode selection or display amplitude change.
  const cameraTarget = $derived(data && get_center_of_mass(data.structure))

  async function open_file(event: Event): Promise<void> {
    const element = event.currentTarget as HTMLInputElement
    const file = element.files?.[0]
    element.value = ''
    if (!file) return
    const current = ++generation
    loading = true
    error = ''
    try {
      if (file.size > FREQUENCY_FILE_LIMIT) throw new Error('Frequency file exceeds the 16 MiB limit.')
      const parsed = read_frequency_cjson(await file.text())
      if (disposed || current !== generation) return
      data = parsed
      filename = file.name
      modeIndex = 0
      amplitude = DEFAULT_FREQUENCY_AMPLITUDE
      step = 0
    } catch (reason) {
      if (!disposed && current === generation) error = reason instanceof Error ? reason.message : String(reason)
    } finally {
      if (!disposed && current === generation) loading = false
    }
  }

  const set_amplitude = (event: Event): void => {
    const control = event.currentTarget as HTMLInputElement
    const value = control.valueAsNumber
    // Do not propagate transient blank/zero/invalid input into the renderer.
    amplitude = Number.isFinite(value) && value > 0 && value <= 2 ? value : DEFAULT_FREQUENCY_AMPLITUDE
    control.value = String(amplitude)
  }

  onMount(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.showModal()
    return () => {
      disposed = true
      generation++
      dialog.close()
      queueMicrotask(() => { if (previous?.isConnected) previous.focus() })
    }
  })
</script>

<dialog bind:this={dialog} class="frequency-viewer" aria-labelledby="frequency-heading" oncancel={onclose}>
  <header>
    <h2 id="frequency-heading">{$t('Vibrational modes')}</h2>
    <button type="button" aria-label={$t('Close vibration viewer')} onclick={onclose}><X size={18}/></button>
  </header>
  <div class="file-row">
    <button type="button" onclick={() => input.click()} disabled={loading}><FolderOpen size={17}/>{$t('Open frequency file')}</button>
    <input bind:this={input} type="file" accept=".cjson,.json" aria-label={$t('Frequency file')} hidden onchange={open_file}/>
    <span class="filename" title={filename}>{loading ? $t('Loading…') : filename}</span>
  </div>
  {#if error}<p role="alert" class="error">{$t(error)}</p>{/if}
  {#if data && mode && trajectory}
    <div class="mode-row">
      <label>{$t('Normal mode')}
        <select bind:value={modeIndex}>
          {#each data.modes as item, index}
            <option value={index}>{item.number} · {item.frequency.toFixed(2)} cm⁻¹{item.frequency < 0 ? ` (${$t('imaginary')})` : ''}</option>
          {/each}
        </select>
      </label>
      <label>{$t('Visual amplitude (Å)')}
        <input type="number" min="0.01" max="2" step="0.05" value={amplitude} onchange={set_amplitude}/>
      </label>
      {#if mode.ir !== undefined}<span class="intensity">IR: {mode.ir.toFixed(2)} km/mol</span>{/if}
    </div>
    <p class="hint">{$t('Amplitude and playback speed are visual settings.')}</p>
    <div class="scene">
      {#key data}
        <Trajectory
          {trajectory}
          bind:current_step_idx={step}
          auto_play={false}
          allow_file_drop={false}
          display_mode="structure"
          fps={24}
          show_controls={{ mode: 'always', hidden: ['filename', 'info-pane', 'export-pane', 'view-mode', 'fullscreen'] }}
          fullscreen_toggle={false}
          structure_props={{
            structure_series_key: data,
            enable_measure_mode: false,
            show_controls: { mode: 'always', hidden: ['info-pane', 'export-pane', 'fullscreen'] },
            scene_props: { camera_target: cameraTarget, auto_rotate: 0 },
          }}
          on_error={event => { error = event.error_msg ?? 'Unable to display this normal mode.' }}
        />
      {/key}
    </div>
  {:else}
    <div class="empty">
      <p>{$t('Open molecular normal modes exported by cclib.')}</p>
      <p>{$t('For Gaussian or ORCA output, first export one complete frequency calculation:')}</p>
      <code>ccwrite cjson frequency.out</code>
      <p>{$t('Choose the resulting .cjson file. Frequencies and Cartesian displacements are required.')}</p>
    </div>
  {/if}
</dialog>

<style>
  .frequency-viewer { position: fixed; inset: 0; width: min(1100px, calc(100vw - 32px)); height: min(820px, calc(100dvh - 32px)); max-width: none; max-height: none; margin: auto; padding: 0; border: 1px solid var(--ui-border); border-radius: 12px; background: var(--ui-background, white); color: var(--ui-foreground, #172b3a); overflow: hidden; }
  .frequency-viewer[open] { display: flex; flex-direction: column; }
  .frequency-viewer::backdrop { background: #15253488; }
  header, .file-row, .mode-row { display: flex; align-items: center; gap: 16px; padding: 12px 18px; flex-shrink: 0; }
  header { justify-content: space-between; border-bottom: 1px solid var(--ui-border); }
  h2 { font-size: 18px; margin: 0; }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; padding: 6px 10px; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-background, white); color: inherit; font: inherit; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  button:hover:not(:disabled) { background: var(--ui-muted); }
  button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--ui-ring); outline-offset: 2px; }
  .file-row button { flex-shrink: 0; }
  .filename { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mode-row { flex-wrap: wrap; padding-top: 0; padding-bottom: 0; }
  label { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  select, input[type=number] { color: inherit; background: var(--ui-background, white); font: inherit; border: 1px solid var(--ui-border); border-radius: 5px; padding: 6px; }
  input[type=number] { width: 78px; }
  .intensity, .hint { font-size: 12px; color: var(--ui-muted-foreground, #596b7a); }
  .hint { padding: 0 18px; margin: 8px 0; }
  .error { margin: 0 18px 12px; color: #b42318; overflow-wrap: anywhere; }
  .scene { flex: 1; min-height: 0; }
  .scene :global(.trajectory) { height: 100%; }
  .empty { display: grid; align-content: center; justify-items: center; flex: 1; padding: 24px; text-align: center; }
  .empty p { max-width: 60ch; line-height: 1.6; }
  code { padding: 10px 18px; border-radius: 6px; background: var(--ui-muted); }
</style>
