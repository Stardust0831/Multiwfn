import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import type { VolumetricData } from 'matterviz'
import {
  DEFAULT_ESP_LIMIT, KCAL_PER_HARTREE, esp_legend_ticks,
  normalize_esp_volume, trans_flag_color_css,
} from '../src/esp.ts'

const samples = [-10, -5, 0, 5, 10, 15, 20, 25]
const cube = (values: number[]): string => `ESP unit regression
Same grid, different explicitly declared value units
    1 0 0 0
    2 1 0 0
    2 0 1 0
    2 0 0 1
    1 1 0 0 0
${values.join(' ')}
`
const close = (actual: number, expected: number): void => {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`)
}
const values = (volume: VolumetricData): number[] => Array.isArray(volume.grid)
  ? volume.grid.flat(2) : Array.from(volume.grid.data)

test('kcal/mol Cube imports match a.u. values, color range and numerical legend', async () => {
  const server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false, watch: null } })
  try {
    const { parse_cube } = await server.ssrLoadModule('matterviz/isosurface')
    const original = parse_cube(cube(samples)).volumes[0] as VolumetricData
    const atomic = parse_cube(cube(samples.map(value => value / KCAL_PER_HARTREE))).volumes[0] as VolumetricData
    const entry = { path: 'sample_kcal_esp.cub', analysisKind: 'esp-potential', valueUnit: 'kcal/mol' as const }
    const normalized = normalize_esp_volume(original, entry)
    assert.deepEqual(values(original), samples, 'do not mutate the source dataset')
    for (const [index, value] of values(normalized).entries()) {
      close(value, values(atomic)[index])
      assert.equal(trans_flag_color_css(value, -DEFAULT_ESP_LIMIT, DEFAULT_ESP_LIMIT),
        trans_flag_color_css(values(atomic)[index], -DEFAULT_ESP_LIMIT, DEFAULT_ESP_LIMIT))
    }
    for (const field of ['min', 'max', 'mean', 'abs_max'] as const) {
      close(normalized.data_range[field], atomic.data_range[field])
    }
    assert.ok(normalized.data_range.max < DEFAULT_ESP_LIMIT, '25 kcal/mol must not saturate a 0.05 a.u. range')
    const ticks = esp_legend_ticks(normalized.data_range.min, normalized.data_range.max)
    close(ticks[0].kcalMolPerElectron, 25)
    close(ticks.at(-1)!.kcalMolPerElectron, -10)
    assert.equal(ticks[0].label, '+25.0')
    assert.equal(ticks.at(-1)!.label, '-10.0')
    close(esp_legend_ticks(-DEFAULT_ESP_LIMIT, DEFAULT_ESP_LIMIT)[0].kcalMolPerElectron,
      DEFAULT_ESP_LIMIT * KCAL_PER_HARTREE)
    assert.equal(normalized.origin, original.origin)
    assert.equal(normalized.lattice, original.lattice)
    // The same import adapter also accepts the parser's packed representation.
    const packed = { ...original, grid: { dimensions: [2, 2, 2] as [number, number, number], order: 'z-fastest' as const, data: new Float64Array(samples) } }
    values(normalize_esp_volume(packed, entry)).forEach((value, index) => close(value, values(atomic)[index]))
    assert.deepEqual(Array.from(packed.grid.data), samples)
    for (const unconverted of [
      { ...entry, valueUnit: 'au' as const },
      { ...entry, valueUnit: undefined },
      { ...entry, analysisKind: 'esp-density' },
      { ...entry, analysisKind: 'orbital' },
    ]) assert.equal(normalize_esp_volume(original, unconverted), original)
  } finally { await server.close() }
})
