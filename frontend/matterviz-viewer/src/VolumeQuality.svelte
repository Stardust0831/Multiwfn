<script lang="ts">
  import { onMount } from 'svelte'
  import { isosurface_geometry_states, scene_registry, type IsosurfaceGeometryState } from 'matterviz'
  import { t } from './i18n'
  let { shell, quality = $bindable('source'), disabled = false, error = '' }: {
    shell?: HTMLElement; quality?: 'source' | 'preview'; disabled?: boolean; error?: string
  } = $props()
  let states = $state<IsosurfaceGeometryState[]>([])
  const dimensions = $derived([...new Set(states.flatMap((state) => state.grids.map((grid) =>
    `${grid.source.join(' × ')} → ${grid.effective.join(' × ')}`)))])
  const pending = $derived(states.some((state) => state.status === 'pending'))
  const failure = $derived(error || states.find((state) => state.error)?.error)
  onMount(() => {
    const timer = setInterval(() => {
      const canvas = shell?.querySelector<HTMLCanvasElement>('.structure canvas')
      const scene = canvas && scene_registry.get(canvas)
      states = scene ? isosurface_geometry_states(scene.scene) : []
    }, 200)
    return () => clearInterval(timer)
  })
</script>

<div class="volume-quality" data-volume-quality={quality}>
  <label>{$t('Surface sampling')}
    <select aria-label={$t('Surface sampling')} bind:value={quality} {disabled}>
      <option value="source">{$t('Original grid')}</option>
      <option value="preview">{$t('Preview (500k samples)')}</option>
    </select>
  </label>
  <span>{$t('PNG uses the original grid.')}</span>
  {#if quality === 'preview'}<span>{$t('Preview may reduce detail to limit display cost.')}</span>{/if}
  {#if pending}<span role="status">{$t('Preparing surfaces…')}</span>{/if}
  {#each dimensions as dims}<span title={$t('Source → displayed samples')}>{dims}</span>{/each}
  {#if failure}<span class="quality-error" role="alert">{failure} {$t('Choose Preview or reduce the visible surfaces/range.')}</span>{/if}
</div>

<style>
  .volume-quality { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 6px 10px; max-height: 120px; overflow: auto; font-size: 12px; background: #f3f6fa; color: #27384a; }
  label { display: flex; align-items: center; gap: 8px; }
  select { max-width: 180px; }
  .quality-error { color: #a32f22; width: 100%; }
</style>
