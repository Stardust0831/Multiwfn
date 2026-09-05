import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { cached_plot_resolver, import_plot_document, parse_numeric_plot, plot_data_csv, serialize_plot_document } from '../src/workbench-plots.ts'
import { parse_plot_artifact, plot_title, resolve_plot_scene, type PlotArtifact, type PlotScene } from '../src/plot.ts'

test('imports numeric curves with Fortran exponents without guessing scientific units', async () => {
  const plot = parse_numeric_plot('# Multiwfn curve\nX DOS PDOS\n-1.0D+00 2 3\n0.0 4 5\n1.0 6 7', 'DOS.txt')
  assert.equal(plot.artifact.version, 2)
  const scene = plot.artifact as PlotScene
  assert.equal(scene.semanticKind, 'curve')
  assert.equal(scene.panels[0].axes.x1.unit, undefined)
  const { datasets } = await resolve_plot_scene(scene, plot.resolver)
  assert.deepEqual(Array.from(datasets.get(2)!.y!), [3, 5, 7])
  assert.deepEqual(Array.from(datasets.get(2)!.x!), [-1, 0, 1])
})

test('supports comma-separated tables, descending axes and constant data', async () => {
  const plot = parse_numeric_plot('Frequency,Intensity\n2000,1\n1000,1\n', 'IR.csv')
  const scene = plot.artifact as PlotScene
  assert.equal(scene.panels[0].axes.x1.label, 'Frequency')
  assert.deepEqual(Array.from((await plot.resolver(1)).x!), [2000, 1000])
  assert.ok(scene.panels[0].axes.y1.range[1] > scene.panels[0].axes.y1.range[0])
})

test('rejects incomplete tables, missing values, overflow, binary and raw program logs', async () => {
  for (const text of ['1 2', '1 2\n2 3 4', '1,2\n3,', '1 2\n3 Infinity', '1 2\n3 1e400', '1 2\nerror happened', '1 2\n2 3\n\n3 4']) {
    assert.throws(() => parse_numeric_plot(text, 'bad.txt'))
  }
  await assert.rejects(import_plot_document('\0\x01', 'bad.dat'), /Binary/)
  await assert.rejects(import_plot_document('Gaussian, Inc.\nEntering Link 1\n1 2', 'out.log'))
})

test('self-contained plot documents round-trip without a backend, preserving datasets', async () => {
  const original = { id: 'local', ...parse_numeric_plot('1 2 3\n2 4 6', 'curve') }
  const json = await serialize_plot_document(original)
  const imported = await import_plot_document(json, 'saved.json')
  assert.equal(imported.artifact.title, original.artifact.title)
  assert.equal(imported.artifact.panels.length, original.artifact.panels.length)
  assert.deepEqual(Array.from((await imported.resolver(2)).y!), [3, 6])
  await assert.rejects(import_plot_document(JSON.stringify(JSON.parse(json).plot), 'unresolved.json'), /Missing embedded dataset/)
})

test('validates embedded roles before admitting a document to the workbench', async () => {
  const plot = { id: 'test', ...parse_numeric_plot('1 2\n3 4', 'curve') }
  const document = JSON.parse(await serialize_plot_document(plot))
  document.datasets[1].y[0] = 'not a number'
  await assert.rejects(import_plot_document(JSON.stringify(document), 'bad.json'), /invalid y/)
  document.datasets[1].y = [1]
  await assert.rejects(import_plot_document(JSON.stringify(document), 'bad.json'), /different lengths/)
})

test('caches resolved and in-flight datasets and permits retry after errors', async () => {
  let calls = 0
  const resolver = cached_plot_resolver(async () => {
    calls++
    if (calls === 1) throw new Error('offline')
    return { x: new Float64Array([1]), y: new Float64Array([2]) }
  })
  const first = resolver(1)
  assert.equal(first, resolver(1))
  await assert.rejects(first, /offline/)
  const dataset = await resolver(1)
  assert.equal(dataset, await resolver(1))
  assert.equal(calls, 2)
})

test('exports v1 sticks and reference metadata losslessly, with safe CSV labels', async () => {
  const artifact: PlotArtifact = {
    format: 'multiwfn-matterviz-plot', version: 1, kind: 'nmr', title: 'NMR', panels: [{
      id: 'spectrum', xAxis: { label: 'Shielding', unit: 'ppm', range: [200, 0] },
      yAxis: { label: 'Intensity', range: [0, 2] },
      referenceLines: [{ axis: 'x', value: 100, label: 'Reference' }],
      series: [{ id: 'peaks', label: '=formula', type: 'sticks', x: [4, 8], y: [-1, 1], labels: ['C1', 'C2'] }],
    }],
  }
  const plot = { id: 'nmr', artifact, resolver: async () => ({}) }
  const document = await serialize_plot_document(plot)
  assert.deepEqual((await import_plot_document(document, 'NMR.json')).artifact, parse_plot_artifact(artifact))
  const csv = await plot_data_csv(plot)
  assert.match(csv, /"'=formula"/)
  assert.match(csv, /"y",0,-1/)
})

test('result navigation keeps renderers mounted and preserves original calculation return', () => {
  const app = readFileSync(new URL('../src/App.svelte', import.meta.url), 'utf8')
  assert.match(app, /class:inactive=\{activeResult !== 'scene'\}/)
  assert.match(app, /class:inactive=\{activeResult !== plot.id\}/)
  assert.match(app, /onExported=\{return_to_multiwfn\}/)
  assert.match(app, /scene_registry.get\(canvas\)/)
  assert.doesNotMatch(app, /\{#if plotArtifact\}/)
})

test('replaces only the obsolete DISLIN close instruction, without changing metadata', () => {
  const plot = parse_numeric_plot('1 2\n2 3', 'Click right mouse button to close').artifact
  assert.equal(plot_title(plot), 'Multiwfn plot')
  assert.equal(plot.title, 'Click right mouse button to close')
  assert.equal(plot_title({ ...plot, title: 'C18 anharmonic IR' }), 'C18 anharmonic IR')
})
