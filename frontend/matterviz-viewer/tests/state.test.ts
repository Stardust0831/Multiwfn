import assert from 'node:assert/strict'
import test from 'node:test'
import {
  create_workbench_state,
  parse_workbench_state,
  restore_workbench_state,
} from '../src/state.ts'

test('serializes volume, cross-coloring, and periodic display state', () => {
  const state = create_workbench_state({
    manifest: { periodic: { enabled: true } },
    sourceManifest: 'http://127.0.0.1/session/manifest.json',
    entries: [{ path: 'density.cube', role: 'density' }, { path: 'esp.cube', role: 'esp' }],
    isosurfaceSettings: {
      display_range: [[-1, 2], [0, 1], [0.5, 3]],
      layers: [{
        volume_idx: 0,
        color_volume_idx: 1,
        isovalue: 0.001,
        opacity: 0.8,
        visible: true,
        color: '#123456',
        negative_color: '#654321',
        show_negative: true,
        colormap: 'interpolateRdBu',
        color_range: [-0.05, 0.05],
      }],
    },
    activeVolume: 0,
    atomSupercell: '2x1x1',
    showBoundaryAtoms: true,
    showUnitCell: false,
  })
  assert.equal(state.format, 'multiwfn-matterviz-workbench')
  assert.equal(state.volumes[0].colorVolumeIndex, 1)
  assert.deepEqual(state.volumes[0].colorRange, [-0.05, 0.05])
  assert.equal(state.volumes[0].color, '#123456')
  assert.equal(state.volumes[0].negativeColor, '#654321')
  assert.equal(state.volumes[0].showNegative, true)
  assert.deepEqual(state.periodic?.displayRange, [[-1, 2], [0, 1], [0.5, 3]])
})

test('omits invalid display ranges and clamps the active index', () => {
  const state = create_workbench_state({
    manifest: { periodic: { enabled: true } },
    entries: [],
    isosurfaceSettings: { display_range: [[0, 1], [0, Number.NaN], [0, 1]] },
    activeVolume: 30,
    atomSupercell: '1x1x1',
    showBoundaryAtoms: false,
    showUnitCell: true,
  })
  assert.equal(state.activeVolume, 0)
  assert.equal(state.periodic?.displayRange, undefined)
})

test('round-trips camera state and restores appearance by volume index', () => {
  const exported = create_workbench_state({
    manifest: { periodic: { enabled: true } },
    entries: [{ path: 'density.cube' }, { path: 'esp.cube' }],
    isosurfaceSettings: {
      isovalue: 0.1,
      opacity: 0.9,
      positive_color: '#000',
      negative_color: '#fff',
      show_negative: true,
      wireframe: true,
      material: 'pbr',
      roughness: 0.2,
      metalness: 0.3,
      shininess: 0.4,
      specular: 0.5,
      halo: 0.6,
      layers: [{
        volume_idx: 0,
        isovalue: 0.01,
        opacity: 0.75,
        visible: true,
        color: '#123456',
        negative_color: '#654321',
        show_negative: true,
        color_volume_idx: 1,
      }],
    },
    activeVolume: 1,
    atomSupercell: '2x1x1',
    showBoundaryAtoms: true,
    showUnitCell: false,
    camera: { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1], zoom: 2.5, projection: 'orthographic' },
  })
  const parsed = parse_workbench_state(JSON.parse(JSON.stringify(exported)))
  assert.deepEqual(parsed.camera, exported.camera)
  assert.deepEqual(parsed.periodic, exported.periodic)
  const restored = restore_workbench_state(parsed, {
    entries: [{ path: 'density.cube' }],
    isosurfaceSettings: {
      isovalue: 1,
      opacity: 1,
      positive_color: '#aaa',
      negative_color: '#bbb',
      show_negative: false,
      wireframe: false,
      halo: 0,
      layers: [{ volume_idx: 0, isovalue: 2, opacity: 0.2, visible: false, color: '#000', negative_color: '#111', show_negative: false }],
    },
  })
  assert.equal(restored.activeVolume, 0)
  assert.equal(restored.isosurfaceSettings.layers?.[0].color, '#123456')
  assert.equal(restored.isosurfaceSettings.layers?.[0].negative_color, '#654321')
  assert.equal(restored.isosurfaceSettings.layers?.[0].color_volume_idx, 0)
  assert.equal(restored.isosurfaceSettings.material, 'pbr')
})

test('rejects unsupported state versions and ignores malformed optional fields', () => {
  assert.throws(() => parse_workbench_state({ format: 'other', version: 1, volumes: [] }))
  assert.throws(() => parse_workbench_state({ format: 'multiwfn-matterviz-workbench', version: 2, volumes: [] }))
  const parsed = parse_workbench_state({
    format: 'multiwfn-matterviz-workbench',
    version: 1,
    activeVolume: Number.NaN,
    volumes: [{ path: 'density.cube', volumeIndex: 0, color: 7, colorRange: ['nope', 1], colormap: 'not-a-map' }],
    camera: { position: [1, Number.NaN, 3], projection: 'invalid' },
    periodic: { atomSupercell: '1x1x1', showBoundaryAtoms: true, showUnitCell: false, displayRange: [[0, 1], [0, 1], [0, Number.NaN]] },
  })
  assert.equal(parsed.activeVolume, 0)
  assert.equal(parsed.volumes[0].color, undefined)
  assert.equal(parsed.volumes[0].colormap, undefined)
  assert.equal(parsed.camera, undefined)
  assert.equal(parsed.periodic?.displayRange, undefined)
})

test('ignores malformed camera up and zoom while preserving valid camera fields', () => {
  const parsed = parse_workbench_state({
    format: 'multiwfn-matterviz-workbench',
    version: 1,
    activeVolume: 0,
    volumes: [],
    camera: {
      position: [1, 2, 3],
      target: [0, 0, 0],
      up: [0, Number.NaN, 1],
      zoom: -2,
      projection: 'orthographic',
    },
    session: {},
  })
  assert.deepEqual(parsed.camera, {
    position: [1, 2, 3],
    target: [0, 0, 0],
    up: undefined,
    zoom: undefined,
    projection: 'orthographic',
  })
})

test('preserves every colormap exposed by the layer controls', () => {
  for (const colormap of ['interpolateRdBu', 'interpolateViridis', 'interpolateTurbo', 'interpolateCool', 'interpolateWarm', 'interpolateRdYlGn', 'interpolateGreys']) {
    const parsed = parse_workbench_state({
      format: 'multiwfn-matterviz-workbench',
      version: 1,
      activeVolume: 0,
      volumes: [{ path: 'density.cube', volumeIndex: 0, colormap }],
      session: {},
    })
    assert.equal(parsed.volumes[0].colormap, colormap)
  }
})

test('normalizes reversed persisted color ranges', () => {
  const parsed = parse_workbench_state({
    format: 'multiwfn-matterviz-workbench',
    version: 1,
    activeVolume: 0,
    volumes: [{ path: 'density.cube', volumeIndex: 0, colorRange: [0.2, -0.1] }],
    session: {},
  })
  assert.deepEqual(parsed.volumes[0].colorRange, [-0.1, 0.2])
})

test('round-trips structure appearance and background state', () => {
  const exported = create_workbench_state({
    manifest: {},
    entries: [{ path: 'structure.cif' }],
    isosurfaceSettings: {},
    activeVolume: 0,
    atomSupercell: '1x1x1',
    showBoundaryAtoms: true,
    showUnitCell: true,
    sceneProps: {
      representation_preset: 'wire',
      representation_atom_base: 0.8,
      representation_bond_base: 0.04,
      show_atoms: false,
      show_bonds: 'molecules',
      show_gizmo: false,
      atom_radius: 1.25,
      same_size_atoms: true,
      bond_thickness: 0.2,
      bonding_strategy: 'solid_angle',
      show_site_labels: true,
      show_site_indices: true,
      sphere_segments: 32,
    },
    backgroundColor: '#112233',
    backgroundOpacity: 0.65,
  })
  const expected = {
    representationPreset: 'wire',
    representationAtomBase: 0.8,
    representationBondBase: 0.04,
    showAtoms: false,
    showBonds: 'molecules',
    showGizmo: false,
    atomRadius: 1.25,
    sameSizeAtoms: true,
    bondThickness: 0.2,
    bondingStrategy: 'solid_angle',
    showSiteLabels: true,
    showSiteIndices: true,
    sphereSegments: 32,
    backgroundColor: '#112233',
    backgroundOpacity: 0.65,
  }
  assert.deepEqual(exported.structureAppearance, expected)
  const parsed = parse_workbench_state(JSON.parse(JSON.stringify(exported)))
  assert.deepEqual(parsed.structureAppearance, expected)
  const restored = restore_workbench_state(parsed, { entries: [{ path: 'structure.cif' }], isosurfaceSettings: {} })
  assert.deepEqual(restored.structureAppearance, expected)
})

test('round-trips true and false axes visibility and omits malformed legacy values', () => {
  for (const showGizmo of [true, false]) {
    const parsed = parse_workbench_state({
      format: 'multiwfn-matterviz-workbench',
      version: 1,
      activeVolume: 0,
      volumes: [{ path: 'structure.cif', volumeIndex: 0 }],
      structureAppearance: { showGizmo },
      session: {},
    })
    assert.equal(parsed.structureAppearance?.showGizmo, showGizmo)
  }
  const malformed = parse_workbench_state({
    format: 'multiwfn-matterviz-workbench',
    version: 1,
    activeVolume: 0,
    volumes: [{ path: 'structure.cif', volumeIndex: 0 }],
    structureAppearance: { showGizmo: 'yes' },
    session: {},
  })
  assert.equal(malformed.structureAppearance, undefined)
})

test('clamps bounded structure appearance values and ignores malformed fields', () => {
  const parsed = parse_workbench_state({
    format: 'multiwfn-matterviz-workbench',
    version: 1,
    activeVolume: 0,
    volumes: [{ path: 'structure.cif', volumeIndex: 0 }],
    structureAppearance: {
      representationPreset: 'invalid',
      representationAtomBase: 'bad',
      representationBondBase: Number.POSITIVE_INFINITY,
      showAtoms: 'yes',
      showBonds: 'invalid',
      showGizmo: 'yes',
      show_gizmo: 'no',
      atomRadius: -10,
      same_size_atoms: true,
      bond_thickness: 10,
      bondingStrategy: 'invalid',
      show_site_labels: false,
      showSiteIndices: Number.NaN,
      sphere_segments: 100,
      backgroundColor: '   ',
      background_opacity: -1,
    },
    session: {},
  })
  assert.deepEqual(parsed.structureAppearance, {
    atomRadius: 0.1,
    sameSizeAtoms: true,
    bondThickness: 1,
    showSiteLabels: false,
    sphereSegments: 64,
    backgroundOpacity: 0,
  })
})

test('round-trips slice controls and ESP legend placement', () => {
  const exported = create_workbench_state({
    manifest: {},
    entries: [{ path: 'density.cube' }],
    isosurfaceSettings: {},
    activeVolume: 0,
    atomSupercell: '1x1x1',
    showBoundaryAtoms: true,
    showUnitCell: true,
    slice: {
      open: true,
      plane: 'yz',
      millerIndices: [1, -2, 3],
      position: 0.75,
      resolution: 256,
      colormap: 'RdBu',
      rangeMode: 'manual',
      manualMin: -2,
      manualMax: 4,
    },
    espLegend: { visible: false, position: { left: 42, top: 18 } },
  })
  const parsed = parse_workbench_state(JSON.parse(JSON.stringify(exported)))
  assert.deepEqual(parsed.slice, exported.slice)
  assert.deepEqual(parsed.espLegend, exported.espLegend)
  const restored = restore_workbench_state(parsed, { entries: [{ path: 'density.cube' }], isosurfaceSettings: {} })
  assert.deepEqual(restored.slice, exported.slice)
  assert.deepEqual(restored.espLegend, exported.espLegend)
})

test('normalizes malformed optional slice and legend fields', () => {
  const parsed = parse_workbench_state({
    format: 'multiwfn-matterviz-workbench',
    version: 1,
    activeVolume: 0,
    volumes: [{ path: 'density.cube', volumeIndex: 0 }],
    slice: {
      plane: 'bad',
      millerIndices: [1, Number.NaN, 3],
      position: 4,
      resolution: 999,
      colormap: 'bad',
      rangeMode: 'invalid',
      manualMin: 'nope',
      manualMax: 2,
    },
    espLegend: { visible: 'yes', position: { left: Number.NaN, top: 2 } },
    session: {},
  })
  assert.deepEqual(parsed.slice, { position: 1, resolution: 512, manualMax: 2 })
  assert.equal(parsed.espLegend, undefined)
})
