<script lang="ts">
  import { onMount } from 'svelte'
  import {
    clampLegendPosition,
    espLegendTicks,
    type EspLegendTick,
    type LegendPosition,
  } from './esp'

  export let min = -0.05
  export let max = 0.05
  export let ticks: EspLegendTick[] | undefined = undefined
  export let visible = true
  export let position: LegendPosition = { left: 16, top: 16 }
  export let container_width = 0
  export let container_height = 0
  export let onclose: (() => void) | undefined = undefined
  export let onpositionchange: ((position: LegendPosition) => void) | undefined = undefined

  let legend: HTMLElement | undefined
  let resize_observer: ResizeObserver | undefined
  let parent_width = 0
  let parent_height = 0
  let drag: { pointer_id: number; offset_x: number; offset_y: number } | undefined
  let measured_position: LegendPosition = { left: 16, top: 16 }

  $: legend_ticks = ticks?.length ? ticks : espLegendTicks(min, max, 5)
  $: available_width = Math.max(0, Number(container_width) || parent_width)
  $: available_height = Math.max(0, Number(container_height) || parent_height)
  $: {
    const rect = legend?.getBoundingClientRect()
    const width = rect?.width || 184
    const height = rect?.height || 236
    measured_position = clampLegendPosition(
      position,
      { width, height },
      { width: available_width, height: available_height },
    )
  }

  const sync_parent_size = (): void => {
    const parent = legend?.parentElement
    if (!parent) return
    parent_width = parent.clientWidth
    parent_height = parent.clientHeight
  }

  const apply_position = (next: LegendPosition): void => {
    const rect = legend?.getBoundingClientRect()
    const width = rect?.width || 184
    const height = rect?.height || 236
    const clamped = clampLegendPosition(
      next,
      { width, height },
      { width: available_width, height: available_height },
    )
    measured_position = clamped
    position = clamped
    onpositionchange?.(clamped)
  }

  const start_drag = (event: PointerEvent): void => {
    if (event.button !== 0 || (event.target instanceof HTMLElement && event.target.closest('button'))) return
    const rect = legend?.getBoundingClientRect()
    if (!rect) return
    drag = {
      pointer_id: event.pointerId,
      offset_x: event.clientX - rect.left,
      offset_y: event.clientY - rect.top,
    }
    legend?.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  const move_drag = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointer_id) return
    const parent = legend?.parentElement
    const parent_rect = parent?.getBoundingClientRect()
    if (!parent_rect) return
    apply_position({
      left: event.clientX - parent_rect.left - drag.offset_x,
      top: event.clientY - parent_rect.top - drag.offset_y,
    })
    event.preventDefault()
  }

  const finish_drag = (event?: PointerEvent): void => {
    if (event && drag && event.pointerId !== drag.pointer_id) return
    if (drag) legend?.releasePointerCapture?.(drag.pointer_id)
    drag = undefined
  }

  const close = (): void => {
    visible = false
    onclose?.()
  }

  onMount(() => {
    sync_parent_size()
    if (typeof ResizeObserver !== 'undefined' && legend?.parentElement) {
      resize_observer = new ResizeObserver(() => sync_parent_size())
      resize_observer.observe(legend.parentElement)
    }
    return () => resize_observer?.disconnect()
  })
</script>

<aside
  bind:this={legend}
  class="esp-legend"
  class:closed={!visible}
  class:is-dragging={Boolean(drag)}
  aria-hidden={!visible}
  aria-label="Electrostatic potential legend"
  style={`left: ${measured_position.left}px; top: ${measured_position.top}px;`}
  onpointerdown={start_drag}
  onpointermove={move_drag}
  onpointerup={finish_drag}
  onpointercancel={finish_drag}
>
  <header class="legend-header">
    <strong>Electrostatic Potential</strong>
    <span>kcal/mol/e</span>
    <button type="button" aria-label="Hide ESP legend" title="Hide ESP legend" onclick={close}>×</button>
  </header>
  <div class="legend-scale">
    <div class="legend-gradient" aria-hidden="true"></div>
    <div class="legend-ticks">
      {#each legend_ticks as tick}
        <span>{tick.label}</span>
      {/each}
    </div>
  </div>
  <footer>{Number(min).toPrecision(5)} to {Number(max).toPrecision(5)} a.u.</footer>
</aside>

<style>
  .esp-legend {
    position: absolute;
    z-index: 150000000;
    display: grid;
    grid-template-rows: auto auto auto;
    width: min(184px, calc(100% - 20px));
    max-width: calc(100% - 20px);
    padding: 10px;
    overflow: hidden;
    color: #18202a;
    background: rgba(247, 248, 250, 0.95);
    border: 1px solid #b9c2ce;
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(23, 31, 44, 0.16);
    touch-action: none;
    user-select: none;
  }

  .esp-legend.closed { display: none; }
  .legend-header { position: relative; padding-right: 24px; cursor: grab; }
  .is-dragging .legend-header { cursor: grabbing; }
  .legend-header strong, .legend-header span { display: block; letter-spacing: 0; }
  .legend-header strong { font-size: 12px; line-height: 1.25; white-space: nowrap; }
  .legend-header span { margin-top: 2px; color: #667085; font-size: 11px; }
  .legend-header button {
    position: absolute;
    top: -6px;
    right: -6px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    color: #667085;
    background: transparent;
    border: 0;
    border-radius: 4px;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
  .legend-header button:hover { color: #18202a; background: #e9edf2; }
  .legend-header button:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
  .legend-scale {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 10px;
    height: 168px;
    margin-top: 10px;
  }
  .legend-gradient {
    width: 24px;
    height: 168px;
    border: 1px solid #b8c0cc;
    border-radius: 4px;
    background: linear-gradient(to bottom, #5bcefa 0%, #ffffff 50%, #f5a9b8 100%);
  }
  .legend-ticks {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-width: 0;
    height: 168px;
    overflow: hidden;
    color: #18202a;
    font: 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-variant-numeric: tabular-nums;
  }
  .legend-ticks span { white-space: nowrap; }
  footer { margin-top: 8px; color: #667085; font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

  @media (max-width: 520px) {
    .esp-legend { width: min(156px, calc(100% - 12px)); padding: 8px; }
    .legend-scale { grid-template-columns: 20px minmax(0, 1fr); gap: 8px; height: 132px; margin-top: 8px; }
    .legend-gradient { width: 20px; }
    .legend-gradient, .legend-ticks { height: 132px; }
    .legend-header strong { font-size: 11px; }
  }
</style>
