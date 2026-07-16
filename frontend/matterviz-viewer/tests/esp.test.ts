import assert from 'node:assert/strict'
import test from 'node:test'
import {
  KCAL_PER_HARTREE,
  clampLegendPosition,
  estimateEspRange,
  estimateSymmetricRange,
  espLegendTicks,
  extractEspExtrema,
  findDeclaredEspPair,
  findMappedEspPair,
  findSurfaceExtrema,
  resolveEspLegendVisibility,
} from '../src/esp.ts'

test('ESP pairing requires explicit density and potential provenance plus the active mapping', () => {
  const compatible = () => true
  const genericEntries = [
    { path: '/api/volume/1', analysisKind: 'density' },
    { path: '/api/volume/2', analysisKind: 'generic-scalar' },
  ]
  const crossColored = [{ volume_idx: 0, color_volume_idx: 1 }]
  assert.equal(findDeclaredEspPair(genericEntries, compatible), undefined)
  assert.equal(findMappedEspPair(genericEntries, crossColored, compatible), undefined)

  const espEntries = [
    { path: '/api/volume/3', analysisKind: 'esp-density' },
    { path: '/api/volume/4', analysisKind: 'esp-potential' },
    { path: '/api/volume/5', analysisKind: 'generic-scalar' },
  ]
  assert.deepEqual(findDeclaredEspPair(espEntries, compatible), { densityIdx: 0, potentialIdx: 1 })
  assert.deepEqual(
    findMappedEspPair(espEntries, [{ volume_idx: 0, color_volume_idx: 1 }], compatible),
    { densityIdx: 0, potentialIdx: 1 },
  )
  assert.equal(
    findMappedEspPair(espEntries, [{ volume_idx: 0, color_volume_idx: 2 }], compatible),
    undefined,
  )
  assert.equal(resolveEspLegendVisibility(true, undefined), false)
  assert.equal(resolveEspLegendVisibility(undefined, { densityIdx: 0, potentialIdx: 1 }), true)
  assert.equal(resolveEspLegendVisibility(false, { densityIdx: 0, potentialIdx: 1 }), false)

  const multipleEspEntries = [
    { path: '/api/volume/6', analysisKind: 'esp-density' },
    { path: '/api/volume/7', analysisKind: 'esp-potential' },
    { path: '/api/volume/8', analysisKind: 'esp-potential' },
  ]
  const onlySecondPotentialCompatible = (left: number, right: number) => left === 0 && right === 2
  assert.deepEqual(
    findMappedEspPair(
      multipleEspEntries,
      [{ volume_idx: 0, color_volume_idx: 2 }],
      onlySecondPotentialCompatible,
    ),
    { densityIdx: 0, potentialIdx: 2 },
  )
})

type Grid = number[][][]

const volume = (grid: Grid, periodic = false) => ({
  grid,
  grid_dims: [grid.length, grid[0]?.length ?? 0, grid[0]?.[0]?.length ?? 0] as [number, number, number],
  lattice: [[2, 0, 0], [0, 3, 0], [0, 0, 4]] as [[number, number, number], [number, number, number], [number, number, number]],
  origin: [1, 2, 3] as [number, number, number],
  periodic,
  data_range: { min: -1, max: 1, abs_max: 1, mean: 0 },
})

test('estimates a symmetric range from MatterViz nested grids', () => {
  const density = volume([
    [[0, 0], [0, 0]],
    [[2, 2], [2, 2]],
  ])
  const esp = volume([
    [[-0.2, -0.2], [-0.2, -0.2]],
    [[0.4, 0.4], [0.4, 0.4]],
  ])
  assert.ok(Math.abs(estimateSymmetricRange(density, esp, 1) - 0.1) < 1e-9)
  const range = estimateEspRange(density, esp, 1)
  assert.ok(Math.abs(range.min + 0.1) < 1e-9)
  assert.ok(Math.abs(range.max - 0.1) < 1e-9)
  assert.ok(range.sampleCount > 0)
  assert.equal(estimateSymmetricRange(density, { ...esp, origin: [2, 2, 3] }, 1), 0.05)
  assert.equal(estimateSymmetricRange(density, {
    ...esp,
    lattice: [[2, 0, 0], [0, 4, 0], [0, 0, 4]],
  }, 1), 0.05)
  assert.equal(estimateSymmetricRange(density, { ...esp, periodic: true }, 1), 0.05)
})

test('falls back safely for malformed, incompatible, or non-crossing grids', () => {
  const valid = volume([[[0, 0], [0, 0]], [[0, 0], [0, 0]]])
  assert.equal(estimateSymmetricRange(valid, { grid_dims: [2, 2, 2] }, 1), 0.05)
  assert.equal(estimateSymmetricRange(valid, valid, Number.NaN), 0.05)
  assert.equal(estimateSymmetricRange(valid, valid, 1), 0.05)
})

test('cell caps sample across the full grid instead of only the first slabs', () => {
  const densityGrid = Array.from({ length: 20 }, (_, x) =>
    Array.from({ length: 10 }, () => Array(10).fill(x < 10 ? 0 : 2)))
  const potentialGrid = Array.from({ length: 20 }, (_, x) =>
    Array.from({ length: 10 }, () => Array(10).fill((x - 10) / 10)))
  const range = estimateEspRange(volume(densityGrid), volume(potentialGrid), 1, {
    maxCells: 100,
    maxSamples: 100,
  })
  assert.ok(range.sampleCount > 0)
  assert.equal(range.fallback, false)
})

test('converts signed atomic-unit ticks to kcal/mol/e', () => {
  const ticks = espLegendTicks(-0.0533, 0.0533)
  assert.equal(ticks.length, 5)
  assert.deepEqual(ticks.map((tick) => tick.label), ['+33.4', '+16.7', '0', '-16.7', '-33.4'])
  assert.ok(Math.abs(ticks[0].kcalMolPerElectron - 0.0533 * KCAL_PER_HARTREE) < 1e-9)
  assert.equal(ticks[0].fraction, 0)
  assert.equal(ticks[4].fraction, 1)
  assert.deepEqual(espLegendTicks(1, 1), [])
})

test('extracts deterministic extrema with an explicit work cap', () => {
  const density = volume([
    [[2, 2], [2, 2]],
    [[0, 0], [0, 0]],
  ])
  const esp = volume([
    [[-0.8, -0.6], [-0.4, -0.2]],
    [[0.4, 0.6], [0.8, 1.0]],
  ])
  const result = extractEspExtrema(density, esp, 1, {
    excludeBoundary: false,
    maxCells: 1,
    maxSamples: 4,
    maxExtrema: 2,
  })
  assert.ok(result.sampledCells <= 1)
  assert.ok(result.sampleCount <= 4)
  assert.ok(Math.abs(result.minima[0].value + 0.2) < 1e-9)
  assert.ok(Math.abs(result.maxima[0].value - 0.4) < 1e-9)
  assert.equal(result.minima[0].kcalMolPerElectron, result.minima[0].kcalMol)
  assert.ok(result.capped)
})

test('returns extrema lists without requiring a marker renderer', () => {
  const points = [
    { x: 0, y: 0, z: 0, value: -2 },
    { x: 1, y: 0, z: 0, value: 1 },
    { x: 0, y: 1, z: 0, value: 2 },
  ]
  const result = findSurfaceExtrema(points, [0, 1, 2], { maxExtrema: 8 })
  assert.deepEqual(result.minima.map((point) => point.value), [-2])
  assert.deepEqual(result.maxima.map((point) => point.value), [2])
  assert.equal(result.minima[0].global, true)
  assert.equal(result.maxima[0].global, true)
})

test('clamps draggable legend positions to the containing viewport', () => {
  assert.deepEqual(
    clampLegendPosition({ left: -20, top: 999 }, { width: 120, height: 80 }, { width: 300, height: 200 }),
    { left: 0, top: 120 },
  )
  assert.deepEqual(
    clampLegendPosition({ left: 20, top: 30 }, { left: 400, top: 400 }, { left: 200, top: 100 }),
    { left: 0, top: 0 },
  )
})
