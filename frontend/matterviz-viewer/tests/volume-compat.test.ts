import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import { color_grid_compatibility, create_cartesian_sampler, type Vec3 } from '../src/volume-compat.ts'
import { estimate_esp_range, extract_esp_extrema, extract_esp_extrema_async } from '../src/esp.ts'

const BOHR = 0.529177210903
type Volume = {
  grid: number[][][]; grid_dims: Vec3; origin: Vec3; lattice: [Vec3, Vec3, Vec3]; periodic: boolean
  data_range: { min: number; max: number; abs_max: number; mean: number }
}

/** Finite Cube-like grid: `spacing` per voxel, `dims` points per axis. */
const volume = (dims: Vec3, spacing: Vec3, origin: Vec3, field: (p: Vec3) => number, axes?: [Vec3, Vec3, Vec3]): Volume => {
  const unit = axes ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  const lattice = unit.map((row, axis) => row.map((value) => value * spacing[axis] * (dims[axis] - 1))) as [Vec3, Vec3, Vec3]
  const point = (x: number, y: number, z: number): Vec3 => [0, 1, 2].map((c) =>
    origin[c] + unit[0][c] * spacing[0] * x + unit[1][c] * spacing[1] * y + unit[2][c] * spacing[2] * z) as Vec3
  const grid = Array.from({ length: dims[0] }, (_, x) => Array.from({ length: dims[1] }, (_, y) =>
    Array.from({ length: dims[2] }, (_, z) => field(point(x, y, z)))))
  let min = Infinity, max = -Infinity
  for (const plane of grid) for (const row of plane) for (const value of row) { if (value < min) min = value; if (value > max) max = value }
  return { grid, grid_dims: dims, origin, lattice, periodic: false, data_range: { min, max, abs_max: Math.max(-min, max), mean: 0 } }
}

// CH3Cl pair from issue #74: same origin and axes, independently rounded counts.
const origin: Vec3 = [-7.687040 * BOHR, -6.974014 * BOHR, -8.789723 * BOHR]
const center: Vec3 = [origin[0] + 7.7 * BOHR, origin[1] + 7.4 * BOHR, origin[2] + 8.0 * BOHR]
const density_field = (p: Vec3): number => Math.exp(-Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]))
const slope: Vec3 = [0.013, -0.007, 0.021]
const linear = (p: Vec3): number => 0.004 + slope[0] * p[0] + slope[1] * p[1] + slope[2] * p[2]
const fine = (): Volume => volume([121, 117, 126], [0.128650 * BOHR, 0.128650 * BOHR, 0.128650 * BOHR], origin, density_field)
const coarse = (field = linear): Volume => volume([51, 49, 53], [0.308761 * BOHR, 0.308761 * BOHR, 0.308761 * BOHR], origin, field)

test('identical grids are exact; the CH3Cl cross-resolution pair is resampled within one coarse voxel', () => {
  const density = fine()
  assert.deepEqual(color_grid_compatibility(density, density), { ok: true, mode: 'exact' })
  const result = color_grid_compatibility(density, coarse())
  assert.equal(result.ok && result.mode, 'resampled')
  if (!result.ok || result.mode !== 'resampled') return
  // x matches exactly; y and z ESP boxes end slightly short from grid rounding.
  assert.ok(result.shortfall[0] < 1e-9)
  assert.ok(result.shortfall[1] > 0.04 && result.shortfall[1] < 0.308761 * BOHR)
  assert.ok(result.shortfall[2] > 0 && result.shortfall[2] < 0.308761 * BOHR)
})

test('shifted, rotated, singular, periodic-mismatched, truncated and incomplete pairs are rejected', () => {
  const density = fine()
  const spacing: Vec3 = [0.308761 * BOHR, 0.308761 * BOHR, 0.308761 * BOHR]
  const reject = (color: unknown, pattern: RegExp) => {
    const result = color_grid_compatibility(density, color)
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.reason, pattern)
  }
  reject(volume([51, 49, 53], spacing, [origin[0] + 0.01, origin[1], origin[2]], linear), /origins differ/)
  const angle = Math.PI / 180
  reject(volume([51, 49, 53], spacing, origin, linear, [[Math.cos(angle), Math.sin(angle), 0], [-Math.sin(angle), Math.cos(angle), 0], [0, 0, 1]]), /axis 1 directions differ/)
  reject({ ...coarse(), lattice: [[1, 0, 0], [2, 0, 0], [0, 0, 1]] }, /singular/)
  reject({ ...coarse(), periodic: true }, /boundary modes differ/)
  reject(volume([40, 49, 53], spacing, origin, linear), /covers .* along axis 1/)
  reject({ ...coarse(), origin: undefined }, /incomplete/)
  const periodic = { ...density, periodic: true }
  assert.equal(color_grid_compatibility(periodic, { ...coarse(), periodic: true }).ok, false)
})

test('Cartesian sampler matches MatterViz fallback sampling, including out-of-bounds NaN and typed grids', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', cacheDir: 'node_modules/.vite-volume-compat-tests' })
  try {
    const { create_volume_sampler } = await server.ssrLoadModule('/node_modules/matterviz/dist/isosurface/sampling.js')
    const angle = 0.3
    const skew = volume([7, 6, 8], [0.4, 0.5, 0.3], [0.2, -0.1, 0.5], (p) => Math.sin(p[0]) + p[1] * p[2],
      [[Math.cos(angle), Math.sin(angle), 0], [0.2, 0.9, 0.1], [0, 0.1, 1]])
    const reference = create_volume_sampler(skew, { out_of_bounds: 'fallback' })
    const ours = create_cartesian_sampler(skew)!
    let state = 7
    const random = () => (state = (state * 48271) % 2147483647) / 2147483647
    for (let index = 0; index < 500; index += 1) {
      const position: Vec3 = [random() * 4 - 1, random() * 4 - 1, random() * 4 - 1]
      const expected = reference(position), actual = ours(position)
      if (Number.isNaN(expected)) assert.ok(Number.isNaN(actual), String(position))
      else assert.ok(Math.abs(actual - expected) < 1e-12, `${position}: ${actual} vs ${expected}`)
    }
    const data = new Float64Array(7 * 6 * 8)
    for (let x = 0; x < 7; x += 1) for (let y = 0; y < 6; y += 1) for (let z = 0; z < 8; z += 1) data[x + 7 * (y + 6 * z)] = skew.grid[x][y][z]
    const typed = create_cartesian_sampler({ ...skew, grid: { data, dimensions: [7, 6, 8], order: 'x-fastest' } })!
    const inside: Vec3 = [0.9, 0.8, 1.1]
    assert.ok(Math.abs(typed(inside) - ours(inside)) < 1e-12)
  } finally { await server.close() }
})

test('cross-resolution ESP range and extrema sample the potential at each surface crossing', async () => {
  const density = fine()
  const potential = coarse()
  const isovalue = Math.exp(-2.4)
  const options = { maxCells: 2_000_000, maxSamples: 500_000 }
  const extrema = extract_esp_extrema(density, potential, isovalue, options)
  assert.equal(extrema.malformed, false)
  assert.equal(extrema.resampled, true)
  assert.equal(extrema.unsampled, 0)
  assert.ok(extrema.sampleCount > 1000)
  // Trilinear interpolation reproduces a linear field exactly, so every
  // reported value equals the analytic potential at its Cartesian position.
  for (const point of [...extrema.minima, ...extrema.maxima]) {
    assert.ok(Math.abs(point.value - linear([point.x, point.y, point.z])) < 1e-12)
  }
  // Global extrema of a linear field on a sphere lie along ∓slope.
  const radius = 2.4, norm = Math.hypot(...slope)
  const expectedMin = linear(center.map((c, axis) => c - radius * slope[axis] / norm) as Vec3)
  const expectedMax = linear(center.map((c, axis) => c + radius * slope[axis] / norm) as Vec3)
  const globalMin = extrema.minima.find((point) => point.global)!.value
  const globalMax = extrema.maxima.find((point) => point.global)!.value
  assert.ok(Math.abs(globalMin - expectedMin) < 1e-3 && Math.abs(globalMax - expectedMax) < 1e-3, `${globalMin} ${globalMax}`)
  const asyncExtrema = await extract_esp_extrema_async(density, potential, isovalue, options)
  assert.deepEqual(asyncExtrema.minima.map((point) => point.value), extrema.minima.map((point) => point.value))
  const range = estimate_esp_range(density, potential, isovalue, options)
  assert.equal(range.fallback, false)
  assert.equal(range.resampled, true)
  assert.ok(range.max > 0 && range.max <= Math.max(Math.abs(expectedMin), Math.abs(expectedMax)) + 1e-9)
})

test('surface crossings outside a shorter potential box are skipped and counted, never clamped', () => {
  const spacing: Vec3 = [0.5, 0.5, 0.5]
  const densityOrigin: Vec3 = [-3, -3, -3]
  const sphere = (p: Vec3) => Math.exp(-Math.hypot(...p))
  const density = volume([13, 13, 13], spacing, densityOrigin, sphere)
  // Box ends 0.6 Å short along z: exactly one coarse voxel, still accepted.
  const potential = volume([11, 11, 10], [0.6, 0.6, 0.6], densityOrigin, linear)
  assert.equal(color_grid_compatibility(density, potential).ok, true)
  const result = extract_esp_extrema(density, potential, Math.exp(-2.85), { maxCells: 100000, maxSamples: 100000 })
  assert.equal(result.resampled, true)
  assert.ok(result.unsampled > 0)
  for (const point of [...result.minima, ...result.maxima]) assert.ok(point.z <= densityOrigin[2] + 0.6 * 9 + 1e-9)
  // Identical grids keep the edge-interpolated path.
  const same = extract_esp_extrema(density, volume([13, 13, 13], spacing, densityOrigin, linear), Math.exp(-2.85))
  assert.equal(same.resampled, false)
  assert.equal(same.unsampled, 0)
})
