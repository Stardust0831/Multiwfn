<script lang="ts">
  import type { IsosurfaceSettings } from 'matterviz'
  import {
    apply_representation_preset,
    detect_representation_preset,
    refine_representation,
    REPRESENTATION_PRESETS,
    type RepresentationPreset,
  } from './representation'
  import {
    apply_surface_preset,
    detect_surface_preset,
    normalize_surface_appearance,
    normalize_surface_number,
    SURFACE_DEFAULTS,
    SURFACE_PRESETS,
    type SurfaceNumber,
  } from './material'

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
    on_isosurface_settings_change?.({ ...isosurface_settings, ...normalize_surface_appearance(patch) })
  }

  $: surface_preset = detect_surface_preset(isosurface_settings)
  $: surface_description = SURFACE_PRESETS.find((preset) => preset.value === surface_preset)?.description
    ?? 'Custom surface appearance. Choose a preset to reset the finish.'
  $: shaded_surface = !isosurface_settings.wireframe && isosurface_settings.material !== 'unlit'

  $: surface_values = { ...SURFACE_DEFAULTS, ...normalize_surface_appearance(isosurface_settings) }

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

  const set_surface_number = (key: SurfaceNumber, event: Event): void => {
    const input = event.currentTarget as HTMLInputElement
    const value = normalize_surface_number(key, input.valueAsNumber)
    if (value !== undefined) update_surface({ [key]: value })
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
        <div class="surface-presets" role="group" aria-label="Surface finish presets">
          {#each SURFACE_PRESETS as preset}
            <button
              type="button"
              class="surface-preset"
              class:selected={surface_preset === preset.value}
              aria-pressed={surface_preset === preset.value}
              title={preset.description}
              disabled={!volume_count}
              onclick={() => on_isosurface_settings_change?.(apply_surface_preset(isosurface_settings, preset.value))}
            >
              <span class="finish-swatch" data-preset={preset.value} aria-hidden="true"></span>
              <span>{preset.label}</span>
            </button>
          {/each}
        </div>
        <p class="finish-description">{surface_description}</p>
        <details class="surface-refinement">
          <summary>Fine tune{surface_preset === 'custom' ? ' · Custom' : ''}</summary>
          <div class="field-grid">
            <label>
              <span>Material</span>
              <select value={isosurface_settings.material || SURFACE_DEFAULTS.material} onchange={(event) => update_surface({ material: event.currentTarget.value as IsosurfaceSettings['material'] })} disabled={!volume_count}>
                <option value="matte">Matte</option>
                <option value="glossy">Glossy</option>
                <option value="pbr">PBR</option>
                <option value="unlit">Unlit</option>
              </select>
            </label>
          </div>
          <div class="control-grid">
            <label class="toggle-row">
              <input type="checkbox" checked={isosurface_settings.wireframe ?? false} onchange={(event) => update_surface({ wireframe: event.currentTarget.checked })} disabled={!volume_count} />
              <span>Wireframe</span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" checked={isosurface_settings.flat_shading ?? false} onchange={(event) => update_surface({ flat_shading: event.currentTarget.checked })} disabled={!volume_count || !shaded_surface} />
              <span>Faceted</span>
            </label>
          </div>
          <div class="field-grid">
            {#if isosurface_settings.material === 'pbr'}
              <label>
                <span class="value-label">Roughness <span class="control-value" aria-hidden="true">{surface_values.roughness.toFixed(2)}</span></span>
                <input type="range" min="0" max="1" step="0.01" value={surface_values.roughness} oninput={(event) => set_surface_number('roughness', event)} disabled={!volume_count || isosurface_settings.wireframe} />
              </label>
              <label>
                <span class="value-label">Metalness <span class="control-value" aria-hidden="true">{surface_values.metalness.toFixed(2)}</span></span>
                <input type="range" min="0" max="1" step="0.01" value={surface_values.metalness} oninput={(event) => set_surface_number('metalness', event)} disabled={!volume_count || isosurface_settings.wireframe} />
              </label>
            {:else if isosurface_settings.material === 'glossy'}
              <label>
                <span>Shininess</span>
                <input type="number" min="1" max="120" step="1" value={surface_values.shininess} oninput={(event) => set_surface_number('shininess', event)} disabled={!volume_count || isosurface_settings.wireframe} />
              </label>
              <label>
                <span class="value-label">Specular <span class="control-value" aria-hidden="true">{surface_values.specular.toFixed(2)}</span></span>
                <input type="range" min="0" max="1" step="0.01" value={surface_values.specular} oninput={(event) => set_surface_number('specular', event)} disabled={!volume_count || isosurface_settings.wireframe} />
              </label>
            {/if}
          </div>
          <div class="field-grid">
            <label>
              <span class="value-label">Rim contrast <span class="control-value" aria-hidden="true">{surface_values.outline.toFixed(2)}</span></span>
              <input type="range" min="0" max="1" step="0.01" value={surface_values.outline} oninput={(event) => set_surface_number('outline', event)} disabled={!volume_count || !shaded_surface} />
            </label>
            <label>
              <span class="value-label">Rim width <span class="control-value" aria-hidden="true">{surface_values.outlineWidth.toFixed(2)}</span></span>
              <input type="range" min="0" max="1" step="0.01" value={surface_values.outlineWidth} oninput={(event) => set_surface_number('outlineWidth', event)} disabled={!volume_count || !shaded_surface || !surface_values.outline} />
            </label>
          </div>
          <label class="toggle-row angle-opacity">
            <input type="checkbox" checked={isosurface_settings.transmode === 1} onchange={(event) => update_surface({ transmode: event.currentTarget.checked ? 1 : 0 })} disabled={!volume_count || !shaded_surface} aria-describedby="angle-opacity-help" />
            <span>Angle-dependent opacity</span>
          </label>
          <p id="angle-opacity-help" class="muted">Makes grazing edges more opaque on transparent layers.</p>
        </details>
        <p class="muted">Finish applies to all surface layers. Edit colors and opacity in Layers.</p>
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
          <label>
            <span>Boundary padding</span>
            <input type="number" min="0" max="1" step="0.05" value={surface_values.halo} oninput={(event) => set_surface_number('halo', event)} disabled={!volume_count} aria-describedby="boundary-padding-help" />
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
        <p id="boundary-padding-help" class="muted">Padding extends periodic surfaces beyond the cell bounds, in fractional cell units.</p>
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
  .surface-presets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
  .surface-preset { display: flex; align-items: center; gap: 9px; height: 44px; padding: 7px 9px; text-align: left; font-size: 11px; }
  .surface-preset.selected { color: #135e9e; border-color: #1976b8; background: #edf5fc; box-shadow: inset 0 0 0 1px #1976b8; }
  .finish-swatch { flex: 0 0 26px; height: 26px; border-radius: 50%; background: radial-gradient(circle at 32% 28%, #8dafcf, #3e719b 65%, #244c70); }
  .finish-swatch[data-preset='soft-gloss'] { background: radial-gradient(circle at 32% 28%, #eef6fe, #a3c7e5 14%, #437fae 45%, #234764 85%); }
  .finish-swatch[data-preset='satin'] { background: radial-gradient(ellipse at 30% 26%, #c5ddef, #6595b9 36%, #315c7d 80%); }
  .finish-swatch[data-preset='unlit'] { background: #477eaa; }
  .finish-description { min-height: 32px; margin: 10px 0 12px; color: #5c6675; font-size: 11px; line-height: 1.45; }
  .surface-refinement { padding-top: 10px; border-top: 1px solid #d8dee6; }
  .surface-refinement summary { color: #344054; font-size: 11px; font-weight: 600; cursor: pointer; }
  .surface-refinement .control-grid { margin-top: 7px; }
  .angle-opacity { margin-top: 8px; }
  .value-label { display: flex; justify-content: space-between; gap: 4px; }
  .control-value { color: #344054; font-variant-numeric: tabular-nums; }
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
  button:disabled { cursor: default; opacity: .5; }
  button:focus-visible, summary:focus-visible { outline: 2px solid #1976b8; outline-offset: 2px; }
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
