import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ORBITAL_GRID_QUALITY_LEVELS,
  exclusive_volume_visibility,
  initial_orbital_volume_index,
  loaded_orbital_volume_index,
  normalize_orbital_isovalue,
  orbital_frontier_label,
  visible_orbital_index,
} from '../src/orbital.ts'

const entry = (path: string, role?: string, orbitalIndex?: number) => ({ path, role, orbitalIndex })

test('selects the HOMO volume before other orbital and generic volumes', () => {
  const entries = [
    entry('density.cube', 'density'),
    entry('orb4.cube', 'orbital', 4),
    entry('orb5.cube', 'orbital', 5),
  ]
  assert.equal(initial_orbital_volume_index(entries, 5), 2)
})

test('falls back from a missing HOMO to the first orbital and then first volume', () => {
  const orbitals = [entry('density.cube', 'density'), entry('orb4.cube', 'Orbital', 4)]
  assert.equal(initial_orbital_volume_index(orbitals, 9), 1)
  assert.equal(initial_orbital_volume_index([entry('density.cube', 'density')], 9), 0)
  assert.equal(initial_orbital_volume_index([], 9), undefined)
})

test('finds cached orbitals by exact positive integer index', () => {
  const entries = [
    entry('orb4-a.cube', 'orbital', 4),
    entry('orb4-b.cube', 'orbital', 4),
    entry('orb5.cube', 'orbital', 5),
  ]
  assert.equal(loaded_orbital_volume_index(entries, 4), 0)
  assert.equal(loaded_orbital_volume_index(entries, 5), 2)
  assert.equal(loaded_orbital_volume_index(entries, 0), undefined)
  assert.equal(loaded_orbital_volume_index(entries, 4.5), undefined)
  assert.equal(loaded_orbital_volume_index(entries, 'missing'), undefined)
})

test('makes exactly one volume visible without changing other layer settings', () => {
  const layers = [
    { volume_idx: 2, visible: true, opacity: 0.2 },
    { volume_idx: 0, visible: false, opacity: 0.7 },
    { volume_idx: 1, opacity: 1 },
  ]
  assert.deepEqual(exclusive_volume_visibility(layers, 1), [
    { volume_idx: 2, visible: false, opacity: 0.2 },
    { volume_idx: 0, visible: false, opacity: 0.7 },
    { volume_idx: 1, visible: true, opacity: 1 },
  ])
  assert.deepEqual(exclusive_volume_visibility(layers, undefined).map((layer) => layer.visible), [false, false, false])
})

test('retains the full original GUI orbital grid precision range', () => {
  assert.deepEqual([...ORBITAL_GRID_QUALITY_LEVELS], [25000, 50000, 120000, 300000, 500000, 1000000, 1500000])
})

test('normalizes orbital isovalues to the original GUI input bounds', () => {
  assert.equal(normalize_orbital_isovalue(0.05), 0.05)
  assert.equal(normalize_orbital_isovalue(-0.02), 0.02)
  assert.equal(normalize_orbital_isovalue(1), 0.3)
  assert.equal(normalize_orbital_isovalue('bad', 0.015), 0.015)
})

test('labels frontier orbitals only for explicitly closed-shell sessions', () => {
  assert.equal(orbital_frontier_label(42, 42, false), 'HOMO')
  assert.equal(orbital_frontier_label(43, 42, false), 'LUMO')
  assert.equal(orbital_frontier_label(42, 42, true), '')
  assert.equal(orbital_frontier_label(42, 42, undefined), '')
  assert.equal(orbital_frontier_label(42, 0, false), '')
})

test('restores a visible orbital after a preceding visible non-orbital layer', () => {
  const entries = [
    entry('density.cube', 'density'),
    entry('/api/orbital', 'orbital', 12),
    entry('/api/orbital', 'orbital', 13),
  ]
  assert.equal(visible_orbital_index(entries, [
    { volume_idx: 0, visible: true },
    { volume_idx: 1, visible: true },
    { volume_idx: 2, visible: false },
  ]), 12)
  assert.equal(visible_orbital_index(entries, [
    { volume_idx: 0, visible: true },
    { volume_idx: 1, visible: false },
  ]), undefined)
})
