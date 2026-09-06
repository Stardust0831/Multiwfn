import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse_plot_artifact } from '../src/plot.ts'
import { broaden_value, parse_spectrum_output, spectrum_defaults, spectrum_kind, spectrum_peak_x, spectrum_plot, type SpectrumData } from '../src/spectra.ts'

const gaussian = `Entering Gaussian System
Harmonic frequencies (cm**-1)
 Frequencies -- 100.0 200.0 300.0
 IR Inten    -- 1.0 2.0 3.0
 Raman Activ -- 4.0 5.0 6.0
 Frequencies -- 400.0
 IR Inten    -- 7.0
 Raman Activ -- 8.0
Excitation energies and oscillator strengths
 Excited State 1: Singlet-A 1.00 eV 1239.842 nm f=0.1
Excitation energies and oscillator strengths
 Excited State 1: Singlet-A 3.00 eV 413.281 nm f=0.20
 Excited State 2: Singlet-A 4.00 eV 309.960 nm f=1.0D-02
Magnetic shielding tensor (ppm):
 1 C Isotropic = 1.5000D+02 Anisotropy = 2.0
 2 H Isotropic = 31.0 Anisotropy = 1.0
`
const anharm = `
Anharmonic Infrared Spectroscopy
Fundamental Bands
Mode(n) E(harm) E(anharm) I(harm) I(anharm)
 1(1) 100.0 98.0 2.0 1.8
 2(1) 200.0 198.0 3.0 2.8

Overtones
Mode(n) E(harm) E(anharm) I(anharm)
 1(2) 200.0 195.0 0.3

Combination Bands
Mode(n) E(harm) E(anharm) I(anharm)
 1(1) 2(1) 300.0 290.0 0.1

Other properties
Fundamental Bands
 1(1) 100.0 98.0 99999.0 99999.0
`

test('Gaussian content enables the four distinct spectra with original strengths and one-based nuclei', () => {
  const data = parse_spectrum_output(gaussian, 'anything.xyz')
  assert.deepEqual(data.map((d) => d.kind), ['ir', 'raman', 'uvvis', 'nmr'])
  assert.deepEqual(data[0].peaks.map((p) => p.y), [1, 2, 3, 7])
  assert.equal(data[1].peaks[3].label, 'Mode 4')
  assert.deepEqual(data[2].peaks.map((p) => p.x), [3, 4])
  assert.equal(data[2].peaks[1].y, .01)
  assert.deepEqual(data[3].peaks, [{ x: 150, y: 1, label: 'C1', element: 'C' }, { x: 31, y: 1, label: 'H2', element: 'H' }])
})

test('Gaussian anharmonic categories remain distinct and do not consume unrelated tables', () => {
  const data = parse_spectrum_output(gaussian + anharm, 'molecule.out').find((d) => d.variant === 'Anharmonic')!
  assert.deepEqual(data.peaks.map((p) => p.x), [98, 198, 195, 290])
  assert.deepEqual(data.peaks.map((p) => p.category), ['fundamental', 'fundamental', 'overtone', 'combination'])
  const plot = spectrum_plot(data, { ...spectrum_defaults('ir'), overtone: false, combination: false, view: 'sticks' })
  assert.deepEqual(plot.panels[0].series[0].x, [98, 198])
  assert.throws(() => spectrum_plot(data, { ...spectrum_defaults('ir'), fundamental: false, overtone: false, combination: false }), /No transitions/)
})

test('Gaussian anharmonic Raman uses the native activity conversion', () => {
  const input = 'Gaussian, Inc\n' + anharm.replace('Infrared', 'Raman')
  const data = parse_spectrum_output(input, 'raman.log')[0]
  assert.equal(data.kind, 'raman')
  assert.equal(data.peaks[0].y, 1.8 * .059320323 * 100)
})

const orca5 = `O   R   C   A
IR SPECTRUM
Mode freq eps Int T**2 TX TY TZ
 (cm**-1) (L/(mol*cm)) (km/mol) (a.u.)
--------------
 6: 100.0 90.0 1.5 2.0 0 0 0
 7: 200.0 80.0 2.5 3.0 0 0 0

RAMAN SPECTRUM
Mode freq Activity Depolarization
 (cm**-1) (Ang**4/amu)
--------------
 6: 100.0 12.5 0.5
 7: 200.0 14.5 0.6

ABSORPTION SPECTRUM VIA TRANSITION ELECTRIC DIPOLE MOMENTS
State Energy Wavelength fosc T2 TX TY TZ
 (cm-1) (nm)
--------------
 1 24196.6341 413.281 0.3 0.1 0 0 0
 2 32262.1788 309.960 0.4 0.1 0 0 0

Nucleus Element Isotropic Anisotropy
--------------
 0 C 151.2 1.0
 4 H 31.4 2.0

`
test('ORCA 5 IR uses intensity, not epsilon; Raman activity and NMR atom indices are retained', () => {
  const data = parse_spectrum_output(orca5, 'orca.out')
  assert.deepEqual(data.map((d) => d.kind), ['ir', 'raman', 'uvvis', 'nmr'])
  assert.deepEqual(data[0].peaks.map((p) => p.y), [1.5, 2.5])
  assert.equal(data[1].peaks[0].y, 12.5)
  assert.ok(Math.abs(data[2].peaks[0].x - 3) < 1e-10)
  assert.equal(data[3].peaks[1].label, 'H5')
})
test('ORCA 6 electric-dipole rows are independent from SOC tables', () => {
  const text = `O R C A
ABSORPTION SPECTRUM VIA TRANSITION ELECTRIC DIPOLE MOMENTS
State Energy Wavenumber Wavelength fosc
 0-1A -> 1-1A 3.0000 24196.6341 413.281 0.3 0.1 0 0 0

SOC CORRECTED ABSORPTION SPECTRUM VIA TRANSITION ELECTRIC DIPOLE MOMENTS
 0-1A -> 1-1A 4.0000 32262.1788 309.960 0.9 0.1 0 0 0
`
  const data = parse_spectrum_output(text, 'orca6.out')
  assert.equal(data.length, 1)
  assert.ok(Math.abs(data[0].peaks[0].x - 3) < 1e-10)
  assert.equal(data[0].peaks[0].y, .3)
})
test('ORCA 4 IR table uses its original strength column', () => {
  const data = parse_spectrum_output('O R C A\nIR SPECTRUM\nMode    freq (cm**-1)   T\n 6: 100.0 9.5 1 2 3\n\n', 'ir.log')
  assert.equal(data[0].peaks[0].y, 9.5)
})

test('structure-only, frequency-only, binary, overflow and malformed tables are rejected', () => {
  for (const text of ['2\nwater\nH 0 0 0\nH 0 0 1', 'Gaussian, Inc\n Frequencies -- 123 234', '\0Gaussian, Inc', gaussian.replace('1.0 2.0 3.0', '1.0 2.0'), gaussian.replace('1.0 2.0 3.0', '1.0 **** 3.0'), gaussian.replace('1.0 2.0 3.0', '1e999 2.0 3.0')]) {
    assert.throws(() => parse_spectrum_output(text, 'input.out'))
  }
})

test('Lorentzian and Gaussian kernels retain area and their exact FWHM', () => {
  for (const shape of ['gaussian', 'lorentzian'] as const) {
    const peak = broaden_value(0, 0, 2, 8, shape)
    assert.ok(Math.abs(broaden_value(4, 0, 2, 8, shape) / peak - .5) < 1e-12)
    let area = 0
    for (let i = -100000; i <= 100000; i++) area += broaden_value(i * .05, 0, 2, 8, shape) * .05
    assert.ok(Math.abs(area - 2) < .002)
  }
})

test('UV-Vis broadens in eV when displaying wavelength, with a separate oscillator-strength axis', () => {
  const data = parse_spectrum_output(gaussian, 'molecule.out').find((d) => d.kind === 'uvvis')!
  const options = spectrum_defaults('uvvis'), plot = spectrum_plot(data, options)
  const series = plot.panels[0].series
  assert.equal(plot.panels[0].xAxis.unit, 'nm')
  assert.equal(series[1].axis, 'y2')
  assert.equal(series[1].x[0], 1239.842 / 3)
  const i = 1200, energy = 1239.842 / series[0].x[i]
  const expected = data.peaks.reduce((sum, p) => sum + broaden_value(energy, p.x, p.y, options.fwhm, options.shape), 0)
  assert.equal(series[0].y[i], expected)
  assert.deepEqual(JSON.parse(JSON.stringify(parse_plot_artifact(plot))), plot)
  assert.ok(plot.panels[0].xAxis.range[1] < 500)
})
test('NMR keeps absolute shielding by default and requires a single element for reference/linear shifts', () => {
  const data = parse_spectrum_output(gaussian, 'nmr.log').find((d) => d.kind === 'nmr')!
  const options = { ...spectrum_defaults('nmr'), view: 'sticks' as const }
  assert.deepEqual(spectrum_plot(data, options).panels[0].series[0].x, [150, 31])
  assert.throws(() => spectrum_plot(data, { ...options, nmrMode: 'reference' }), /Select one element/)
  const reference = spectrum_plot(data, { ...options, element: 'H', nmrMode: 'reference', reference: 32 })
  assert.deepEqual(reference.panels[0].series[0].x, [1])
  assert.deepEqual(reference.panels[0].series[0].labels, ['H2'])
  assert.ok(reference.panels[0].xAxis.range[0] > reference.panels[0].xAxis.range[1])
  assert.equal(spectrum_peak_x(data.peaks[0], 'nmr', { ...options, nmrMode: 'linear', intercept: 180, slope: -1.1 }), 15)
})
test('invalid widths and nonpositive UV energies do not produce plausible plots', () => {
  const data = parse_spectrum_output(gaussian, 'spectrum.out')[0]
  for (const fwhm of [0, -1, NaN, Infinity, 1e5]) assert.throws(() => spectrum_plot(data, { ...spectrum_defaults('ir'), fwhm }), /Invalid spectrum/)
  assert.throws(() => spectrum_plot({ ...data, kind: 'uvvis', peaks: [{ x: 0, y: 1, label: 'bad' }] }, spectrum_defaults('uvvis')), /positive/)
})
test('incomplete mode blocks fail, while signed computed strengths retain a visible negative range', () => {
  assert.throws(() => parse_spectrum_output(gaussian.replace(' IR Inten    -- 7.0', ''), 'partial.log'), /Incomplete harmonic/)
  assert.throws(() => parse_spectrum_output(gaussian.replace('f=0.20', 'f=*****'), 'partial.log'), /Incomplete Gaussian/)
  const data = parse_spectrum_output(gaussian.replace('1.0 2.0 3.0', '-1.0 2.0 3.0'), 'signed.log')[0]
  const plot = spectrum_plot(data, { ...spectrum_defaults('ir'), view: 'sticks' })
  assert.equal(plot.panels[0].series[0].y[0], -1)
  assert.ok(plot.panels[0].yAxis.range[0] < -1)
})
test('original plot kinds and Tools actions use explicit semantic metadata', () => {
  const artifact = spectrum_plot(parse_spectrum_output(gaussian, 'ir.out')[0], spectrum_defaults('ir'))
  assert.equal(spectrum_kind(artifact), 'ir')
  assert.equal(spectrum_kind({ ...artifact, kind: 'dos' }), undefined)
  const app = readFileSync(new URL('../src/App.svelte', import.meta.url), 'utf8')
  assert.match(app, /SPECTRUM_KINDS as kind/)
  assert.match(app, /AnalysisAction reason=\{spectrum_reason\(kind\)\}/)
  assert.match(app, /new Worker\(new URL\('\.\/spectra.worker.ts'/)
  assert.match(app, /untrack\(reset_spectra\)/)
  assert.match(app, /if \(generation !== spectrumGeneration\) return/)
  const native = readFileSync(new URL('../../../noGUI/GUI_matterviz.f90', import.meta.url), 'utf8')
  for (const kind of ['ir', 'raman', 'uvvis', 'nmr']) assert.ok(native.includes(`kind='${kind}'`))
})

test('real C18 anharmonic output retains all bands', { skip: !process.env.MULTIWFN_TEST_IR_OUTPUT }, () => {
  const data = parse_spectrum_output(readFileSync(process.env.MULTIWFN_TEST_IR_OUTPUT!, 'utf8'), 'C18-anharm.out')
  assert.deepEqual([...new Set(data.map((d) => d.kind))], ['ir', 'raman'])
  const ir = data.find((d) => d.variant === 'Anharmonic') as SpectrumData
  assert.equal(ir.peaks.filter((p) => p.category === 'fundamental').length, 48)
  assert.equal(ir.peaks.filter((p) => p.category === 'overtone').length, 48)
  assert.equal(ir.peaks.filter((p) => p.category === 'combination').length, 1128)
  assert.equal(ir.peaks[0].x, 50.516)
  assert.equal(ir.peaks[0].y, .00007087)
  assert.ok(spectrum_plot(ir, spectrum_defaults('ir')).panels[0].series[0].y.every(Number.isFinite))
})
