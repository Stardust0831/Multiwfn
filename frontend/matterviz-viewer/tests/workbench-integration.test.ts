import assert from 'node:assert/strict'
import test from 'node:test'
import type { IsosurfaceLayer, IsosurfaceSettings } from 'matterviz'
import { ESP_COLORMAP, surface_colormap } from '../src/esp.ts'
import { normalize_lighting } from '../src/lighting.ts'
import { normalize_surface_appearance, SURFACE_DEFAULTS } from '../src/material.ts'
import { create_workbench_state, parse_workbench_state, restore_workbench_state } from '../src/state.ts'

test('one workbench snapshot preserves topology, material, lighting, camera and cross-volume coloring together', () => {
  const entries = [
    { path: '/api/volume/11', analysisKind: 'esp-density', format: 'mwfn-volume-v1' },
    { path: '/api/volume/12', analysisKind: 'esp-potential', format: 'mwfn-volume-v1' },
    { path: '/api/volume/15', role: 'orbital', orbitalIndex: 42, format: 'mwfn-volume-v1' },
  ]
  const layer = (volume_idx: number): IsosurfaceLayer => ({
    volume_idx, isovalue: 0.02, opacity: 0.8, visible: true,
    color: '#2563eb', negative_color: '#dc2626', show_negative: true,
  })
  // Layer ordering is independent of volume indices, as it can be after restoring
  // or editing the workbench. ESP coloring must retain its potential-volume link.
  const settings: IsosurfaceSettings = {
    ...SURFACE_DEFAULTS,
    isovalue: 0.02, opacity: 0.8, positive_color: '#2563eb', negative_color: '#dc2626', show_negative: true,
    material: 'pbr', roughness: 0.46, metalness: 0.08, outline: 0.2, outlineWidth: 0.45, transmode: 1,
    display_range: [[-0.5, 1.5], [0, 1], [0, 1]],
    layers: [
      { ...layer(2), isovalue: 0.045, opacity: 0.72 },
      { ...layer(0), isovalue: 0.001, opacity: 0.6, color_volume_idx: 1,
        colormap: surface_colormap(entries[1], 'interpolateViridis'), color_range: [-0.05, 0.2], show_negative: false },
      { ...layer(1), visible: false },
    ],
  }
  const camera = {
    position: [4, -3, 2] as [number, number, number], target: [0.1, 0.2, 0.3] as [number, number, number],
    up: [0.2, 0.9, -0.3] as [number, number, number], zoom: 1.7, projection: 'orthographic' as const,
  }
  const topologyDisplay = {
    cpTypes: [false, true, true, false, true], pathTypes: [false, true, false, true],
    labels: true, radius: 0.14, width: 3.5,
  }
  const source = {
    manifest: { periodic: { enabled: true } }, sourceManifest: 'http://127.0.0.1/session/manifest.json',
    entries, isosurfaceSettings: settings, activeVolume: 2,
    atomSupercell: '2x1x1', showBoundaryAtoms: false, showUnitCell: true,
    sceneProps: { ambient_light: 0, directional_light: 2.35 }, camera, topologyDisplay,
    espLegend: { visible: true, position: { left: 24, top: 36 } },
  }
  const snapshot = create_workbench_state(source)
  const parsed = parse_workbench_state(JSON.parse(JSON.stringify(snapshot)))
  const current: IsosurfaceSettings = {
    ...settings, ...SURFACE_DEFAULTS,
    layers: [layer(1), layer(2), layer(0)],
  }
  const currentBefore = structuredClone(current)
  const restored = restore_workbench_state(parsed, { entries, isosurfaceSettings: current })
  const restoredLayers = new Map(restored.isosurfaceSettings.layers?.map((item) => [item.volume_idx, item]))
  assert.deepEqual(restored.topologyDisplay, topologyDisplay)
  assert.deepEqual(normalize_surface_appearance(restored.isosurfaceSettings), normalize_surface_appearance(settings))
  assert.deepEqual(normalize_lighting(restored.structureAppearance), source.sceneProps)
  assert.deepEqual(restored.camera, camera)
  assert.equal(restored.activeVolume, 2)
  for (const original of settings.layers!) assert.deepEqual(restoredLayers.get(original.volume_idx), original)
  assert.equal(restoredLayers.get(0)?.color_volume_idx, 1)
  assert.equal(restoredLayers.get(0)?.colormap, ESP_COLORMAP)
  assert.deepEqual(parsed.volumes.map((volume) => volume.path), entries.map((entry) => entry.path))
  assert.deepEqual(current, currentBefore, 'restore must not mutate the currently displayed layers')

  // Saving the combined restoration again must produce the same portable state,
  // despite the different layer ordering and the changed current renderer defaults.
  const resaved = create_workbench_state({
    ...source, isosurfaceSettings: restored.isosurfaceSettings, activeVolume: restored.activeVolume,
    sceneProps: normalize_lighting(restored.structureAppearance), camera: restored.camera,
    topologyDisplay: restored.topologyDisplay, espLegend: restored.espLegend,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(resaved)), JSON.parse(JSON.stringify(snapshot)))
})
