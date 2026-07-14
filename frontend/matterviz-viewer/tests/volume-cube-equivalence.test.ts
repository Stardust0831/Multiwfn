import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createServer, type ViteDevServer } from 'vite'
import type { VolumetricData } from 'matterviz/isosurface'
import { adapt_matterviz_volume, decode_matterviz_volume } from '../src/volume.ts'

let server: ViteDevServer
let parse_cube: (content: string, options?: { periodic?: boolean }) => {
  volumes: VolumetricData[]
} | null

test.before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  const parser = await server.ssrLoadModule('matterviz/isosurface')
  parse_cube = parser.parse_cube
})

test.after(async () => {
  await server.close()
})

const fixture = (name: string): URL =>
  new URL(`../../../tests/fixtures/${name}`, import.meta.url)

const read_hex = async (url: URL): Promise<Uint8Array> => {
  const text = await readFile(url, 'utf8')
  const hex = text.replace(/#[^\n]*|\s+/g, '')
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16))
}

const assert_close = (actual: number, expected: number, message: string): void => {
  assert.ok(Math.abs(actual - expected) <= 1e-12, `${message}: ${actual} != ${expected}`)
}

const grid_value = (volume: VolumetricData, x: number, y: number, z: number): number => {
  const grid = volume.grid
  if (Array.isArray(grid)) return grid[x]![y]![z]!
  const [nx, ny, nz] = grid.dimensions
  const index = grid.order === 'x-fastest'
    ? x + nx * (y + ny * z)
    : z + nz * (y + ny * x)
  return grid.data[index]!
}

test('binary adapter is numerically equivalent to the MatterViz Cube parser', async () => {
  const cube = parse_cube(
    await readFile(fixture('matterviz-volume-v1-orbital.cube'), 'utf8'),
    { periodic: false },
  )?.volumes[0]
  assert.ok(cube)

  const decoded = decode_matterviz_volume(
    await read_hex(fixture('matterviz-volume-v1-orbital.hex')),
  )
  decoded.periodic_axes = [false, false, false]
  const binary = adapt_matterviz_volume(decoded)

  assert.deepEqual(binary.grid_dims, cube.grid_dims)
  for (let x = 0; x < binary.grid_dims[0]; x += 1) {
    for (let y = 0; y < binary.grid_dims[1]; y += 1) {
      for (let z = 0; z < binary.grid_dims[2]; z += 1) {
        assert_close(grid_value(binary, x, y, z), grid_value(cube, x, y, z), `grid[${x}][${y}][${z}]`)
      }
    }
  }
  assert.equal(binary.periodic, cube.periodic)
  for (let axis = 0; axis < 3; axis += 1) {
    assert_close(binary.origin[axis], cube.origin[axis], `origin[${axis}]`)
    for (let component = 0; component < 3; component += 1) {
      assert_close(
        binary.lattice[axis][component],
        cube.lattice[axis][component],
        `lattice[${axis}][${component}]`,
      )
    }
  }
  for (const field of ['min', 'max', 'mean', 'abs_max'] as const) {
    assert_close(binary.data_range[field], cube.data_range[field], `data_range.${field}`)
  }
})
