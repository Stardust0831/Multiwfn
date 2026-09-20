import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import { Color, SRGBColorSpace } from 'three'
import { color_stop_hex, color_stop_interpolator, color_stops_gradient, normalize_color_stops } from 'matterviz/colors/stops'
import { COLOR_SCALE_PRESETS, legacy_color_scale, migrate_color_scale, normalize_color_scale, preset_color_scale, volume_color_scale } from '../src/color-scale.ts'
import { copy_rep, create_rep, migrate_reps, normalize_rep, rep_surface_settings } from '../src/reps.ts'
import { create_workbench_state, parse_workbench_state, restore_workbench_state } from '../src/state.ts'

const stops = [{ position: 0.1, color: '#ff0000' }, { position: 0.3, color: '#00ff00' }, { position: 0.8, color: '#0000ff' }]

test('uneven color stops interpolate in sRGB and extend the nearest endpoint', () => {
  const interpolate = color_stop_interpolator(stops), output = [0, 0, 0]
  assert.equal(interpolate(0.2, output), output)
  assert.ok(Math.abs(output[0] - 0.5) < 1e-12)
  assert.ok(Math.abs(output[1] - 0.5) < 1e-12)
  assert.equal(output[2], 0)
  assert.equal(color_stop_hex(stops, 0.3), '#00ff00')
  assert.deepEqual(interpolate(-1), [1, 0, 0])
  assert.deepEqual(interpolate(1), [0, 0, 1])
  assert.deepEqual(interpolate(0.3), [0, 1, 0])
  assert.equal(color_stops_gradient(stops, 'to top'), 'linear-gradient(to top in srgb, #ff0000 10%, #00ff00 30%, #0000ff 80%)')
})

test('inserting a sampled point preserves the scale within one 8-bit color step', () => {
  const expanded = [...stops, { position: 0.55, color: color_stop_hex(stops, 0.55) }]
  const before = color_stop_interpolator(stops), after = color_stop_interpolator(expanded)
  for (let i = 0; i <= 100; i++) before(i / 100).forEach((channel, c) => assert.ok(Math.abs(channel - after(i / 100)[c]) <= 1 / 255))
})

test('color-stop validation bounds allocation and rejects ambiguous or malformed scales', () => {
  for (const invalid of [undefined, [], [stops[0]], Array.from({ length: 33 }, (_, i) => ({ ...stops[0], position: i / 32 }))])
    assert.throws(() => normalize_color_stops(invalid), /between 2 and 32/)
  for (const position of [-0.1, 1.1, NaN, Infinity, '0.2', undefined])
    assert.throws(() => normalize_color_stops([{ ...stops[0], position }, stops[2]]), /between 0% and 100%/)
  for (const color of ['#fff', 'red', '#12345z', 'url(example)', null])
    assert.throws(() => normalize_color_stops([{ ...stops[0], color }, stops[2]]), /six-digit hex/)
  assert.throws(() => normalize_color_stops([stops[0], stops[0]]), /distinct/)
  const input = [{ position: 1, color: '#AABBCC' }, { position: 0, color: '#FFFFFF' }]
  assert.deepEqual(normalize_color_stops(input), [{ position: 0, color: '#ffffff' }, { position: 1, color: '#aabbcc' }])
  assert.equal(input[0].color, '#AABBCC', 'normalization must not mutate caller data')
  assert.equal(normalize_color_stops(Array.from({ length: 32 }, (_, i) => ({ color: '#abcdef', position: i / 31 }))).length, 32)
})

test('every preset loads independent editable points and edited presets become custom', () => {
  for (const { name } of COLOR_SCALE_PRESETS) {
    const first = preset_color_scale(`interpolate${name}`), second = preset_color_scale(`interpolate${name}`)
    assert.deepEqual(normalize_color_scale(first), first)
    assert.equal(first.stops[0].position, 0)
    assert.equal(first.stops.at(-1)!.position, 1)
    first.stops[0].position = 0.01
    assert.equal(second.stops[0].position, 0)
    assert.equal(normalize_color_scale(first).preset, 'custom')
    assert.equal(normalize_color_scale({ ...second, preset: 'custom' }).preset, 'custom')
  }
})

test('legacy pink/white/blue retains physical-zero white and one-sided ranges', () => {
  const asymmetric = legacy_color_scale('interpolateTransFlag', [-0.02, 0.08])
  assert.equal(asymmetric.preset, 'custom')
  assert.ok(Math.abs(asymmetric.stops[1].position - 0.2) < 1e-12)
  assert.equal(color_stop_hex(asymmetric.stops, 0.2), '#ffffff')
  assert.deepEqual(legacy_color_scale('interpolateTransFlag', [0.08, -0.02]), asymmetric)
  assert.deepEqual(legacy_color_scale('interpolateTransFlag', [-1, 1]), preset_color_scale('interpolateTransFlag'))
  for (const [range, colors] of [
    [[0, 1], ['#ffffff', '#5bcefa']],
    [[-1, 0], ['#f5a9b8', '#ffffff']],
    [[1, 1], ['#ffffff', '#ffffff']],
  ] as const) assert.deepEqual(legacy_color_scale('interpolateTransFlag', [...range]).stops.map(stop => stop.color), colors)
})

test('custom scales copy independently, persist with the scene and reach the renderer unchanged', () => {
  const rep = create_rep({ kind: 'volume', index: 0, path: 'density' }, 'density')
  rep.volume.color_volume_idx = 1; rep.volume.colorSourcePath = 'esp'
  rep.volume.colorScale = { preset: 'custom', stops: structuredClone(stops) }
  const duplicate = copy_rep(rep, 'copy')
  duplicate.volume.colorScale!.stops[1].color = '#ffffff'
  assert.equal(rep.volume.colorScale.stops[1].color, '#00ff00')
  assert.deepEqual(rep_surface_settings(rep).layers![0].color_stops, stops)
  rep.volume.color_range = [6, -2]
  assert.deepEqual(rep_surface_settings(rep).layers![0].color_range, [-2, 6])
  const entries = [{ path: 'density' }, { path: 'esp' }], isosurfaceSettings = rep_surface_settings(rep)
  const saved = create_workbench_state({ representations: { items: [rep, duplicate], selectedId: 'copy' }, manifest: {}, entries, isosurfaceSettings,
    activeVolume: 0, atomSupercell: '1x1x1', showBoundaryAtoms: true, showUnitCell: false })
  const restored = restore_workbench_state(parse_workbench_state(JSON.parse(JSON.stringify(saved))), { entries: [...entries].reverse(), isosurfaceSettings }).representations!
  assert.deepEqual(restored.items[0].volume.colorScale, rep.volume.colorScale)
  assert.deepEqual(restored.items[1].volume.colorScale, duplicate.volume.colorScale)
  assert.equal(restored.items[0].volume.color_volume_idx, 0)
  assert.throws(() => normalize_rep({ ...rep, volume: { ...rep.volume, colorScale: { stops: [stops[0], stops[0]] } } }), /distinct/)
})

test('old Reps and imported renderer layers migrate their actual colors', () => {
  assert.equal(legacy_color_scale().preset, 'interpolateViridis', 'unspecified legacy maps use the renderer default')
  const rep = create_rep({ kind: 'volume', index: 0 }, 'legacy')
  delete rep.volume.colorScale
  rep.volume.colormap = 'interpolateTransFlag'; rep.volume.color_range = [-1, 3]
  assert.deepEqual(normalize_rep(rep)!.volume.colorScale, legacy_color_scale('interpolateTransFlag', [-1, 3]))
  rep.volume.color_stops = stops
  assert.deepEqual(normalize_rep(rep)!.volume.colorScale!.stops, stops)
  assert.deepEqual(volume_color_scale(rep.volume).stops, stops)
})

test('migrated percentages stay fixed when the range changes, before and after saving', () => {
  const rep = create_rep({ kind: 'volume', index: 0 }, 'legacy')
  delete rep.volume.colorScale
  rep.volume.colormap = 'interpolateTransFlag'; rep.volume.color_range = [-1, 3]
  const settings = { ...rep_surface_settings(rep), layers: [rep.volume] }
  const migrated = migrate_reps({}, settings, [{ path: 'density' }], false).items[1]
  assert.equal(migrated.volume.colorScale!.stops[1].position, 0.25)
  const restored = normalize_rep(JSON.parse(JSON.stringify(migrated)))!
  migrated.volume.color_range = [-1, 1]; restored.volume.color_range = [-1, 1]
  assert.equal(rep_surface_settings(migrated).layers![0].color_stops![1].position, 0.25)
  assert.deepEqual(rep_surface_settings(restored).layers![0].color_stops, rep_surface_settings(migrated).layers![0].color_stops)
})

test('legacy automatic TransFlag waits for the rendered range, including saved hidden Reps', () => {
  const rep = create_rep({ kind: 'volume', index: 0 }, 'legacy')
  delete rep.volume.colorScale
  rep.volume.colormap = 'interpolateTransFlag'
  const migrated = migrate_reps({}, { ...rep_surface_settings(rep), layers: [rep.volume] }, [{ path: 'density' }], false).items[1]
  const restored = normalize_rep(JSON.parse(JSON.stringify(migrated)))!
  assert.equal(restored.volume.colorScale, undefined)
  assert.equal(rep_surface_settings(restored).layers![0].color_stops, undefined, 'keep the renderer legacy zero normalization while awaiting the range')
  for (const range of [[0.1, 0.4], [-0.4, -0.1], [-1, 3], [0.1, 0.1]] as [number, number][]) {
    const scale = migrate_color_scale(restored.volume, range)!
    assert.deepEqual(scale, legacy_color_scale('interpolateTransFlag', range))
    const resolved = { ...restored.volume, colorScale: scale }
    assert.equal(migrate_color_scale(resolved, [-1, 1]), scale, 'later automatic range changes must not move migrated points')
  }
  assert.equal(migrate_color_scale({ colormap: 'interpolateTransFlag' }), undefined)
  assert.deepEqual(migrate_color_scale({ colormap: 'interpolateTransFlag', color_range: [-1, 3] }), legacy_color_scale('interpolateTransFlag', [-1, 3]))
  const explicit = preset_color_scale('interpolateTransFlag')
  assert.equal(migrate_color_scale({ colormap: 'interpolateTransFlag', colorScale: explicit }, [0.1, 0.4]), explicit, 'explicit user scales stay unchanged')
})

test('surface buffers and rendered legend share custom stops, midpoint, fallback and linear RGB conversion', async () => {
  const server = await createServer({ appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } })
  try {
    const { scalars_to_vertex_colors } = await server.ssrLoadModule('/node_modules/matterviz/dist/isosurface/coloring.js')
    const { default: Legend } = await server.ssrLoadModule('/src/EspLegend.svelte')
    const { render } = await server.ssrLoadModule('svelte/server')
    const values = new Float64Array([-4, -2, 0, 1, 4, 10, NaN]), out = new Float32Array(values.length * 3)
    const scale = [{ position: 0, color: '#000000' }, { position: 0.25, color: '#ffffff' }, { position: 1, color: '#ff0000' }]
    const result = scalars_to_vertex_colors(values, { colormap: 'interpolateTransFlag', color_stops: scale, color_range: [-2, 6], fallback_color: '#123456' }, out)
    assert.equal(result, out, 'recoloring reuses the GPU-bound allocation')
    const expected = [[0, 0, 0], [0, 0, 0], [1, 1, 1], [1, 5 / 6, 5 / 6], [1, 1 / 3, 1 / 3], [1, 0, 0]]
    const fallback = new Color('#123456')
    expected.map(channels => new Color().setRGB(...channels as [number, number, number], SRGBColorSpace).toArray()).concat([fallback.toArray()])
      .flat().forEach((channel, i) => assert.ok(Math.abs(result[i] - channel) < 1e-6, `linear RGB component ${i}`))
    const html = render(Legend, { props: { min: -2, max: 6, color_stops: scale } }).body
    assert.ok(html.includes(color_stops_gradient(scale, 'to top')))
    const constant = scalars_to_vertex_colors(new Float64Array([-1, 0, 1]), { color_stops: scale, color_range: [0, 0] })
    const midpoint = new Color().setRGB(1, 2 / 3, 2 / 3, SRGBColorSpace).toArray()
    Array.from(constant).forEach((channel, i) => assert.ok(Math.abs(channel - midpoint[i % 3]) < 1e-6))
    assert.ok(render(Legend, { props: { min: 0, max: 0, color_stops: scale } }).body.includes('background: #ffaaaa'))
  } finally { await server.close() }
})
