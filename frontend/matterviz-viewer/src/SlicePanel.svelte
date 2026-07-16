<script lang="ts">
  import type { VolumetricData } from 'matterviz'
  import { onMount } from 'svelte'
  import {
    AXIS_LABELS,
    AXIS_PRESETS,
    SLICE_COLORMAPS,
    clamp01,
    normalize_slice_resolution,
    resolve_slice_range,
    slice_to_rgba,
    type SliceAxis,
    type SliceColormap,
  } from './slice'
  import { sample_slice } from './slice-runtime'

  export let volumes: VolumetricData[] = []
  export let active_volume_idx = 0
  export let open = false
  export let onclose: (() => void) | undefined = undefined
  export let axis: SliceAxis = 'xy'
  export let miller_h = AXIS_PRESETS.xy[0]
  export let miller_k = AXIS_PRESETS.xy[1]
  export let miller_l = AXIS_PRESETS.xy[2]
  export let position = 0.5
  export let resolution = 128
  export let colormap: SliceColormap = 'Viridis'
  export let range_mode: 'auto' | 'manual' = 'auto'
  export let manual_min = ''
  export let manual_max = ''

  let canvas: HTMLCanvasElement | undefined
  let canvas_host: HTMLDivElement | undefined
  let resize_observer: ResizeObserver | undefined

  $: volume_index = Math.min(Math.max(0, Number(active_volume_idx) || 0), Math.max(0, volumes.length - 1))
  $: position = clamp01(position)
  $: resolution = normalize_slice_resolution(resolution)
  $: volume = volumes[volume_index]
  $: miller_indices = [Number(miller_h) || 0, Number(miller_k) || 0, Number(miller_l) || 0] as [number, number, number]
  $: slice = sample_slice(volume, miller_indices, position, resolution)
  $: automatic_range = slice ? resolve_slice_range(slice) : [0, 1] as [number, number]
  $: selected_range = range_mode === 'manual'
    ? resolve_slice_range(slice ?? new Float64Array(), manual_min, manual_max)
    : automatic_range
  $: {
    slice
    selected_range
    colormap
    open
    if (canvas && canvas_host) draw_canvas()
  }

  const set_axis = (value: SliceAxis): void => {
    axis = value
    const preset = AXIS_PRESETS[value]
    miller_h = preset[0]
    miller_k = preset[1]
    miller_l = preset[2]
  }

  const draw_canvas = (): void => {
    if (!canvas || !canvas_host) return
    const style = getComputedStyle(canvas_host)
    const horizontal_padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
    const vertical_padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
    const css_width = Math.max(1, Math.floor(canvas_host.clientWidth - horizontal_padding))
    const css_height = Math.max(220, Math.floor(canvas_host.clientHeight - vertical_padding))
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
    canvas.width = Math.floor(css_width * dpr)
    canvas.height = Math.floor(css_height * dpr)
    canvas.style.width = `${css_width}px`
    canvas.style.height = `${css_height}px`
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, css_width, css_height)
    context.fillStyle = '#f7f9fb'
    context.fillRect(0, 0, css_width, css_height)
    if (!slice) {
      context.fillStyle = '#667085'
      context.font = '13px system-ui, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(volume ? 'Slice unavailable for this plane' : 'No volumetric data', css_width / 2, css_height / 2)
      return
    }
    const rgba = slice_to_rgba(slice, selected_range, colormap)
    const bitmap = document.createElement('canvas')
    bitmap.width = slice.width
    bitmap.height = slice.height
    const bitmap_context = bitmap.getContext('2d')
    if (!bitmap_context) return
    bitmap_context.putImageData(new ImageData(new Uint8ClampedArray(rgba), slice.width, slice.height), 0, 0)
    const scale = Math.min(css_width / slice.width, css_height / slice.height)
    const draw_width = slice.width * scale
    const draw_height = slice.height * scale
    context.imageSmoothingEnabled = false
    context.drawImage(bitmap, (css_width - draw_width) / 2, (css_height - draw_height) / 2, draw_width, draw_height)
  }

  const close_panel = (): void => {
    open = false
    onclose?.()
  }

  onMount(() => {
    if (typeof ResizeObserver !== 'undefined' && canvas_host) {
      resize_observer = new ResizeObserver(() => draw_canvas())
      resize_observer.observe(canvas_host)
    }
    draw_canvas()
    return () => resize_observer?.disconnect()
  })
</script>

<aside class="slice-panel" class:closed={!open} aria-hidden={!open} aria-label="2D volume slice">
  <header>
    <strong>2D cube slice</strong>
    <button type="button" onclick={close_panel} aria-label="Close slice panel">Close</button>
  </header>
  <div class="controls">
    <label>
      <span>Volume</span>
      <select value={volume_index} onchange={(event) => active_volume_idx = Number(event.currentTarget.value)} aria-label="Slice volume">
        {#each volumes as item, index}
          <option value={index}>{item.label || `Volume ${index + 1}`}</option>
        {/each}
      </select>
    </label>
    <label>
      <span>Plane</span>
      <select value={axis} onchange={(event) => set_axis(event.currentTarget.value as SliceAxis)} aria-label="Slice plane">
        {#each Object.keys(AXIS_LABELS) as key}
          <option value={key}>{AXIS_LABELS[key as SliceAxis]}</option>
        {/each}
      </select>
    </label>
    <label>
      <span>Position {clamp01(position).toFixed(2)}</span>
      <input type="range" min="0" max="1" step="0.01" bind:value={position} aria-label="Fractional slice position" />
    </label>
    <label>
      <span>Resolution</span>
      <input type="number" min="2" max="512" step="1" bind:value={resolution} aria-label="Slice resolution" />
    </label>
    <label>
      <span>Colormap</span>
      <select bind:value={colormap} aria-label="Slice colormap">
        {#each SLICE_COLORMAPS as map}
          <option value={map}>{map}</option>
        {/each}
      </select>
    </label>
    <label>
      <span>Range</span>
      <select bind:value={range_mode} aria-label="Slice range mode">
        <option value="auto">Automatic ({automatic_range[0].toPrecision(4)} … {automatic_range[1].toPrecision(4)})</option>
        <option value="manual">Manual</option>
      </select>
    </label>
    {#if range_mode === 'manual'}
      <label><span>Minimum</span><input type="number" bind:value={manual_min} placeholder={String(automatic_range[0])} /></label>
      <label><span>Maximum</span><input type="number" bind:value={manual_max} placeholder={String(automatic_range[1])} /></label>
    {/if}
    <div class="miller" aria-label="Miller indices">
      <span>Miller</span>
      <input type="number" bind:value={miller_h} aria-label="Miller h" />
      <input type="number" bind:value={miller_k} aria-label="Miller k" />
      <input type="number" bind:value={miller_l} aria-label="Miller l" />
    </div>
  </div>
  <div class="canvas-host" bind:this={canvas_host}>
    <canvas bind:this={canvas} aria-label="2D volume heatmap"></canvas>
  </div>
  {#if slice}
    <footer>{slice.width} × {slice.height} · range {selected_range[0].toPrecision(5)} … {selected_range[1].toPrecision(5)}</footer>
  {/if}
</aside>

<style>
  .slice-panel { position: absolute; inset: 10px; z-index: 200000000; display: grid; grid-template-rows: auto auto minmax(220px, 1fr) auto; grid-template-columns: minmax(0, 1fr); width: calc(100% - 20px); min-width: 0; overflow: hidden; background: #fff; border: 1px solid #aeb8c5; border-radius: 7px; box-shadow: 0 12px 36px rgba(23, 32, 42, 0.24); }
  .slice-panel.closed { display: none; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px 7px 13px; background: #f5f7f9; border-bottom: 1px solid #d6dce4; }
  header button { height: 27px; }
  .controls { display: flex; min-width: 0; overflow-x: auto; flex-wrap: wrap; gap: 7px 9px; padding: 8px 10px; border-bottom: 1px solid #e2e6eb; }
  label, .miller { display: grid; gap: 3px; min-width: 90px; }
  label > span, .miller > span { color: #5c6675; font-size: 11px; }
  input, select, button { min-height: 28px; border: 1px solid #b9c2ce; border-radius: 5px; background: #fff; color: #18202a; font: inherit; }
  input, select { padding: 3px 6px; }
  input[type='number'] { width: 82px; }
  .miller { grid-template-columns: auto repeat(3, 58px); align-items: end; }
  .miller input { width: 58px; }
  .canvas-host { min-width: 0; min-height: 220px; position: relative; overflow: hidden; padding: 8px; background: #f7f9fb; }
  canvas { display: block; width: 100%; max-width: 100%; height: 100%; min-height: 220px; border: 1px solid #d6dce4; background: #f7f9fb; }
  footer { padding: 5px 10px; color: #667085; border-top: 1px solid #e2e6eb; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
