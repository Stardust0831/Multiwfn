const assert = require('node:assert/strict');
const test = require('node:test');

const {
  broaden,
  processDos,
  processIr,
  processNmr
} = require('../analysis-worker.js');

test('Gaussian and Lorentzian broadening stay finite and peak at the transition', () => {
  const x = [-1, -0.5, 0, 0.5, 1];
  for (const mode of ['gaussian', 'lorentzian']) {
    const y = broaden(x, [0], [2], 0.4, mode);
    assert.equal(y.length, x.length);
    assert.ok(y.every(Number.isFinite));
    assert.equal(y.indexOf(Math.max(...y)), 2);
  }
});

test('molecular DOS separates alpha and beta channels and exposes element PDOS', () => {
  const data = {
    axes: { x: { label: 'Energy', unit: 'eV' }, y: { label: 'DOS', unit: 'states/eV' } },
    series: {
      levels: [
        { energy: -1, spin: 'alpha', projections: { C: 0.75, H: 0.25 } },
        { energy: 0.5, spin: 'beta', projections: { C: 0.25, H: 0.75 } }
      ]
    },
    controls: { defaultFwhm: 0.2 }
  };
  const result = processDos(data, { fwhm: 0.2, projectionMode: 'element', showSticks: false });
  assert.deepEqual(result.traces.slice(0, 2).map((trace) => trace.name), ['TDOS alpha', 'TDOS beta']);
  assert.ok(result.traces.some((trace) => trace.name === 'C alpha'));
  assert.ok(result.traces.some((trace) => trace.name === 'H beta'));
  assert.ok(result.traces.find((trace) => trace.name === 'TDOS beta').y.some((value) => value < 0));
});

test('IR defaults can combine fundamentals, overtones, and combinations', () => {
  const data = {
    series: {
      harmonic: [],
      anharmonic: [
        { mode: '1', frequency: 500, intensity: 10, bandType: 'fundamental' },
        { mode: '1(2)', frequency: 995, intensity: 3, bandType: 'overtone' },
        { mode: '1+2', frequency: 1300, intensity: 5, bandType: 'combination' }
      ]
    },
    controls: { defaultMode: 'anharmonic', defaultFwhm: 8 }
  };
  const result = processIr(data, {
    mode: 'anharmonic',
    bandTypes: ['fundamental', 'overtone', 'combination'],
    broadening: 'lorentzian',
    fwhm: 8
  });
  assert.equal(result.summary.count, 3);
  assert.equal(result.reversed, true);
  assert.equal(result.csv.length, 3);
  assert.equal(result.traces[0].x[0], 0);
  assert.equal(result.traces[0].x[result.traces[0].x.length - 1], 4000);
});

test('NMR reference and linear modes transform shielding positions', () => {
  const data = {
    series: { atoms: [{ index: 1, element: 'C', shielding: 150 }, { index: 2, element: 'H', shielding: 30 }] },
    controls: { defaultFwhmHeavy: 0.2, defaultFwhmHydrogen: 0.02 }
  };
  const shifted = processNmr(data, { element: 'C', mode: 'shift', reference: 200, fwhm: 0.2 });
  assert.equal(shifted.csv[0][3], 50);
  assert.equal(shifted.reversed, true);
  const scaled = processNmr(data, { element: 'C', mode: 'scale', slope: -2, intercept: 10, fwhm: 0.2 });
  assert.equal(scaled.csv[0][3], -70);
});
