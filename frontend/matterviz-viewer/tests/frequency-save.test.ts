import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
let server: Awaited<ReturnType<typeof createServer>>
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
test.before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', cacheDir: 'node_modules/.vite-frequency-save-tests' })
})
test.after(async () => { await server?.close() })

test('native save sends exact bytes/capability and awaits saved, cancellation and failure distinctly', async () => {
  const { create_frequency_save } = await server.ssrLoadModule('/src/frequency-save.ts')
  const response = deferred<Response>()
  let request!: { url: URL; init: RequestInit }
  const sink = create_frequency_save(new URL('http://127.0.0.1:1234/?workbench=1&cap=secret'), async (url: URL, init: RequestInit) => { request = { url: new URL(String(url)), init }; return response.promise })
  const blob = new Blob([new Uint8Array([137,80,78,71,13,10,26,10,1])], { type: 'image/png' })
  let settled = false
  const pending = sink(blob, 'water.png', 'image/png').then(() => { settled = true })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(settled, false)
  assert.equal(request.url.pathname, '/api/viewer-export')
  assert.equal(request.url.searchParams.get('cap'), 'secret')
  assert.equal(request.url.searchParams.get('filename'), 'water.png')
  assert.deepEqual(new Uint8Array(await (request.init.body as Blob).arrayBuffer()), new Uint8Array(await blob.arrayBuffer()))
  response.resolve(Response.json({ status: 'saved' })); await pending
  const cancelled = create_frequency_save(new URL('http://localhost/?cap=x'), async () => Response.json({ status: 'cancelled' }))
  await assert.rejects(cancelled('text', 'water.xyz', 'text/plain'), { name: 'AbortError' })
  const failed = create_frequency_save(new URL('http://localhost/?cap=x'), async () => Response.json({ message: 'write failed' }, { status: 500 }))
  await assert.rejects(failed('text', 'water.xyz', 'text/plain'), /write failed/)
  await assert.rejects(create_frequency_save(new URL('http://localhost/'), async () => { throw Error('must not fetch') })('text', 'x.xyz', 'text/plain'), /native host/i)
})

test('save exposes bounded host rejection text and never submits after its viewer is closed', async () => {
  const { create_frequency_save, FREQUENCY_EXPORT_LIMIT } = await server.ssrLoadModule('/src/frequency-save.ts')
  const rejected = create_frequency_save(new URL('http://localhost/?cap=x'), async () => new Response('Payload Too Large', { status: 413 }))
  await assert.rejects(rejected('text', 'water.xyz', 'text/plain'), { message: 'Payload Too Large' })
  let requests = 0
  const controller = new AbortController()
  const closed = create_frequency_save(new URL('http://localhost/?cap=x'), async () => { requests++; return Response.json({ status: 'saved' }) }, controller.signal)
  controller.abort()
  await assert.rejects(closed('text', 'water.xyz', 'text/plain'), { name: 'AbortError' })
  assert.equal(requests, 0)
  assert.equal(FREQUENCY_EXPORT_LIMIT, 64 * 1024 * 1024)
})
