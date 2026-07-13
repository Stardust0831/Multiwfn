import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, type ViteDevServer } from 'vite'
import type { AnyStructure } from 'matterviz'

let server: ViteDevServer
let parse_any_structure: (content: string, filename: string) => AnyStructure

test.before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  const parser = await server.ssrLoadModule('matterviz/structure/parse')
  parse_any_structure = parser.parse_any_structure
})

test.after(async () => {
  await server.close()
})

type NativeSite = {
  species: [{ element: string; occu: number; oxidation_state: number }]
  abc: [number, number, number]
  xyz: [number, number, number]
  label: string
  properties: Record<string, unknown>
}

const site = (
  element: string,
  label: string,
  xyz: [number, number, number],
  abc: [number, number, number] = xyz,
): NativeSite => ({
  species: [{ element, occu: 1, oxidation_state: 0 }],
  abc,
  xyz,
  label,
  properties: {},
})

test('parses native nonperiodic JSON and preserves explicit root bond orders', () => {
  const bonds = [
    { site_idx_1: 0, site_idx_2: 1, order: 1 as const },
    { site_idx_1: 1, site_idx_2: 2, order: 2 as const },
    { site_idx_1: 0, site_idx_2: 3, order: 'aromatic' as const },
  ]
  const native = {
    sites: [
      site('C', 'C1', [0, 0, 0]),
      site('C', 'C2', [1.54, 0, 0]),
      site('O', 'O1', [2.74, 0, 0]),
      site('C', 'C3', [0.77, 1.33, 0]),
    ],
    charge: 0,
    properties: { bonds },
  }

  const parsed = parse_any_structure(JSON.stringify(native), 'structure.json')

  assert.equal(parsed.charge, 0)
  assert.equal('lattice' in parsed, false)
  assert.deepEqual(parsed.sites.map((item) => item.species[0]?.element), ['C', 'C', 'O', 'C'])
  assert.deepEqual(parsed.properties?.bonds, bonds)
})

test('parses native periodic JSON and round-trips the lattice matrix', () => {
  const native = {
    sites: [
      site('Si', 'Si1', [0, 0, 0]),
      site('O', 'O1', [2, 2.5, 3], [0.5, 0.5, 0.5]),
    ],
    charge: 0,
    lattice: {
      matrix: [[4, 0, 0], [0, 5, 0], [0, 0, 6]],
      pbc: [true, true, true],
    },
    properties: {
      bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 1 as const }],
    },
  }

  const parsed = parse_any_structure(JSON.stringify(native), 'structure.json')

  assert.ok('lattice' in parsed && parsed.lattice)
  assert.deepEqual(parsed.lattice.matrix, native.lattice.matrix)
  assert.deepEqual(parsed.lattice.pbc, [true, true, true])
  assert.equal(parsed.lattice.a, 4)
  assert.equal(parsed.lattice.b, 5)
  assert.equal(parsed.lattice.c, 6)
  assert.equal(parsed.lattice.volume, 120)
  assert.deepEqual(parsed.sites[1]?.abc, [0.5, 0.5, 0.5])
  assert.deepEqual(parsed.sites[1]?.xyz, [2, 2.5, 3])
  assert.deepEqual(parsed.properties?.bonds, native.properties.bonds)
})

test('preserves a labeled Multiwfn ghost center without mapping it to a real element', () => {
  const native = {
    sites: [{
      species: [{ element: 'Bq', occu: 1, oxidation_state: 0 }],
      abc: [0, 0, 0],
      xyz: [1, 2, 3],
      label: 'Bq1',
      properties: { multiwfnGhost: true },
    }],
    charge: 0,
    properties: { bonds: [] },
  }

  const parsed = parse_any_structure(JSON.stringify(native), 'structure.json')

  assert.equal(parsed.sites[0]?.species[0]?.element, 'Bq')
  assert.equal(parsed.sites[0]?.properties?.multiwfnGhost, true)
  assert.deepEqual(parsed.sites[0]?.xyz, [1, 2, 3])
})
