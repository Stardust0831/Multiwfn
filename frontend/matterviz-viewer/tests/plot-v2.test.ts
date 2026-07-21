import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import {
  materialize_plot_layer,
  decode_plot_dataset,
  parse_plot_scene,
  release_plot_scene,
  resolve_plot_scene,
  route_plot_layer,
  to_matterviz_axis,
  to_matterviz_data_series,
} from '../src/plot.ts'
import { contour_geometry } from '../src/field.ts'

const crc32c = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0x82f63b78 & -(crc & 1))
  }
  return (~crc) >>> 0
}

const binary_dataset = (): ArrayBuffer => {
  const frame = new ArrayBuffer(80 + 64 + 32)
  const bytes = new Uint8Array(frame)
  const view = new DataView(frame)
  bytes.set(new TextEncoder().encode('MWFNP2D\0'), 0)
  view.setUint16(8, 1, true); view.setUint16(12, 1, true); view.setUint16(14, 1, true)
  view.setUint32(16, 80, true); view.setBigUint64(20, 9n, true); view.setUint32(28, 2, true)
  view.setUint32(32, 32, true); view.setBigUint64(36, 64n, true); view.setBigUint64(44, 32n, true)
  view.setBigUint64(52, 4n, true); view.setBigUint64(72, BigInt(frame.byteLength), true)
  for (const [index, role] of [1, 2].entries()) {
    const entry = 80 + index * 32
    view.setUint8(entry, role); view.setBigUint64(entry + 8, 2n, true)
    view.setBigUint64(entry + 16, BigInt(index * 16), true); view.setBigUint64(entry + 24, 16n, true)
  }
  new Float64Array(frame, 144, 4).set([0, 1, 2, 3])
  view.setUint32(64, crc32c(bytes.subarray(144)), true)
  view.setUint32(60, 0, true); view.setUint32(60, crc32c(bytes.subarray(0, 80)), true)
  return frame
}

const axis = (label: string, range: [number, number], scale: 'linear' | 'log' = 'linear') => ({ label, range, scale })
const scene_input = {
  format: 'multiwfn-matterviz-plot', version: 2, title: 'Generic scene', semanticKind: 'surface', page: { width: 1600, height: 900 },
  panels: [{
    id: 'main', viewport: [0, 0, 1, 1], axes: { x1: axis('X', [10, 0]), y1: axis('Y', [100, 1], 'log'), x2: axis('X2', [0, 1]), y2: axis('Y2', [1, 10]) },
    layers: [
      { id: 'line', type: 'line', data: { datasetId: 1 } },
      { id: 'scatter', type: 'scatter', data: { datasetId: 1 } },
      { id: 'mixed', type: 'line+scatter', data: { datasetId: 1 }, axis: { x: 'x2', y: 'y2' } },
      { id: 'bars', type: 'bars', data: { datasetId: 1 } },
      { id: 'errors', type: 'error-bars', data: { datasetId: 1 } },
      { id: 'fill', type: 'fill', data: { datasetId: 1 } },
      { id: 'contour', type: 'contour', data: { datasetId: 1 }, shape: [2, 2], levels: [1] },
    ],
    annotations: [{ text: 'peak', coordinateSpace: 'data', x: 5, y: 10, xAxis: 'x1', yAxis: 'y1' }],
  }],
}

test('parses v2 layers, explicit axes, reversed/log ranges, and annotations', () => {
  const scene = parse_plot_scene(scene_input)
  assert.equal(scene.version, 2)
  assert.deepEqual(scene.panels[0].axes.x1.range, [10, 0])
  assert.equal(scene.panels[0].axes.y1.scale, 'log')
  assert.equal(scene.panels[0].layers.length, 7)
  assert.equal(scene.panels[0].annotations?.[0].coordinateSpace, 'data')
  assert.deepEqual(to_matterviz_axis(scene.panels[0].axes.y1).range, [100, 1])
})

test('compiles the v2 component entry with lazy v1 initialization', async () => {
  const server = await createServer({ appType: 'custom', server: { middlewareMode: true } })
  try {
    const module = await server.ssrLoadModule('/src/MultiwfnPlotView.svelte')
    assert.equal(typeof module.default, 'function')
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/MultiwfnPlotView.svelte', import.meta.url), 'utf8'))
    assert.match(source, /artifact\.version === 1 \? v1_artifact\.panels\.map/)
    const scene_source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/PlotSceneView.svelte', import.meta.url), 'utf8'))
    assert.match(scene_source, /resolve_plot_scene\(scene, resolver\)/)
    assert.doesNotMatch(scene_source, /resolve_plot_scene\(parse_plot_scene\(scene\)/)
    assert.doesNotMatch(scene_source, /fullscreen=\{true\}/)
  } finally {
    await server.close()
  }
})

test('resolves one typed dataset and materializes line data without inline arrays', async () => {
  const scene = parse_plot_scene(scene_input)
  let requests = 0
  const resolved = await resolve_plot_scene(scene, async (id) => {
    requests += 1
    assert.equal(id, 1)
    return { x: new Float64Array([1, 2]), y: new Float64Array([1, 2]), z: new Float64Array([0, 1, 2, 3]), u: new Float64Array([1, 1, 1, 1]), v: new Float64Array([0, 1, 0, -1]), lower: new Float64Array([1, 1]), upper: new Float64Array([2, 3]), baseline: new Float64Array([1, 1]) }
  })
  assert.equal(requests, 1)
  const line = scene.panels[0].layers[0]
  assert.deepEqual(Array.from(materialize_plot_layer(line, resolved.datasets.get(1)! ).x), [1, 2])
  assert.equal(to_matterviz_data_series(line, resolved.datasets.get(1)!).markers, 'line')
  assert.equal(resolved.datasets.get(1)!.baseline?.length, 2)
})

test('decodes MWFNP2D arrays as views over the response buffer', () => {
  const buffer = binary_dataset()
  const decoded = decode_plot_dataset(buffer)
  assert.equal(decoded.datasetId, 9)
  assert.deepEqual(Array.from(decoded.dataset.x!), [0, 1])
  assert.deepEqual(Array.from(decoded.dataset.y!), [2, 3])
  assert.equal(decoded.dataset.x!.buffer, buffer)
  const corrupt = binary_dataset()
  new Uint8Array(corrupt)[corrupt.byteLength - 1] ^= 1
  assert.throws(() => decode_plot_dataset(corrupt), /body CRC mismatch/)
  const wrong_count = binary_dataset()
  const view = new DataView(wrong_count)
  view.setBigUint64(52, 5n, true)
  view.setUint32(60, 0, true)
  view.setUint32(60, crc32c(new Uint8Array(wrong_count, 0, 80)), true)
  assert.throws(() => decode_plot_dataset(wrong_count), /invalid plot dataset header/)
})

test('routes dense scatter to binned renderer while preserving sparse routes', () => {
  const scene = parse_plot_scene(scene_input)
  const scatter = scene.panels[0].layers[1]
  assert.equal(route_plot_layer(scatter, 50_001), 'binned-scatter')
  assert.equal(route_plot_layer(scatter, 50_000), 'scatter')
  assert.equal(route_plot_layer(scene.panels[0].layers[3], 2), 'bars')
  assert.equal(route_plot_layer(scene.panels[0].layers[6], 4), 'field')
})

test('rejects malformed v2 input and missing axis references', () => {
  assert.throws(() => parse_plot_scene({ ...scene_input, panels: [] }), /panels must be non-empty/)
  assert.throws(() => parse_plot_scene({ ...scene_input, panels: [{ ...scene_input.panels[0], layers: [{ id: 'bad', type: 'unknown', data: { datasetId: 1 } }] }] }), /layers\[0\]\.type is invalid/)
  assert.throws(() => parse_plot_scene({ ...scene_input, panels: [{ ...scene_input.panels[0], axes: { x1: axis('X', [0, 1]), y1: axis('Y', [0, 1]), }, layers: [{ id: 'bad', type: 'line', data: { datasetId: 1 }, axis: { x: 'x2' } }] }] }), /missing x2 axis/)
  assert.throws(() => parse_plot_scene({ ...scene_input, panels: [{ ...scene_input.panels[0], layers: [{ id: 'bad', type: 'annotation', data: { datasetId: 1 } }] }] }), /type is invalid/)
  assert.throws(() => parse_plot_scene({ ...scene_input, panels: [{ ...scene_input.panels[0], axes: { x1: axis('X', [1, 1]), y1: axis('Y', [0, 1]) }, layers: [{ id: 'bad', type: 'line', data: { datasetId: 1 } }] }] }), /range values must differ/)
  assert.throws(() => parse_plot_scene({ ...scene_input, panels: [{ ...scene_input.panels[0], layers: [{ id: 'bad', type: 'contour', data: { datasetId: 1 } }] }] }), /shape is required/)
  assert.throws(() => parse_plot_scene({ ...scene_input, panels: [{ ...scene_input.panels[0], layers: [{ id: 'bad', type: 'contour', data: { datasetId: 1 }, shape: [2, 2], filled: true }] }] }), /filled contours are unsupported/)
})

test('rejects mismatched shapes, lengths, log data, and unsupported secondary field routes', async () => {
  const simple = parse_plot_scene({ ...scene_input, panels: [{ ...scene_input.panels[0], axes: { x1: axis('X', [1, 10], 'log'), y1: axis('Y', [1, 10], 'log') }, layers: [{ id: 'line', type: 'line', data: { datasetId: 1 } }] }] })
  await assert.rejects(resolve_plot_scene(simple, async () => ({ x: new Float64Array([1, 2]), y: new Float64Array([1]) })), /different lengths/)
  await assert.rejects(resolve_plot_scene(simple, async () => ({ x: new Float64Array([0, 2]), y: new Float64Array([1, 2]) })), /nonpositive values/)
  const field = parse_plot_scene({ ...scene_input, panels: [{ ...scene_input.panels[0], axes: { x1: axis('X', [0, 1]), y1: axis('Y', [0, 1]) }, layers: [{ id: 'field', type: 'contour', data: { datasetId: 1 }, shape: [2, 3] }] }] })
  await assert.rejects(resolve_plot_scene(field, async () => ({ z: new Float64Array(5) })), /does not match shape/)
  const secondary = parse_plot_scene({ ...scene_input, panels: [{ ...scene_input.panels[0], layers: [{ id: 'field', type: 'contour', data: { datasetId: 1 }, shape: [2, 2], xAxis: 'x2' }] }] })
  await assert.rejects(resolve_plot_scene(secondary, async () => ({ z: new Float64Array(4) })), /cannot use secondary axes/)
  const secondary_fill = parse_plot_scene({ ...scene_input, panels: [{ ...scene_input.panels[0], layers: [{ id: 'fill', type: 'fill', data: { datasetId: 1 }, yAxis: 'y2' }] }] })
  await assert.rejects(resolve_plot_scene(secondary_fill, async () => ({ x: new Float64Array([1, 2]), y: new Float64Array([1, 2]), lower: new Float64Array([1, 1]) })), /cannot use secondary axes/)
  const dense_secondary = parse_plot_scene({ ...scene_input, panels: [{ ...scene_input.panels[0], layers: [{ id: 'a', type: 'scatter', data: { datasetId: 1 }, yAxis: 'y2' }, { id: 'b', type: 'scatter', data: { datasetId: 2 }, yAxis: 'y2' }] }] })
  await assert.rejects(resolve_plot_scene(dense_secondary, async () => ({ x: new Float64Array(30_000).fill(1), y: new Float64Array(30_000).fill(1) })), /dense scatter panel/)
})

test('field helper produces contour geometry', () => {
  const z = new Float64Array([0, 1, 1, 0])
  assert.equal(contour_geometry(z, 2, 2, [0.5]).length, 1)
})

test('release clears all resolved datasets', async () => {
  const scene = parse_plot_scene(scene_input)
  const resolved = await resolve_plot_scene(scene, async () => ({ x: new Float64Array([1, 2]), y: new Float64Array([1, 2]), z: new Float64Array([0, 0, 0, 0]), u: new Float64Array([1, 1, 1, 1]), v: new Float64Array([1, 1, 1, 1]), lower: new Float64Array([1, 1]), upper: new Float64Array([2, 2]), baseline: new Float64Array([1, 1]) }))
  const released: number[] = []
  release_plot_scene(resolved, (id) => released.push(id))
  assert.deepEqual(released, [1])
  assert.equal(resolved.datasets.size, 0)
})
