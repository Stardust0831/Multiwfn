<script lang="ts">
  import { Icon } from 'matterviz'
  import { tick, type Snippet } from 'svelte'

  let { name, label, active = $bindable(), children }: {
    name: string; label: string; active?: string; children: Snippet
  } = $props()
  let trigger: HTMLButtonElement
  let panel = $state<HTMLDivElement>()
  let left = $state(8)
  let top = $state(44)
  let maxHeight = $state(500)
  const close = (focus = false): void => {
    if (active !== name) return
    active = undefined
    if (focus) trigger?.focus()
  }
  const position = (): void => {
    if (!trigger || !panel) return
    const rect = trigger.getBoundingClientRect()
    left = Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8))
    top = Math.max(rect.bottom, trigger.closest('.toolbar')?.getBoundingClientRect().bottom ?? 0) + 5
    maxHeight = Math.max(80, window.innerHeight - top - 8)
  }
  const open = async (focus = false): Promise<void> => {
    active = name
    await tick()
    position()
    if (focus) panel?.querySelector<HTMLElement>('button:not(:disabled), input, select')?.focus()
  }
  const outside = (event: PointerEvent): void => {
    if (event.target instanceof Node && !panel?.contains(event.target) && !trigger?.contains(event.target)) close()
  }
  const keyboard = (event: KeyboardEvent): void => {
    if (active !== name) return
    if (event.key === 'Escape') { event.preventDefault(); close(true) }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    if (!(event.target instanceof HTMLButtonElement) || !panel?.contains(event.target)) return
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const index = buttons.indexOf(event.target)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    event.preventDefault()
    buttons[next]?.focus()
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={keyboard} onresize={position} />
<button bind:this={trigger} type="button" aria-expanded={active === name} aria-controls={`workbench-menu-${name}`}
  onclick={() => active === name ? close() : open()}
  onkeydown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); void open(true) } }}>
  {label}<Icon icon="ArrowDown" width="13" height="13" />
</button>
{#if active === name}
  <div bind:this={panel} id={`workbench-menu-${name}`} class="workbench-menu" role="group" aria-label={label}
    style:left={`${left}px`} style:top={`${top}px`} style:max-height={`${maxHeight}px`}>
    {@render children()}
  </div>
{/if}
