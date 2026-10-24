import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createServer } from 'vite'

let server: Awaited<ReturnType<typeof createServer>>
let api: typeof import('../src/frequency.ts')
const fixture = async (name = 'gaussian16-water') => JSON.parse(await readFile(new URL(`./fixtures/frequency/${name}.cjson`, import.meta.url), 'utf8'))
test.before(async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
    cacheDir: 'node_modules/.vite-frequency-tests',
  })
  api = await server.ssrLoadModule('/src/frequency.ts')
})
test.after(async () => { await server?.close() })

test('cclib exports from real Gaussian and ORCA outputs preserve all source modes and atom order', async () => {
  for (const [name, atoms, count, frequencies] of [
    ['gaussian16-water', 3, 3, [2169.7613, 4141.3837, 4392.5759]],
    ['orca42-dvb', 20, 54, [45.75, 78.4, 150.6]],
  ] as const) {
    const text = await readFile(new URL(`./fixtures/frequency/${name}.cjson`, import.meta.url), 'utf8')
    const source = JSON.parse(text)
    const data = api.read_frequency_cjson(text)
    assert.equal(data.structure.sites.length, atoms)
    assert.equal(data.modes.length, count)
    assert.deepEqual(data.modes.slice(0, 3).map(mode => mode.frequency), frequencies)
    assert.deepEqual(data.structure.sites.flatMap(site => site.xyz), source.atoms.coords['3d'])
    assert.deepEqual(data.modes.map(mode => mode.displacement), source.vibrations.displacement)
    assert.deepEqual(data.modes.map(mode => mode.ir), source.vibrations.intensities.IR)
    assert.deepEqual(data.modes.map(mode => mode.number), Array.from({ length: count }, (_, index) => index + 1))
    assert.ok(!('lattice' in data.structure), 'molecules must not acquire a fictitious cell')
  }
})

test('real water mode retains O/H displacement ratios and gives a bounded visual excursion', async () => {
  const source = await fixture()
  const data = api.read_frequency_cjson(JSON.stringify(source))
  assert.deepEqual(data.structure.sites.map(site => site.species[0].element), ['O', 'H', 'H'])
  const unchanged = JSON.stringify(data)
  const trajectory = api.frequency_trajectory(data, 0, .35)
  assert.equal(trajectory.frames.length, 1, 'only equilibrium is eager; native trajectory owns playback/cache')
  const read = async (index: number) => (await trajectory.frame_loader!.load_frame('', index))!
  assert.deepEqual((await read(0)).structure.sites.map(site => site.xyz), data.structure.sites.map(site => site.xyz))
  const plus = await read(12), minus = await read(36)
  const shifts = plus.structure.sites.map((site, atom) => site.xyz.map((v, axis) => v - data.structure.sites[atom].xyz[axis]))
  const ratio = shifts[0][2] / shifts[1][2]
  assert.ok(Math.abs(ratio - (-.07 / .54)) < 1e-12, 'must not apply sqrt(mass) a second time')
  assert.ok(Math.abs(Math.max(...shifts.map(v => Math.hypot(...v))) - .35) < 1e-12)
  for (const [atom, site] of minus.structure.sites.entries()) {
    site.xyz.forEach((value, axis) => assert.ok(Math.abs(value - data.structure.sites[atom].xyz[axis] + shifts[atom][axis]) < 1e-12))
  }
  assert.equal(plus.structure.properties?.bonds, data.structure.properties?.bonds, 'equilibrium bonds remain fixed')
  assert.equal(JSON.stringify(data), unchanged)
})

test('imaginary/zero frequencies and missing intensities do not discard or reorder source modes', async () => {
  const source = await fixture()
  source.vibrations.frequencies[0] = -2169.7613
  source.vibrations.frequencies[1] = 0
  source.vibrations.intensities.IR[0] = null
  const data = api.read_frequency_cjson(JSON.stringify(source))
  assert.deepEqual(data.modes.map(mode => mode.frequency), [-2169.7613, 0, 4392.5759])
  assert.equal(data.modes[0].ir, undefined)
  const trajectory = api.frequency_trajectory(data, 0)
  assert.equal(trajectory.metadata?.frequency_cm_1, -2169.7613)
  delete source.vibrations.intensities
  assert.ok(api.read_frequency_cjson(JSON.stringify(source)).modes.every(mode => mode.ir === undefined))
})

test('incomplete/misaligned/nonfinite inputs fail before publishing a dataset', async () => {
  const cases: [((data: any) => void), RegExp][] = [
    [data => { delete data.vibrations.displacement }, /displacements/],
    [data => { data.vibrations.displacement.pop() }, /displacements/],
    [data => { data.vibrations.displacement[0].pop() }, /atom count/],
    [data => { data.vibrations.displacement[0][0] = [1, 2] }, /displacement/],
    [data => { data.vibrations.displacement[0][0][0] = null }, /finite/],
    [data => { data.vibrations.displacement[0] = Array.from({length: 3}, () => [0, 0, 0]) }, /nonzero/],
    [data => { data.vibrations.frequencies[0] = '2169' }, /finite/],
    [data => { data.vibrations.intensities.IR.pop() }, /intensities/],
    [data => { data.atoms.coords['3d'].pop() }, /coordinates/],
    [data => { data.atoms.elements.number[0] = 119 }, /atomic number/],
    [data => { data['unit cell'] = {} }, /periodic/],
    [data => { data['chemical json'] = 1 }, /cclib/],
  ]
  for (const [change, pattern] of cases) {
    const source = await fixture()
    change(source)
    assert.throws(() => api.read_frequency_cjson(JSON.stringify(source)), pattern)
  }
  assert.throws(() => api.read_frequency_cjson('{"chemical json":0'), SyntaxError)
  assert.throws(() => api.read_frequency_cjson(' '.repeat(api.FREQUENCY_FILE_LIMIT + 1)), /16 MiB/)
})

test('invalid visual settings and out-of-range frame access are rejected', async () => {
  const data = api.read_frequency_cjson(JSON.stringify(await fixture()))
  for (const amplitude of [0, -1, NaN, Infinity, 2.01]) assert.throws(() => api.frequency_trajectory(data, 0, amplitude), /amplitude/)
  assert.throws(() => api.frequency_trajectory(data, 99), /normal mode/)
  const trajectory = api.frequency_trajectory(data, 0)
  for (const frame of [-1, .5, 48, NaN]) await assert.rejects(trajectory.frame_loader!.load_frame('', frame), /frame/)
})

test('tiny finite displacement scales never create NaN coordinates', async () => {
  const source = await fixture()
  source.vibrations.displacement = source.vibrations.displacement.map((mode: number[][]) => mode.map(row => row.map(value => value * 1e-310)))
  const data = api.read_frequency_cjson(JSON.stringify(source))
  const trajectory = api.frequency_trajectory(data, 0)
  for (const index of [0, 12]) {
    const frame = await trajectory.frame_loader!.load_frame('', index)
    assert.ok(frame!.structure.sites.every(site => site.xyz.every(Number.isFinite)))
  }
})
