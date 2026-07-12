import assert from 'node:assert/strict'
import test from 'node:test'
import {
  finite_energy_range,
  gaussian_broaden,
  parse_dos_payload,
  stable_color,
} from '../src/analysis.ts'

test('parses orbital DOS levels and sampled VASP-style curves', () => {
  const dos = parse_dos_payload({
    format: 'multiwfn-analysis-data', version: 1, kind: 'dos',
    series: {
      levels: [{ energy: '-1', spin: 'up', projections: { C: 0.75, H: 0.25 } }],
      sampled: [{ id: 'tdos', energy: [-1, 0], value: [1, 2], label: 'TDOS' }],
      projections: [{ energy: [-1, 0], value: [0.5, 1], element: 'C', orbital: 'p' }],
    },
    controls: { defaultFwhm: 0.2 },
  })
  assert.equal(dos.series.levels[0].energy, -1)
  assert.deepEqual(dos.series.sampled[0].density, [1, 2])
  assert.equal(dos.series.projections[0].element, 'C')
  assert.deepEqual(dos.controls.elements, ['C', 'H'])
})

test('rejects malformed required DOS data and safely drops malformed optional curves', () => {
  assert.throws(() => parse_dos_payload({ format: 'multiwfn-analysis-data', version: 1, kind: 'dos', series: { levels: [{ energy: 'bad' }] } }), /non-finite energy/)
  const dos = parse_dos_payload({
    format: 'multiwfn-analysis-data', version: 1, kind: 'dos',
    series: { levels: [], sampled: [{ energy: [0, 1], value: [1] }, { energy: [0, 1], value: [1, 2] }] },
  })
  assert.equal(dos.series.sampled.length, 1)
  assert.throws(() => parse_dos_payload({ format: 'multiwfn-analysis-data', version: 1, kind: 'dos', series: { levels: [] } }), /no valid data/)
})

test('broadens levels with bounded sampling and signed beta/projection channels', () => {
  const result = gaussian_broaden([
    { energy: -1, spin: 'alpha', projections: { C: 1 } },
    { energy: 1, spin: 'beta', projections: { C: 0.5 } },
  ], { fwhm: 0.2, samples: 101 })
  assert.equal(result.energies.length, 101)
  assert(result.tdos.every(Number.isFinite))
  assert(result.alpha?.some((value) => value > 0))
  assert(result.beta?.some((value) => value < 0))
  assert(result.projected.C.some((value) => value < 0))
  assert.deepEqual(finite_energy_range([{ energy: 2, spin: 'total', projections: {} }], 0.5), [1, 3])
})

test('assigns deterministic palette colors', () => {
  assert.equal(stable_color('C'), stable_color('C'))
  assert.notEqual(stable_color('C'), stable_color('H'))
})

test('bounds direct sampled curves and points while retaining endpoints', () => {
  const points = Array.from({ length: 10_000 }, (_, index) => index)
  const curves = Array.from({ length: 40 }, (_, index) => ({
    id: `curve-${index}`,
    energy: points,
    value: points,
  }))
  const dos = parse_dos_payload({
    format: 'multiwfn-analysis-data', version: 1, kind: 'dos',
    series: { sampled: curves },
  })
  assert.equal(dos.series.sampled.length, 32)
  assert.equal(dos.series.sampled[0].energy.length, 5_000)
  assert.equal(dos.series.sampled[0].energy[0], 0)
  assert.equal(dos.series.sampled[0].energy.at(-1), 9_999)
})
