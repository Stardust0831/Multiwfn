<script lang="ts">
  import { onMount } from 'svelte'
  import { Trajectory } from 'matterviz/trajectory'
  import {
    DEFAULT_VIBRATION_AMPLITUDE,
    DEFAULT_VIBRATION_FPS,
    VIBRATION_AUTO_PLAY,
    api_url,
    frequency_thz,
    is_imaginary_frequency,
    load_vibration_session,
    normalized_mode_pattern,
    synthesize_vibration_trajectory,
    type VibrationSession,
  } from './vibration'
  import { signal_frontend_ready } from './startup'

  let session = $state<VibrationSession>()
  let loading = $state(true)
  let error_msg = $state<string>()
  let mode_idx = $state(0)
  let amplitude = $state(DEFAULT_VIBRATION_AMPLITUDE)
  let fps = $state(DEFAULT_VIBRATION_FPS)
  let show_vectors = $state(false)
  let current_step_idx = $state(0)
  let returned = $state(false)
  // View zoom scales the WebGL canvas via CSS transform. The vendored player re-asserts
  // its declarative camera zoom from the live controls each frame in this lineage, so
  // camera-level wheel zoom cannot hold across frame swaps (the upstream 0.7 series
  // addresses it with a rewritten trajectory camera pipeline). Scaling the canvas is
  // deterministic in every WebView; picking stays aligned because the browser maps
  // pointer coordinates through the transform.
  let view_scale = $state(1)
  const VIEW_SCALE_MIN = 0.4
  const VIEW_SCALE_MAX = 5
  const zoom_by = (factor: number): void => {
    view_scale = Math.min(VIEW_SCALE_MAX, Math.max(VIEW_SCALE_MIN, view_scale * factor))
  }
  const zoom_reset = (): void => {
    view_scale = 1
  }

  let scene_props = $derived({
    // arcball keeps the declarative camera setters frozen after gestures (the same mode
    // the workbench uses); the default orbit mode re-asserts the stale declarative zoom
    // every frame, which silently reverts every wheel/pinch zoom.
    camera_control_mode: 'arcball',
    vector_configs: { force: { visible: show_vectors, color: null, scale: null } },
  })

  onMount(async () => {
    try {
      session = await load_vibration_session()
      await signal_frontend_ready()
    } catch (error) {
      error_msg = error instanceof Error ? error.message : String(error)
    } finally {
      loading = false
    }
  })

  let pane_el = $state<HTMLElement>()
  let resume_playback_after_drag = false
  $effect(() => {
    // The pane only renders after the session loads, so bind:this starts undefined;
    // attach input listeners as soon as it exists.
    const element = pane_el
    if (!element) return
    // Pause playback while a drag gesture is in progress: per-frame structure swaps
    // otherwise fight the camera mid-gesture (drag stutter) and the rotated pose
    // cannot settle. Resume on release if the animation was playing.
    const pause_button = (): HTMLButtonElement | null =>
      element.querySelector<HTMLButtonElement>(
        '.trajectory-controls button[title^="Play"], .trajectory-controls button[title^="Pause"]',
      )
    const on_pointerdown = (event: PointerEvent): void => {
      if (!(event.target instanceof HTMLCanvasElement)) return
      const button = pause_button()
      if (button && button.title.includes('Pause')) {
        button.click()
        resume_playback_after_drag = true
      }
    }
    const on_pointerup = (): void => {
      if (!resume_playback_after_drag) return
      resume_playback_after_drag = false
      pause_button()?.click()
    }
    element.addEventListener('pointerdown', on_pointerdown)
    window.addEventListener('pointerup', on_pointerup)
    // Physical wheel drives the CSS view scale directly (see zoom note above).
    const on_wheel = (event: WheelEvent): void => {
      event.preventDefault()
      zoom_by(event.deltaY < 0 ? 1.15 : 1 / 1.15)
    }
    element.addEventListener('wheel', on_wheel, { passive: false })
    // macOS WebViews report trackpad pinch as gesture events rather than wheel events.
    const on_gesture = (event: Event): void => {
      event.preventDefault()
      const scale = (event as { scale?: number }).scale ?? 1
      zoom_by(scale >= 1 ? 1.04 : 1 / 1.04)
    }
    element.addEventListener('gesturestart', on_gesture as EventListener, { passive: false })
    element.addEventListener('gesturechange', on_gesture as EventListener, { passive: false })
    return () => {
      element.removeEventListener('pointerdown', on_pointerdown)
      window.removeEventListener('pointerup', on_pointerup)
      element.removeEventListener('wheel', on_wheel)
      element.removeEventListener('gesturestart', on_gesture as EventListener)
      element.removeEventListener('gesturechange', on_gesture as EventListener)
    }
  })

  let selected_mode = $derived(session?.modes[mode_idx])
  let imaginary = $derived(selected_mode ? is_imaginary_frequency(selected_mode.frequency) : false)
  let trajectory = $derived.by(() => {
    if (!session) return undefined
    const pattern = normalized_mode_pattern(session.displacements, session.shape, mode_idx)
    // A cleared or invalid number input yields NaN/0; fall back to the default so the
    // synthesizer's defensive amplitude check never fires while the user is typing.
    const safe_amplitude =
      Number.isFinite(amplitude) && amplitude > 0 ? amplitude : DEFAULT_VIBRATION_AMPLITUDE
    return synthesize_vibration_trajectory(session.structure, pattern, { amplitude: safe_amplitude })
  })

  let reset_key = $state(-1)
  $effect(() => {
    if (reset_key !== mode_idx) {
      reset_key = mode_idx
      current_step_idx = 0
    }
  })

  const return_to_multiwfn = async (): Promise<void> => {
    try {
      const response = await fetch(api_url('/api/return'), { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      returned = true
    } catch (error) {
      error_msg = error instanceof Error ? error.message : String(error)
    }
  }

  const format_frequency = (frequency: number): string =>
    `${frequency.toFixed(2)} cm⁻¹ (${frequency_thz(frequency).toFixed(3)} THz)`
</script>

<div class="vibration-page">
  <header class="vibration-header">
    <div class="titles">
      <strong>Vibrational modes</strong>
      {#if session?.manifest.vibrations}
        {@const vibrations = session.manifest.vibrations}
        <span>
          {vibrations.sourceProgram ?? 'unknown source'}
          {#if vibrations.spectrumKind}· {vibrations.spectrumKind.toUpperCase()}{/if}
          · {vibrations.atomCount} atoms · {vibrations.modeCount} modes
        </span>
      {/if}
    </div>
    <button class="return-button" type="button" onclick={return_to_multiwfn} disabled={returned || loading}>
      {returned ? 'Returned to Multiwfn' : 'Return to Multiwfn'}
    </button>
  </header>

  {#if loading}
    <div class="status">Loading vibrational modes…</div>
  {:else if error_msg && !session}
    <div class="status error">{error_msg}</div>
  {:else if session}
    <div class="vibration-body">
      <aside class="mode-panel">
        {#if selected_mode}
          <div class="mode-summary" class:imaginary>
            <strong>Mode {selected_mode.index}</strong>
            <span>{format_frequency(selected_mode.frequency)}</span>
            {#if selected_mode.intensity !== null}
              <span>Intensity {selected_mode.intensity.toFixed(2)} {session.manifest.vibrations?.intensityUnit ?? ''}</span>
            {/if}
            {#if imaginary}
              <span class="imaginary-tag">Imaginary mode — check the transition-state displacement direction</span>
            {/if}
          </div>
        {/if}
        <div class="mode-list" role="listbox" aria-label="Vibrational modes">
          {#each session.modes as mode, index (mode.index)}
            <button
              type="button"
              role="option"
              aria-selected={index === mode_idx}
              class:selected={index === mode_idx}
              class:imaginary={is_imaginary_frequency(mode.frequency)}
              onclick={() => (mode_idx = index)}
            >
              <span>Mode {mode.index}</span>
              <span>{mode.frequency.toFixed(1)} cm⁻¹</span>
            </button>
          {/each}
        </div>
        <div class="controls">
          <label class="slider">
            <span>Amplitude</span>
            <input type="range" min="0.02" max="3" step="0.02" bind:value={amplitude} />
            <span class="amplitude-input">
              <input
                type="number"
                min="0.02"
                step="0.05"
                bind:value={amplitude}
                aria-label="Amplitude in Angstrom"
              />
              <output>Å</output>
            </span>
          </label>
          <label class="toggle">
            <input type="checkbox" bind:checked={show_vectors} />
            <span>Displacement arrows</span>
          </label>
          <div class="zoom-controls" role="group" aria-label="View zoom">
            <span>Zoom <output>{view_scale.toFixed(2)}×</output></span>
            <button type="button" title="Zoom in" aria-label="Zoom in" onclick={() => zoom_by(1.25)}>＋</button>
            <button type="button" title="Zoom out" aria-label="Zoom out" onclick={() => zoom_by(1 / 1.25)}>－</button>
            <button type="button" title="Reset zoom" aria-label="Reset zoom" onclick={zoom_reset}>Fit</button>
          </div>
        </div>
      </aside>
      <main class="trajectory-pane" bind:this={pane_el} style={`--view-scale: ${view_scale}`}>
        {#if trajectory}
          <Trajectory
            {trajectory}
            auto_play={VIBRATION_AUTO_PLAY}
            display_mode="structure"
            bind:current_step_idx
            bind:fps
            fullscreen_toggle={false}
            structure_props={{ scene_props, series_reference: session.structure, fullscreen_toggle: false }}
            show_controls={{
              mode: 'always',
              hidden: [
                'filename',
                'info-pane',
                'msd-pane',
                'vacf-pane',
                'rdf-pane',
                'structure-id-pane',
                'data-inspector-pane',
                'x-axis',
                'view-mode',
                'fullscreen',
              ],
            }}
          />
        {/if}
      </main>
    </div>
  {/if}
  {#if error_msg && session}
    <div class="status error floating">{error_msg}</div>
  {/if}
</div>

<style>
  .vibration-page {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--page-bg, #eef1f4);
    color: var(--text-color, #18202a);
  }
  .vibration-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    background: var(--pane-bg, #fff);
    border-bottom: 1px solid var(--border-color, #cfd6df);
  }
  .titles {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }
  .titles span {
    color: #667085;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .return-button {
    padding: 6px 12px;
    border: 1px solid var(--border-color, #cfd6df);
    border-radius: 6px;
    background: var(--pane-bg, #fff);
    cursor: pointer;
  }
  .return-button:hover:not(:disabled) {
    border-color: var(--accent-color, #1976b8);
    color: var(--accent-color, #1976b8);
  }
  .return-button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .status {
    padding: 24px;
    text-align: center;
  }
  .status.error {
    color: #b42318;
  }
  .status.floating {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: #fef3f2;
    border: 1px solid #fecdca;
    border-radius: 6px;
    padding: 8px 14px;
  }
  .vibration-body {
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr);
    flex: 1;
    min-height: 0;
  }
  .mode-panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--pane-bg, #fff);
    border-right: 1px solid var(--border-color, #cfd6df);
  }
  .mode-summary {
    display: grid;
    gap: 4px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-color, #cfd6df);
    font-size: 13px;
  }
  .mode-summary.imaginary strong {
    color: #b42318;
  }
  .imaginary-tag {
    color: #b42318;
    font-size: 12px;
  }
  .mode-list {
    flex: 1;
    overflow-y: auto;
    display: grid;
    align-content: start;
  }
  .mode-list button {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 14px;
    border: 0;
    border-bottom: 1px solid #eef1f4;
    background: transparent;
    font-size: 13px;
    cursor: pointer;
    text-align: left;
  }
  .mode-list button:hover {
    background: #f4f7fa;
  }
  .mode-list button.selected {
    background: #e8f1f8;
    color: var(--accent-color, #1976b8);
    font-weight: 600;
  }
  .mode-list button.imaginary span:last-child {
    color: #b42318;
  }
  .controls {
    display: grid;
    gap: 10px;
    padding: 12px 14px;
    border-top: 1px solid var(--border-color, #cfd6df);
    font-size: 13px;
  }
  .controls .slider {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
  }
  .controls .slider input[type='range'] {
    width: 100%;
    min-width: 0;
  }
  .controls .amplitude-input {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .controls .amplitude-input input {
    width: 4.5em;
    padding: 2px 4px;
    border: 1px solid var(--border-color, #cfd6df);
    border-radius: 4px;
  }
  .controls .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .zoom-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .zoom-controls span {
    margin-right: auto;
  }
  .zoom-controls button {
    min-width: 2.2em;
    padding: 3px 8px;
    border: 1px solid var(--border-color, #cfd6df);
    border-radius: 6px;
    background: var(--pane-bg, #fff);
    cursor: pointer;
  }
  .zoom-controls button:hover {
    border-color: var(--accent-color, #1976b8);
    color: var(--accent-color, #1976b8);
  }
  .trajectory-pane {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  /* Pin the playback bar into the normal flow at the top of the pane instead of letting
     it overlay the scene, so it never covers the molecule. */
  .trajectory-pane > :global(.trajectory) {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .trajectory-pane :global(.trajectory-controls) {
    order: -1;
    flex: none;
    position: relative;
    z-index: 2;
    opacity: 1;
    pointer-events: auto;
    background: var(--pane-bg, #fff);
    border-bottom: 1px solid var(--border-color, #cfd6df);
    backdrop-filter: none;
  }
  .trajectory-pane :global(.content-area) {
    flex: 1;
    min-height: 0;
  }
  /* View zoom scales the WebGL canvas only; the trajectory playback bar and the
     workbench chrome keep their native size. */
  .trajectory-pane :global(canvas) {
    transform: scale(var(--view-scale, 1));
    transform-origin: center center;
  }
  .trajectory-pane > :global(.trajectory) {
    width: 100%;
    height: 100%;
  }
  @media (max-width: 700px) {
    .vibration-body {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(220px, 40%) minmax(0, 1fr);
    }
    .mode-panel {
      border-right: 0;
      border-bottom: 1px solid var(--border-color, #cfd6df);
    }
  }
</style>
