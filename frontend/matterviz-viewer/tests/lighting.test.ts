import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import { createServer } from 'vite'
import { LIGHTING_DEFAULTS, normalize_light_intensity, normalize_lighting } from '../src/lighting.ts'
import { create_workbench_state, parse_workbench_state, restore_workbench_state } from '../src/state.ts'

test('lighting normalization preserves zero, accepts legacy names and bounds finite intensities', () => {
  assert.deepEqual(LIGHTING_DEFAULTS, { ambient_light: 0.72, directional_light: 1.2 })
  assert.deepEqual(normalize_lighting({ ambientLight: 0, directionalLight: '2.4' }), { ambient_light: 0, directional_light: 2.4 })
  assert.deepEqual(normalize_lighting({ ambient_light: -2, directional_light: 10 }), { ambient_light: 0, directional_light: 4 })
  assert.deepEqual(normalize_lighting({ ambientLight: 0, ambient_light: 2 }), { ambient_light: 0 })
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '', ' ', 'bad', true, null, []]) {
    assert.equal(normalize_light_intensity(value), undefined)
    assert.deepEqual(normalize_lighting({ ambient_light: value, directional_light: value }), {})
  }
  assert.deepEqual(normalize_lighting({}), {})
})

test('saved lighting reaches the actual App restoration without changing camera or atom styling', async () => {
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8')
  const start = app.indexOf('    if (restored.structureAppearance) {')
  const end = app.indexOf('    const slice = restored.slice', start)
  assert.ok(start > 0 && end > start)
  const restoreBlock = ts.transpileModule(app.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  const apply = new Function('normalize_lighting', 'restored', 'sceneProps', `
    let showGizmo = true, backgroundColor = '#ffffff', backgroundOpacity = 1;
    ${restoreBlock}
    return sceneProps;
  `)
  const original = {
    camera_position: [2, 3, 4], camera_up: [0, 0, 1], camera_control_mode: 'arcball',
    representation_preset: 'spacefill', atom_radius: 1.4, bond_thickness: 0.08,
    ambient_light: 0.72, directional_light: 1.2,
  }
  for (const intensities of [{ ambient_light: 0, directional_light: 0 }, { ambient_light: 1.25, directional_light: 1.55 }, { ambient_light: 4, directional_light: 4 }]) {
    const snapshot = create_workbench_state({
      manifest: {}, entries: [], activeVolume: 0, atomSupercell: '1x1x1', showBoundaryAtoms: true, showUnitCell: false,
      isosurfaceSettings: { isovalue: 0.025, opacity: 0.65, material: 'pbr', roughness: 0.48 },
      sceneProps: intensities,
    })
    assert.deepEqual(snapshot.structureAppearance, { ambientLight: intensities.ambient_light, directionalLight: intensities.directional_light })
    const parsed = parse_workbench_state(JSON.parse(JSON.stringify(snapshot)))
    const restored = restore_workbench_state(parsed, { entries: [], isosurfaceSettings: { isovalue: 0.025, opacity: 0.65 } })
    assert.deepEqual(restored.structureAppearance, snapshot.structureAppearance)
    const next = apply(normalize_lighting, restored, original)
    assert.deepEqual(next, { ...original, ...intensities })
    assert.equal(next.camera_position, original.camera_position)
    assert.equal(next.camera_up, original.camera_up)
    assert.equal(restored.isosurfaceSettings.isovalue, 0.025)
    assert.equal(restored.isosurfaceSettings.opacity, 0.65)
  }
  const legacy = apply(normalize_lighting, { structureAppearance: { showGizmo: false } }, original)
  assert.equal(legacy.ambient_light, original.ambient_light)
  assert.equal(legacy.directional_light, original.directional_light)
  assert.equal(original.ambient_light, 0.72)
})

test('import and direct restore sanitize lighting while older snapshots retain omitted fields', () => {
  const base = { format: 'multiwfn-matterviz-workbench', version: 1, activeVolume: 0, volumes: [], session: {} }
  for (const appearance of [
    { ambientLight: -5, directionalLight: 20 },
    { ambient_light: '-5', directional_light: '20' },
  ]) {
    const snapshot = { ...base, structureAppearance: appearance }
    assert.deepEqual(parse_workbench_state(snapshot).structureAppearance, { ambientLight: 0, directionalLight: 4 })
    assert.deepEqual(restore_workbench_state(snapshot, { entries: [], isosurfaceSettings: {} }).structureAppearance, { ambientLight: 0, directionalLight: 4 })
  }
  for (const appearance of [{}, { ambientLight: Number.NaN, directionalLight: Number.POSITIVE_INFINITY }]) {
    const snapshot = { ...base, structureAppearance: appearance }
    assert.equal(parse_workbench_state(snapshot).structureAppearance, undefined)
    assert.equal(restore_workbench_state(snapshot, { entries: [], isosurfaceSettings: {} }).structureAppearance, undefined)
  }
  const partial = parse_workbench_state({ ...base, structureAppearance: { directionalLight: 0 } })
  assert.deepEqual(partial.structureAppearance, { directionalLight: 0 })
})

test('Inspector lighting displays current renderer defaults and restored values in Structure', async () => {
  const server = await createServer({ appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } })
  try {
    const { default: Inspector } = await server.ssrLoadModule('/src/ViewerInspector.svelte')
    const { render } = await server.ssrLoadModule('svelte/server')
    const show = (scene_props: Record<string, unknown>) => render(Inspector, { props: { section: 'structure', scene_props, isosurface_settings: {} } }).body
    const defaults = show({})
    assert.match(defaults, /lighting-heading/)
    assert.match(defaults, /Ambient[\s\S]*?0\.72/)
    assert.match(defaults, /Directional[\s\S]*?1\.20/)
    assert.match(defaults, /Reset lighting/)
    const restored = show({ ambient_light: 0, directional_light: 2.4 })
    assert.match(restored, /Ambient[\s\S]*?0\.00/)
    assert.match(restored, /Directional[\s\S]*?2\.40/)
  } finally { await server.close() }
})
