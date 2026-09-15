import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileModule } from 'svelte/compiler'
import type { AnyStructure } from 'matterviz'
import { analysis_structure_key } from '../src/analysis-structure.ts'

const fixture = () => ({
  sites: [{ xyz: [0, 0, 0], species: [{ element: 'C', occu: 1 }], label: 'Carbon', properties: {} }],
  lattice: { matrix: [[5, 0, 0], [0, 5, 0], [0, 0, 5]], pbc: [true, true, true] },
  charge: 0,
})
const key = (value: unknown) => analysis_structure_key(value as AnyStructure)

test('analysis identity includes coordinates, elements, occupancies, cell, periodicity and charge', () => {
  const original = fixture()
  const expected = key(original)
  for (const edit of [
    (s: ReturnType<typeof fixture>) => { s.sites[0].xyz[0] = 1 },
    (s: ReturnType<typeof fixture>) => { s.sites[0].species[0].element = 'O' },
    (s: ReturnType<typeof fixture>) => { s.sites[0].species[0].occu = .5 },
    (s: ReturnType<typeof fixture>) => { s.sites.push(structuredClone(s.sites[0])) },
    (s: ReturnType<typeof fixture>) => { s.lattice.matrix[0][0] = 6 },
    (s: ReturnType<typeof fixture>) => { s.lattice.pbc[0] = false },
    (s: ReturnType<typeof fixture>) => { s.charge = 1 },
  ]) {
    const changed = structuredClone(original)
    edit(changed)
    assert.notEqual(key(changed), expected)
  }
  assert.equal(analysis_structure_key(undefined), '')
})

test('display labels, properties, derived cell dimensions and species ordering do not invalidate analysis', () => {
  const original = fixture()
  original.sites[0].species.push({ element: 'N', occu: .5 })
  const changed = structuredClone(original)
  changed.sites[0].label = 'site 1'
  changed.sites[0].properties = { color: 'red', selected: true }
  changed.sites[0].species.reverse()
  Object.assign(changed.lattice, { a: 5, volume: 125 })
  assert.equal(key(changed), key(original))
})

test('production manifest loaders discard stale analysis but finish startup; failed loads do not signal ready', async () => {
  const source = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8')
  const effectStart = source.indexOf('  $effect(() => {\n    if (loadedGeometryKey')
  const effectEnd = source.indexOf('  let displayedStructure', effectStart)
  const loadStart = source.indexOf('      if (manifest.topology) {')
  const loadEnd = source.indexOf("      if (String(manifest.multiwfnGui?.entry", loadStart)
  const finishStart = source.indexOf("      set_status(surfaceResult ? ui_message('Original quantitative surface results loaded')", loadEnd)
  const finishEnd = source.indexOf('\n  }', finishStart)
  const derived = source.split('\n').find((line) => line.includes('const geometryKey = $derived'))!
  assert.ok(effectStart > 0 && effectEnd > effectStart && loadStart > 0 && loadEnd > loadStart
    && finishStart > loadEnd && finishEnd > finishStart)
  // Exercise both production loader blocks and the real completion/catch/finally
  // path. A stale result must not prevent the native startup-ready handshake.
  const code = `
    import assert from 'node:assert/strict'
    import { flushSync } from 'svelte'
    import { analysis_structure_key } from './src/analysis-structure.ts'
    import { ui_message, format_message } from './src/i18n.ts'
    async function exercise(stage, change, reject = false) {
      let topologyGeneration = 0
      let structure = $state(${JSON.stringify(fixture())})
      let loadedGeometryKey = $state(analysis_structure_key(structure))
      ${derived}
      let topologyResult = $state.raw(), topologyActive = $state(false), topologySelection = $state()
      let surfaceResult = $state.raw(), surfaceActive = $state(false), surfaceSelection = $state()
      let surfacePanelOpen = $state(false), topologyPanelOpen = $state(false), orbitalPanelOpen = $state(true)
      let surfaceFitPending = false, loading = true, readyCalls = 0, restoredCalls = 0, status = ''
      const errors = []
      const set_status = value => status = value
      const signal_frontend_ready = async () => readyCalls++
      const report_error = error => errors.push(error.message)
      const startupState = {}, entries = []
      const apply_workbench_state = () => restoredCalls++
      const open_surface_results = () => { surfaceActive = true; surfacePanelOpen = true }
      const cleanup = $effect.root(() => { ${source.slice(effectStart, effectEnd)} })
      flushSync()
      let finishTopology, rejectTopology, finishSurface, rejectSurface
      const load_topology = () => new Promise((resolve, reject) => { finishTopology = resolve; rejectTopology = reject })
      const load_surface = () => new Promise((resolve, reject) => { finishSurface = resolve; rejectSurface = reject })
      const manifest = { topology: {}, surfaceAnalysis: {} }
      const generation = topologyGeneration
      const request = async () => {
        try {
          ${source.slice(loadStart, loadEnd)}
          ${source.slice(finishStart, finishEnd)}
      }
      const edit = () => {
        if (change === 'coordinates') structure.sites[0].xyz[0] = 10
        if (change === 'species') structure.sites[0].species[0].element = 'O'
        if (change === 'lattice') structure.lattice.matrix[0][0] = 6
        if (change === 'generation') topologyGeneration++
        flushSync()
      }
      const pending = request()
      if (stage === 'topology') edit()
      if (reject && stage === 'topology') rejectTopology(new Error('topology failed'))
      else {
        finishTopology({ source: 'topology' })
        await Promise.resolve()
        if (stage === 'surface') edit()
        if (reject) rejectSurface(new Error('surface failed'))
        else finishSurface({ source: 'surface' })
      }
      await pending
      flushSync()
      assert.equal(loading, false)
      assert.equal(readyCalls, reject ? 0 : 1, stage + ':' + change + ' readiness')
      assert.equal(restoredCalls, reject ? 0 : 1)
      if (reject) {
        assert.deepEqual(errors, [stage + ' failed'])
        assert.equal(format_message('en', status), 'Session loading failed')
      } else {
        assert.deepEqual(errors, [])
        assert.equal(Boolean(surfaceResult), !change)
        assert.equal(surfaceActive, !change)
        assert.equal(surfaceFitPending, !change)
        const topologyExpected = !change || (stage === 'surface' && change === 'generation')
        assert.equal(Boolean(topologyResult), topologyExpected)
        assert.equal(topologyActive, topologyExpected)
      }
      cleanup()
    }
    for (const stage of ['topology', 'surface']) {
      for (const change of ['', 'coordinates', 'species', 'lattice', 'generation']) await exercise(stage, change)
      await exercise(stage, '', true)
    }
  `
  const compiled = compileModule(code, { filename: 'analysis-lifetime.svelte.js', generate: 'client' })
  execFileSync(process.execPath, ['--conditions=browser', '--experimental-strip-types', '--input-type=module'], {
    input: compiled.js.code, cwd: new URL('..', import.meta.url), timeout: 15000, stdio: 'pipe',
  })
})
