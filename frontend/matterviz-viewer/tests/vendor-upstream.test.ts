import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { createServer, type ViteDevServer } from 'vite'

let server: ViteDevServer
let parser: any
let sampling: any
let marching: any
let math: any
let binary: any
let compression: any

test.before(async () => {
  server = await createServer({
    appType: 'custom', logLevel: 'error',
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true },
  })
  const load = (path: string) => server.ssrLoadModule(`/node_modules/matterviz/dist/${path}`)
  ;[parser, sampling, marching, math, binary, compression] = await Promise.all([
    load('isosurface/parse.js'), load('isosurface/sampling.js'), load('marching-cubes.js'),
    load('math.js'), load('io/is-binary.js'), load('io/decompress.js'),
  ])
})
test.after(async () => { await server?.close() })

const cube = (values: (number | string)[], header = '1 1 2 3', orbital = '') => [
  'Upstream regression', '2 by 2 by 2 finite grid', header,
  '-2 1 0 0', '-2 0 1 0', '-2 0 0 1', '1 1 1.5 2 3',
  ...(orbital ? [orbital] : []), values.join(' '), '',
].join('\n')
const values = [1, 2, 3, 4, 5, 6, 7, 8]
const chgcar = (body: string) => [
  'Hydrogen density', '1', '2 0 0', '0 2 0', '0 0 2', 'H', '1',
  'Direct', '0 0 0', '', '2 2 2', body, '',
].join('\n')

test('single-field Cube preserves samples, finite voxel spacing and atom coordinates', () => {
  const parsed = parser.parse_cube(cube(values), { periodic: false })
  assert.deepEqual(Array.from(parsed.volumes[0].grid.data), values)
  assert.deepEqual(parsed.volumes[0].lattice, [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
  assert.deepEqual(parsed.structure.sites[0].xyz, [0.5, 0, 0])
  assert.deepEqual(parsed.structure.sites[0].abc, [0.5, 0, 0])
  assert.deepEqual(parser.parse_cube(cube(values), { periodic: true }).volumes[0].lattice,
    [[2, 0, 0], [0, 2, 0], [0, 0, 2]])
})

test('Cube NVAL and orbital headers cannot silently mix multiple fields', () => {
  const interleaved = values.flatMap(value => [value, value + 100])
  assert.throws(() => parser.parse_cube(cube(interleaved, '1 1 2 3 2')), /single-field/)
  assert.throws(() => parser.parse_cube(cube(interleaved, '-1 1 2 3', '2 5 6')), /single-field/)
  assert.deepEqual(Array.from(parser.parse_cube(cube(values, '-1 1 2 3', '1 5')).volumes[0].grid.data), values)
})

test('truncated Cube and CHGCAR charge fields fail instead of becoming zero-filled data', () => {
  assert.throws(() => parser.parse_cube(cube(values.slice(0, 4))), /expected 8.*got 4/)
  assert.throws(() => parser.parse_chgcar(chgcar('1 2 3 4')), /expected 8.*got 4/)
  const parsed = parser.parse_chgcar(chgcar(values.join(' ') + '\n\n2 2 2\n1 2 3'))
  assert.equal(parsed.volumes.length, 1, 'retain complete charge density, omit partial magnetization')
  assert.deepEqual(Array.from(parsed.volumes[0].grid.data), values.map(value => value / 8))
})

test('recognized malformed files report their own filename and unknown formats still return null', () => {
  assert.throws(() => parser.parse_volumetric_file(cube([1]), 'broken.cub'), /broken\.cub.*expected 8/)
  assert.throws(() => parser.parse_volumetric_file(cube(values, '1 1 2 3 2'), 'other.cube.gz'),
    error => error instanceof Error && /other\.cube\.gz.*single-field/.test(error.message) && !/broken/.test(error.message))
  assert.throws(() => parser.parse_volumetric_file(cube([1])), /expected 8/)
  assert.equal(parser.parse_volumetric_file('not a volumetric file', 'notes.txt'), null)
})

test('impossible grid dimensions fail before a large typed-array allocation', () => {
  for (const dims of ['600', '0', '1.5', '9007199254740992']) {
    const content = cube(values).replace('-2 1 0 0', `-${dims} 1 0 0`)
      .replace('-2 0 1 0', `-${dims} 0 1 0`).replace('-2 0 0 1', `-${dims} 0 0 1`)
    assert.throws(() => parser.parse_cube(content), /not a valid point count|bytes remain/)
  }
  assert.throws(() => parser.parse_cube(cube(values).replace('1 1 2 3\n', '1000 1 2 3\n')), /ends before atom/)
  assert.throws(() => parser.parse_cube(cube(values).replace('-2 0 1 0', '-2 1 0 0')), /singular/)
})

test('Fortran exponents are accepted and non-finite or invalid field values are rejected', () => {
  assert.deepEqual(Array.from(parser.parse_cube(cube(values.map(value => `${value}D+0`))).volumes[0].grid.data), values)
  for (const invalid of ['NaN', 'Infinity', '1e999', 'not-a-number']) {
    assert.throws(() => parser.parse_cube(cube([1, invalid, ...values.slice(2)])), /Invalid volumetric value|truncated/)
  }
})

test('CRLF and tab-heavy XYZ text remains text while NUL and binary bytes remain binary', () => {
  assert.equal(binary.is_binary('2\r\n\r\nH\t0\t0\t0\r\nH\t1\t0\t0\r\n'), false)
  assert.equal(binary.is_binary('text\0text'), true)
  assert.equal(binary.is_binary('\u0001\u0002\u00ff'), true)
})

test('decompression preserves valid content and stops an inflated stream at its byte limit', async () => {
  const content = cube(values)
  const gz = gzipSync(content)
  const buffer = gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength)
  assert.equal(await compression.decompress_data(buffer, 'gzip'), content)
  const chunks = () => new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(4)); controller.enqueue(new Uint8Array(4)); controller.close() },
  })
  assert.equal((await new Response(chunks().pipeThrough(compression.inflation_limiter('gzip', 8))).arrayBuffer()).byteLength, 8)
  await assert.rejects(new Response(chunks().pipeThrough(compression.inflation_limiter('gzip', 7))).arrayBuffer(), /7-byte inflated limit/)
})

const planeVolume = (periodic: boolean, lattice = [[20, 0, 0], [0, 13, 0], [0, 0, 8]]) => {
  const dims = [81, 17, 13]
  const data = Float64Array.from({ length: dims[0] * dims[1] * dims[2] }, (_, idx) =>
    Math.floor(idx / (dims[1] * dims[2])) / (periodic ? dims[0] : dims[0] - 1))
  return { grid: { data, dimensions: dims, order: 'z-fastest' }, grid_dims: dims,
    lattice, origin: [3, -2, 1], periodic,
    data_range: { min: 0, max: 1, mean: 0.5, abs_max: 1 } }
}
const meshFractions = (volume: any, prepared: any) => {
  const mesh = marching.marching_cubes_typed(prepared.grid, 0.37, prepared.lattice,
    { periodic: prepared.periodic, centered: false, interpolate: true, normals: false })
  assert.ok(mesh.positions.length > 0)
  const to_frac = math.create_cart_to_frac(volume.lattice)
  return Array.from({ length: mesh.positions.length / 3 }, (_, idx) => to_frac(
    [0, 1, 2].map(axis => mesh.positions[idx * 3 + axis] + prepared.origin[axis] - volume.origin[axis])))
}

test('bounded geometry preparation preserves an analytic plane in orthogonal and skew cells', () => {
  for (const lattice of [[[20, 0, 0], [0, 13, 0], [0, 0, 8]], [[20, 0, 0], [3, 13, 0], [-2, 1, 8]]]) {
    const volume = planeVolume(false, lattice)
    const prepared = sampling.prepare_geometry_grid(volume, null, { max_points: 64 })
    assert.ok(prepared.grid.data.length <= 64)
    for (const [x] of meshFractions(volume, prepared)) assert.ok(Math.abs(x - 0.37) < 1e-6, `plane at ${x}, expected 0.37`)
    assert.equal(volume.grid.data.length, 81 * 17 * 13, 'source data remains untouched')
  }
})

test('managed grids retain buffer ownership and periodic marching uses physical voxel spacing', () => {
  for (const periodic of [false, true]) {
    const volume = planeVolume(periodic)
    const prepared = sampling.prepare_geometry_grid(volume, null, { preserve_grid: true })
    assert.equal(prepared.grid, volume.grid)
    assert.equal(prepared.grid.data, volume.grid.data)
    assert.equal(prepared.periodic, periodic)
    const interior = meshFractions(volume, prepared).filter(([x]: number[]) => x < 0.8)
    assert.ok(interior.length > 0)
    for (const [x] of interior) assert.ok(Math.abs(x - 0.37) < 1e-6)
  }
})

test('integer tiling and fractional ranges sample the same physical periodic field', () => {
  const volume = planeVolume(true)
  const tiled = sampling.prepare_geometry_grid(volume, null, { tiling: [2, 1, 1], max_points: 30_000 })
  const ranged = sampling.prepare_geometry_grid(volume, [[0, 2], [0, 1], [0, 1]], { max_points: 30_000 })
  assert.deepEqual(tiled, ranged)
  const points = meshFractions(volume, tiled)
  for (const cell of [0, 1]) {
    const plane = points.filter(([x]: number[]) => x >= cell && x < cell + 0.7)
    assert.ok(plane.length > 0)
    for (const [x] of plane) assert.ok(Math.abs(x - cell - 0.37) < 1e-6)
  }
})

test('the rendered isosurface uses the tested preparation and boundary mode', async () => {
  const component = await readFile(new URL('../node_modules/matterviz/dist/isosurface/Isosurface.svelte', import.meta.url), 'utf8')
  assert.match(component, /prepare_geometry_grid\(vol, effective_range\(vol\)/)
  assert.match(component, /periodic: prepared\.periodic/)
  assert.doesNotMatch(component, /downsample_grid\(|tile_volumetric_data\(/)
})
