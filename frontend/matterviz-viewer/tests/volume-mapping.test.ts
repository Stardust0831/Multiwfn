import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { transpileModule, ScriptTarget } from 'typescript'
import { color_stop_interpolator } from 'matterviz/colors/stops'
import { apply_manifest_color_mapping } from '../src/volume-mapping.ts'
import { migrate_reps, remap_rep_sources } from '../src/reps.ts'
import { read_geometry_memory_budget } from '../src/volume.ts'

const template = await readFile(new URL('../../../tests/fixtures/weak-interaction-vmd/IRIfill.vmd', import.meta.url), 'utf8')
const range = template.match(/mol scaleminmax top 1 ([-.\d]+) ([-.\d]+)/)!.slice(1).map(Number) as [number, number]
const midpoint = Number(template.match(/color scale midpoint ([.\d]+)/)![1])
const entries = [
  { name: 'IRI', path: '/api/volume/1', colorMapping: { path: '/api/volume/2', range,
    stops: [{ position: 0, color: '#0000ff' }, { position: midpoint, color: '#00ff00' }, { position: 1, color: '#ff0000' }] } },
  { name: 'sign(lambda2)rho', path: '/api/volume/2' },
]
const layers = [{ volume_idx: 0, isovalue: 0.1, show_negative: false, visible: true, opacity: 1 }, { volume_idx: 1, visible: false }]

test('maps IRI geometry by the separate signed field using the official VMD BGR scale', () => {
  assert.match(template, /Isosurface 1.0 1 /)
  assert.match(template, /mol color Volume 0/)
  assert.match(template, /color scale method BGR/)
  const mapped = apply_manifest_color_mapping(layers, entries, () => true)
  assert.equal(mapped[0].color_volume_idx, 1)
  assert.equal(mapped[0].isovalue, 0.1) // An explicit menu value overrides the template default.
  assert.equal(mapped[0].show_negative, false)
  assert.equal(mapped[1].visible, false)
  assert.deepEqual(mapped[0].color_range, [-0.04, 0.02])
  const color = color_stop_interpolator(mapped[0].color_stops!)
  assert.deepEqual(color(-1), [0, 0, 1])
  assert.deepEqual(color(0.333), [0, 0.5, 0.5])
  assert.deepEqual(color(0.666), [0, 1, 0])
  color(0.833).forEach((channel, idx) => assert.ok(Math.abs(channel - [0.5, 0.5, 0][idx]) < 1e-12))
  assert.deepEqual(color(2), [1, 0, 0])
  const reps = migrate_reps({}, { layers: mapped }, entries)
  const surface = reps.items[1]
  assert.deepEqual(surface.volume.colorScale?.stops, mapped[0].color_stops)
  assert.equal(surface.volume.colorSourcePath, entries[1].path)
  const restored = remap_rep_sources(JSON.parse(JSON.stringify(reps)), [...entries].reverse())
  assert.equal(restored.items[1].source.index, 1)
  assert.equal(restored.items[1].volume.color_volume_idx, 0)
})

test('rejects missing, identical or incompatible coloring grids and invalid scales', () => {
  assert.throws(() => apply_manifest_color_mapping(layers, entries.slice(0, 1), () => true), /separate coloring/)
  assert.throws(() => apply_manifest_color_mapping(layers, entries, () => false), /same grid/)
  const withMapping = (patch: object) => [{ ...entries[0], colorMapping: { ...entries[0].colorMapping!, ...patch } }, entries[1]]
  assert.throws(() => apply_manifest_color_mapping(layers, withMapping({ path: entries[0].path }), () => true), /separate coloring/)
  assert.throws(() => apply_manifest_color_mapping(layers, withMapping({ range: [1, -1] }), () => true), /increasing bounds/)
  assert.throws(() => apply_manifest_color_mapping(layers, withMapping({ stops: [{ position: 0, color: 'bad' }] }), () => true))
  assert.deepEqual(apply_manifest_color_mapping(layers, [{ path: 'generic.cube' }], () => false), layers)
})

test('the production manifest loader retains native geometry budgets and preserves edited mappings on append', async () => {
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8')
  const start = app.indexOf('  const layer_for_entry =')
  const end = app.indexOf('  const compact_volumes =', start)
  assert.ok(start > 0 && end > start)
  // Execute the real loading path with only network/volume decoding stubbed;
  // losing this header used to silently resample initial high-quality grids.
  const code = transpileModule(app.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText
  const responseHeaders = new Map([
    ['/api/volume/1', '2000000'], ['/api/volume/2', '1000000'], ['/api/volume/3', '3000000'],
    ['/invalid', '-1'],
  ])
  const loader = new Function('env', `
    const { fetch, read_geometry_memory_budget, apply_manifest_color_mapping } = env
    let structure = {}, manifest = {}, volumeEntries = [], volumetricData = [], isosurfaceSettings = {}, activeVolumeIdx = 0
    const DEFAULT_ISOSURFACE_SETTINGS = {}, ESP_COLORS = {}, display_range = () => undefined
    const resolve_volume_entry_url = (entry, base) => new URL(entry.path, base)
    const read_matterviz_volume_response = async () => ({}), decode_matterviz_volume = x => x, adapt_matterviz_volume = x => x
    const grids_compatible = () => true
    ${code}
    return { apply_entries, settings: () => isosurfaceSettings }
  `)({
    read_geometry_memory_budget, apply_manifest_color_mapping,
    fetch: async (url: URL) => {
      const headers = new Headers({ 'content-type': 'application/vnd.multiwfn.volume' })
      const budget = responseHeaders.get(url.pathname)
      if (budget !== undefined) headers.set('x-matterviz-geometry-memory-budget', budget)
      return { ok: true, headers }
    },
  })
  const base = new URL('http://localhost/session/')
  await loader.apply_entries(entries.map(entry => ({ ...entry, format: 'mwfn-volume-v2' })), base)
  assert.equal(loader.settings().geometry_memory_budget_bytes, 1000000)
  assert.equal(loader.settings().layers[0].color_volume_idx, 1)
  loader.settings().layers[0].color_range = [-0.1, 0.1]
  await loader.apply_entries([{ path: '/api/volume/3', format: 'mwfn-volume-v2' }], base, 'append')
  assert.equal(loader.settings().geometry_memory_budget_bytes, 1000000)
  assert.deepEqual(loader.settings().layers[0].color_range, [-0.1, 0.1])
  await assert.rejects(loader.apply_entries([{ path: '/invalid', format: 'mwfn-volume-v2' }], base), /invalid geometry memory budget/)
  assert.equal(loader.settings().geometry_memory_budget_bytes, 1000000)
  await loader.apply_entries([{ path: '/legacy', format: 'mwfn-volume-v1' }], base)
  assert.equal(loader.settings().geometry_memory_budget_bytes, undefined)
})
