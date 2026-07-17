import assert from 'node:assert/strict'
import test from 'node:test'

import { signal_frontend_ready, type ReadyFetch } from '../src/startup.ts'

test('does not report ready outside a capability-bound managed session', async () => {
  let requests = 0
  const request: ReadyFetch = async () => {
    requests += 1
    throw new Error('unexpected readiness request')
  }

  assert.equal(
    await signal_frontend_ready(new URL('http://127.0.0.1:8765/index.html'), request),
    false,
  )
  assert.equal(requests, 0)
})

test('posts readiness with only the current session capability', async () => {
  let requestedUrl: URL | undefined
  let requestedInit: RequestInit | undefined
  const request: ReadyFetch = async (url, init) => {
    requestedUrl = url
    requestedInit = init
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }

  const ready = await signal_frontend_ready(
    new URL('http://127.0.0.1:8765/index.html?manifest=/session/manifest.json&cap=session-secret'),
    request,
  )

  assert.equal(ready, true)
  assert.equal(requestedUrl?.href, 'http://127.0.0.1:8765/api/ready?cap=session-secret')
  assert.deepEqual(requestedInit, { method: 'POST', cache: 'no-store' })
})

test('rejects a failed readiness acknowledgement', async () => {
  const request: ReadyFetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({ ok: false }),
  })

  await assert.rejects(
    signal_frontend_ready(
      new URL('http://127.0.0.1:8765/index.html?cap=session-secret'),
      request,
    ),
    /HTTP 404/,
  )
})
