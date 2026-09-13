import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createServer } from 'vite'

test('measurement readouts retain ordered, signed and periodic geometry outside the canvas', async () => {
  const server = await createServer({ appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } })
  try {
    const { default: Readout } = await server.ssrLoadModule('/src/MeasurementReadout.svelte')
    const { render } = await server.ssrLoadModule('svelte/server')
    const structure = { sites: [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 0, -1]].map((xyz) => ({ xyz, species: [{ element: 'C', occu: 1 }] })) }
    const show = (sites: number[], mode: string, source = structure, bonds: unknown[] = []) => render(Readout, {
      props: { structure: source, sites, mode, bonds, on_remove_bond() {}, on_clear_selection() {} },
    }).body
    assert.match(show([0, 1], 'distance'), /1\.0000 Å/)
    assert.match(show([0, 1, 2], 'angle'), /90\.0000 °/)
    assert.match(show([0, 1, 2, 3], 'angle'), /-90\.0000 °/)
    assert.match(show([0, 0, 0], 'angle'), /Undefined/)
    assert.doesNotMatch(show([0, 1], 'edit-atoms'), /Geometry measurement/)
    const periodic = { sites: [[0.5, 0, 0], [9.5, 0, 0]].map((xyz) => ({ xyz, species: [{ element: 'C', occu: 1 }] })),
      lattice: { matrix: [[10, 0, 0], [0, 10, 0], [0, 0, 10]], pbc: [true, true, true] } }
    const text = show([0, 1], 'distance', periodic)
    assert.match(text, /1\.0000 Å/)
    assert.match(text, /Direct: 9\.0000 Å/)
    const results = show([], 'distance', structure, [{ key: '1:2:mayer', atoms: 'C1 - C2', method: 'Mayer', value: 1.234567 }])
    assert.match(results, /1\.234567/)
    assert.match(results, /C1 - C2/)
  } finally { await server.close() }
})

test('backend work does not unmount Structure and all numerical readouts have a separate layout row', async () => {
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8')
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  assert.match(app, /bind:loading=\{structureLoading\}/)
  assert.doesNotMatch(app, /bind:loading\s/)
  assert.doesNotMatch(app, /Working\.\.\./)
  assert.match(app, /<div class="calculation-status" role="status">/)
  assert.match(app, /<\/div>\s*\{#if loading \|\| measuredSites.length \|\| bondResults.length\}/)
  assert.match(css, /\.viewer-shell\s*\{[^}]*grid-template-rows: minmax\(0, 1fr\) auto/)
  assert.match(css, /\.scene-viewport \.measure-label\s*\{[^}]*display: none/)
})

test('frontier shortcuts use declared HOMO metadata and scroll only the orbital list', async () => {
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8')
  assert.match(app, /homoIndex = \$derived\(manifest.orbitals\?\.homoIndex \?\? manifest.multiwfnGui\?\.state\?\.homoIndex\)/)
  assert.match(app, /aria-label="Frontier orbitals"/)
  assert.match(app, /data-orbital-index=\{item.index\}/)
  assert.match(app, /list.scrollTop = Math.max/)
  assert.doesNotMatch(app, /scrollIntoView\(/)
})
