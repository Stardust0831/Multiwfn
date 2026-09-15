import assert from 'node:assert/strict'
import test from 'node:test'
import {
  apply_surface_preset,
  detect_surface_preset,
  normalize_surface_appearance,
  normalize_surface_number,
  SURFACE_PRESETS,
  type SurfacePreset,
} from '../src/material.ts'
import { create_workbench_state, parse_workbench_state, restore_workbench_state } from '../src/state.ts'

// Original MaterialPanel PRESETS from commit 861d59be68be7efc568f919fcdc5e2c7466e14e2.
// Keep this independent fixture so changing or dropping a legacy combination is visible.
const ORIGINAL_PRESETS = {
  Matte: { material: 'matte', outline: 0, outlineWidth: 0.6, transmode: 0 },
  Diffuse: { material: 'matte', outline: 0, outlineWidth: 0.6, transmode: 0 },
  Goodsell: { material: 'matte', roughness: 0.7, metalness: 0, shininess: 18, specular: 0.12, outline: 0, outlineWidth: 0.6, transmode: 0 },
  Edgy: { material: 'glossy', shininess: 50, specular: 0.5, outline: 0.5, outlineWidth: 0.9, transmode: 0 },
  EdgyShiny: { material: 'glossy', shininess: 70, specular: 0.85, outline: 0.6, outlineWidth: 0.92, transmode: 0 },
  AOShiny: { material: 'glossy', shininess: 45, specular: 0.55, outline: 0.15, outlineWidth: 0.7, transmode: 0 },
  AOChalky: { material: 'glossy', shininess: 20, specular: 0.2, outline: 0.1, outlineWidth: 0.6, transmode: 0 },
  Glass1: { material: 'glossy', shininess: 55, specular: 0.65, outline: 0.05, outlineWidth: 0.6, transmode: 1 },
  GlassBubble: { material: 'glossy', shininess: 90, specular: 0.95, outline: 0.05, outlineWidth: 0.6, transmode: 1 },
  EdgyGlass: { material: 'glossy', shininess: 70, specular: 0.6, outline: 0.5, outlineWidth: 0.9, transmode: 1 },
  BrushedMetal: { material: 'pbr', metalness: 0.75, roughness: 0.35, specular: 0.3, outline: 0.05, outlineWidth: 0.6, transmode: 0 },
  Metallic: { material: 'pbr', metalness: 0.8, roughness: 0.28, specular: 0.3, outline: 0.05, outlineWidth: 0.6, transmode: 0 },
  PBR: { material: 'pbr', metalness: 0.2, roughness: 0.5, specular: 0.2, outline: 0.15, outlineWidth: 0.6, transmode: 0 },
  Unlit: { material: 'unlit', outline: 0, outlineWidth: 0.6, transmode: 0 },
} as const

const effective_preset = (preset: SurfacePreset): SurfacePreset =>
  preset === 'diffuse' || preset === 'goodsell' ? 'matte' : preset

const settings = {
  isovalue: 0.045,
  opacity: 0.7,
  positive_color: '#3177ba',
  negative_color: '#ce5588',
  show_negative: true,
  wireframe: true,
  flat_shading: true,
  halo: 0.2,
  outline: 0.5,
  outlineWidth: 0.4,
  transmode: 1,
  display_range: [[-0.2, 1.3], [0, 1], [0, 1]],
  geometry_memory_budget_bytes: 1024,
  layers: [{
    volume_idx: 0,
    isovalue: 0.013,
    opacity: 0.45,
    color: '#2c70a2',
    negative_color: '#ab538f',
    visible: true,
    show_negative: true,
    color_volume_idx: 1,
    colormap: 'interpolateTransFlag',
    color_range: [-0.05, 0.05],
  }],
}

test('surface presets preserve scientific settings, colors, and geometry references', () => {
  const original = structuredClone(settings)
  for (const preset of SURFACE_PRESETS) {
    const next = apply_surface_preset(settings, preset.value)
    assert.equal(detect_surface_preset(next), effective_preset(preset.value))
    for (const key of ['isovalue', 'opacity', 'positive_color', 'negative_color', 'show_negative', 'halo', 'geometry_memory_budget_bytes'] as const) {
      assert.equal(next[key], settings[key], `${preset.value}: ${key}`)
    }
    assert.equal(next.layers, settings.layers)
    assert.equal(next.display_range, settings.display_range)
    assert.equal(next.wireframe, false)
    assert.equal(next.flat_shading, false)
    assert.equal(next.outline, preset.appearance.outline)
    assert.equal(next.transmode, preset.appearance.transmode)
  }
  assert.deepEqual(settings, original)
})

test('all original MaterialPanel combinations retain every original parameter and name', () => {
  assert.deepEqual(SURFACE_PRESETS.filter((preset) => !preset.group).map((preset) => preset.value), ['matte', 'soft-gloss', 'satin', 'unlit'])
  const legacyNames = Object.keys(ORIGINAL_PRESETS).filter((name) => name !== 'Matte' && name !== 'Unlit')
  assert.deepEqual(SURFACE_PRESETS.filter((preset) => preset.group === 'legacy').map((preset) => preset.label), legacyNames)
  assert.equal(new Set(SURFACE_PRESETS.map((preset) => preset.value)).size, SURFACE_PRESETS.length)
  for (const [name, original] of Object.entries(ORIGINAL_PRESETS)) {
    const preset = SURFACE_PRESETS.find((item) => name === 'Unlit' ? item.value === 'unlit' : item.label === name)
    assert.ok(preset, name)
    assert.deepEqual(preset.appearance, { wireframe: false, flat_shading: false, ...original }, name)
    const next = apply_surface_preset(settings, preset.value)
    for (const [key, value] of Object.entries(original)) assert.equal(next[key], value, `${name}: ${key}`)
  }
})

test('preset selection follows active renderer values after manual refinement', () => {
  assert.equal(detect_surface_preset({}), 'matte')
  const satin = apply_surface_preset(settings, 'satin')
  assert.equal(detect_surface_preset({ ...satin, shininess: 117, specular: 0.9 }), 'satin')
  assert.equal(detect_surface_preset({ ...satin, roughness: 0.5 }), 'custom')
  assert.equal(detect_surface_preset({ ...satin, flat_shading: true }), 'custom')
  assert.equal(detect_surface_preset({ ...satin, wireframe: true }), 'custom')
  assert.equal(detect_surface_preset({ ...satin, outline: 0.2 }), 'custom')
  assert.equal(detect_surface_preset({ ...satin, outlineWidth: 0.1 }), 'satin')
  const unlit = apply_surface_preset(settings, 'unlit')
  assert.equal(detect_surface_preset({ ...unlit, outline: 1, flat_shading: true, transmode: 1 }), 'unlit')
})

test('legacy detection ignores inactive parameters and canonicalizes equivalent matte finishes', () => {
  for (const name of ['diffuse', 'goodsell'] as const) {
    const matte = apply_surface_preset(settings, name)
    assert.equal(detect_surface_preset({ ...matte, roughness: 0.12, metalness: 0.9, shininess: 119, specular: 0.99 }), 'matte')
  }
  for (const name of ['brushed-metal', 'metallic', 'pbr'] as const) {
    const pbr = apply_surface_preset(settings, name)
    assert.equal(detect_surface_preset({ ...pbr, shininess: 117, specular: 0.91 }), name)
    assert.equal(detect_surface_preset({ ...pbr, roughness: 0.91 }), 'custom')
  }
  for (const preset of SURFACE_PRESETS.filter((item) => item.group === 'legacy' && item.appearance.material === 'glossy')) {
    const glossy = apply_surface_preset(settings, preset.value)
    assert.equal(detect_surface_preset({ ...glossy, roughness: 0.91, metalness: 0.92 }), preset.value)
    assert.equal(detect_surface_preset({ ...glossy, shininess: 119 }), 'custom')
  }
})

test('appearance normalization rejects nonfinite data and clamps renderer limits', () => {
  assert.deepEqual(normalize_surface_appearance({
    material: 'unlit', wireframe: false, flat_shading: true,
    roughness: -2, metalness: 9, shininess: '999', specular: '-4', halo: '2',
    outline: 2, outlineWidth: -1, transmode: 1,
    layers: settings.layers, isovalue: 4,
  }), {
    material: 'unlit', wireframe: false, flat_shading: true,
    roughness: 0, metalness: 1, shininess: 120, specular: 0, halo: 1,
    outline: 1, outlineWidth: 0, transmode: 1,
  })
  assert.deepEqual(normalize_surface_appearance({
    material: 'unknown', wireframe: 'true', flat_shading: 1,
    roughness: Number.NaN, metalness: Number.POSITIVE_INFINITY,
    shininess: Number.NEGATIVE_INFINITY, specular: '', halo: null,
    outline: true, outlineWidth: [], transmode: 2,
  }), {})
  assert.equal(normalize_surface_number('shininess', -10), 1)
  assert.equal(normalize_surface_number('roughness', '   '), undefined)
})

test('every finish survives JSON save and restore with camera and layer styling intact', () => {
  const camera = { position: [1, 2, 3], target: [0.2, 0.3, 0.4], up: [0.1, 0.9, 0.2], zoom: 1.4, projection: 'orthographic' }
  const entries = [{ path: 'density.cube' }, { path: 'esp.cube' }]
  for (const preset of SURFACE_PRESETS) {
    const styled = apply_surface_preset(settings, preset.value)
    const snapshot = create_workbench_state({
      manifest: {}, entries, isosurfaceSettings: styled, activeVolume: 1,
      atomSupercell: '1x1x1', showBoundaryAtoms: true, showUnitCell: false, camera,
    })
    const parsed = parse_workbench_state(JSON.parse(JSON.stringify(snapshot)))
    const restored = restore_workbench_state(parsed, { entries, isosurfaceSettings: settings })
    assert.equal(detect_surface_preset(restored.isosurfaceSettings), effective_preset(preset.value))
    assert.deepEqual(normalize_surface_appearance(restored.isosurfaceSettings), normalize_surface_appearance(styled))
    assert.deepEqual(restored.camera, camera)
    assert.deepEqual(restored.isosurfaceSettings.layers, settings.layers)
    assert.equal(restored.isosurfaceSettings.halo, settings.halo)
    assert.equal(restored.isosurfaceSettings.flat_shading, false)
    assert.equal(restored.activeVolume, 1)
  }
})

test('legacy workbench snapshots restore material combinations without storing preset markers', () => {
  for (const [name, appearance] of Object.entries(ORIGINAL_PRESETS)) {
    const preset = SURFACE_PRESETS.find((item) => name === 'Unlit' ? item.value === 'unlit' : item.label === name)!
    const parsed = parse_workbench_state({
      format: 'multiwfn-matterviz-workbench', version: 1, activeVolume: 0, volumes: [], session: {},
      isosurface: { ...appearance, wireframe: false, flatShading: false },
    })
    const restored = restore_workbench_state(parsed, { entries: [], isosurfaceSettings: settings })
    assert.equal(detect_surface_preset(restored.isosurfaceSettings), effective_preset(preset.value), name)
    for (const [key, value] of Object.entries(appearance)) assert.equal(restored.isosurfaceSettings[key], value, `${name}: ${key}`)
    assert.equal('preset' in parsed.isosurface!, false)
    assert.equal('preset' in restored.isosurfaceSettings, false)
  }
})
