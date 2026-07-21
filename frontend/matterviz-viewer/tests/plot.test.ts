import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse_plot_artifact, stick_path, to_matterviz_series } from '../src/plot.ts'
import { SCIENTIFIC_PLOT_LEGEND, SCIENTIFIC_PLOT_PADDING, scientific_series_color } from '../src/scientific-plot.ts'

const axis = (label: string, range: [number, number]) => ({ label, range })
const artifact = {
  format: 'multiwfn-matterviz-plot', version: 1, kind: 'dos', title: 'Density of states',
  panels: [
    { id: 'total', xAxis: axis('Energy', [-5, 5]), yAxis: axis('DOS', [0, 10]), series: [{ id: 'up', type: 'sticks', x: [-1, 1], y: [2, 4] }] },
    { id: 'projected', xAxis: axis('Energy', [5, -5]), yAxis: axis('DOS', [10, 0]), series: [{ id: 'line', type: 'line', x: [-1, 1], y: [2, 4] }] },
  ],
}

test('parses DOS multi-panel sticks and preserves explicit ranges', () => {
  const parsed = parse_plot_artifact(artifact)
  assert.equal(parsed.panels.length, 2)
  assert.deepEqual(parsed.panels[1].xAxis.range, [5, -5])
  assert.deepEqual(to_matterviz_series(parsed.panels[0].series[0]).x, [-1, -1])
  assert.deepEqual(to_matterviz_series(parsed.panels[0].series[0]).y, [0, 0])
  assert.equal(stick_path(parsed.panels[0].series[0], (value) => value * 10, (value) => 100 - value * 10), 'M-10,100V80M10,100V60')
  assert.doesNotMatch(stick_path(parsed.panels[0].series[0], (value) => value, (value) => value), /H/)
})

test('maps curve labels to anchors and leaves stick labels to the disconnected renderer', () => {
  const line = to_matterviz_series({ id: 'ir', type: 'line', x: [1000, 1100], y: [2, 4], labels: [null, '1100'] })
  assert.equal(line.markers, 'line+points')
  assert.deepEqual(line.point_style, { radius: 0, fill_opacity: 0, stroke_opacity: 0 })
  assert.deepEqual(line.point_label, [{}, { text: '1100', auto_placement: true }])

  const sticks = to_matterviz_series({ id: 'nmr', type: 'sticks', x: [1, 2], y: [3, 4], labels: ['1H', null] })
  assert.equal(sticks.markers, 'line')
  assert.deepEqual(sticks.x, [1, 1])
  assert.deepEqual(sticks.y, [0, 0])
  assert.equal(sticks.point_label, undefined)
})

test('reserves a deterministic external legend band and stable series colors', () => {
  assert.ok(SCIENTIFIC_PLOT_PADDING.r > SCIENTIFIC_PLOT_PADDING.l)
  assert.match(SCIENTIFIC_PLOT_LEGEND.style, /left:\s*auto/)
  assert.match(SCIENTIFIC_PLOT_LEGEND.style, /right:/)
  assert.equal(scientific_series_color(undefined, 0), '#4e79a7')
  assert.equal(scientific_series_color(undefined, 1), '#f28e2c')
  assert.equal(scientific_series_color('#123456', 1), '#123456')
})

test('accepts reversed IR and NMR axes and leaves UV-Vis nm values unchanged', () => {
  for (const kind of ['ir', 'nmr'] as const) {
    const parsed = parse_plot_artifact({ ...artifact, kind, panels: [{ ...artifact.panels[0], xAxis: axis('Wavenumber', [4000, 400]), yAxis: axis('Intensity', [1, 0]) }] })
    assert.deepEqual(parsed.panels[0].xAxis.range, [4000, 400])
  }
  const uvvis = parse_plot_artifact({ ...artifact, kind: 'uvvis', panels: [{ ...artifact.panels[0], xAxis: axis('Wavelength', [800, 200]), series: [{ id: 's', type: 'line', x: [250, 500, 750], y: [0.1, 0.8, 0.2] }] }] })
  assert.deepEqual(uvvis.panels[0].series[0].x, [250, 500, 750])
})

test('rejects malformed plot artifacts', () => {
  assert.throws(() => parse_plot_artifact({ ...artifact, version: 2 }), /unsupported format or version/)
  assert.throws(() => parse_plot_artifact({ ...artifact, panels: [] }), /panels must be non-empty/)
  assert.throws(() => parse_plot_artifact({ ...artifact, panels: [{ ...artifact.panels[0], series: [{ id: 'bad', type: 'line', x: [1], y: [2, 3] }] }] }), /x\/y lengths differ/)
})

test('parses the checked-in minimal artifact for every connected plot kind', () => {
  for (const kind of ['dos', 'ir', 'raman', 'uvvis', 'nmr'] as const) {
    const path = new URL(`./fixtures/plots/${kind}.json`, import.meta.url)
    const parsed = parse_plot_artifact(JSON.parse(readFileSync(path, 'utf8')))
    assert.equal(parsed.kind, kind)
    assert.ok(parsed.panels[0].series.length > 0)
  }
})
