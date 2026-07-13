import assert from 'node:assert/strict'
import test from 'node:test'

import { request_return_and_close } from '../src/return.ts'

test('closes exactly once after a successful Return request', async () => {
  let returned = 0
  let closed = 0
  const errors: unknown[] = []

  await request_return_and_close({
    request: async () => undefined,
    close: () => { closed += 1 },
    onReturned: () => { returned += 1 },
    onError: (error) => errors.push(error),
  })

  assert.equal(returned, 1)
  assert.equal(closed, 1)
  assert.deepEqual(errors, [])
})

test('still closes exactly once when the Return request fails', async () => {
  const failure = new Error('request failed')
  let returned = 0
  let closed = 0
  const errors: unknown[] = []

  await request_return_and_close({
    request: async () => { throw failure },
    close: () => { closed += 1 },
    onReturned: () => { returned += 1 },
    onError: (error) => errors.push(error),
  })

  assert.equal(returned, 0)
  assert.equal(closed, 1)
  assert.deepEqual(errors, [failure])
})

test('reports a close failure without repeating the Return request', async () => {
  const closeFailure = new Error('close failed')
  let requests = 0
  const errors: unknown[] = []

  await request_return_and_close({
    request: async () => { requests += 1 },
    close: () => { throw closeFailure },
    onReturned: () => undefined,
    onError: (error) => errors.push(error),
  })

  assert.equal(requests, 1)
  assert.deepEqual(errors, [closeFailure])
})
