import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, type ViteDevServer } from 'vite'

type Grid = number[][][] | {
  data: Float32Array | Float64Array
  dimensions: [number, number, number]
  order: 'x-fastest' | 'z-fastest'
}

let server: ViteDevServer
let types: any
let sampling: any
let marching: any
let slice: any

test.before(async () => {
  server = await createServer({
    configFile: false,
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  })
  types = await server.ssrLoadModule('/node_modules/matterviz/dist/isosurface/types.js')
  sampling = await server.ssrLoadModule('/node_modules/matterviz/dist/isosurface/sampling.js')
  marching = await server.ssrLoadModule('/node_modules/matterviz/dist/marching-cubes.js')
  slice = await server.ssrLoadModule('/node_modules/matterviz/dist/isosurface/slice.js')
})

test.after(async () => {
  await server.close()
})

const dims: [number, number, number] = [3, 3, 3]
const value = (x: number, y: number, z: number): number => x + 10 * y + 100 * z
const nested: number[][][] = Array.from({ length: dims[0] }, (_, x) =>
  Array.from({ length: dims[1] }, (_, y) =>
    Array.from({ length: dims[2] }, (_, z) => value(x, y, z)),
  ),
)
const flat_grid = (order: 'x-fastest' | 'z-fastest'): Grid => {
  const data = new Float64Array(dims[0] * dims[1] * dims[2])
  for (let x = 0; x < dims[0]; x += 1) {
    for (let y = 0; y < dims[1]; y += 1) {
      for (let z = 0; z < dims[2]; z += 1) {
        const index = order === 'x-fastest'
          ? x + dims[0] * (y + dims[1] * z)
          : z + dims[2] * (y + dims[1] * x)
        data[index] = value(x, y, z)
      }
    }
  }
  return { data, dimensions: dims, order }
}

const volume = (grid: Grid) => ({
  grid,
  grid_dims: dims,
  lattice: [[3, 0, 0], [0, 3, 0], [0, 0, 3]],
  origin: [0, 0, 0],
  data_range: types.grid_data_range(grid),
  periodic: true,
})

test('flat x-fastest, flat z-fastest, and legacy grids are behaviorally equal', () => {
  const grids = [nested, flat_grid('x-fastest'), flat_grid('z-fastest')]
  const range = grids.map((grid) => types.grid_data_range(grid))
  assert.deepEqual(range[1], range[0])
  assert.deepEqual(range[2], range[0])

  const samples = grids.map((grid) => sampling.trilinear_interpolate(grid, 0.25, 0.5, 0.75, true))
  assert.deepEqual(samples, [samples[0], samples[0], samples[0]])

  const meshes = grids.map((grid) => marching.marching_cubes(
    grid,
    111,
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    { periodic: false, centered: false, normals: false },
  ))
  assert.deepEqual(meshes[1], meshes[0])
  assert.deepEqual(meshes[2], meshes[0])
})

test('downsample, periodic padding, tiling, range extraction, and slices share the accessor', () => {
  const grids = [nested, flat_grid('x-fastest'), flat_grid('z-fastest')]
  const downsampled = grids.map((grid) => types.downsample_grid(grid, dims, 8).grid)
  const padded = grids.map((grid) => types.pad_periodic_grid(grid, dims, 0.34).grid)
  const tiled = grids.map((grid) => types.tile_volumetric_data(volume(grid), [2, 1, 1]).grid)
  const extracted = grids.map((grid) => sampling.extract_volume_range(volume(grid), [[0, 1], [0, 1], [0, 1]]).grid)
  const read = (grid: Grid, shape: [number, number, number]) => Array.from(
    { length: shape[0] * shape[1] * shape[2] },
    (_, index) => {
      const x = index % shape[0]
      const y = Math.floor(index / shape[0]) % shape[1]
      const z = Math.floor(index / (shape[0] * shape[1]))
      return types.grid_value(grid, x, y, z, shape)
    },
  )
  assert.deepEqual(read(downsampled[1], [2, 2, 2]), read(downsampled[0], [2, 2, 2]))
  assert.deepEqual(read(downsampled[2], [2, 2, 2]), read(downsampled[0], [2, 2, 2]))
  assert.deepEqual(read(padded[1], [5, 5, 5]), read(padded[0], [5, 5, 5]))
  assert.deepEqual(read(tiled[1], [6, 3, 3]), read(tiled[0], [6, 3, 3]))
  assert.deepEqual(read(extracted[1], [4, 4, 4]), read(extracted[0], [4, 4, 4]))

  const slices = grids.map((grid) => slice.sample_hkl_slice(volume(grid), [0, 0, 1], 0.5, 4))
  assert(slices[0] && slices[1] && slices[2])
  assert.deepEqual(Array.from(slices[1].data), Array.from(slices[0].data))
  assert.deepEqual(Array.from(slices[2].data), Array.from(slices[0].data))
})

test('large typed grids remain one typed buffer through preparation', () => {
  const data = new Float32Array(10_000_000)
  const grid: Grid = { data, dimensions: [100, 100, 1000], order: 'z-fastest' }
  const result = types.downsample_grid(grid, [100, 100, 1000], 500_000)
  assert(data instanceof Float32Array)
  assert(result.grid.data instanceof Float32Array)
  assert.equal(Array.isArray(result.grid), false)
  assert.equal(result.grid.data.length, result.grid.dimensions[0] * result.grid.dimensions[1] * result.grid.dimensions[2])
})
