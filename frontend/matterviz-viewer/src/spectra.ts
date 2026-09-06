import type { PlotArtifact, PlotKind, PlotSeries, PlotScene } from './plot'

export const SPECTRUM_KINDS = ['uvvis', 'ir', 'raman', 'nmr'] as const
export type SpectrumKind = typeof SPECTRUM_KINDS[number]
export const SPECTRUM_NAMES: Record<SpectrumKind, string> = { uvvis: 'UV-Vis spectrum', ir: 'Infrared spectrum', raman: 'Raman spectrum', nmr: 'NMR spectrum' }
export const SPECTRUM_FILE_LIMIT = 64 * 1024 * 1024
export const SPECTRUM_DATA_LIMIT = 32
const MAX_PEAKS = 20000
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[EeDd][+-]?\\d+)?'
const number = (token: string): number => {
  if (!new RegExp(`^${NUMBER}$`).test(token)) throw new Error('Incomplete or nonnumeric spectrum data')
  const value = Number(token.replace(/[dD]/, 'e'))
  if (!Number.isFinite(value)) throw new Error('Nonfinite spectrum data')
  return value
}
const numbers = (line: string): number[] => line.trim().split(/\s+/).map(number)
export type SpectrumPeak = { x: number; y: number; label: string; category?: 'fundamental' | 'overtone' | 'combination'; element?: string }
export type SpectrumData = { id: string; name: string; kind: SpectrumKind; source: string; variant: string; peaks: SpectrumPeak[] }
export type SpectrumSettings = {
  view: 'curve' | 'sticks' | 'both'; shape: 'gaussian' | 'lorentzian'; fwhm: number; scale: number
  xUnit: 'eV' | 'nm'; element: string; nmrMode: 'shielding' | 'reference' | 'linear'; reference: number; intercept: number; slope: number
  fundamental: boolean; overtone: boolean; combination: boolean; labels: boolean
}
export const spectrum_defaults = (kind: SpectrumKind): SpectrumSettings => ({
  view: 'both', shape: kind === 'uvvis' ? 'gaussian' : 'lorentzian', fwhm: kind === 'uvvis' ? 2 / 3 : kind === 'nmr' ? .5 : 8,
  scale: 1, xUnit: 'nm', element: '', nmrMode: 'shielding', reference: 0, intercept: 0, slope: -1,
  fundamental: true, overtone: true, combination: true, labels: false,
})
export const spectrum_kind = (artifact: PlotArtifact | PlotScene): SpectrumKind | undefined => {
  const kind = artifact.version === 1 ? artifact.kind : artifact.semanticKind
  return SPECTRUM_KINDS.includes(kind as SpectrumKind) ? kind as SpectrumKind : undefined
}

const last_section = (lines: string[], pattern: RegExp): string[] => {
  for (let i = lines.length - 1; i >= 0; i--) if (pattern.test(lines[i])) return lines.slice(i + 1)
  return []
}
const element_symbol = (value: string): string => value[0].toUpperCase() + value.slice(1).toLowerCase()

/** Read complete labelled tables, never infer spectral type or units from an extension. */
export const parse_spectrum_output = (text: string, name: string): SpectrumData[] => {
  if (text.length > SPECTRUM_FILE_LIMIT || /[\u0000-\u0008\u000e-\u001f]/.test(text)) throw new Error('Spectrum input is binary or exceeds 64 MiB')
  const lines = text.split(/\r?\n/)
  const output: SpectrumData[] = []
  const add = (kind: SpectrumKind, variant: string, peaks: SpectrumPeak[]): void => {
    if (!peaks.length) return
    if (peaks.length > MAX_PEAKS) throw new Error(`A spectrum may contain at most ${MAX_PEAKS} transitions`)
    if (peaks.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error(`Invalid ${kind} transition values`)
    output.push({ id: `${kind}:${variant}`, name: `${name} - ${variant}`, source: name, kind, variant, peaks })
  }
  if (/Gaussian, Inc|Entering Gaussian System/.test(text)) {
    const harmonic = last_section(lines, /Harmonic frequencies/)
    const vibrationLines = harmonic.length ? harmonic : lines
    const ir: SpectrumPeak[] = [], raman: SpectrumPeak[] = []
    let frequency: number[] = [], mode = 0
    for (const line of vibrationLines) {
      const freq = line.match(/^\s*Frequencies\s+--\s+(.+)$/)
      if (freq) { mode += frequency.length; frequency = numbers(freq[1]); continue }
      const strength = line.match(/^\s*(IR Inten|Raman Activ)\s+--\s+(.+)$/)
      if (!strength || !frequency.length) continue
      const values = numbers(strength[2])
      if (values.length !== frequency.length) throw new Error('Frequency and strength counts differ')
      const target = strength[1] === 'IR Inten' ? ir : raman
      values.forEach((y, i) => target.push({ x: frequency[i], y, label: `Mode ${mode + i + 1}` }))
    }
    const expectedModes = mode + frequency.length
    if ((ir.length && ir.length !== expectedModes) || (raman.length && raman.length !== expectedModes)) throw new Error('Incomplete harmonic spectrum table')
    add('ir', 'Harmonic', ir); add('raman', 'Harmonic activity', raman)
    for (const [kind, title] of [['ir', 'Infrared'], ['raman', 'Raman']] as const) {
      const section = last_section(lines, new RegExp(`Anharmonic ${title} Spectroscopy`))
      const peaks: SpectrumPeak[] = []
      let category: SpectrumPeak['category'], reading = false, groups = 0
      for (const line of section) {
        if (/Fundamental Bands|^\s*Overtones\s*$|Combination Bands/.test(line)) {
          if (++groups > 3) break
          category = line.includes('Fundamental') ? 'fundamental' : line.includes('Overtones') ? 'overtone' : 'combination'
          reading = false; continue
        }
        if (!category) continue
        const row = line.match(/^\s*((?:\d+\(\d+\)\s*){1,2})\s+(.+)$/)
        if (row) {
          const values = numbers(row[2]), expected = category === 'fundamental' ? 4 : 3
          if (values.length !== expected) throw new Error('Incomplete anharmonic spectrum table')
          peaks.push({ x: values[1], y: values[values.length - 1] * (kind === 'raman' ? .059320323 * values[0] : 1), label: row[1].trim(), category })
          reading = true
        } else if (reading) { category = undefined; if (groups === 3) break }
      }
      add(kind, kind === 'ir' ? 'Anharmonic' : 'Anharmonic activity', peaks)
    }
    const excited = last_section(lines, /Excitation energies and oscillator strengths/)
    const uv: SpectrumPeak[] = []
    for (const line of excited) {
      const row = line.match(new RegExp(`^\\s*Excited State\\s+(\\d+):.*?(${NUMBER})\\s+eV.*?f=\\s*(${NUMBER})`))
      if (row) uv.push({ x: number(row[2]), y: number(row[3]), label: `State ${row[1]}` })
      else if (/^\s*Excited State\s+\d+:/.test(line)) throw new Error('Incomplete Gaussian excitation data')
    }
    add('uvvis', 'Electric dipole', uv)
    const shields: SpectrumPeak[] = []
    for (const line of last_section(lines, /Magnetic shielding tensor \(ppm\)/)) {
      const row = line.match(new RegExp(`^\\s*(\\d+)\\s+([A-Za-z]{1,2})\\s+Isotropic\\s*=\\s*(${NUMBER})`))
      if (row) shields.push({ x: number(row[3]), y: 1, label: `${element_symbol(row[2])}${row[1]}`, element: element_symbol(row[2]) })
      else if (/^\s*\d+\s+[A-Za-z]{1,2}\s+Isotropic\s*=/.test(line)) throw new Error('Incomplete Gaussian shielding data')
    }
    add('nmr', 'Isotropic shielding', shields)
  } else if (/O\s+R\s+C\s+A/.test(text)) {
    for (const kind of ['ir', 'raman', 'uvvis', 'nmr'] as const) {
      const pattern = kind === 'ir' ? /^\s*IR SPECTRUM\s*$/ : kind === 'raman' ? /^\s*RAMAN SPECTRUM\s*$/ : kind === 'uvvis'
        ? /^\s*ABSORPTION SPECTRUM VIA TRANSITION ELECTRIC DIPOLE MOMENTS\s*$/ : /^\s*Nucleus\s+Element\s+.*(?:[Ii]sotropic|[Ss]hielding)/
      const section = last_section(lines, pattern)
      const peaks: SpectrumPeak[] = []
      let started = false, oldIR = false
      for (const line of section) {
        if (kind === 'ir' && /Mode\s+freq\s*\(cm\*\*-1\)\s+T/.test(line)) oldIR = true
        let peak: SpectrumPeak | undefined
        if (kind === 'nmr') {
          const row = line.match(new RegExp(`^\\s*(\\d+)\\s+([A-Za-z]{1,2})\\s+(${NUMBER})(?:\\s|$)`))
          if (row) peak = { x: number(row[3]), y: 1, label: `${element_symbol(row[2])}${Number(row[1]) + 1}`, element: element_symbol(row[2]) }
        } else if (kind === 'uvvis') {
          const row = line.match(/^\s*(\d+(?:-\d+[A-Za-z]*)?\s*->\s*\d+(?:-\d+[A-Za-z]*)?|\d+)\s+(.+)$/)
          if (row) {
            const values = numbers(row[2])
            // ORCA 6 adds energy in eV before wavenumber; ORCA <=5 begins with wavenumber.
            const offset = row[1].includes('->') ? 1 : 0
            if (values.length < offset + 3) throw new Error('Incomplete ORCA absorption table')
            peak = { x: values[offset] / 8065.5447, y: values[offset + 2], label: `State ${row[1]}` }
          }
        } else {
          const row = line.match(/^\s*(\d+)\s*:\s*(.+)$/)
          if (row) {
            const values = numbers(row[2]), intensity = kind === 'ir' && !oldIR ? 2 : 1
            if (values.length <= intensity) throw new Error('Incomplete ORCA vibrational table')
            peak = { x: values[0], y: values[intensity], label: `Mode ${row[1]}` }
          }
        }
        if (peak) { peaks.push(peak); started = true }
        else if (started) break
      }
      add(kind, kind === 'nmr' ? 'Isotropic shielding' : kind === 'raman' ? 'Harmonic activity' : kind === 'ir' ? 'Harmonic' : 'Electric dipole', peaks)
    }
  }
  if (!output.length) throw new Error('No supported UV-Vis, IR, Raman activity or NMR shielding data found. Import a Gaussian/ORCA output or open an original Multiwfn plot document.')
  return output
}

export const spectrum_peak_x = (peak: SpectrumPeak, kind: SpectrumKind, options: SpectrumSettings): number => {
  if (kind !== 'nmr') return peak.x * options.scale
  return options.nmrMode === 'reference' ? options.reference - peak.x : options.nmrMode === 'linear' ? options.intercept + options.slope * peak.x : peak.x
}

export const broaden_value = (x: number, center: number, strength: number, width: number, shape: SpectrumSettings['shape']): number => {
  const delta = x - center
  return shape === 'lorentzian' ? strength * .5 / Math.PI * width / (delta * delta + .25 * width * width)
    : strength * Math.sqrt(4 * Math.log(2) / Math.PI) / width * Math.exp(-4 * Math.log(2) * (delta / width) ** 2)
}

/** Broadening uses the original area-normalized kernels; UV broadens in energy, not wavelength. */
export const spectrum_plot = (data: SpectrumData, options: SpectrumSettings): PlotArtifact => {
  if (![options.fwhm, options.scale, options.reference, options.intercept, options.slope].every(Number.isFinite)
    || options.fwhm < 1e-4 || options.fwhm > 1e4 || options.scale <= 0 || options.scale > 10) throw new Error('Invalid spectrum settings')
  if (data.kind === 'nmr' && options.nmrMode !== 'shielding' && !options.element) throw new Error('Select one element for chemical shifts')
  const peaks = data.peaks.filter((p) => (!options.element || p.element === options.element)
    && (!p.category || options[p.category])).map((p) => ({ ...p, x: spectrum_peak_x(p, data.kind, options) }))
  if (!peaks.length) throw new Error('No transitions match the selected filters')
  if (data.kind === 'uvvis' && peaks.some((p) => p.x <= 0)) throw new Error('UV-Vis energies must be positive')
  let low = Infinity, high = -Infinity
  for (const peak of peaks) { low = Math.min(low, peak.x); high = Math.max(high, peak.x) }
  const minimumEnergy = low, maximumEnergy = high
  const pad = Math.max(options.fwhm * 5, (high - low) * .12, data.kind === 'nmr' ? 1 : .1)
  low -= pad; high += pad
  if (data.kind === 'uvvis') low = Math.max(.05, low)
  const wavelength = data.kind === 'uvvis' && options.xUnit === 'nm'
  const toX = (x: number): number => wavelength ? 1239.842 / x : x
  let start = toX(low), end = toX(high)
  if (wavelength) [start, end] = [Math.max(1, 1239.842 / maximumEnergy - 40), 1239.842 / minimumEnergy + 40]
  const x = Array.from({ length: 2401 }, (_, i) => start + (end - start) * i / 2400)
  const y = x.map((value) => {
    const energy = wavelength ? 1239.842 / value : value
    let total = 0
    for (const peak of peaks) total += broaden_value(energy, peak.x, peak.y, options.fwhm, options.shape)
    return total
  })
  const units = data.kind === 'uvvis' ? options.xUnit : data.kind === 'nmr' ? 'ppm' : 'cm^-1'
  const reverse = data.kind === 'ir' || data.kind === 'raman' || (data.kind === 'nmr' && options.nmrMode !== 'shielding')
  const strength = data.kind === 'ir' ? 'Integrated intensity (km/mol)' : data.kind === 'raman' ? 'Raman activity (A^4/amu)' : data.kind === 'uvvis' ? 'Oscillator strength' : 'Nuclei'
  const series: PlotSeries[] = []
  if (options.view !== 'sticks') series.push({ id: 'curve', type: 'line', label: 'Broadened', x, y, color: '#177f91' })
  if (options.view !== 'curve') series.push({ id: 'transitions', type: 'sticks', label: 'Transitions', x: peaks.map((p) => toX(p.x)), y: peaks.map((p) => p.y), axis: options.view === 'both' ? 'y2' : 'y', color: '#ba5271', labels: peaks.map((p) => p.label) })
  const yRange = (values: number[]): [number, number] => [Math.min(0, ...values) * 1.08, Math.max(...values, 1e-12) * 1.08]
  return { format: 'multiwfn-matterviz-plot', version: 1, kind: data.kind as PlotKind, title: `${SPECTRUM_NAMES[data.kind]} - ${data.name}`,
    panels: [{ id: 'spectrum', xAxis: { label: data.kind === 'nmr' ? options.nmrMode === 'shielding' ? 'Isotropic shielding' : 'Chemical shift' : wavelength ? 'Wavelength' : data.kind === 'uvvis' ? 'Energy' : 'Wavenumber', unit: units, range: reverse ? [end, start] : [start, end] },
      yAxis: { label: options.view === 'sticks' ? strength : `${strength} / ${data.kind === 'uvvis' ? 'eV' : units}`, range: yRange(options.view === 'sticks' ? peaks.map((p) => p.y) : y) },
      ...(options.view === 'both' ? { y2Axis: { label: strength, range: yRange(peaks.map((p) => p.y)) } } : {}), series }] }
}
