import assert from 'node:assert/strict'
import { test } from 'node:test'
import { download_blob } from '../src/save-export.ts'

test('native saving awaits the chooser and never falls back on cancel or failure', async () => {
  const oldWindow = globalThis.window
  const oldFetch = globalThis.fetch
  Object.assign(globalThis, { window: { __MULTIWFN_NATIVE_EXPORT__: true, location: { href: 'http://127.0.0.1:1234/index.html?cap=session' } } })
  const png = new Blob(['png bytes'], { type: 'image/png' })
  try {
    for (const status of ['saved', 'cancelled']) {
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input))
        assert.equal(url.origin, 'http://127.0.0.1:1234')
        assert.equal(url.pathname, '/api/viewer-export')
        assert.equal(url.searchParams.get('cap'), 'session')
        assert.equal(url.searchParams.get('filename'), 'scene.png')
        assert.equal(init?.method, 'POST')
        assert.equal(init?.body, png)
        return Response.json({ status })
      }
      assert.equal(await download_blob(png, 'scene.png'), status)
    }
    globalThis.fetch = async () => Response.json({ message: 'Disk full' }, { status: 500 })
    await assert.rejects(download_blob(png, 'scene.png'), /Disk full/)
    globalThis.fetch = async () => Response.json({ status: 'unknown' })
    await assert.rejects(download_blob(png, 'scene.png'), /Invalid save response/)
  } finally {
    Object.assign(globalThis, { window: oldWindow, fetch: oldFetch })
  }
})
