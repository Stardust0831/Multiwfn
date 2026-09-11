import assert from 'node:assert/strict'
import test from 'node:test'
import {
  apply_surface_preset,
  detect_surface_preset,
  normalize_surface_appearance,
  normalize_surface_number,
  SURFACE_PRESETS,
} from '../src/material.ts'
import { create_workbench_state, parse_workbench_state, restore_workbench_state } from '../src/state.ts'

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
    assert.equal(detect_surface_preset(next), preset.value)
    for (const key of ['isovalue', 'opacity', 'positive_color', 'negative_color', 'show_negative', 'halo', 'geometry_memory_budget_bytes'] as const) {
      assert.equal(next[key], settings[key], `${preset.value}: ${key}`)
    }
    assert.equal(next.layers, settings.layers)
    assert.equal(next.display_range, settings.display_range)
    assert.equal(next.wireframe, false)
    assert.equal(next.flat_shading, false)
    assert.equal(next.outline, 0)
    assert.equal(next.transmode, 0)
  }
  assert.deepEqual(settings, original)
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
    assert.equal(detect_surface_preset(restored.isosurfaceSettings), preset.value)
    assert.deepEqual(restored.camera, camera)
    assert.deepEqual(restored.isosurfaceSettings.layers, settings.layers)
    assert.equal(restored.isosurfaceSettings.halo, settings.halo)
    assert.equal(restored.isosurfaceSettings.flat_shading, false)
    assert.equal(restored.activeVolume, 1)
  }
})
