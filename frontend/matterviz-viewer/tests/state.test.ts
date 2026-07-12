import assert from 'node:assert/strict'
import test from 'node:test'
import { create_workbench_state } from '../src/state.ts'

test('serializes volume, cross-coloring, and periodic display state', () => {
  const state = create_workbench_state({
    manifest: { periodic: { enabled: true }, analysis: { primaryDos: { path: 'dos.json' } } },
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
        colormap: 'coolwarm',
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
  assert.equal(state.session.analysis?.primaryDos?.path, 'dos.json')
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
