<script lang="ts">
  import type { IsosurfaceSettings } from 'matterviz'
  import {
    apply_representation_preset,
    detect_representation_preset,
    refine_representation,
    REPRESENTATION_PRESETS,
    type RepresentationPreset,
  } from './representation'

  type InspectorSection = 'structure' | 'surfaces' | 'cell'
  type SceneProps = Record<string, unknown>
  type Range = [[number, number], [number, number], [number, number]]

  export let open = true
  export let section: InspectorSection = 'structure'
  export let scene_props: SceneProps = {}
  export let isosurface_settings: IsosurfaceSettings
  export let periodic = false
  export let supercell_scaling = '1x1x1'
  export let show_image_atoms = true
  export let show_unit_cell = true
  export let volume_count = 0
  export let on_scene_props_change: ((next: SceneProps) => void) | undefined = undefined
  export let on_isosurface_settings_change: ((next: IsosurfaceSettings) => void) | undefined = undefined
  export let on_supercell_change: ((value: string) => void) | undefined = undefined
  export let on_boundary_atoms_change: ((value: boolean) => void) | undefined = undefined
  export let on_unit_cell_change: ((value: boolean) => void) | undefined = undefined
  export let on_range_change: ((axis: number, bound: number, value: number) => void) | undefined = undefined
  export let on_layers: (() => void) | undefined = undefined
  export let on_close: (() => void) | undefined = undefined

  const scene_value = <T>(key: string, fallback: T): T => {
    const value = scene_props[key]
    return value === undefined ? fallback : value as T
  }

  const update_scene = (key: string, value: unknown): void => {
    on_scene_props_change?.({ ...scene_props, [key]: value })
  }

  const update_surface = (patch: Partial<IsosurfaceSettings>): void => {
    on_isosurface_settings_change?.({ ...isosurface_settings, ...patch })
  }

  const surface_range = (): Range => {
    const value = isosurface_settings.display_range
    return value && value.length === 3
      ? value as Range
      : [[0, 1], [0, 1], [0, 1]]
  }

  const range_value = (axis: number, bound: number): number => surface_range()[axis][bound]

  const set_number = (key: string, event: Event): void => {
    const input = event.currentTarget as HTMLInputElement
    if (Number.isFinite(input.valueAsNumber)) update_scene(key, input.valueAsNumber)
  }

  const set_dimension = (key: 'atom_radius' | 'bond_thickness', event: Event): void => {
    const input = event.currentTarget as HTMLInputElement
    if (!Number.isFinite(input.valueAsNumber)) return
    on_scene_props_change?.(refine_representation(scene_props, key, input.valueAsNumber))
  }

  const set_representation = (event: Event): void => {
    const input = event.currentTarget as HTMLSelectElement
    const preset = input.value as RepresentationPreset
    on_scene_props_change?.(apply_representation_preset(scene_props, preset))
  }

  const set_surface_number = (key: 'roughness' | 'metalness' | 'shininess' | 'specular' | 'halo', event: Event): void => {
    const input = event.currentTarget as HTMLInputElement
    if (Number.isFinite(input.valueAsNumber)) update_surface({ [key]: input.valueAsNumber })
  }
</script>

<aside class="inspector-drawer" class:closed={!open} aria-label="MatterViz inspector" aria-hidden={!open}>
  <header class="inspector-header">
    <div>
      <strong>Inspector</strong>
    </div>
    <button type="button" class="inspector-close" aria-label="Close inspector" title="Close inspector" onclick={() => on_close?.()}>x</button>
  </header>

  <nav class="inspector-tabs" aria-label="Inspector sections">
    <button type="button" class:active={section === 'structure'} aria-current={section === 'structure' ? 'page' : undefined} onclick={() => section = 'structure'}>
      <span class="tab-icon" aria-hidden="true">S</span><span>Structure</span>
    </button>
    <button type="button" class:active={section === 'surfaces'} aria-current={section === 'surfaces' ? 'page' : undefined} onclick={() => section = 'surfaces'}>
      <span class="tab-icon" aria-hidden="true">V</span><span>Surfaces</span>
    </button>
    {#if periodic}
      <button type="button" class:active={section === 'cell'} aria-current={section === 'cell' ? 'page' : undefined} onclick={() => section = 'cell'}>
        <span class="tab-icon" aria-hidden="true">C</span><span>Cell</span>
      </button>
    {/if}
    <button type="button" class="layers-tab" onclick={() => on_layers?.()} aria-label={`Open volume layers (${volume_count})`}>
      <span class="tab-icon" aria-hidden="true">L</span><span>Layers</span><small>{volume_count}</small>
    </button>
  </nav>

  <div class="inspector-content">
    {#if section === 'structure'}
      <section class="inspector-section" aria-labelledby="structure-heading">
        <h2 id="structure-heading">Structure</h2>
        <div class="control-grid">
          <label class="toggle-row">
            <input type="checkbox" checked={scene_value('show_gizmo', true)} onchange={(event) => update_scene('show_gizmo', event.currentTarget.checked)} />
            <span>Axes</span>
          </label>
        </div>
      </section>

      <section class="inspector-section" aria-labelledby="representation-heading">
        <h2 id="representation-heading">Representation</h2>
        <label>
          <span>Preset</span>
          <select value={detect_representation_preset(scene_props)} onchange={set_representation}>
            {#each REPRESENTATION_PRESETS as preset}
              <option value={preset.value}>{preset.label}</option>
            {/each}
          </select>
        </label>
        <div class="field-grid compact-fields">
          <label>
            <span>Atom radius</span>
            <input type="number" min="0.1" max="3" step="0.01" value={scene_value('atom_radius', 0.7)} oninput={(event) => set_dimension('atom_radius', event)} />
          </label>
          <label>
            <span>Bond thickness</span>
            <input type="number" min="0.01" max="1" step="0.01" value={scene_value('bond_thickness', 0.07)} oninput={(event) => set_dimension('bond_thickness', event)} />
          </label>
        </div>
      </section>

      <section class="inspector-section" aria-labelledby="background-heading">
        <h2 id="background-heading">Background</h2>
        <div class="field-grid">
          <label>
            <span>Color</span>
            <input type="color" value={scene_value('background_color', '#ffffff')} onchange={(event) => update_scene('background_color', event.currentTarget.value)} />
          </label>
          <label>
            <span>Opacity</span>
            <input type="range" min="0" max="1" step="0.05" value={scene_value('background_opacity', 1)} oninput={(event) => set_number('background_opacity', event)} />
          </label>
        </div>
      </section>
    {:else if section === 'surfaces'}
      <section class="inspector-section" aria-labelledby="surfaces-heading">
        <h2 id="surfaces-heading">Surfaces</h2>
        <div class="control-grid">
          <label class="toggle-row">
            <input type="checkbox" checked={isosurface_settings.wireframe} onchange={(event) => update_surface({ wireframe: event.currentTarget.checked })} disabled={!volume_count} />
            <span>Wireframe</span>
          </label>
        </div>
        <div class="field-grid">
          <label>
            <span>Material</span>
            <select value={isosurface_settings.material || 'matte'} onchange={(event) => update_surface({ material: event.currentTarget.value as IsosurfaceSettings['material'] })} disabled={!volume_count}>
              <option value="matte">Matte</option>
              <option value="glossy">Glossy</option>
              <option value="pbr">PBR</option>
            </select>
          </label>
          <label>
            <span>Halo</span>
            <input type="number" min="0" max="1" step="0.05" value={isosurface_settings.halo} oninput={(event) => set_surface_number('halo', event)} disabled={!volume_count} />
          </label>
          {#if isosurface_settings.material === 'pbr'}
            <label>
              <span>Roughness</span>
              <input type="range" min="0" max="1" step="0.01" value={isosurface_settings.roughness ?? 0.32} oninput={(event) => set_surface_number('roughness', event)} disabled={!volume_count} />
            </label>
            <label>
              <span>Metalness</span>
              <input type="range" min="0" max="1" step="0.01" value={isosurface_settings.metalness ?? 0} oninput={(event) => set_surface_number('metalness', event)} disabled={!volume_count} />
            </label>
          {:else if isosurface_settings.material === 'glossy'}
            <label>
              <span>Shininess</span>
              <input type="number" min="1" max="120" step="1" value={isosurface_settings.shininess ?? 42} oninput={(event) => set_surface_number('shininess', event)} disabled={!volume_count} />
            </label>
            <label>
              <span>Specular</span>
              <input type="range" min="0" max="1" step="0.01" value={isosurface_settings.specular ?? 0.28} oninput={(event) => set_surface_number('specular', event)} disabled={!volume_count} />
            </label>
          {/if}
        </div>
        {#if !volume_count}<p class="muted">Load a surface to edit surface appearance.</p>{/if}
      </section>
    {:else if section === 'cell' && periodic}
      <section class="inspector-section" aria-labelledby="cell-heading">
        <h2 id="cell-heading">Cell</h2>
        <div class="cell-ranges">
          {#each ['a', 'b', 'c'] as axis, axis_idx}
            <div class="range-row">
              <span class="range-label">{axis}</span>
              <input type="number" step="0.05" value={range_value(axis_idx, 0)} aria-label={`${axis} range minimum`} oninput={(event) => on_range_change?.(axis_idx, 0, event.currentTarget.valueAsNumber)} />
              <span aria-hidden="true">to</span>
              <input type="number" step="0.05" value={range_value(axis_idx, 1)} aria-label={`${axis} range maximum`} oninput={(event) => on_range_change?.(axis_idx, 1, event.currentTarget.valueAsNumber)} />
            </div>
          {/each}
        </div>
        <div class="field-grid">
          <label>
            <span>Supercell</span>
            <input type="text" value={supercell_scaling} aria-label="Atom supercell" onchange={(event) => on_supercell_change?.(event.currentTarget.value)} />
          </label>
          <label class="toggle-row">
            <input type="checkbox" checked={show_image_atoms} onchange={(event) => on_boundary_atoms_change?.(event.currentTarget.checked)} />
            <span>Boundary atoms</span>
          </label>
          <label class="toggle-row">
            <input type="checkbox" checked={show_unit_cell} onchange={(event) => on_unit_cell_change?.(event.currentTarget.checked)} />
            <span>Cell frame</span>
          </label>
        </div>
      </section>
    {/if}
  </div>
</aside>

<style>
  .inspector-drawer {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    min-width: 258px;
    width: 300px;
    height: 100%;
    overflow: hidden;
    color: #18202a;
    background: #f8f9fb;
    border-right: 1px solid #cfd6df;
  }
  .inspector-drawer.closed { display: none; }
  .inspector-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 47px;
    padding: 7px 9px 7px 13px;
    border-bottom: 1px solid #d8dee6;
  }
  .inspector-header strong { display: block; }
  .inspector-header strong { font-size: 13px; }
  .inspector-close { width: 28px; height: 28px; padding: 0; font-size: 18px; line-height: 1; }
  .inspector-tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid #d8dee6; }
  .inspector-tabs button { position: relative; display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 4px; min-width: 0; height: 42px; padding: 2px 4px; overflow: hidden; color: #556274; border: 0; border-radius: 0; background: transparent; font-size: 10px; text-align: left; }
  .inspector-tabs button:hover:not(:disabled), .inspector-tabs button.active { color: #135e9e; background: #edf5fc; }
  .inspector-tabs button.active::after { position: absolute; right: 0; bottom: 0; left: 0; height: 2px; background: #1976b8; content: ''; }
  .tab-icon { display: inline-grid; width: 15px; place-items: center; color: #1976b8; font-size: 14px; }
  .layers-tab small { justify-self: end; color: #667085; font-size: 10px; }
  .inspector-content { min-height: 0; overflow: auto; }
  .inspector-section { padding: 12px 12px 14px; border-bottom: 1px solid #d8dee6; }
  .inspector-section h2 { margin: 0 0 10px; color: #344054; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .control-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 8px; }
  .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px 8px; margin-top: 11px; }
  .compact-fields { gap: 7px 8px; margin-top: 8px; }
  label { display: grid; min-width: 0; gap: 4px; }
  label > span { color: #5c6675; font-size: 11px; }
  .toggle-row { display: flex; align-items: center; min-height: 28px; gap: 6px; }
  .toggle-row span { color: #344054; font-size: 11px; }
  input, select, button { min-width: 0; height: 29px; border: 1px solid #b9c2ce; border-radius: 5px; background: #fff; color: #18202a; font: inherit; }
  input, select { width: 100%; padding: 3px 6px; }
  input[type='checkbox'] { width: 15px; height: 15px; accent-color: #1976b8; }
  input[type='color'] { padding: 2px; }
  input[type='range'] { accent-color: #1976b8; }
  button { cursor: pointer; }
  button:hover:not(:disabled) { border-color: #66788c; background: #f0f3f7; }
  .cell-ranges { display: grid; gap: 8px; }
  .range-row { display: grid; grid-template-columns: 15px minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 5px; }
  .range-row input { width: 100%; }
  .range-row > span:not(.range-label) { color: #667085; font-size: 10px; }
  .range-label { color: #344054; font-size: 11px; font-weight: 700; }
  .muted { margin: 11px 0 0; color: #667085; font-size: 11px; line-height: 1.4; }

  @media (max-width: 800px) {
    .inspector-drawer { position: absolute; top: 0; bottom: 0; left: 44px; z-index: 100; width: min(320px, calc(100% - 44px)); height: auto; border: 1px solid #aeb8c5; box-shadow: 10px 0 28px rgba(23, 32, 42, .18); }
  }
</style>
