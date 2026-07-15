import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, type ViteDevServer } from 'vite'

let server: ViteDevServer
let geometry: any

test.before(async () => {
  server = await createServer({
    configFile: false,
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  })
  const marching = await server.ssrLoadModule('/node_modules/matterviz/dist/marching-cubes.js')
  class FakeWorker {
    onmessage?: (event: MessageEvent) => void
    onerror?: (event: ErrorEvent) => void
    terminate(): void {}
    postMessage(message: any, transfer: Transferable[] = []): void {
      try {
        const transferred = structuredClone(message, { transfer })
        const result = marching.marching_cubes_typed(
          transferred.grid,
          transferred.iso_value,
          transferred.lattice,
          transferred.options,
        )
        const response = {
          job_id: transferred.job_id,
          ok: true,
          positions: result.positions.buffer,
          normals: result.normals.buffer,
          indices: result.indices.buffer,
          data_buffer: transferred.grid.data.buffer,
          estimate: marching.preflight_marching_cubes(
            transferred.grid,
            transferred.iso_value,
            transferred.options,
          ),
        }
        queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent))
      } catch (error) {
        queueMicrotask(() => this.onerror?.({ message: String(error) } as ErrorEvent))
      }
    }
  }
  ;(globalThis as any).Worker = FakeWorker
  geometry = await server.ssrLoadModule('/node_modules/matterviz/dist/isosurface/geometry.js')
})

test.after(async () => {
  delete (globalThis as any).Worker
  await server.close()
})

test('transferred ordinary ArrayBuffer is returned and restored after worker completion', async () => {
  const backing = new ArrayBuffer(304 + 8 * Float64Array.BYTES_PER_ELEMENT)
  const backingBytes = backing.byteLength
  const data = new Float64Array(backing, 304, 8)
  data.set([0, 1, 1, 0, 1, 0, 0, 1])
  const grid = {
    data,
    dimensions: [2, 2, 2] as [number, number, number],
    order: 'x-fastest' as const,
  }
  const before = Array.from(grid.data)
  await geometry.request_isosurface_geometry(
    grid,
    0.5,
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    { periodic: false, centered: false, normals: true },
  )
  assert.deepEqual(Array.from(grid.data), before)
  assert.equal(grid.data.byteOffset, 304)
  assert.equal(grid.data.length, 8)
  assert.equal(grid.data.buffer.byteLength, backingBytes)
})

test('a newer generation wins when requests overlap on one grid', async () => {
  const grid = {
    data: new Float32Array([0, 1, 1, 0, 1, 0, 0, 1]),
    dimensions: [2, 2, 2] as [number, number, number],
    order: 'x-fastest' as const,
  }
  const options = { periodic: false, centered: false, normals: true }
  const first = geometry.request_isosurface_geometry(grid, 0.5, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], options)
  const second = geometry.request_isosurface_geometry(grid, 0.25, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], options)
  const [first_result, second_result] = await Promise.all([first, second])
  assert.equal(first_result.stale, true)
  assert.equal(second_result.stale, undefined)
})

test('worker messages normalize proxied grid metadata arrays', async (t) => {
  if (typeof SharedArrayBuffer === 'undefined') {
    t.skip('SharedArrayBuffer is unavailable')
    return
  }
  const shared = new SharedArrayBuffer(8 * Float32Array.BYTES_PER_ELEMENT)
  const data = new Float32Array(shared)
  data.set([0, 1, 1, 0, 1, 0, 0, 1])
  const proxied = (values: number[]) => new Proxy(values, {})
  const grid = {
    data,
    dimensions: proxied([2, 2, 2]),
    order: 'x-fastest' as const,
  }
  const lattice = new Proxy([
    proxied([1, 0, 0]),
    proxied([0, 1, 0]),
    proxied([0, 0, 1]),
  ], {})
  const result = await geometry.request_isosurface_geometry(
    grid,
    0.5,
    lattice,
    new Proxy({ periodic: false, centered: false, normals: true }, {}),
  )
  assert.ok(result.positions.length > 0)
  assert.equal(grid.data.buffer, shared)
})
