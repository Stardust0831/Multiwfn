import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { AnyStructure } from 'matterviz'
import { analysis_structure_key } from '../src/analysis-structure.ts'

const fixture = () => ({
  sites: [{ xyz: [0, 0, 0], species: [{ element: 'C', occu: 1 }], label: 'Carbon', properties: {} }],
  lattice: { matrix: [[5, 0, 0], [0, 5, 0], [0, 0, 5]], pbc: [true, true, true] },
  charge: 0,
})
const key = (value: unknown) => analysis_structure_key(value as AnyStructure)

test('analysis identity includes coordinates, elements, occupancies, cell, periodicity and charge', () => {
  const original = fixture()
  const expected = key(original)
  for (const edit of [
    (s: ReturnType<typeof fixture>) => { s.sites[0].xyz[0] = 1 },
    (s: ReturnType<typeof fixture>) => { s.sites[0].species[0].element = 'O' },
    (s: ReturnType<typeof fixture>) => { s.sites[0].species[0].occu = .5 },
    (s: ReturnType<typeof fixture>) => { s.sites.push(structuredClone(s.sites[0])) },
    (s: ReturnType<typeof fixture>) => { s.lattice.matrix[0][0] = 6 },
    (s: ReturnType<typeof fixture>) => { s.lattice.pbc[0] = false },
    (s: ReturnType<typeof fixture>) => { s.charge = 1 },
  ]) {
    const changed = structuredClone(original)
    edit(changed)
    assert.notEqual(key(changed), expected)
  }
  assert.equal(analysis_structure_key(undefined), '')
})

test('display labels, properties, derived cell dimensions and species ordering do not invalidate analysis', () => {
  const original = fixture()
  original.sites[0].species.push({ element: 'N', occu: .5 })
  const changed = structuredClone(original)
  changed.sites[0].label = 'site 1'
  changed.sites[0].properties = { color: 'red', selected: true }
  changed.sites[0].species.reverse()
  Object.assign(changed.lattice, { a: 5, volume: 125 })
  assert.equal(key(changed), key(original))
})

test('native readiness follows both scene and plot loading', async () => {
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8')
  const load = app.slice(app.indexOf('async function load_manifest()'), app.indexOf('function show_orbital'))
  assert.ok(load.indexOf('await signal_frontend_ready()') > load.indexOf('await load_surface('))
  assert.match(load, /await signal_frontend_ready\(\)\s*\} catch/)
})
