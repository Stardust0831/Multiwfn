import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import { quality_fixture } from './fixtures/volume-quality.mjs'
import { browser_geometry_budget, source_volume_bytes } from '../src/geometry-budget.ts'
import { adapt_matterviz_volume, decode_matterviz_volume } from '../src/volume.ts'

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true, watch: null }, appType: 'custom', optimizeDeps: { noDiscovery: true } })
const sampling = await server.ssrLoadModule('/node_modules/matterviz/dist/isosurface/sampling.js')
const geometry = await server.ssrLoadModule('/node_modules/matterviz/dist/isosurface/geometry.js')
const parse = await server.ssrLoadModule('/node_modules/matterviz/dist/isosurface/parse.js')
test.after(() => server.close())

test('Cube and native frames preserve the same samples, signed mesh and Cartesian placement', async () => {
  const { cube, binary, volume } = quality_fixture()
  const file = parse.parse_cube(cube).volumes[0]
  const native = adapt_matterviz_volume(decode_matterviz_volume(binary))
  assert.deepEqual(file.grid.data, native.grid.data)
  for (const sign of [1, -1]) {
    const meshes = []
    for (const input of [file, native]) {
      const prepared = sampling.prepare_geometry_grid(input)
      assert.equal(prepared.grid, input.grid)
      const mesh = await geometry.request_isosurface_geometry(prepared.grid, sign * 0.03, prepared.lattice, { periodic: false, centered: false, geometry_memory_budget_bytes: 64 * 1024 ** 2, preserve_source: true })
      meshes.push(mesh)
    }
    assert.deepEqual(meshes[0].positions, meshes[1].positions)
    assert.deepEqual(meshes[0].indices, meshes[1].indices)
    assert.ok(meshes[0].indices.length > 1000)
  }
  assert.deepEqual(file.origin, native.origin)
  assert.deepEqual(file.grid.data, volume.grid.data)
})

test('source quality preserves threshold, multi-million and anisotropic grids; preview is explicit', () => {
  for (const dims of [[79, 79, 79], [58, 102, 90], [160, 160, 160], [2, 510, 510]]) {
    const grid = { data: new Float64Array(dims.reduce((a, b) => a * b)), dimensions: dims, order: 'z-fastest' }
    const volume = { grid, grid_dims: dims, lattice: [[6, 0, 0], [1, 6, 0], [0, 1, 6]], origin: [1, 2, 3], periodic: false }
    for (const budget of [0, 1024, 128 * 1024 ** 2]) assert.equal(sampling.prepare_geometry_grid(volume, null, { memory_budget_bytes: budget }).grid, grid)
    const preview = sampling.prepare_geometry_grid(volume, null, { quality: 'preview', memory_budget_bytes: 16 * 1024 ** 2 })
    assert.ok(preview.grid.data.length <= 500000)
    assert.deepEqual(preview.origin, volume.origin)
    assert.deepEqual(preview.lattice, volume.lattice)
    assert.equal(grid.data.length, dims.reduce((a, b) => a * b))
  }
})

test('periodic range/halo expansion follows source density and admits its temporary storage first', () => {
  const dims = [80, 84, 88]
  const volume = { grid: { data: new Float64Array(dims.reduce((a, b) => a * b)), dimensions: dims, order: 'z-fastest' }, grid_dims: dims,
    lattice: [[6, 0, 0], [1, 6, 0], [0, 1, 6]], origin: [1, -2, 0.5], periodic: true }
  const range = [[-0.25, 1.25], [0, 1], [0, 1]]
  const full = sampling.prepare_geometry_grid(volume, range, { memory_budget_bytes: 32 * 1024 ** 2 })
  assert.deepEqual(full.grid.dimensions, [121, 85, 89])
  assert.deepEqual(full.origin, [-0.5, -2, 0.5])
  assert.ok(full.grid.data.length > 500000)
  const halo = sampling.prepare_geometry_grid(volume, null, { halo: 0.25, memory_budget_bytes: 32 * 1024 ** 2 })
  assert.deepEqual(halo.grid.dimensions, [121, 127, 133])
  assert.throws(() => sampling.prepare_geometry_grid(volume, range, { memory_budget_bytes: 1 }), /Prepared isosurface grid requires/)
  const preview = sampling.prepare_geometry_grid(volume, range, { quality: 'preview', memory_budget_bytes: 4 * 1024 ** 2 })
  assert.ok(preview.grid.data.length <= 500000)
  assert.deepEqual(preview.origin, full.origin)
  assert.deepEqual(preview.lattice, full.lattice)
  assert.equal(volume.grid.data.length, 80 * 84 * 88)
})

test('immutable worker requests survive actual buffer transfer, cancellation and worker failure', async () => {
  const originalWorker = globalThis.Worker
  let worker: any
  class TransferWorker {
    onmessage: any; onerror: any; message: any
    constructor() { worker = this }
    postMessage(message: any, transfer: Transferable[]) { this.message = structuredClone(message, { transfer }) }
    terminate() {}
  }
  globalThis.Worker = TransferWorker as any
  try {
    const { volume } = quality_fixture([8, 9, 10])
    const original = volume.grid.data.slice()
    const request = () => geometry.request_isosurface_geometry(volume.grid, 0.03, volume.lattice, { periodic: false, preserve_source: true, geometry_memory_budget_bytes: 1024 ** 2 })
    let pending = request(); await new Promise(resolve => setImmediate(resolve))
    assert.notEqual(worker.message.grid.data.buffer, volume.grid.data.buffer)
    assert.deepEqual(volume.grid.data, original)
    geometry.release_isosurface_geometry(volume.grid)
    await assert.rejects(pending, { code: 'geometry-released' })
    assert.deepEqual(volume.grid.data, original)
    pending = request(); await new Promise(resolve => setImmediate(resolve))
    worker.onerror({ message: 'injected worker failure' })
    await assert.rejects(pending, /injected worker failure/)
    assert.deepEqual(volume.grid.data, original)
    await assert.rejects(geometry.request_isosurface_geometry(volume.grid, 0.03, volume.lattice,
      { preserve_source: true, geometry_memory_budget_bytes: 1 }), /exceeding/)
    assert.deepEqual(volume.grid.data, original)
  } finally { globalThis.Worker = originalWorker }
})

test('two consumers of an immutable source both receive geometry and low budgets never select preview', async () => {
  const { volume } = quality_fixture([8, 9, 10])
  const options = { periodic: false, preserve_source: true, geometry_memory_budget_bytes: 1024 ** 2 }
  const [a, b] = await Promise.all([geometry.request_isosurface_geometry(volume.grid, 0.03, volume.lattice, options), geometry.request_isosurface_geometry(volume.grid, -0.03, volume.lattice, options)])
  assert.equal(a.stale, undefined); assert.equal(b.stale, undefined)
  assert.ok(a.indices.length && b.indices.length)
  await assert.rejects(geometry.request_isosurface_geometry(volume.grid, 0.03, volume.lattice, { ...options, geometry_memory_budget_bytes: 1 }), /budget/)
  assert.equal(sampling.prepare_geometry_grid(volume).grid, volume.grid)
})

test('browser admission is bounded independently of fidelity and counts source buffers once', () => {
  assert.equal(browser_geometry_budget(0), 128 * 1024 ** 2)
  assert.equal(browser_geometry_budget(32 * 1024 ** 2, 4), 480 * 1024 ** 2)
  assert.equal(browser_geometry_budget(32, 4, 64), 0)
  const { volume } = quality_fixture([8, 9, 10])
  assert.equal(source_volume_bytes([volume, volume] as any), volume.grid.data.byteLength)
})
