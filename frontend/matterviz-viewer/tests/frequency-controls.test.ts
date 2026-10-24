import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createServer } from 'vite'

let server: Awaited<ReturnType<typeof createServer>>
let frequency: typeof import('../src/frequency.ts')
const source = await readFile(new URL('./fixtures/frequency/gaussian16-water.cjson', import.meta.url), 'utf8')
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const file = (name: string, text = async () => source, size = source.length) => ({ name, size, text })
test.before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', cacheDir: 'node_modules/.vite-frequency-controls-tests' })
  frequency = await server.ssrLoadModule('/src/frequency.ts')
})
test.after(async () => { await server?.close() })

test('native displacement vectors exactly equal each rendered xyz shift, retaining sign and atom ratios', async () => {
  const data = frequency.read_frequency_cjson(source)
  const trajectory = frequency.frequency_trajectory(data, 0, .35)
  const { get_all_site_vectors } = await server.ssrLoadModule('/node_modules/matterviz/dist/structure/index.js')
  for (const idx of [0, 12, 36]) {
    const frame = (await trajectory.frame_loader!.load_frame('', idx))!
    for (const [atom, site] of frame.structure.sites.entries()) {
      const vector = site.properties?.displacement
      assert.deepEqual(vector, site.xyz.map((v, axis) => v - data.structure.sites[atom].xyz[axis]))
      assert.deepEqual(get_all_site_vectors(site), [{ key: 'displacement', vec: vector }])
    }
  }
})

test('ordered queue parses only selected files and preserves displayed data/identity on malformed middle item', async () => {
  const { create_frequency_queue } = await server.ssrLoadModule('/src/frequency-queue.ts')
  const reads: string[] = []
  const queue = create_frequency_queue()
  const files = [file('first', async () => { reads.push('first'); return source }), file('bad', async () => { reads.push('bad'); return '{}' }), file('last', async () => { reads.push('last'); return source })]
  await queue.replace(files)
  assert.deepEqual(reads, ['first'])
  const valid = queue.state.data
  await queue.select(1)
  assert.equal(queue.state.index, 1)
  assert.match(queue.state.error, /cclib/)
  assert.equal(queue.state.data, valid)
  assert.equal(queue.state.displayedName, 'first')
  assert.equal(queue.state.files[1].name, 'bad')
  await queue.select(2)
  assert.equal(queue.state.displayedName, 'last')
  assert.deepEqual(reads, ['first', 'bad', 'last'])
  assert.deepEqual(queue.state.files.map((item: File) => item.name), ['first', 'bad', 'last'])
})

test('replacement, rapid navigation and close invalidate delayed reads without stale publishing', async () => {
  const { create_frequency_queue } = await server.ssrLoadModule('/src/frequency-queue.ts')
  const old = deferred<string>(), middle = deferred<string>(), closed = deferred<string>()
  const updates: unknown[] = []
  const queue = create_frequency_queue((state: unknown) => updates.push(state))
  const pending = queue.replace([file('old', () => old.promise)])
  await queue.replace([file('new'), file('middle', () => middle.promise), file('last')])
  old.resolve(source); await pending
  assert.equal(queue.state.displayedName, 'new')
  const changing = queue.select(1)
  await queue.select(2)
  middle.resolve(source); await changing
  assert.equal(queue.state.displayedName, 'last')
  const closing = queue.replace([file('closed', () => closed.promise)])
  queue.dispose(); const count = updates.length
  closed.resolve(source); await closing
  assert.equal(updates.length, count)
  assert.equal(queue.state.displayedName, 'last')
})

test('queue rejects oversized files before reading and handles read failures without losing valid scene', async () => {
  const { create_frequency_queue } = await server.ssrLoadModule('/src/frequency-queue.ts')
  const queue = create_frequency_queue()
  await queue.replace([file('valid')]); const data = queue.state.data
  await queue.replace([file('large', async () => { throw Error('must not read') }, frequency.FREQUENCY_FILE_LIMIT + 1)])
  assert.match(queue.state.error, /16 MiB/)
  await queue.replace([file('unreadable', async () => { throw Error('disk read failed') })])
  assert.equal(queue.state.data, data)
  assert.equal(queue.state.displayedName, 'valid')
  assert.match(queue.state.error, /disk read failed/)
})
