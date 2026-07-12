import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clamp_periodic_bound,
  inject_manifest_lattice,
  supercell_scaling_for_ranges,
} from '../src/periodic.ts'

test('clamps periodic range inputs and rejects missing or non-finite values', () => {
  assert.equal(clamp_periodic_bound(-50), -20)
  assert.equal(clamp_periodic_bound('4.25'), 4.25)
  assert.equal(clamp_periodic_bound(50), 20)
  assert.equal(clamp_periodic_bound(''), undefined)
  assert.equal(clamp_periodic_bound(Number.NaN), undefined)
})
import type { MultiwfnManifest } from '../src/manifest.ts'
import type { AnyStructure, Crystal, Molecule } from 'matterviz/structure'

const molecule = (): Molecule => ({
  sites: [{
    species: [{ element: 'H', occu: 1, oxidation_state: 0 }],
    abc: [0, 0, 0],
    xyz: [1, 1.5, 2],
    label: 'H1',
    properties: { tag: 'keep' },
  }],
})

const manifest_with_cell = (
  cell: { a: number[]; b: number[]; c: number[] },
): MultiwfnManifest => ({ periodic: { enabled: true, cell } })

test('injects an orthogonal manifest lattice and recomputes fractional coordinates', () => {
  const structure = molecule()
  const result = inject_manifest_lattice(
    structure,
    manifest_with_cell({ a: [2, 0, 0], b: [0, 3, 0], c: [0, 0, 4] }),
  )
  assert.deepEqual(result.sites[0].xyz, [1, 1.5, 2])
  assert.deepEqual(result.sites[0].abc, [0.5, 0.5, 0.5])
  assert.deepEqual(result.lattice?.matrix, [[2, 0, 0], [0, 3, 0], [0, 0, 4]])
  assert.deepEqual(result.lattice?.pbc, [true, true, true])
  assert.equal(result.lattice?.a, 2)
  assert.equal(result.lattice?.b, 3)
  assert.equal(result.lattice?.c, 4)
  assert.equal(result.lattice?.volume, 24)
  assert.equal(structure.sites[0].abc[0], 0)
})

test('handles oblique row-vector cells using Cartesian site positions', () => {
  const structure = molecule()
  structure.sites[0].xyz = [1.375, 1.6875, 3]
  const result = inject_manifest_lattice(
    structure,
    manifest_with_cell({ a: [2, 0, 0], b: [1, 3, 0], c: [0.5, 0.25, 4] }),
  )
  assert.deepEqual(result.sites[0].abc, [0.25, 0.5, 0.75])
  assert.equal(result.lattice?.volume, 24)
  assert.ok(Math.abs((result.lattice?.gamma ?? 0) - 71.565051177) < 1e-8)
})

test('leaves existing periodic structures unchanged unless explicitly overridden', () => {
  const existing: Crystal = {
    ...molecule(),
    lattice: {
      matrix: [[5, 0, 0], [0, 5, 0], [0, 0, 5]],
      pbc: [true, true, true],
      a: 5,
      b: 5,
      c: 5,
      alpha: 90,
      beta: 90,
      gamma: 90,
      volume: 125,
    },
  }
  const manifest = manifest_with_cell({ a: [2, 0, 0], b: [0, 3, 0], c: [0, 0, 4] })
  assert.strictEqual(inject_manifest_lattice(existing, manifest), existing)
  const overridden = inject_manifest_lattice(existing, manifest, { override: true })
  assert.notStrictEqual(overridden, existing)
  assert.equal(overridden.lattice?.a, 2)
})

test('rejects malformed and singular cells without changing the structure', () => {
  const structure = molecule()
  const malformed = inject_manifest_lattice(
    structure,
    manifest_with_cell({ a: [1, 0], b: [0, 1, 0], c: [0, 0, 1] }),
  )
  assert.strictEqual(malformed, structure)
  const singular = inject_manifest_lattice(
    structure,
    manifest_with_cell({ a: [1, 0, 0], b: [2, 0, 0], c: [0, 0, 1] }),
  )
  assert.strictEqual(singular, structure)
})

test('maps fractional and negative ranges to integer atom supercells', () => {
  assert.equal(
    supercell_scaling_for_ranges([[0.25, 1.75], [-1.5, 2.25], [0.125, 0.875]]),
    '2x5x1',
  )
  assert.equal(supercell_scaling_for_ranges([[-0.2, 0.2], [1, 1], [2.1, 2.2]]), '2x1x1')
  assert.equal(supercell_scaling_for_ranges(undefined), '1x1x1')
  assert.equal(
    supercell_scaling_for_ranges([[Number.NaN, 1], [0, Number.POSITIVE_INFINITY], [2, -1]]),
    '1x1x3',
  )
})
