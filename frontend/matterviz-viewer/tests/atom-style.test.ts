import assert from 'node:assert/strict'
import test from 'node:test'
import { apply_atom_style, ATOM_STYLE_PRESETS, atom_style_values, normalize_atom_style } from '../src/atom-style.ts'
import { create_workbench_state, parse_workbench_state, restore_workbench_state } from '../src/state.ts'

test('TMIM atom presets retain the historical six parameter combinations', () => {
  assert.deepEqual(ATOM_STYLE_PRESETS.map((p) => p.value), ['current', 'goodsell', 'edgy', 'glass', 'metallic', 'matte'])
  assert.deepEqual(ATOM_STYLE_PRESETS.find((p) => p.value === 'current'), { value: 'current', label: 'Balanced', roughness: .5, metalness: .07, opacity: 1, outline: .1, outlineWidth: .6 })
  assert.deepEqual(ATOM_STYLE_PRESETS.find((p) => p.value === 'glass'), { value: 'glass', label: 'Glass', roughness: .05, metalness: 0, opacity: .55, outline: .05, outlineWidth: .6 })
  assert.deepEqual(normalize_atom_style({ atom_roughness: -1, atom_metalness: 3, atom_opacity: '0.4', atom_outline: 2, atom_outline_width: 2 }), { atom_roughness: 0, atom_metalness: 1, atom_opacity: .4, atom_outline: 1, atom_outline_width: 1 })
})

test('TMIM atom appearance persists through a portable workbench snapshot', () => {
  const scene = apply_atom_style({ lighting_rig: 'tmim', scene_tone_mapping: 'none', ambient_light: 1.25, directional_light: 1.55, fill_light: .85, rim_light: .42 }, 'glass')
  const snapshot = create_workbench_state({ manifest: {}, entries: [{ path: 'structure.json' }], activeVolume: 0, atomSupercell: '1x1x1', showBoundaryAtoms: true, showUnitCell: false, isosurfaceSettings: {}, sceneProps: scene })
  const restored = restore_workbench_state(parse_workbench_state(JSON.parse(JSON.stringify(snapshot))), { entries: [{ path: 'structure.json' }], isosurfaceSettings: {} })
  assert.deepEqual(restored.structureAppearance, { ambientLight: 1.25, directionalLight: 1.55, fillLight: .85, rimLight: .42, lightingRig: 'tmim', sceneToneMapping: 'none', atomStyle: 'glass', atomMaterial: 'pbr', atomRoughness: .05, atomMetalness: 0, atomOpacity: .55, atomOutline: .05, atomOutlineWidth: .6 })
  assert.equal(atom_style_values(scene).value, 'glass')
})
