<script lang="ts">
  import type { IsosurfaceSettings } from 'matterviz'

  let {
    settings = $bindable<IsosurfaceSettings>(),
    sceneProps = $bindable<Record<string, unknown>>(),
    open = $bindable(false),
  }: { settings: IsosurfaceSettings; sceneProps: Record<string, unknown>; open: boolean } = $props()

  // VMD-inspired material presets. Each maps to the renderer's material fields:
  // material style, PBR (roughness/metalness), Phong (shininess/specular), the
  // new Fresnel edge outline (outline/outlineWidth) and angle-dependent
  // transparency (transmode). A "Glass" preset also enables transmode so
  // transparent surfaces stay crisp at grazing angles.
  const PRESETS: Record<string, Partial<IsosurfaceSettings>> = {
    Matte: { material: 'matte', outline: 0, outlineWidth: 0.6, transmode: 0 },
    Diffuse: { material: 'matte', outline: 0, outlineWidth: 0.6, transmode: 0 },
    Goodsell: {
      material: 'matte', roughness: 0.7, metalness: 0, shininess: 18,
      specular: 0.12, outline: 0, outlineWidth: 0.6, transmode: 0,
    },
    Edgy: {
      material: 'glossy', shininess: 50, specular: 0.5,
      outline: 0.5, outlineWidth: 0.9, transmode: 0,
    },
    EdgyShiny: {
      material: 'glossy', shininess: 70, specular: 0.85,
      outline: 0.6, outlineWidth: 0.92, transmode: 0,
    },
    AOShiny: {
      material: 'glossy', shininess: 45, specular: 0.55,
      outline: 0.15, outlineWidth: 0.7, transmode: 0,
    },
    AOChalky: {
      material: 'glossy', shininess: 20, specular: 0.2,
      outline: 0.1, outlineWidth: 0.6, transmode: 0,
    },
    Glass1: {
      material: 'glossy', shininess: 55, specular: 0.65,
      outline: 0.05, outlineWidth: 0.6, transmode: 1,
    },
    GlassBubble: {
      material: 'glossy', shininess: 90, specular: 0.95,
      outline: 0.05, outlineWidth: 0.6, transmode: 1,
    },
    EdgyGlass: {
      material: 'glossy', shininess: 70, specular: 0.6,
      outline: 0.5, outlineWidth: 0.9, transmode: 1,
    },
    BrushedMetal: {
      material: 'pbr', metalness: 0.75, roughness: 0.35, specular: 0.3,
      outline: 0.05, outlineWidth: 0.6, transmode: 0,
    },
    Metallic: {
      material: 'pbr', metalness: 0.8, roughness: 0.28, specular: 0.3,
      outline: 0.05, outlineWidth: 0.6, transmode: 0,
    },
    PBR: {
      material: 'pbr', metalness: 0.2, roughness: 0.5, specular: 0.2,
      outline: 0.15, outlineWidth: 0.6, transmode: 0,
    },
    Unlit: { material: 'unlit', outline: 0, outlineWidth: 0.6, transmode: 0 },
  }

  const apply_preset = (name: string): void => {
    const preset = PRESETS[name]
    if (!preset) return
    settings = { ...settings, ...preset }
  }

  const patch = <Key extends keyof IsosurfaceSettings>(
    key: Key,
    value: IsosurfaceSettings[Key],
  ): void => {
    settings = { ...settings, [key]: value }
  }
</script>

<aside class="material-panel" aria-label="Isosurface material">
  <header>
    <strong>Material</strong>
    <button type="button" onclick={() => open = false}>Close</button>
  </header>

  <div class="material-body">
    <label class="preset">
      <span>Preset</span>
      <select onchange={(ev) => apply_preset(ev.currentTarget.value)}>
        <option value="" disabled selected>— pick preset —</option>
        {#each Object.keys(PRESETS) as name}
          <option value={name}>{name}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>Material</span>
      <select
        value={settings.material ?? 'matte'}
        onchange={(ev) => patch('material', ev.currentTarget.value as IsosurfaceSettings['material'])}
      >
        <option value="matte">matte</option>
        <option value="glossy">glossy</option>
        <option value="pbr">pbr</option>
        <option value="unlit">unlit</option>
      </select>
    </label>

    {#if (settings.material ?? 'matte') === 'pbr'}
      <label>
        <span>Roughness <output>{Number(settings.roughness ?? 0.7).toFixed(2)}</output></span>
        <input type="range" min="0" max="1" step="0.01" value={settings.roughness ?? 0.7}
          oninput={(ev) => patch('roughness', Number(ev.currentTarget.value))} />
      </label>
      <label>
        <span>Metalness <output>{Number(settings.metalness ?? 0).toFixed(2)}</output></span>
        <input type="range" min="0" max="1" step="0.01" value={settings.metalness ?? 0}
          oninput={(ev) => patch('metalness', Number(ev.currentTarget.value))} />
      </label>
    {/if}

    {#if (settings.material ?? 'matte') === 'glossy'}
      <label>
        <span>Shininess <output>{Math.round(Number(settings.shininess ?? 18))}</output></span>
        <input type="range" min="0" max="100" step="1" value={settings.shininess ?? 18}
          oninput={(ev) => patch('shininess', Number(ev.currentTarget.value))} />
      </label>
      <label>
        <span>Specular <output>{Number(settings.specular ?? 0.12).toFixed(2)}</output></span>
        <input type="range" min="0" max="1" step="0.01" value={settings.specular ?? 0.12}
          oninput={(ev) => patch('specular', Number(ev.currentTarget.value))} />
      </label>
    {/if}

    <label>
      <span>Outline (edge) <output>{Number(settings.outline ?? 0).toFixed(2)}</output></span>
      <input type="range" min="0" max="1" step="0.01" value={settings.outline ?? 0}
        oninput={(ev) => patch('outline', Number(ev.currentTarget.value))} />
    </label>
    <label>
      <span>Outline width <output>{Number(settings.outlineWidth ?? 0.6).toFixed(2)}</output></span>
      <input type="range" min="0" max="1" step="0.01" value={settings.outlineWidth ?? 0.6}
        oninput={(ev) => patch('outlineWidth', Number(ev.currentTarget.value))} />
    </label>

    <label class="check">
      <input type="checkbox" checked={Boolean(settings.transmode)} onchange={(ev) => patch('transmode', ev.currentTarget.checked ? 1 : 0)} />
      <span>Angle-dependent transparency</span>
    </label>
    <label class="check">
      <input type="checkbox" checked={Boolean(settings.wireframe)} onchange={(ev) => patch('wireframe', ev.currentTarget.checked)} />
      <span>Wireframe</span>
    </label>
    <label class="check">
      <input type="checkbox" checked={Boolean(settings.flat_shading)} onchange={(ev) => patch('flat_shading', ev.currentTarget.checked)} />
      <span>Flat shading</span>
    </label>

    <div class="lighting">
      <strong>Lighting</strong>
      <label>
        <span>Ambient <output>{Number(sceneProps?.ambient_light ?? 1.5).toFixed(2)}</output></span>
        <input type="range" min="0" max="4" step="0.05" value={sceneProps?.ambient_light ?? 1.5}
          oninput={(ev) => sceneProps = { ...sceneProps, ambient_light: Number(ev.currentTarget.value) }} />
      </label>
      <label>
        <span>Directional <output>{Number(sceneProps?.directional_light ?? 2.2).toFixed(2)}</output></span>
        <input type="range" min="0" max="4" step="0.05" value={sceneProps?.directional_light ?? 2.2}
          oninput={(ev) => sceneProps = { ...sceneProps, directional_light: Number(ev.currentTarget.value) }} />
      </label>
    </div>
  </div>
</aside>

<style>
  .material-panel {
    position: absolute;
    top: 1rem;
    right: 1rem;
    width: 250px;
    max-height: calc(100% - 3rem);
    overflow: auto;
    background: var(--surface-bg, Canvas);
    color: var(--text-color, currentColor);
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
    z-index: 20;
  }
  .material-panel header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    position: sticky;
    top: 0;
    background: inherit;
  }
  .material-body {
    display: grid;
    gap: 0.5rem;
    padding: 0.6rem;
    font-size: 0.85em;
  }
  .material-body label {
    display: grid;
    gap: 0.2rem;
  }
  .material-body label span {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    opacity: 0.85;
  }
  .material-body label.preset select,
  .material-body label select,
  .material-body label input[type='range'] {
    width: 100%;
  }
  .material-body label.check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .material-body label.check span {
    opacity: 1;
    display: inline;
  }
  .material-body .lighting {
    display: grid;
    gap: 0.5rem;
    border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    padding-top: 0.5rem;
  }
  .material-body .lighting strong {
    font-size: 0.8em;
    opacity: 0.7;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>
