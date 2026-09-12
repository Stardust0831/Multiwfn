import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileModule } from 'svelte/compiler'
import { Color } from 'three'
import ts from 'typescript'
import { createServer } from 'vite'
import { ESP_COLORS, ESP_COLORMAP, surface_colormap } from '../src/esp.ts'
import { create_workbench_state, parse_workbench_state, restore_workbench_state } from '../src/state.ts'

test('native control edits survive camera snapshots and accept external reset', async () => {
  const source = await readFile(new URL('../node_modules/matterviz/dist/structure/Structure.svelte', import.meta.url), 'utf8')
  const start = source.indexOf('  $effect.pre(() => {')
  const end = source.indexOf('\n  })', start) + '\n  })'.length
  assert.ok(start > 0 && end > start)
  // Run the installed component's actual synchronization effect with Svelte's
  // reactive runtime, including the parent's snapshot/replacement behavior.
  const fixture = `
    import assert from 'node:assert/strict'
    import { flushSync, untrack } from 'svelte'
    let scene_props = $state({ auto_rotate: 0, camera_control_mode: 'arcball' })
    let scene_props_in = $state({ auto_rotate: 0 })
    let lattice_props = $state({ cell_edge_opacity: 0.5 })
    let lattice_props_in = $state({ cell_edge_opacity: 0.4 })
    const cleanup = $effect.root(() => { ${source.slice(start, end)} })
    flushSync()
    assert.equal(scene_props_in, scene_props)
    assert.equal(lattice_props_in, lattice_props)
    scene_props.auto_rotate = 0.8
    lattice_props.cell_edge_opacity = 0.7
    flushSync()
    for (let frame = 0; frame < 120; frame++) {
      scene_props_in = { ...scene_props_in, camera_position: [frame, 0, 1] }
      flushSync()
      assert.equal(scene_props.auto_rotate, 0.8)
      assert.equal(scene_props_in.auto_rotate, 0.8)
      assert.equal(lattice_props_in.cell_edge_opacity, 0.7)
    }
    scene_props_in = { ...scene_props_in, auto_rotate: 0 }
    flushSync()
    assert.equal(scene_props.auto_rotate, 0)
    scene_props.auto_rotate = 1.2
    flushSync()
    const suspended = scene_props_in.auto_rotate
    scene_props_in = { ...scene_props_in, auto_rotate: 0 }
    flushSync()
    scene_props_in = { ...scene_props_in, auto_rotate: suspended }
    flushSync()
    assert.equal(scene_props.auto_rotate, 1.2)
    cleanup()
  `
  const compiled = compileModule(fixture, { filename: 'camera-sync.svelte.js', generate: 'client' })
  execFileSync(process.execPath, ['--conditions=browser', '--input-type=module', '-e', compiled.js.code], {
    cwd: new URL('..', import.meta.url), timeout: 15000, stdio: 'pipe',
  })
})

test('ESP palette reaches the actual linear-space vertex colors and preserves other maps', async () => {
  const vite = await createServer({
    configFile: false, server: { middlewareMode: true, watch: null, ws: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true },
  })
  try {
    const { get_d3_interpolator } = await vite.ssrLoadModule('/node_modules/matterviz/dist/colors/index.js')
    const { scalars_to_vertex_colors, ISO_COLORMAPS, auto_color_config } = await vite.ssrLoadModule('/node_modules/matterviz/dist/isosurface/coloring.js')
    const interpolate = get_d3_interpolator(ESP_COLORMAP)
    for (const [t, expected] of [[0, ESP_COLORS.negative], [0.5, ESP_COLORS.zero], [1, ESP_COLORS.positive]] as const) {
      assert.equal(interpolate(t), expected)
    }
    assert.equal(interpolate(-1), ESP_COLORS.negative)
    assert.equal(interpolate(2), ESP_COLORS.positive)
    assert.ok(ISO_COLORMAPS.includes(ESP_COLORMAP))
    const colorBar = await readFile(new URL('../node_modules/matterviz/dist/plot/core/components/ColorBar.svelte', import.meta.url), 'utf8')
    assert.match(colorBar, /func_name === `interpolateTransFlag` \|\| func_name in d3_sc/)
    assert.match(colorBar, /interpolator = get_d3_interpolator\(func_name as D3InterpolateName\)/)
    const out = new Float32Array(9)
    const colors = scalars_to_vertex_colors(new Float32Array([-1, 0, 1]), { colormap: ESP_COLORMAP, color_range: [-1, 1] }, out)
    assert.equal(colors, out)
    for (const [idx, css] of [ESP_COLORS.negative, ESP_COLORS.zero, ESP_COLORS.positive].entries()) {
      const expected = new Color(css).toArray()
      expected.forEach((channel, channelIdx) => assert.ok(Math.abs(colors[3 * idx + channelIdx] - channel) < 1e-7))
    }
    assert.equal(auto_color_config({ min: -1, max: 1, abs_max: 1 }).colormap, 'interpolateRdBu')
    assert.equal(surface_colormap({ path: '/api/volume/2', analysisKind: 'esp-potential' }, 'interpolateRdBu'), ESP_COLORMAP)
    assert.equal(surface_colormap({ path: 'generic.cube' }, 'interpolateViridis'), 'interpolateViridis')
  } finally {
    await vite.close()
  }
})

test('Trans Flag ESP mapping round-trips through workbench state', () => {
  const entries = [
    { path: 'density.cube', analysisKind: 'esp-density' },
    { path: 'potential.cube', analysisKind: 'esp-potential' },
  ]
  const state = create_workbench_state({
    manifest: {}, entries, activeVolume: 0, atomSupercell: '1x1x1',
    showBoundaryAtoms: false, showUnitCell: false,
    isosurfaceSettings: { layers: [{ volume_idx: 0, color_volume_idx: 1, colormap: ESP_COLORMAP, color_range: [-0.05, 0.05] }] },
  })
  const parsed = parse_workbench_state(JSON.parse(JSON.stringify(state)))
  const restored = restore_workbench_state(parsed, { entries, isosurfaceSettings: { layers: [{ volume_idx: 0 }, { volume_idx: 1 }] } })
  assert.equal(restored.isosurfaceSettings.layers?.[0].colormap, ESP_COLORMAP)
  assert.deepEqual(restored.isosurfaceSettings.layers?.[0].color_range, [-0.05, 0.05])
  state.volumes[0].colormap = 'not-a-colormap'
  assert.equal(parse_workbench_state(state).volumes[0].colormap, undefined)
})

test('direct signed ESP surfaces use the same sign colors as mapped ESP', async () => {
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8')
  const start = app.indexOf('  const layer_for_entry =')
  const end = app.indexOf('\n  const parse_volume_entry', start)
  assert.ok(start > 0 && end > start)
  const declaration = ts.transpileModule(app.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  const createLayer = new Function('ESP_COLORS', `${declaration}; return layer_for_entry`)(ESP_COLORS)
  const esp = createLayer({ mode: 'signed', analysisKind: 'esp-potential' }, 1)
  assert.equal(esp.color, ESP_COLORS.positive)
  assert.equal(esp.negative_color, ESP_COLORS.negative)
  assert.equal(esp.show_negative, true)
  const generic = createLayer({ mode: 'signed' }, 0)
  assert.equal(generic.color, '#2563eb')
  assert.equal(generic.negative_color, '#dc2626')
})
