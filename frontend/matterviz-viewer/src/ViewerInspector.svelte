<script lang="ts">
  import { t } from './i18n'
  import type { IsosurfaceSettings } from 'matterviz'
  import { Atom, Layers, Box, X, RotateCcw } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import { Slider } from '$lib/components/ui/slider'
  import * as Tabs from '$lib/components/ui/tabs'
  import WorkbenchSelect from './WorkbenchSelect.svelte'
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
    type SurfacePreset,
    type SurfaceNumber,
  } from './material'
  import { LIGHTING_DEFAULTS, TMIM_LIGHTING_DEFAULTS, normalize_light_intensity, normalize_lighting, type LightingKey } from './lighting'
  import { ATOM_STYLE_PRESETS, apply_atom_style, atom_style_values, type AtomStyle } from './atom-style'

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
  $: primary_surface_presets = SURFACE_PRESETS.filter((preset) => !preset.group)
  $: legacy_surface_presets = SURFACE_PRESETS.filter((preset) => preset.group === 'legacy')
  $: surface_description = SURFACE_PRESETS.find((preset) => preset.value === surface_preset)?.description
    ?? 'Custom surface appearance. Choose a preset to reset the finish.'
  $: shaded_surface = !isosurface_settings.wireframe && isosurface_settings.material !== 'unlit'

  $: surface_values = { ...SURFACE_DEFAULTS, ...normalize_surface_appearance(isosurface_settings) }
  $: lighting_values = { ...LIGHTING_DEFAULTS, ...normalize_lighting(scene_props) }
  $: atom_values = atom_style_values(scene_props)
  $: lighting_rig = scene_props.lighting_rig === 'tmim' ? 'tmim' : 'default'

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

  const set_lighting = (key: LightingKey, intensity: number): void => {
    const value = normalize_light_intensity(intensity)
    if (value !== undefined) update_scene(key, value)
  }

  const set_lighting_rig = (value: string): void => {
    if (value === 'tmim') {
      on_scene_props_change?.({ ...scene_props, lighting_rig: 'tmim', scene_tone_mapping: 'none', ...TMIM_LIGHTING_DEFAULTS })
    } else {
      on_scene_props_change?.({ ...scene_props, lighting_rig: 'default', scene_tone_mapping: 'agx', ...LIGHTING_DEFAULTS, fill_light: 0.38, rim_light: 0.24 })
    }
  }

  const reset_lighting = (): void => {
    if (lighting_rig === 'tmim') on_scene_props_change?.({ ...scene_props, lighting_rig: 'tmim', scene_tone_mapping: 'none', ...TMIM_LIGHTING_DEFAULTS })
    else on_scene_props_change?.({ ...scene_props, lighting_rig: 'default', scene_tone_mapping: 'agx', ...LIGHTING_DEFAULTS, fill_light: 0.38, rim_light: 0.24 })
  }

  const set_atom_style = (value: string): void => {
    on_scene_props_change?.(apply_atom_style(scene_props, value as AtomStyle))
  }

  const set_dimension = (key: 'atom_radius' | 'bond_thickness', event: Event): void => {
    const input = event.currentTarget as HTMLInputElement
    if (!Number.isFinite(input.valueAsNumber)) return
    on_scene_props_change?.(refine_representation(scene_props, key, input.valueAsNumber))
  }

  const set_representation = (value: string): void => {
    const preset = value as RepresentationPreset
    on_scene_props_change?.(apply_representation_preset(scene_props, preset))
  }

  const set_surface_number = (key: SurfaceNumber, event: Event): void => {
    const input = event.currentTarget as HTMLInputElement
    const value = normalize_surface_number(key, input.valueAsNumber)
    if (value !== undefined) update_surface({ [key]: value })
  }
</script>

<aside class="inspector-drawer" class:closed={!open} aria-label={$t("MatterViz inspector")} aria-hidden={!open}>
  <header class="inspector-header">
    <div>
      <strong>{$t("Scene settings")}</strong><span class="inspector-subtitle">{$t("Shape, light & surface")}</span>
    </div>
    <Button variant="ghost" size="icon-sm" aria-label={$t("Close inspector")} title={$t("Close inspector")} onclick={() => on_close?.()}><X size={15} /></Button>
  </header>

  <Tabs.Root value={section} onValueChange={(value) => section = value as InspectorSection} class="inspector-tabs-root grid grid-rows-[auto_minmax(0,1fr)] min-h-0 min-w-0 gap-0">
    <div class="inspector-tab-bar">
      <Tabs.List aria-label={$t("Inspector sections")} class="w-full h-9 p-1 bg-muted">
        <Tabs.Trigger value="structure" class="min-w-0 flex-1 text-xs gap-1"><Atom size={13} />{$t("Structure")}</Tabs.Trigger>
        <Tabs.Trigger value="surfaces" class="min-w-0 flex-1 text-xs gap-1"><Layers size={13} />{$t("Surfaces")}</Tabs.Trigger>
        {#if periodic}<Tabs.Trigger value="cell" class="min-w-0 flex-1 text-xs gap-1"><Box size={13} />{$t("Cell")}</Tabs.Trigger>{/if}
      </Tabs.List>
      <Button variant="outline" size="sm" class="mt-2 w-full justify-between text-xs" onclick={() => on_layers?.()} aria-label={$t("Open volume layers ({count})", { count: volume_count })}>
        <span class="flex items-center gap-2"><Layers size={13} />{$t("Volume layers")}</span><span class="text-muted-foreground tabular-nums">{volume_count}</span>
      </Button>
    </div>
  <div class="inspector-content">
    <Tabs.Content value="structure" class="m-0">
      <section class="inspector-section" aria-labelledby="structure-heading">
        <h2 id="structure-heading">{$t("Structure")}</h2>
        <div class="control-grid">
          <label class="toggle-row">
            <input type="checkbox" checked={scene_value('show_gizmo', true)} onchange={(event) => update_scene('show_gizmo', event.currentTarget.checked)} />
            <span>{$t("Axes")}</span>
          </label>
        </div>
      </section>

      <section class="inspector-section" aria-labelledby="representation-heading">
        <h2 id="representation-heading">{$t("Representation")}</h2>
        <label>
          <span>{$t("Preset")}</span>
          <WorkbenchSelect label="Representation preset" value={detect_representation_preset(scene_props)} options={REPRESENTATION_PRESETS} onchange={set_representation} />
        </label>
        <div class="field-grid compact-fields">
          <label>
            <span>{$t("Atom radius")}</span>
            <input type="number" min="0.1" max="3" step="0.01" value={scene_value('atom_radius', 0.7)} oninput={(event) => set_dimension('atom_radius', event)} />
          </label>
          <label>
            <span>{$t("Bond thickness")}</span>
            <input type="number" min="0.01" max="1" step="0.01" value={scene_value('bond_thickness', 0.07)} oninput={(event) => set_dimension('bond_thickness', event)} />
          </label>
        </div>
      </section>

      <section class="inspector-section" aria-labelledby="lighting-heading">
        <h2 id="lighting-heading">{$t("Lighting")}</h2>
        <label>
          <span>{$t("Lighting preset")}</span>
          <WorkbenchSelect label="Scene appearance preset" value={lighting_rig} options={[{ value: "default", label: "Standard lighting" }, { value: "tmim", label: "Studio lighting" }]} onchange={set_lighting_rig} />
        </label>
        <div class="field-grid">
          <label>
            <span class="value-label">{$t("Ambient")} <span class="control-value" aria-hidden="true">{lighting_values.ambient_light.toFixed(2)}</span></span>
            <Slider type="single" min={0} max={4} step={0.01} aria-label={$t("Ambient light")} value={lighting_values.ambient_light} onValueChange={(value) => set_lighting('ambient_light', value)} />
          </label>
          <label>
            <span class="value-label">{$t("Directional")} <span class="control-value" aria-hidden="true">{lighting_values.directional_light.toFixed(2)}</span></span>
            <Slider type="single" min={0} max={4} step={0.01} aria-label={$t("Directional light")} value={lighting_values.directional_light} onValueChange={(value) => set_lighting('directional_light', value)} />
          </label>
          <label>
            <span class="value-label">{$t("Fill")} <span class="control-value" aria-hidden="true">{(lighting_values.fill_light ?? 0.38).toFixed(2)}</span></span>
            <Slider type="single" min={0} max={4} step={0.01} aria-label={$t("Fill light")} value={lighting_values.fill_light ?? 0.38} onValueChange={(value) => set_lighting('fill_light', value)} />
          </label>
          <label>
            <span class="value-label">{$t("Rim")} <span class="control-value" aria-hidden="true">{(lighting_values.rim_light ?? 0.24).toFixed(2)}</span></span>
            <Slider type="single" min={0} max={4} step={0.01} aria-label={$t("Rim light")} value={lighting_values.rim_light ?? 0.24} onValueChange={(value) => set_lighting('rim_light', value)} />
          </label>
        </div>
        <p class="muted">{$t(lighting_rig === "tmim" ? "Studio lighting uses hemisphere light, warm fill and cool rim light, with tone mapping disabled." : "Standard lighting uses neutral lights and AgX tone mapping.")}</p>
        <Button variant="outline" size="sm" class="mt-3 text-xs" onclick={reset_lighting}><RotateCcw size={13} />{$t("Reset lighting")}</Button>
      </section>

      <section class="inspector-section" aria-labelledby="atom-material-heading">
        <h2 id="atom-material-heading">{$t("Atom material")}</h2>
        <label>
          <span>{$t("Finish preset")}</span>
          <WorkbenchSelect label="Atom material preset" value={atom_values.value ?? ""} placeholder={$t("Renderer default")} options={ATOM_STYLE_PRESETS} onchange={set_atom_style} />
        </label>
        <p class="muted">{$t("Presets retain element colors and apply to complete, partial, and image atoms.")}</p>
      </section>

      <section class="inspector-section" aria-labelledby="background-heading">
        <h2 id="background-heading">{$t("Background")}</h2>
        <div class="field-grid">
          <label>
            <span>{$t("Color")}</span>
            <input type="color" value={scene_value('background_color', '#ffffff')} onchange={(event) => update_scene('background_color', event.currentTarget.value)} />
          </label>
          <label>
            <span>{$t("Opacity")}</span>
            <input type="range" min="0" max="1" step="0.05" value={scene_value('background_opacity', 1)} oninput={(event) => set_number('background_opacity', event)} />
          </label>
        </div>
      </section>
    </Tabs.Content>
    <Tabs.Content value="surfaces" class="m-0">
      <section class="inspector-section" aria-labelledby="surfaces-heading">
        <h2 id="surfaces-heading">{$t("Surfaces")}</h2>
        <div class="surface-presets" role="group" aria-label={$t("Surface finish presets")}>
          {#each primary_surface_presets as preset}
            <Button
              variant="outline"
              class={`h-14 justify-start gap-2 px-2 text-xs ${surface_preset === preset.value ? 'border-primary bg-accent text-primary ring-1 ring-primary' : ''}`}
              aria-pressed={surface_preset === preset.value}
              title={$t(preset.description)}
              disabled={!volume_count}
              onclick={() => on_isosurface_settings_change?.(apply_surface_preset(isosurface_settings, preset.value))}
            >
              <span class="finish-swatch" data-preset={preset.value} aria-hidden="true"></span>
              <span>{$t(preset.label)}</span>
            </Button>
          {/each}
        </div>
        <p class="finish-description">{$t(surface_description)}</p>
        <label>
          <span>{$t("Original surface finish")}</span>
          <WorkbenchSelect label="Original surface material preset" value={surface_preset} options={legacy_surface_presets}
            placeholder={$t("Choose original combination…")} disabled={!volume_count} onchange={(value) => on_isosurface_settings_change?.(apply_surface_preset(isosurface_settings, value as SurfacePreset))} />
        </label>
        <details class="surface-refinement">
          <summary>{$t("Fine tune")}{surface_preset === 'custom' ? ` · ${$t('Custom')}` : ''}</summary>
          <div class="field-grid">
            <label>
              <span>{$t("Material")}</span>
              <select value={isosurface_settings.material || SURFACE_DEFAULTS.material} onchange={(event) => update_surface({ material: event.currentTarget.value as IsosurfaceSettings['material'] })} disabled={!volume_count}>
                <option value="matte">{$t("Matte")}</option>
                <option value="glossy">{$t("Glossy")}</option>
                <option value="pbr">PBR</option>
                <option value="unlit">{$t("Unlit")}</option>
              </select>
            </label>
          </div>
          <div class="control-grid">
            <label class="toggle-row">
              <input type="checkbox" checked={isosurface_settings.wireframe ?? false} onchange={(event) => update_surface({ wireframe: event.currentTarget.checked })} disabled={!volume_count} />
              <span>{$t("Wireframe")}</span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" checked={isosurface_settings.flat_shading ?? false} onchange={(event) => update_surface({ flat_shading: event.currentTarget.checked })} disabled={!volume_count || !shaded_surface} />
              <span>{$t("Faceted")}</span>
            </label>
          </div>
          <div class="field-grid">
            {#if isosurface_settings.material === 'pbr'}
              <label>
                <span class="value-label">{$t("Roughness")} <span class="control-value" aria-hidden="true">{surface_values.roughness.toFixed(2)}</span></span>
                <input type="range" min="0" max="1" step="0.01" value={surface_values.roughness} oninput={(event) => set_surface_number('roughness', event)} disabled={!volume_count || isosurface_settings.wireframe} />
              </label>
              <label>
                <span class="value-label">{$t("Metalness")} <span class="control-value" aria-hidden="true">{surface_values.metalness.toFixed(2)}</span></span>
                <input type="range" min="0" max="1" step="0.01" value={surface_values.metalness} oninput={(event) => set_surface_number('metalness', event)} disabled={!volume_count || isosurface_settings.wireframe} />
              </label>
            {:else if isosurface_settings.material === 'glossy'}
              <label>
                <span>{$t("Shininess")}</span>
                <input type="number" min="1" max="120" step="1" value={surface_values.shininess} oninput={(event) => set_surface_number('shininess', event)} disabled={!volume_count || isosurface_settings.wireframe} />
              </label>
              <label>
                <span class="value-label">{$t("Specular")} <span class="control-value" aria-hidden="true">{surface_values.specular.toFixed(2)}</span></span>
                <input type="range" min="0" max="1" step="0.01" value={surface_values.specular} oninput={(event) => set_surface_number('specular', event)} disabled={!volume_count || isosurface_settings.wireframe} />
              </label>
            {/if}
          </div>
          <div class="field-grid">
            <label>
              <span class="value-label">{$t("Rim contrast")} <span class="control-value" aria-hidden="true">{surface_values.outline.toFixed(2)}</span></span>
              <input type="range" min="0" max="1" step="0.01" value={surface_values.outline} oninput={(event) => set_surface_number('outline', event)} disabled={!volume_count || !shaded_surface} />
            </label>
            <label>
              <span class="value-label">{$t("Rim width")} <span class="control-value" aria-hidden="true">{surface_values.outlineWidth.toFixed(2)}</span></span>
              <input type="range" min="0" max="1" step="0.01" value={surface_values.outlineWidth} oninput={(event) => set_surface_number('outlineWidth', event)} disabled={!volume_count || !shaded_surface || !surface_values.outline} />
            </label>
          </div>
          <label class="toggle-row angle-opacity">
            <input type="checkbox" checked={isosurface_settings.transmode === 1} onchange={(event) => update_surface({ transmode: event.currentTarget.checked ? 1 : 0 })} disabled={!volume_count || !shaded_surface} aria-describedby="angle-opacity-help" />
            <span>{$t("Angle-dependent opacity")}</span>
          </label>
          <p id="angle-opacity-help" class="muted">{$t("Makes grazing edges more opaque on transparent layers.")}</p>
        </details>
        <p class="muted">{$t("Finish applies to all surface layers. Edit colors and opacity in Layers.")}</p>
        {#if !volume_count}<p class="muted">{$t("Load a surface to edit surface appearance.")}</p>{/if}
      </section>
    </Tabs.Content>
    {#if periodic}
    <Tabs.Content value="cell" class="m-0">
      <section class="inspector-section" aria-labelledby="cell-heading">
        <h2 id="cell-heading">{$t("Cell")}</h2>
        <div class="cell-ranges">
          {#each ['a', 'b', 'c'] as axis, axis_idx}
            <div class="range-row">
              <span class="range-label">{axis}</span>
              <input type="number" step="0.05" value={range_value(axis_idx, 0)} aria-label={$t("{axis} range minimum", { axis })} oninput={(event) => on_range_change?.(axis_idx, 0, event.currentTarget.valueAsNumber)} />
              <span aria-hidden="true">{$t("to")}</span>
              <input type="number" step="0.05" value={range_value(axis_idx, 1)} aria-label={$t("{axis} range maximum", { axis })} oninput={(event) => on_range_change?.(axis_idx, 1, event.currentTarget.valueAsNumber)} />
            </div>
          {/each}
        </div>
        <div class="field-grid">
          <label>
            <span>{$t("Supercell")}</span>
            <input type="text" value={supercell_scaling} aria-label={$t("Atom supercell")} onchange={(event) => on_supercell_change?.(event.currentTarget.value)} />
          </label>
          <label>
            <span>{$t("Boundary padding")}</span>
            <input type="number" min="0" max="1" step="0.05" value={surface_values.halo} oninput={(event) => set_surface_number('halo', event)} disabled={!volume_count} aria-describedby="boundary-padding-help" />
          </label>
          <label class="toggle-row">
            <input type="checkbox" checked={show_image_atoms} onchange={(event) => on_boundary_atoms_change?.(event.currentTarget.checked)} />
            <span>{$t("Boundary atoms")}</span>
          </label>
          <label class="toggle-row">
            <input type="checkbox" checked={show_unit_cell} onchange={(event) => on_unit_cell_change?.(event.currentTarget.checked)} />
            <span>{$t("Cell frame")}</span>
          </label>
        </div>
        <p id="boundary-padding-help" class="muted">{$t("Padding extends periodic surfaces beyond the cell bounds, in fractional cell units.")}</p>
      </section>
    </Tabs.Content>
    {/if}
  </div>
  </Tabs.Root>
</aside>

<style>
  .inspector-drawer {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 258px;
    width: 300px;
    height: 100%;
    overflow: hidden;
    color: #18202a;
    background: #fbfcfd;
    border-right: 1px solid #cfd6df;
  }
  .inspector-drawer.closed { display: none; }
  .inspector-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 66px;
    padding: 7px 9px 7px 13px;
    border-bottom: 1px solid #d8dee6;
  }
  .inspector-header strong { display: block; }
  .inspector-header strong { font-size: 13px; }
  .inspector-subtitle { display: block; margin-top: 4px; font-size: 11px; color: #637287; }
  .inspector-tab-bar { padding: 10px 12px; border-bottom: 1px solid #e3e9ef; }
  .inspector-content { min-height: 0; overflow: auto; }
  .inspector-section { padding: 12px 12px 14px; border-bottom: 1px solid #d8dee6; }
  .inspector-section h2 { margin: 0 0 10px; color: #344054; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .control-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 8px; }
  .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px 8px; margin-top: 11px; }
  .compact-fields { gap: 7px 8px; margin-top: 8px; }
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
  input, select { min-width: 0; height: 29px; border: 1px solid #b9c2ce; border-radius: 5px; background: #fff; color: #18202a; font: inherit; }
  input, select { width: 100%; padding: 3px 6px; }
  input[type='checkbox'] { width: 15px; height: 15px; accent-color: #1976b8; }
  input[type='color'] { padding: 2px; }
  input[type='range'] { accent-color: #176c86; }
  summary:focus-visible { outline: 2px solid #176c86; outline-offset: 2px; }
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
