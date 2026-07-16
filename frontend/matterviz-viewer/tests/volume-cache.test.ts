import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compact_volume_cache,
  orbital_visibility,
  type VolumeCacheState,
} from '../src/volume-cache.ts'
import { loaded_orbital_volume_index } from '../src/orbital.ts'

const volume = (name: string, buffer = new ArrayBuffer(8)) => ({
  name,
  grid: { data: new Float64Array(buffer), dimensions: [1, 1, 1], order: 'x-fastest' },
})

const state = (
  volumes: ReturnType<typeof volume>[],
  entries: VolumeCacheState<ReturnType<typeof volume>>['entries'],
  layers: VolumeCacheState<ReturnType<typeof volume>>['layers'],
  active_volume_idx = 0,
): VolumeCacheState<ReturnType<typeof volume>> => ({ volumes, entries, layers, active_volume_idx })

test('switching orbitals releases the previous orbital and forces a later backend request', () => {
  const orbital12 = volume('MO 12')
  const orbital13 = volume('MO 13')
  const switched = compact_volume_cache(state(
    [orbital12, orbital13],
    [
      { path: '/api/orbital', role: 'orbital', orbitalIndex: 12 },
      { path: '/api/orbital', role: 'orbital', orbitalIndex: 13 },
    ],
    orbital_visibility([
      { volume_idx: 0, visible: true },
      { volume_idx: 1, visible: false },
    ], [
      { path: '/api/orbital', role: 'orbital', orbitalIndex: 12 },
      { path: '/api/orbital', role: 'orbital', orbitalIndex: 13 },
    ], 1),
    1,
  ))

  assert.deepEqual(switched.volumes, [orbital13])
  assert.deepEqual(switched.released_volumes, [orbital12])
  assert.equal(switched.active_volume_idx, 0)
  assert.equal(switched.layers[0]?.volume_idx, 0)
  assert.equal(loaded_orbital_volume_index(switched.entries, 12), undefined)
  assert.equal(loaded_orbital_volume_index(switched.entries, 13), 0)
})

test('orbital switching preserves visible non-orbital data but drops hidden orbitals', () => {
  const density = volume('density')
  const oldOrbital = volume('MO 5')
  const newOrbital = volume('MO 6')
  const entries = [
    { path: 'density.cube', role: 'density' },
    { path: '/api/orbital', role: 'orbital', orbitalIndex: 5 },
    { path: '/api/orbital', role: 'orbital', orbitalIndex: 6 },
  ]
  const layers = orbital_visibility([
    { volume_idx: 0, visible: true },
    { volume_idx: 1, visible: true },
    { volume_idx: 2, visible: false },
  ], entries, 2)
  assert.equal(layers[0]?.visible, true)

  const compacted = compact_volume_cache(state(
    [density, oldOrbital, newOrbital],
    entries,
    layers,
    2,
  ))
  assert.deepEqual(compacted.volumes, [density, newOrbital])
  assert.deepEqual(compacted.released_volumes, [oldOrbital])
  assert.equal(compacted.active_volume_idx, 1)
})

test('retains hidden color and slice sources while referenced, then releases an orphaned source', () => {
  const surface = volume('surface')
  const colors = volume('colors')
  const slice = volume('slice')
  const initial = state(
    [surface, colors, slice],
    [
      { path: 'surface.cube' },
      { path: 'colors.cube' },
      { path: 'slice.cube' },
    ],
    [
      { volume_idx: 0, color_volume_idx: 1, visible: true },
      { volume_idx: 1, visible: false },
      { volume_idx: 2, visible: false },
    ],
    2,
  )
  const retained = compact_volume_cache(initial, { retain_active_volume: true })
  assert.deepEqual(retained.volumes, [surface, colors, slice])

  const deletedOwner = compact_volume_cache(initial, {
    remove_indices: [0],
    retain_active_volume: true,
  })
  assert.deepEqual(deletedOwner.volumes, [slice])
  assert.deepEqual(deletedOwner.released_volumes, [surface, colors])
  assert.equal(deletedOwner.active_volume_idx, 0)
})

test('pruning reindexes surface and color-volume references deterministically', () => {
  const hidden = volume('hidden')
  const colors = volume('colors')
  const surface = volume('surface')
  const compacted = compact_volume_cache(state(
    [hidden, colors, surface],
    [{ path: 'hidden' }, { path: 'colors' }, { path: 'surface' }],
    [
      { volume_idx: 0, visible: false },
      { volume_idx: 1, visible: false },
      { volume_idx: 2, color_volume_idx: 1, visible: true },
    ],
    2,
  ))
  assert.deepEqual(compacted.volumes, [colors, surface])
  assert.deepEqual(compacted.old_to_new, new Map([[1, 0], [2, 1]]))
  assert.deepEqual(compacted.layers, [
    { volume_idx: 0, visible: false },
    { volume_idx: 1, color_volume_idx: 0, visible: true },
  ])
  assert.equal(compacted.active_volume_idx, 1)
})

test('replacement removes the old SharedArrayBuffer view and counts shared backing once', (t) => {
  if (typeof SharedArrayBuffer === 'undefined') {
    t.skip('SharedArrayBuffer is unavailable')
    return
  }
  const shared = new SharedArrayBuffer(16)
  const old = volume('old', shared)
  const alias = volume('alias', shared)
  const replacement = volume('replacement')
  const compacted = compact_volume_cache(state(
    [old, alias, replacement],
    [{ path: 'old' }, { path: 'alias' }, { path: 'replacement' }],
    [
      { volume_idx: 0, visible: false },
      { volume_idx: 1, visible: false },
      { volume_idx: 2, visible: true },
    ],
    2,
  ))
  assert.deepEqual(compacted.volumes, [replacement])
  assert.deepEqual(compacted.released_volumes, [old, alias])
  assert.equal(compacted.released_buffers.size, 1)
  assert.ok(compacted.released_buffers.has(shared))
})
