import assert from 'node:assert/strict'
import test from 'node:test'

import {
  create_update_client,
  is_update_active,
  parse_update_status,
  poll_update_status,
  type UpdateStatus,
} from '../src/update.ts'

const page = new URL('http://127.0.0.1:8765/index.html?manifest=/session/manifest.json&cap=session-secret')
const response = (payload: unknown, ok = true, status = 200) => ({ ok, status, json: async () => payload })
const valid = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  format: 'multiwfn-matterviz-update', version: 1, visible: true, state: 'idle', conflicts: [], ...patch,
})

test('validates status, hides malformed fields, and sanitizes plain text', () => {
  const status = parse_update_status(valid({
    state: 'conflict', currentTag: 'v1.2.3', targetTag: 'v1.3.0', progress: 2,
    message: '<b>Keep</b>\n working', conflicts: ['<path>\nchanged', 42],
  }))
  assert.equal(status.progress, 2)
  assert.equal(status.message, 'bKeep/b working')
  assert.deepEqual(status.conflicts, ['path changed'])
  assert.throws(() => parse_update_status({ ...valid(), version: 2 }), /Unsupported/)
  assert.throws(() => parse_update_status({ ...valid(), state: 'unknown' }), /Invalid update state/)
  assert.throws(() => parse_update_status({ ...valid(), visible: 'yes' }), /visibility/)
})

test('formal sessions remain hidden and active states are narrowly defined', () => {
  assert.equal(parse_update_status(valid({ visible: false })).visible, false)
  assert.equal(is_update_active('checking'), true)
  assert.equal(is_update_active('available'), false)
  assert.equal(is_update_active('ready'), false)
  assert.equal(is_update_active('recovery'), false)
})

test('uses the page capability and exact JSON POST contract', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const client = create_update_client(page, async (url, init) => {
    calls.push({ url: url.href, init })
    return response(valid({ state: calls.length === 1 ? 'checking' : 'available', targetTag: 'v2.0.0' }))
  })
  await client.check()
  await client.stage()
  assert.equal(calls[0].url, 'http://127.0.0.1:8765/api/update/check?cap=session-secret')
  assert.equal(calls[1].url, 'http://127.0.0.1:8765/api/update/stage?cap=session-secret')
  assert.deepEqual(calls[0].init, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: '{}' })
})

test('polling never overlaps requests and cancels pending work', async () => {
  let scheduled: (() => void) | undefined
  let scheduleCount = 0
  let clearCount = 0
  const timer = {
    setTimeout: (callback: () => void, delay: number) => { assert.equal(delay, 500); scheduled = callback; scheduleCount += 1; return scheduleCount },
    clearTimeout: (_id: number) => { clearCount += 1 },
  }
  let requests = 0
  let resolveRequest: ((status: UpdateStatus) => void) | undefined
  const statuses: UpdateStatus[] = []
  const stop = poll_update_status({
    client: { status: () => { requests += 1; return new Promise<UpdateStatus>((resolve) => { resolveRequest = resolve }) } },
    initial: parse_update_status(valid({ state: 'checking' })),
    onStatus: (status) => statuses.push(status),
    onError: (error) => { throw error },
    timer,
  })
  assert.equal(scheduleCount, 1)
  scheduled?.()
  assert.equal(requests, 1)
  assert.equal(scheduleCount, 1)
  resolveRequest?.(parse_update_status(valid({ state: 'available' })))
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  assert.equal(statuses[0]?.state, 'available')
  assert.equal(scheduleCount, 1)
  stop()
  assert.equal(clearCount, 1)
})
