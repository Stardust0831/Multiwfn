import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createServer, type ViteDevServer } from 'vite'

let server: ViteDevServer
let marching: any
let geometry: any

test.before(async () => {
  server = await createServer({
    configFile: false,
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  })
  marching = await server.ssrLoadModule('/node_modules/matterviz/dist/marching-cubes.js')
  geometry = await server.ssrLoadModule('/node_modules/matterviz/dist/isosurface/geometry.js')
})

test.after(async () => {
  await server.close()
})

const lattice = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

function grid(values: number[], dimensions: [number, number, number] = [2, 2, 2]) {
  return {
    data: new Float32Array(values),
    dimensions,
    order: 'x-fastest' as const,
  }
}

test('preflight exactly matches typed marching output on representative fields', () => {
  const fields = [
    grid(new Array(8).fill(1)),
    grid([0, 0, 0, 0, 1, 1, 1, 1]),
    grid([0, 1, 1, 0, 1, 0, 0, 1]),
    grid([0, 1, 0, 1, 1, 0, 1, 0]),
    grid(Array.from({ length: 27 }, (_, index) => Math.sin(index * 1.7)), [3, 3, 3]),
  ]
  for (const field of fields) {
    const estimate = marching.preflight_marching_cubes(field, 0.5, { periodic: false, normals: true })
    const result = marching.marching_cubes_typed(field, 0.5, lattice, {
      periodic: false,
      centered: false,
      normals: true,
    })
    assert.equal(estimate.vertex_count, result.positions.length / 3)
    assert.equal(estimate.triangle_count, result.indices.length / 3)
    assert.ok(estimate.total_bytes >= estimate.working_bytes + estimate.gpu_bytes)
    assert.ok(estimate.total_bytes > estimate.positions_bytes + estimate.normals_bytes + estimate.indices_bytes)
  }
})

test('flat x-fastest and z-fastest worker geometry has sync parity', async () => {
  const x = grid([0, 1, 1, 0, 1, 0, 0, 1])
  const z = {
    data: new Float32Array([0, 1, 1, 0, 1, 0, 0, 1]),
    dimensions: [2, 2, 2] as [number, number, number],
    order: 'z-fastest' as const,
  }
  const sync = marching.marching_cubes_typed(x, 0.5, lattice, { periodic: false, centered: false, normals: true })
  const worker_x = await geometry.request_isosurface_geometry(x, 0.5, lattice, { periodic: false, centered: false, normals: true })
  const worker_z = await geometry.request_isosurface_geometry(z, 0.5, lattice, { periodic: false, centered: false, normals: true })
  assert.deepEqual(Array.from(worker_x.positions), Array.from(sync.positions))
  assert.deepEqual(Array.from(worker_x.normals), Array.from(sync.normals))
  assert.deepEqual(Array.from(worker_x.indices), Array.from(sync.indices))
  assert.deepEqual(Array.from(worker_z.positions), Array.from(sync.positions))
  assert.deepEqual(Array.from(worker_z.indices), Array.from(sync.indices))
})

test('memory budget rejects before geometry allocation', () => {
  const field = grid([0, 1, 1, 0, 1, 0, 0, 1])
  assert.throws(
    () => geometry.geometry_preflight(field, 0.5, { periodic: false, geometry_memory_budget_bytes: 1 }),
    (error: any) => error.code === 'geometry-memory-budget' && error.estimate.total_bytes > 1,
  )
})

test('ordinary ArrayBuffer grid content survives coordinator completion', async () => {
  const field = grid([0, 1, 1, 0, 1, 0, 0, 1])
  const before = Array.from(field.data)
  await geometry.request_isosurface_geometry(field, 0.5, lattice, { periodic: false, centered: false, normals: true })
  assert.deepEqual(Array.from(field.data), before)
})

test('standard flat geometry preparation bypasses the legacy downsample budget', async () => {
  const source = await readFile(new URL('../node_modules/matterviz/dist/isosurface/Isosurface.svelte', import.meta.url), 'utf8')
  assert.match(source, /direct_flat\s*=\s*is_unit_tiling\s*&&\s*halo\s*===\s*0\s*&&\s*managed_budget\s*&&\s*is_scalar_grid\(tiled\.grid\)/)
  assert.match(source, /direct_flat\s*\n\s*\? \{ grid: tiled\.grid, dims: tiled\.grid_dims, factor: 1 \}/)
})

test('worker URL uses a Vite-static module expression', async () => {
  const source = await readFile(new URL('../node_modules/matterviz/dist/isosurface/geometry.js', import.meta.url), 'utf8')
  assert.match(source, /new Worker\(new URL\(`\.\/marching-cubes-worker\.js`, import\.meta\.url\), \{ type: `module` \}\)/)
  assert.match(source, /new Ctor\(buffer, byte_offset, length\)/)
})

test('one geometry budget is shared by all resident surfaces', async () => {
  const source = await readFile(new URL('../node_modules/matterviz/dist/isosurface/Isosurface.svelte', import.meta.url), 'utf8')
  assert.match(source, /committed_budget_bytes = retained_entries\.reduce/)
  assert.equal(geometry.remaining_geometry_budget(undefined, 100), undefined)
  assert.equal(geometry.remaining_geometry_budget(1000, 250), 750)
  assert.equal(geometry.remaining_geometry_budget(1000, 1200), 0)
  assert.match(source, /remaining_geometry_budget\(\s*total_budget,\s*committed_budget_bytes/)
  assert.match(source, /committed_budget_bytes \+= geometry_budget_bytes/)
})
