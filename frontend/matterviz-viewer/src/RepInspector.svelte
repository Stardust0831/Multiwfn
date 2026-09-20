<script lang="ts">
  import { t } from './i18n'
  import { Atom, Layers, Eye, EyeOff, Plus, Copy, Trash2, ArrowUp, ArrowDown, X, Box, SlidersHorizontal } from '@lucide/svelte'
  import * as Tabs from '$lib/components/ui/tabs'
  import { SURFACE_PRESETS, detect_surface_preset } from './material'
  import { REPRESENTATION_PRESETS, apply_representation_preset } from './representation'
  import { dataset_source, copy_rep, material_preset, rep_surface_settings, MAX_REPS, type Cell, type Rep, type RepCollection, type RepMaterial } from './reps'
  import RepPeriodicControls from './RepPeriodicControls.svelte'
  import ColorScaleEditor from './ColorScaleEditor.svelte'
  import { volume_color_scale } from './color-scale'
  import type { Snippet } from 'svelte'

  let { collection, entries, sourceCell, onchange, onadd, onclose, scene, errors = {} }: {
    collection: RepCollection; entries: Array<{ name?: string; path: string }>; sourceCell?: Cell
    onchange: (value: RepCollection) => void; onadd: () => void; onclose: () => void
    scene: Snippet; errors?: Record<string, string>
  } = $props()
  let mode = $state('reps')
  let tab = $state('data')
  const selected = $derived(collection.items.find((rep) => rep.id === collection.selectedId))
  const patch = (value: Partial<Rep>) => {
    if (selected) onchange({ ...collection, items: collection.items.map((rep) => rep.id === selected.id ? { ...rep, ...value, followData: false } : rep) })
  }
  const material = (key: keyof RepMaterial, value: number | string | boolean) => { if (selected) patch({ material: { ...selected.material, [key]: value } }) }
  const numeric = (event: Event, update: (value: number) => void) => { const input = event.currentTarget as HTMLInputElement; if (Number.isFinite(input.valueAsNumber)) update(Math.max(input.min === '' ? -Infinity : Number(input.min), Math.min(input.max === '' ? Infinity : Number(input.max), input.valueAsNumber))) }
  const duplicate = () => {
    if (!selected || collection.items.length >= MAX_REPS) return
    const rep = copy_rep($state.snapshot(selected))
    onchange({ items: [...collection.items, rep], selectedId: rep.id })
  }
  const remove = () => {
    if (!selected) return
    const index = collection.items.indexOf(selected), items = collection.items.filter((rep) => rep.id !== selected.id)
    onchange({ items, selectedId: items[Math.min(index, items.length - 1)]?.id ?? '' })
  }
  const move = (delta: number) => {
    if (!selected) return
    const items = [...collection.items], index = items.indexOf(selected), target = index + delta
    if (target < 0 || target >= items.length) return
    ;[items[index], items[target]] = [items[target], items[index]]
    onchange({ ...collection, items })
  }
  const drawing_style = (style: Rep['structure']['style']) => {
    if (!selected) return
    const before = selected.structure
    const props = apply_representation_preset({ atom_radius: before.radius, bond_thickness: before.bondRadius,
      show_atoms: ['ballstick', 'spacefill'].includes(before.style), show_bonds: before.style === 'spacefill' ? 'never' : 'always' }, style)
    patch({ structure: { ...before, style, radius: Number(props.atom_radius), bondRadius: Number(props.bond_thickness) } })
  }
  const source_kind = (kind: string) => {
    if (!selected) return
    if (kind === 'structure') patch({ source: { kind: 'structure' } })
    else if (entries.length) patch({ source: dataset_source(entries, 0), volume: { ...selected.volume, volume_idx: 0 } })
  }
  const scalarControls = $derived(selected ? [
    { key: 'opacity' as const, label: 'Opacity', min: 0, max: 1, step: 0.01, enabled: true },
    { key: 'diffuse' as const, label: 'Diffuse reflection', min: 0, max: 3, step: 0.01, enabled: selected.material.model !== 'unlit' },
    { key: 'saturation' as const, label: 'Saturation', min: 0, max: 3, step: 0.01, enabled: true },
    { key: 'specular' as const, label: 'Highlight strength', min: 0, max: 1, step: 0.01, enabled: selected.material.model === 'glossy' },
    { key: 'shininess' as const, label: 'Highlight sharpness', min: 1, max: 120, step: 1, enabled: selected.material.model === 'glossy' },
    { key: 'roughness' as const, label: 'Roughness', min: 0, max: 1, step: 0.01, enabled: selected.material.model === 'pbr' },
    { key: 'metalness' as const, label: 'Metalness', min: 0, max: 1, step: 0.01, enabled: selected.material.model === 'pbr' },
  ].filter((item) => item.enabled) : [])
</script>

<aside class="rep-inspector" aria-label={$t('Representation editor')}>
  <header class="rep-header"><div><strong>{$t('Representations')}</strong><span>{$t('{visible} visible · {total} total', { visible: collection.items.filter((rep) => rep.visible).length, total: collection.items.length })}</span></div><button type="button" class="rep-icon" aria-label={$t('Close inspector')} onclick={onclose}><X size={16} /></button></header>
  <div class="rep-mode" role="group" aria-label={$t('Settings scope')}>
    <button type="button" class:chosen={mode === 'reps'} aria-pressed={mode === 'reps'} onclick={() => mode = 'reps'}><Layers size={14} />{$t('Representations')}</button>
    <button type="button" class:chosen={mode === 'scene'} aria-pressed={mode === 'scene'} onclick={() => mode = 'scene'}><SlidersHorizontal size={14} />{$t('Scene')}</button>
  </div>
  {#if mode === 'scene'}
    <div class="rep-editor rep-scene">{@render scene()}</div>
  {:else}
    <div class="rep-list" role="list" aria-label={$t('Representations')}>
      {#each collection.items as rep, index (rep.id)}
        <div class="rep-row" class:selected={selected?.id === rep.id} class:muted={!rep.visible} role="listitem">
          <button type="button" class="rep-icon rep-visibility" aria-label={$t(rep.visible ? 'Hide {name}' : 'Show {name}', { name: rep.name })} aria-pressed={rep.visible} onclick={() => onchange({ ...collection, items: collection.items.map((item) => item.id === rep.id ? { ...item, visible: !item.visible, followData: false } : item) })}>{#if rep.visible}<Eye size={15} />{:else}<EyeOff size={15} />{/if}</button>
          <button type="button" class="rep-select" aria-pressed={selected?.id === rep.id} onclick={() => onchange({ ...collection, selectedId: rep.id })}>
            <span class="rep-number">{String(index + 1).padStart(2, '0')}</span><span class="rep-row-copy"><strong>{rep.name}</strong><small>{#if errors[rep.id]}{$t(errors[rep.id])}{:else}{$t(rep.source.kind === 'structure' ? 'Structure' : 'Volume data')} · {$t(rep.source.kind === 'structure' ? REPRESENTATION_PRESETS.find((preset) => preset.value === rep.structure.style)?.label ?? '' : rep.volume.wireframe ? 'Wireframe' : 'Isosurface')}{/if}</small></span>
            {#if rep.source.kind === 'structure'}<Atom size={15} />{:else}<Layers size={15} />{/if}
          </button>
        </div>
      {/each}
      {#if !collection.items.length}<p class="rep-empty">{$t('Add a Rep to start composing your scene.')}</p>{/if}
    </div>
    <div class="rep-actions">
      <button type="button" class="rep-add" onclick={onadd} disabled={collection.items.length >= MAX_REPS}><Plus size={14} />{$t('Add Rep')}</button>
      <button type="button" class="rep-icon" title={$t('Duplicate Rep')} aria-label={$t('Duplicate Rep')} onclick={duplicate} disabled={!selected || collection.items.length >= MAX_REPS}><Copy size={15} /></button>
      <button type="button" class="rep-icon" title={$t('Move Rep up')} aria-label={$t('Move Rep up')} onclick={() => move(-1)} disabled={!selected || collection.items.indexOf(selected) === 0}><ArrowUp size={15} /></button>
      <button type="button" class="rep-icon" title={$t('Move Rep down')} aria-label={$t('Move Rep down')} onclick={() => move(1)} disabled={!selected || collection.items.indexOf(selected) === collection.items.length - 1}><ArrowDown size={15} /></button>
      <button type="button" class="rep-icon rep-delete" title={$t('Delete Rep')} aria-label={$t('Delete Rep')} onclick={remove} disabled={!selected}><Trash2 size={15} /></button>
    </div>
    {#if selected}
      <label class="rep-name"><span>{$t('Rep name')}</span><input value={selected.name} aria-label={$t('Rep name')} maxlength="120" onchange={(event) => patch({ name: event.currentTarget.value.trim() || 'Rep' })} /></label>
      <Tabs.Root bind:value={tab} class="rep-tabs min-h-0 gap-0">
        <Tabs.List class="rep-tab-bar w-auto h-9 p-1 gap-0.5" aria-label={$t('Rep settings')}>
          <Tabs.Trigger class="text-[11px] px-1 gap-1" value="data"><Atom size={13} />{$t('Data & drawing')}</Tabs.Trigger>
          <Tabs.Trigger class="text-[11px] px-1 gap-1" value="material"><SlidersHorizontal size={13} />{$t('Appearance')}</Tabs.Trigger>
          <Tabs.Trigger class="text-[11px] px-1 gap-1" value="pbc"><Box size={13} />PBC</Tabs.Trigger>
        </Tabs.List>
        <div class="rep-editor">
          <Tabs.Content value="data" class="rep-tab-content">
            <div class="rep-section-label"><span>01</span>{$t('Data source')}</div>
            <label class="rep-field"><span>{$t('Source type')}</span><select value={selected.source.kind} onchange={(event) => source_kind(event.currentTarget.value)}><option value="structure">{$t('Structure')}</option><option value="volume" disabled={!entries.length}>{$t('Volume data')}</option></select></label>
            {#if selected.source.kind === 'volume'}
              <label class="rep-field"><span>{$t('Dataset')}</span><select value={selected.source.index} onchange={(event) => { const index = Number(event.currentTarget.value); patch({ source: dataset_source(entries, index), volume: { ...selected!.volume, volume_idx: index } }) }}>{#each entries as entry, index}<option value={index}>{entry.name ?? entry.path}</option>{/each}</select></label>
            {:else}
              <label class="rep-field"><span>{$t('Atom selection')}</span><input value={selected.structure.selection} onchange={(event) => patch({ structure: { ...selected!.structure, selection: event.currentTarget.value } })} aria-describedby="rep-selection-help" /></label>
              <p id="rep-selection-help" class="rep-help">{$t('Use all, element C O, or index 1-6, 9. Atom indices start at 1.')}</p>
            {/if}
            <div class="rep-section-label"><span>02</span>{$t('Drawing method')}</div>
            {#if selected.source.kind === 'structure'}
              <div class="rep-style-grid" role="group" aria-label={$t('Drawing method')}>{#each REPRESENTATION_PRESETS as preset}<button type="button" class:chosen={selected.structure.style === preset.value} aria-pressed={selected.structure.style === preset.value} onclick={() => drawing_style(preset.value)}>{$t(preset.label)}</button>{/each}</div>
              <div class="rep-fields"><label class="rep-field"><span>{$t('Atom radius')}</span><input type="number" min="0.1" max="3" step="0.05" value={selected.structure.radius} oninput={(event) => numeric(event, (radius) => patch({ structure: { ...selected!.structure, radius } }))} /></label><label class="rep-field"><span>{$t('Bond thickness')}</span><input type="number" min="0.01" max="1" step="0.01" value={selected.structure.bondRadius} oninput={(event) => numeric(event, (bondRadius) => patch({ structure: { ...selected!.structure, bondRadius } }))} /></label></div>
              <label class="rep-toggle"><input type="checkbox" checked={selected.structure.labels} onchange={(event) => patch({ structure: { ...selected!.structure, labels: event.currentTarget.checked } })} />{$t('Element labels')}</label>
              <label class="rep-toggle"><input type="checkbox" checked={selected.structure.indices} onchange={(event) => patch({ structure: { ...selected!.structure, indices: event.currentTarget.checked } })} />{$t('Atom indices')}</label>
            {:else}
              <label class="rep-field"><span>{$t('Drawing method')}</span><select value={selected.volume.wireframe ? 'wire' : 'surface'} onchange={(event) => patch({ volume: { ...selected!.volume, wireframe: event.currentTarget.value === 'wire' } })}><option value="surface">{$t('Isosurface')}</option><option value="wire">{$t('Wireframe')}</option></select></label>
              <label class="rep-field"><span>{$t('Isovalue')}</span><input type="number" step="0.001" value={selected.volume.isovalue} oninput={(event) => numeric(event, (isovalue) => patch({ volume: { ...selected!.volume, isovalue } }))} /></label>
              <label class="rep-toggle"><input type="checkbox" checked={selected.volume.show_negative} onchange={(event) => patch({ volume: { ...selected!.volume, show_negative: event.currentTarget.checked } })} />{$t('Show negative isosurface')}</label>
              <div class="rep-fields"><label class="rep-field"><span>{$t('Positive color')}</span><input type="color" value={selected.volume.color} oninput={(event) => patch({ volume: { ...selected!.volume, color: event.currentTarget.value } })} /></label><label class="rep-field"><span>{$t('Negative color')}</span><input type="color" value={selected.volume.negative_color} oninput={(event) => patch({ volume: { ...selected!.volume, negative_color: event.currentTarget.value } })} /></label></div>
              <label class="rep-field"><span>{$t('Color by')}</span><select value={selected.volume.color_volume_idx ?? -1} onchange={(event) => { const index = Number(event.currentTarget.value); patch({ volume: { ...selected!.volume, color_volume_idx: index < 0 ? undefined : index, colorSourcePath: entries[index]?.path, colorSourceSlot: dataset_source(entries, index).slot, colormap: selected!.volume.colormap ?? 'interpolateTransFlag' } }) }}><option value="-1">{$t('Solid colors')}</option>{#each entries as entry, index}<option value={index}>{entry.name ?? entry.path}</option>{/each}</select></label>
              {#if selected.volume.color_volume_idx !== undefined}
                {#key selected.id}<ColorScaleEditor value={volume_color_scale(selected.volume)} onchange={(colorScale) => patch({ volume: { ...selected!.volume, colorScale } })} />{/key}
                <label class="rep-toggle"><input type="checkbox" checked={Boolean(selected.volume.color_range)} onchange={(event) => patch({ volume: { ...selected!.volume, color_range: event.currentTarget.checked ? [-0.05, 0.05] : undefined } })} />{$t('Manual color range')}</label>
                {#if selected.volume.color_range}<div class="rep-fields">{#each ['Minimum', 'Maximum'] as label, index}<label class="rep-field"><span>{$t(label)}</span><input type="number" step="0.01" value={selected.volume.color_range[index]} oninput={(event) => numeric(event, (value) => { const range = [...selected!.volume.color_range!] as [number, number]; range[index] = value; patch({ volume: { ...selected!.volume, color_range: range } }) })} /></label>{/each}</div>{/if}
              {/if}
            {/if}
          </Tabs.Content>
          <Tabs.Content value="material" class="rep-tab-content">
            <div class="rep-section-label"><span>03</span>{$t('Material')}</div>
            <label class="rep-field"><span>{$t('Preset')}</span><select aria-label={$t('Material preset')} value={selected.material.diffuse === 1 && selected.material.saturation === 1 ? detect_surface_preset(rep_surface_settings(selected)) : 'custom'} onchange={(event) => patch({ material: material_preset(selected!.material, event.currentTarget.value) })}><option value="custom">{$t('Custom')}</option>{#each SURFACE_PRESETS as preset}<option value={preset.value}>{$t(preset.label)}</option>{/each}</select></label>
            <label class="rep-field"><span>{$t('Shading model')}</span><select value={selected.material.model} onchange={(event) => material('model', event.currentTarget.value)}><option value="matte">{$t('Matte')}</option><option value="glossy">{$t('Glossy')}</option><option value="pbr">PBR</option><option value="unlit">{$t('Unlit')}</option></select></label>
            {#each scalarControls as control}
              <label class="rep-scalar"><span>{$t(control.label)}</span><input type="number" min={control.min} max={control.max} step={control.step} value={selected.material[control.key]} oninput={(event) => numeric(event, (value) => material(control.key, Math.max(control.min, Math.min(control.max, value))))} /><input type="range" min={control.min} max={control.max} step={control.step} value={selected.material[control.key]} aria-label={$t(control.label)} oninput={(event) => numeric(event, (value) => material(control.key, value))} /></label>
            {/each}
            {#if selected.material.model !== 'unlit'}
              <details class="rep-details"><summary>{$t('Edges & transparency')}</summary>
                {#each [{ key: 'outline' as const, label: 'Rim contrast' }, { key: 'outlineWidth' as const, label: 'Rim width' }] as control}<label class="rep-scalar"><span>{$t(control.label)}</span><input type="number" min="0" max="1" step="0.01" value={selected.material[control.key]} oninput={(event) => numeric(event, (value) => material(control.key, Math.min(1, Math.max(0, value))))} /><input type="range" min="0" max="1" step="0.01" value={selected.material[control.key]} aria-label={$t(control.label)} oninput={(event) => numeric(event, (value) => material(control.key, value))} /></label>{/each}
                <label class="rep-toggle"><input type="checkbox" checked={selected.material.angleOpacity} onchange={(event) => material('angleOpacity', event.currentTarget.checked)} />{$t('Angle-dependent opacity')}</label>
                {#if selected.source.kind === 'volume'}<label class="rep-toggle"><input type="checkbox" checked={selected.material.faceted} onchange={(event) => material('faceted', event.currentTarget.checked)} />{$t('Faceted')}</label>{/if}
              </details>
            {/if}
            <p class="rep-help">{$t('Opacity controls visibility; diffuse reflection controls the matte response. Scene lighting is shared by all Reps.')}</p>
            <p class="rep-help">{$t('Diffuse reflection: 1 is normal, above 1 is brighter. Saturation: 0 is grayscale, 1 is original, 3 is vivid.')}</p>
          </Tabs.Content>
          <Tabs.Content value="pbc" class="rep-tab-content">
            {#key selected.id}<RepPeriodicControls structure={selected.source.kind === 'structure'} value={selected.periodic} {sourceCell} onchange={(periodic) => patch({ periodic })} />{/key}
          </Tabs.Content>
          {#if errors[selected.id]}<p class="rep-error" role="alert">{$t(errors[selected.id])}</p>{/if}
        </div>
      </Tabs.Root>
    {/if}
  {/if}
</aside>
