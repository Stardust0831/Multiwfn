import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse_surface_metadata, resolve_surface, surface_statistics, surface_document, surface_csv, surface_function, surface_color, surface_position, surface_range, surface_render_indices, type SurfaceMetadata } from '../src/surface-analysis.ts'
import { parse_surface_log, SURFACE_LOG_LIMIT } from '../src/surface-log.ts'

const metadata = (): SurfaceMetadata => ({ version: 1, coordinateUnit: 'bohr', vertices: 1, facets: 2, extrema: 3, surfaceType: 1, mappedFunction: 1, mapped: true, isovalue: .001, volume: 10, massDensity: .8, bohrToAngstrom: .529177210903, hartreeToKcal: 627.509474, hartreeToEv: 27.211386 })
const arrays = () => [
  { x: Float64Array.of(0,0,0, 1,0,0, 0,1,0, 0,0,1), y: Float64Array.of(-.03,-.01,.02,.04), z: Float64Array.of(1,3,4,9) },
  { x: Float64Array.of(0,1,2, 0,2,3, 1,2,3, 0,1,3), y: Float64Array.of(1,2,3,4), z: Float64Array.of(-.03,-.01,.02,.04), u: Float64Array.of(1,3,7,9) },
  { x: Float64Array.of(0,3), y: Float64Array.of(-1,1), z: Float64Array.of(2,5) },
]
const fixture = () => resolve_surface(metadata(), async (id) => arrays()[id - 1])
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`)

test('surface binary data preserves original IDs, connectivity, coordinates and extrema', async () => {
  const r = await fixture()
  assert.deepEqual(Array.from(r.vertexIds), [1,3,4,9])
  assert.deepEqual(surface_position(r, 1), [r.metadata.bohrToAngstrom,0,0])
  const doc = JSON.parse(surface_document(r))
  assert.deepEqual(doc.data.indices, Array.from(r.indices)); assert.deepEqual(doc.data.extremeId, [2,5])
  assert.equal(doc.coordinateUnit, 'bohr'); assert.equal(doc.volume, 10)
  const csv = surface_csv(r)
  assert.match(csv, /facet,3,,,,.*?,2,1,4,9/)
  assert.match(csv, /minimum,2,0,0,0,-0.03,,1,,/)
})

test('facet-weighted statistics match original sigma_tot, polarity and skewness definitions', async () => {
  const s = surface_statistics(await fixture())
  close(s.area, 10); close(s.mean, .017); close(s.positiveArea, 7); close(s.negativeArea, 3)
  close(s.positiveMean!, .22 / 7); close(s.negativeMean!, -.05 / 3)
  close(s.positiveVariance, (3 * (.02 - .22 / 7) ** 2 + 4 * (.04 - .22 / 7) ** 2) / 7)
  close(s.variance, s.positiveVariance + s.negativeVariance)
  close(s.balance!, s.positiveVariance * s.negativeVariance / s.variance ** 2)
  close(s.mpi, .027); close(s.nonpolarArea, 2); close(s.polarArea, 8)
  close(s.skewness!, (1 * (-.03 - .017) ** 3 + 2 * (-.01 - .017) ** 3 + 3 * (.02 - .017) ** 3 + 4 * (.04 - .017) ** 3) / 10 / s.variance ** 1.5)
})

test('one-sign and constant maps expose unavailable statistics without NaN JSON', async () => {
  const r = await fixture(); r.values.fill(.25); r.facetValues.fill(.25)
  const stats = surface_statistics(r)
  assert.equal(stats.negativeMean, null); assert.equal(stats.balance, null); assert.equal(stats.skewness, null)
  assert.equal(stats.negativeVariance, 0)
  assert.doesNotMatch(surface_document(r), /NaN|Infinity/)
  r.metadata.mapped = false; r.metadata.extrema = 0
  const resolved = await resolve_surface(r.metadata, async (id) => arrays()[id - 1])
  assert.equal(resolved.extremeId.length, 0)
  assert.deepEqual(JSON.parse(surface_document(resolved)).statistics, { area: 10 })
})

test('invalid mesh, metadata, mapping and numeric payloads fail before rendering', async () => {
  for (const change of [{ volume: NaN }, { vertices: 0 }, { facets: 1 }, { extrema: -1 }, { coordinateUnit: 'angstrom' }, { mapped: 1 }]) assert.throws(() => parse_surface_metadata({ ...metadata(), ...change }))
  for (const mutate of [
    (a: ReturnType<typeof arrays>) => { a[1].x[0] = 99 },
    (a: ReturnType<typeof arrays>) => { a[0].x[0] = Infinity },
    (a: ReturnType<typeof arrays>) => { a[1].y[0] = -1 },
    (a: ReturnType<typeof arrays>) => { a[0].z[1] = 1 },
    (a: ReturnType<typeof arrays>) => { a[2].y[0] = 0 },
  ]) { const a = arrays(); mutate(a); await assert.rejects(resolve_surface(metadata(), async (id) => a[id - 1])) }
  await assert.rejects(resolve_surface({ ...metadata(), mapped: false }, async (id) => arrays()[id - 1]))
})

test('ESP colors and unit conversions use the original function and conversion metadata', async () => {
  const r = await fixture(), range = surface_range(r)
  assert.deepEqual(range, [-.04,.04])
  assert.equal(surface_color(-.04, range), 'rgb(245, 169, 184)')
  assert.equal(surface_color(0, range), 'rgb(255, 255, 255)')
  assert.equal(surface_color(.04, range), 'rgb(91, 206, 250)')
  assert.equal(surface_function(r.metadata).scale, r.metadata.hartreeToKcal)
  assert.equal(surface_function({ ...r.metadata, mappedFunction: 2 }).unit, 'eV')
  assert.equal(surface_function({ ...r.metadata, mappedFunction: 0 }).unit, 'native units')
})

test('surface controls update original mesh material, never run extraction or backend computations', async () => {
  const overlay = await readFile(new URL('../src/SurfaceAnalysisOverlay.svelte', import.meta.url), 'utf8')
  assert.match(overlay, /surface_render_indices\(current\)/)
  assert.match(overlay, /surface.material.opacity =/)
  assert.doesNotMatch(overlay, /marching|request_isosurface_geometry|fetch\(|new Worker/)
  assert.match(overlay, /geometry.dispose\(\).*material.dispose\(\)/)
})

test('render winding is consistent, outward, and leaves native facets unchanged', async () => {
  const r = await fixture(), original = Array.from(r.indices), rendered = surface_render_indices(r)
  for (let i = 0; i < rendered.length; i += 3) {
    const a = Array.from(rendered.slice(i, i + 3)).sort(), b = original.slice(i, i + 3).sort()
    assert.deepEqual(a, b)
    for (let e = 0; e < 3; e++) {
      const first = rendered[i + e], second = rendered[i + (e + 1) % 3]
      let matches = 0
      for (let j = 0; j < rendered.length; j += 3) for (let k = 0; k < 3; k++) if (rendered[j + k] === second && rendered[j + (k + 1) % 3] === first) matches++
      assert.equal(matches, 1)
    }
  }
  assert.deepEqual(Array.from(r.indices), original)
})

test('surface view masks only volume meshes, retaining bonds, controls and the shared scene', async () => {
  const root = new URL('../node_modules/matterviz/dist/structure/', import.meta.url)
  for (const file of ['Structure.svelte', 'StructureViewport.svelte', 'StructureScene.svelte']) {
    const text = await readFile(new URL(file, root), 'utf8')
    assert.match(text, /surface_view\?: boolean/)
  }
  const scene = await readFile(new URL('StructureScene.svelte', root), 'utf8')
  assert.match(scene, /Isosurface rendering[\s\S]*?<T.Group visible=\{!topology_view && !surface_view\}>/)
  assert.match(scene, /<T.Group visible=\{!topology_view\}>/)
  assert.doesNotMatch(scene, /\{#if !surface_view/)
})

test('unknown metadata retains geometry without inventing mapping, volume or mass density', async () => {
  const m: SurfaceMetadata = { ...metadata(), surfaceType: null, mappedFunction: null, mapped: null, volume: null, massDensity: null, extrema: 0, metadataSource: 'unconfirmed' }
  const a = arrays(); a[0].y.fill(0); a[1].z.fill(0)
  const r = await resolve_surface(m, async (id) => a[id - 1])
  const doc = JSON.parse(surface_document(r))
  assert.deepEqual(doc.statistics, { area: 10 })
  assert.equal(doc.volume, null); assert.equal(doc.massDensity, null)
  assert.equal(surface_function(m).esp, false)
  assert.equal(surface_function(m).name, 'Mapping not confirmed')
  assert.equal(r.extremeId.length, 0)
  assert.throws(() => parse_surface_metadata({ ...m, mapped: true }))
  assert.throws(() => parse_surface_metadata({ ...m, surfaceType: 99 }))
  assert.throws(() => parse_surface_metadata({ ...m, mappedFunction: 99 }))
})

const summary = (volume = '12.34567', density = '0.8123', area = '10.00000') => `
================= Summary of surface analysis =================
Volume: ${volume} Bohr^3 ( 1.82938 Angstrom^3)
Estimated density according to mass and volume (M/V): ${density} g/cm^3
Overall surface area: ${area} Bohr^2 ( 2.80029 Angstrom^2)
---------- Post-processing menu ----------
`
test('log import supplements only printed metadata and checks the current mesh area', async () => {
  const r = await fixture(), snapshot = surface_document(r)
  assert.deepEqual(parse_surface_log(summary(), r), { volume: 12.34567, massDensity: .8123 })
  assert.deepEqual(parse_surface_log(summary('1.23D+1'), r), { volume: 12.3, massDensity: .8123 })
  assert.equal(surface_document(r), snapshot)
  const partial = summary().replace(/^Estimated density.*\n/m, '')
  assert.deepEqual(parse_surface_log(partial, r), { volume: 12.34567, massDensity: null })
  assert.deepEqual(parse_surface_log(summary('9') + summary('8'), r), { volume: 8, massDensity: .8123 })
})
test('bad, mismatched, ambiguous or truncated last log summaries leave data untouched', async () => {
  const r = await fixture()
  for (const text of [summary('NaN'), summary('Infinity'), summary('*****'), summary('-1'), summary('1e999'),
    summary('1', '0.8', '99'), summary().replace('Bohr^2', 'Angstrom^2'),
    summary() + '\n===== Summary of surface analysis =====\nVolume: 4 Bohr^3\n',
    summary().replace('----------', 'Volume: 1 Bohr^3\n----------'),
    'unrelated output', 'binary\x00', 'x'.repeat(SURFACE_LOG_LIMIT + 1)]) {
    assert.throws(() => parse_surface_log(text, r))
  }
})
test('surface confirmation and log import are guarded against stale structural sessions', async () => {
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8')
  const confirmation = app.split('const confirm_surface =')[1].split('const import_surface_log =')[0]
  assert.equal((confirmation.match(/generation !== topologyGeneration \|\| geometry !== geometryKey/g) ?? []).length, 2)
  assert.match(confirmation, /\/api\/surface/)
  assert.doesNotMatch(confirmation, /\/api\/esp|\/api\/orbital|new Worker/)
  const log = app.split('const import_surface_log =')[1].split('const clear_surface_log =')[0]
  assert.match(log, /surfaceResult !== original/)
  assert.match(log, /source: 'log'.*precision: 'printed'/)
  const panel = await readFile(new URL('../src/SurfaceAnalysisPanel.svelte', import.meta.url), 'utf8')
  assert.match(panel, /Mapping calculation completed/)
  assert.match(panel, /fieldset disabled=\{busy\}/)
  const overlay = await readFile(new URL('../src/SurfaceAnalysisOverlay.svelte', import.meta.url), 'utf8')
  assert.match(overlay, /coordinates = \$derived\(result.xyz\)/)
  assert.match(overlay, /current = untrack\(\(\) => result\)/)
})
