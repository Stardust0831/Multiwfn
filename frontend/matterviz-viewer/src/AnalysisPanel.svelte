<script lang="ts">
  import { onMount } from 'svelte'
  import {
    gaussian_broaden,
    parse_dos_payload,
    stable_color,
    type DosPayload,
    type DosSample,
  } from './analysis'

  export let data: unknown = undefined
  export let payload: unknown = undefined
  export let open = false
  export let onclose: (() => void) | undefined = undefined

  let canvas: HTMLCanvasElement | undefined
  let canvas_host: HTMLDivElement | undefined
  let resize_observer: ResizeObserver | undefined
  let fwhm = 1
  let projection_mode = 'none'
  let projection = 'all'
  let samples = 1600
  let parse_error = ''
  let parsed: DosPayload | undefined

  $: input_data = data ?? payload
  $: {
    try {
      parsed = input_data === undefined ? undefined : parse_dos_payload(input_data)
      parse_error = ''
    } catch (error) {
      parsed = undefined
      parse_error = error instanceof Error ? error.message : String(error)
    }
  }
  $: default_fwhm = parsed?.controls.defaultFwhm ?? 1
  $: if (parsed && fwhm === 1 && parsed.controls.defaultFwhm) fwhm = parsed.controls.defaultFwhm
  $: projection_options = parsed ? available_projections(parsed, projection_mode) : []
  $: if (!projection_options.includes(projection) && projection !== 'all') projection = 'all'
  $: {
    parsed
    fwhm
    projection_mode
    projection
    samples
    open
    if (canvas && canvas_host) draw_canvas()
  }

  const available_projections = (dos: DosPayload, mode: string): string[] => {
    const names = new Set<string>(mode === 'orbital' ? [] : dos.controls.elements)
    for (const sample of dos.series.projections) {
      if (sample.element && mode !== 'orbital') names.add(sample.element)
      if (sample.orbital && mode !== 'element') names.add(sample.orbital)
    }
    if (mode !== 'orbital') {
      for (const level of dos.series.levels) for (const name of Object.keys(level.projections)) names.add(name)
    }
    return [...names].sort()
  }

  const finite = (value: unknown): number | undefined => {
    const number = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(number) ? number : undefined
  }

  type Curve = { name: string; x: number[]; y: number[]; color: string }

  const selected_sample_curves = (dos: DosPayload): Curve[] => {
    const curves: Curve[] = []
    const add = (sample: DosSample, name: string, index: number): void => {
      if (projection !== 'all') {
        const matches = projection_mode === 'orbital'
          ? sample.orbital === projection
          : projection_mode === 'element-orbital'
            ? sample.element === projection || sample.orbital === projection
            : sample.element === projection
        if (!matches) return
      }
      curves.push({ name, x: sample.energy, y: sample.density, color: stable_color(name, index) })
    }
    dos.series.sampled.forEach((sample, index) => add(sample, sample.label || sample.id || `DOS ${index + 1}`, index))
    dos.series.projections.forEach((sample, index) => {
      if (projection_mode !== 'none') add(sample, sample.label || sample.id || sample.element || `Projection ${index + 1}`, index + dos.series.sampled.length)
    })
    return curves
  }

  const draw_canvas = (): void => {
    if (!canvas || !canvas_host) return
    const css_width = Math.max(260, canvas_host.clientWidth)
    const css_height = Math.max(250, canvas_host.clientHeight)
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
    const margin = { left: 52, right: 18, top: 18, bottom: 36 }
    const plot_width = Math.max(1, css_width - margin.left - margin.right)
    const plot_height = Math.max(1, css_height - margin.top - margin.bottom)
    if (!parsed) {
      context.fillStyle = parse_error ? '#b42318' : '#667085'
      context.font = '13px system-ui, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(parse_error || 'No DOS data available', css_width / 2, css_height / 2)
      return
    }

    let curves: Curve[]
    if (parsed.series.levels.length) {
      const broadened = gaussian_broaden(parsed.series.levels, {
        fwhm: Number(fwhm) || default_fwhm,
        samples: Number(samples) || 1600,
      })
      curves = []
      if (projection !== 'all' && projection_mode !== 'none' && broadened.projected[projection]) {
        curves.push({ name: projection, x: broadened.energies, y: broadened.projected[projection], color: stable_color(projection) })
      } else if (broadened.alpha && broadened.beta) {
        curves.push({ name: 'TDOS alpha', x: broadened.energies, y: broadened.alpha, color: stable_color('alpha') })
        curves.push({ name: 'TDOS beta', x: broadened.energies, y: broadened.beta, color: stable_color('beta') })
      } else {
        curves.push({ name: 'TDOS', x: broadened.energies, y: broadened.tdos, color: stable_color('TDOS') })
      }
    } else {
      curves = selected_sample_curves(parsed)
    }
    let min_x = Number.POSITIVE_INFINITY; let max_x = Number.NEGATIVE_INFINITY
    let min_y = 0; let max_y = 0; let finite_points = 0
    for (const curve of curves) {
      for (let index = 0; index < curve.x.length; index += 1) {
        const x = curve.x[index]; const y = curve.y[index]
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        min_x = Math.min(min_x, x); max_x = Math.max(max_x, x)
        min_y = Math.min(min_y, y); max_y = Math.max(max_y, y)
        finite_points += 1
      }
    }
    if (!finite_points) {
      context.fillStyle = '#667085'
      context.font = '13px system-ui, sans-serif'
      context.textAlign = 'center'
      context.fillText('No finite DOS samples', css_width / 2, css_height / 2)
      return
    }
    if (min_x === max_x) { min_x -= 1; max_x += 1 }
    if (min_y === max_y) { min_y -= 1; max_y += 1 }
    const x_at = (value: number): number => margin.left + ((value - min_x) / (max_x - min_x)) * plot_width
    const y_at = (value: number): number => margin.top + (1 - (value - min_y) / (max_y - min_y)) * plot_height
    context.strokeStyle = '#c7ced8'; context.lineWidth = 1
    context.beginPath(); context.moveTo(margin.left, y_at(0)); context.lineTo(css_width - margin.right, y_at(0)); context.stroke()
    for (const curve of curves) {
      context.strokeStyle = curve.color; context.lineWidth = 2; context.beginPath()
      curve.x.forEach((x, index) => {
        const y = curve.y[index]; if (!Number.isFinite(x) || !Number.isFinite(y)) return
        const px = x_at(x); const py = y_at(y)
        if (index === 0) context.moveTo(px, py); else context.lineTo(px, py)
      })
      context.stroke()
    }
    for (const marker of parsed.markers) {
      const row = marker && typeof marker === 'object' ? marker as Record<string, unknown> : {}
      const x = finite(row.x)
      if (x === undefined || x < min_x || x > max_x) continue
      context.strokeStyle = '#667085'; context.setLineDash([4, 3]); context.beginPath(); context.moveTo(x_at(x), margin.top); context.lineTo(x_at(x), margin.top + plot_height); context.stroke(); context.setLineDash([])
    }
    context.fillStyle = '#475467'; context.font = '11px system-ui, sans-serif'; context.textAlign = 'center'
    context.fillText(parsed.axes?.x?.label || 'Energy', margin.left + plot_width / 2, css_height - 10)
    context.save(); context.translate(13, margin.top + plot_height / 2); context.rotate(-Math.PI / 2); context.fillText(parsed.axes?.y?.label || 'Density of states', 0, 0); context.restore()
    context.textAlign = 'left'; context.fillText(`${min_x.toPrecision(4)}`, margin.left, css_height - 20)
    context.textAlign = 'right'; context.fillText(`${max_x.toPrecision(4)}`, css_width - margin.right, css_height - 20)
    context.textAlign = 'left'; curves.slice(0, 6).forEach((curve, index) => { context.fillStyle = curve.color; context.fillText(curve.name, margin.left + index * 100, margin.top - 5) })
  }

  const close_panel = (): void => { open = false; onclose?.() }

  onMount(() => {
    if (typeof ResizeObserver !== 'undefined' && canvas_host) {
      resize_observer = new ResizeObserver(() => draw_canvas())
      resize_observer.observe(canvas_host)
    }
    draw_canvas()
    return () => resize_observer?.disconnect()
  })
</script>

<aside class="analysis-panel" class:closed={!open} aria-hidden={!open} aria-label="Density of states analysis">
  <header><strong>DOS / PDOS</strong><button type="button" onclick={close_panel} aria-label="Close analysis panel">Close</button></header>
  <div class="controls">
    <label><span>Broadening FWHM</span><input type="number" min="0.000001" step="0.01" bind:value={fwhm} disabled={!parsed?.series.levels.length} /></label>
    <label><span>Points</span><input type="number" min="2" max="20000" step="100" bind:value={samples} disabled={!parsed?.series.levels.length} /></label>
    <label><span>Projection mode</span><select bind:value={projection_mode} disabled={!parsed || (!parsed.series.projections.length && !parsed.series.levels.some((level) => Object.keys(level.projections).length))}>
      <option value="none">TDOS</option><option value="element">Element</option><option value="orbital">Orbital</option><option value="element-orbital">Element + orbital</option>
    </select></label>
    <label><span>Projection</span><select bind:value={projection} disabled={projection_mode === 'none' || !projection_options.length}><option value="all">All</option>{#each projection_options as option}<option value={option}>{option}</option>{/each}</select></label>
  </div>
  <div class="canvas-host" bind:this={canvas_host}><canvas bind:this={canvas} aria-label="Density of states plot"></canvas></div>
  {#if parsed}<footer>{parsed.metadata.program ? `${String(parsed.metadata.program)} · ` : ''}{parsed.series.levels.length ? `${parsed.series.levels.length} levels` : `${parsed.series.sampled.length} sampled curve(s)`}</footer>{/if}
</aside>

<style>
  .analysis-panel { position: absolute; inset: 10px; z-index: 200000000; display: grid; grid-template-rows: auto auto minmax(250px, 1fr) auto; width: calc(100% - 20px); min-width: 0; overflow: hidden; background: #fff; border: 1px solid #aeb8c5; border-radius: 7px; box-shadow: 0 12px 36px rgba(23, 32, 42, 0.24); }
  .analysis-panel.closed { display: none; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px 7px 13px; background: #f5f7f9; border-bottom: 1px solid #d6dce4; }
  header button, input, select { min-height: 28px; border: 1px solid #b9c2ce; border-radius: 5px; background: #fff; color: #18202a; font: inherit; }
  input, select { padding: 3px 6px; }
  input[type='number'] { width: 90px; }
  .controls { display: flex; min-width: 0; overflow-x: auto; flex-wrap: wrap; gap: 7px 9px; padding: 8px 10px; border-bottom: 1px solid #e2e6eb; }
  label { display: grid; gap: 3px; min-width: 110px; } label > span { color: #5c6675; font-size: 11px; }
  .canvas-host { min-width: 0; min-height: 250px; position: relative; overflow: hidden; padding: 8px; background: #f7f9fb; }
  canvas { display: block; width: 100%; max-width: 100%; height: 100%; min-height: 250px; border: 1px solid #d6dce4; background: #f7f9fb; }
  footer { padding: 5px 10px; color: #667085; border-top: 1px solid #e2e6eb; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
