import assert from 'node:assert/strict'
import test from 'node:test'
import { AXIS_PRESETS, axis_to_miller, normalize_miller_indices, normalize_slice_resolution, normalize_slice_result, resolve_slice_range, sample_slice_with, scalar_to_rgba, slice_to_rgba } from '../src/slice.ts'

const volume = {
  grid: Array.from({ length: 4 }, (_, x) => Array.from({ length: 4 }, (_, y) => Array.from({ length: 4 }, (_, z) => x + y * 10 + z * 100))),
  grid_dims: [4, 4, 4] as [number, number, number],
  lattice: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]],
  origin: [0, 0, 0] as [number, number, number],
  data_range: { min: 0, max: 333, abs_max: 333, mean: 166.5 },
  periodic: true,
}

test('maps standard plane presets to Miller indices', () => {
  assert.deepEqual(axis_to_miller('xy'), [0, 0, 1])
  assert.deepEqual(axis_to_miller('xz'), [0, 1, 0])
  assert.deepEqual(axis_to_miller('yz'), [1, 0, 0])
  assert.deepEqual(AXIS_PRESETS.xy, [0, 0, 1])
  assert.deepEqual(normalize_miller_indices(['bad', 1.8, Infinity]), [0, 2, 0])
})

test('normalizes malformed sample results and ignores non-finite data', () => {
  const result = normalize_slice_result({ width: 2, height: 2, data: [1, Number.NaN, 4] })
  assert(result)
  assert.deepEqual([...result.data], [1, Number.NaN, 4, Number.NaN])
  assert.equal(result.min, 1)
  assert.equal(result.max, 4)
  assert.equal(normalize_slice_result({ width: 0, height: 2, data: [1] }), null)
})

test('samples a normalized MatterViz HKL slice with clamped position', () => {
  const sampler = (_volume: typeof volume, miller: [number, number, number], distance: number, points = 4) => ({
    data: new Float64Array(points * points).fill(distance + miller[2]),
    width: points,
    height: points,
    min: distance + miller[2],
    max: distance + miller[2],
  })
  const result = sample_slice_with(sampler, volume, [0, 0, 1], 10, 6)
  assert(result)
  assert.equal(result.width, 6)
  assert.equal(result.height, 6)
  assert(Number.isFinite(result.min))
  assert(Number.isFinite(result.max))
  assert.equal(sample_slice_with(sampler, volume, [0, 0, 0], 0.5, 6), null)
})

test('clamps slice resolution to a safe quadratic workload', () => {
  assert.equal(normalize_slice_resolution(1), 2)
  assert.equal(normalize_slice_resolution(128.9), 128)
  assert.equal(normalize_slice_resolution(5000), 512)
  assert.equal(normalize_slice_resolution('bad'), 128)
})

test('resolves auto/manual ranges, reversed bounds, constants, and invalid values', () => {
  assert.deepEqual(resolve_slice_range([1, Number.NaN, 5]), [1, 5])
  assert.deepEqual(resolve_slice_range([1, 2], 8, 3), [3, 8])
  assert.deepEqual(resolve_slice_range([1, 2], '', ''), [1, 2])
  assert.deepEqual(resolve_slice_range([1, 2], null, undefined), [1, 2])
  assert.deepEqual(resolve_slice_range([null, 4] as unknown as number[]), [4, 4])
  assert.deepEqual(resolve_slice_range([Number.NaN]), [0, 1])
  assert.deepEqual(resolve_slice_range([4, 4]), [4, 4])
})

test('maps values to clamped RGBA bytes for continuous colormaps', () => {
  assert.deepEqual(scalar_to_rgba(0, [0, 1], 'Viridis').slice(3), [255])
  assert.deepEqual(scalar_to_rgba(Number.NaN, [0, 1]), [0, 0, 0, 0])
  const rgba = slice_to_rgba({ data: new Float64Array([0, 0.5, 1, Number.NaN]), width: 2, height: 2, min: 0, max: 1 }, [0, 1], 'Viridis')
  assert.equal(rgba.length, 16)
  assert.equal(rgba[15], 0)
  assert.notDeepEqual([...rgba.slice(0, 4)], [...rgba.slice(4, 8)])
})
