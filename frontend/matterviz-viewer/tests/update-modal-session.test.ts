import assert from 'node:assert/strict'
import test from 'node:test'

import { create_update_modal_session, type UpdateStatus } from '../src/update.ts'

const status = (state: UpdateStatus['state']): UpdateStatus => ({ visible: true, state, conflicts: [] })
const flush = async (): Promise<void> => { await new Promise<void>((resolve) => setImmediate(resolve)) }

const fixture = () => {
  const calls: Array<{
    action: string
    signal: AbortSignal
    resolve: (value: UpdateStatus) => void
    reject: (error: Error) => void
  }> = []
  const statuses: UpdateStatus[] = []
  const errors: unknown[] = []
  const timers = new Map<number, () => void>()
  let timer_id = 0
  let busy = false
  const session = create_update_modal_session({
    client: (signal) => {
      const request = (action: string) => new Promise<UpdateStatus>((resolve, reject) => {
        // Deliberately allow completion after abort to exercise stale-response guards.
        calls.push({ action, signal, resolve, reject })
      })
      return {
        status: () => request('status'), check: () => request('check'),
        stage: () => request('stage'), install: () => request('install'),
      }
    },
    onStatus: (value) => statuses.push(value),
    onError: (error) => errors.push(error),
    onBusy: (value) => { busy = value },
    timer: {
      setTimeout: (callback, delay) => {
        assert.equal(delay, 500)
        timers.set(++timer_id, callback)
        return timer_id
      },
      clearTimeout: (id) => { timers.delete(id as number) },
    },
  })
  return {
    session, calls, statuses, errors, timers,
    busy: () => busy,
    tick: () => {
      assert.equal(timers.size, 1)
      const [id, callback] = timers.entries().next().value!
      timers.delete(id)
      callback()
    },
  }
}

test('opening refreshes once and reopening observes completion while dismissed', async () => {
  const f = fixture()
  f.session.set_open(false)
  assert.equal(f.calls.length, 0)
  f.session.set_open(true)
  f.session.set_open(true)
  assert.deepEqual(f.calls.map((call) => call.action), ['status'])
  assert.equal(f.busy(), true)
  f.calls[0].resolve(status('checking'))
  await flush()
  assert.equal(f.busy(), false)
  assert.equal(f.timers.size, 1)

  f.session.set_open(false)
  assert.equal(f.calls[0].signal.aborted, true)
  assert.equal(f.timers.size, 0)
  f.session.set_open(true)
  assert.equal(f.calls.length, 2)
  f.calls[1].resolve(status('available'))
  await flush()
  assert.deepEqual(f.statuses.map((value) => value.state), ['checking', 'available'])
  assert.equal(f.timers.size, 0)
})

test('reopening during staging resumes serial polling until ready', async () => {
  const f = fixture()
  f.session.set_open(true)
  f.calls[0].resolve(status('staging'))
  await flush()
  f.session.set_open(false)
  f.session.set_open(true)
  f.calls[1].resolve(status('staging'))
  await flush()
  f.tick()
  f.session.set_open(true)
  assert.equal(f.calls.length, 3)
  assert.equal(f.timers.size, 0, 'no timer while a status request is in flight')
  f.calls[2].resolve(status('staging'))
  await flush()
  f.tick()
  f.calls[3].resolve(status('ready'))
  await flush()
  assert.equal(f.statuses.at(-1)?.state, 'ready')
  assert.equal(f.timers.size, 0)
})

test('closing during refresh aborts it and a stale response cannot affect the reopened modal', async () => {
  const f = fixture()
  f.session.set_open(true)
  f.session.set_open(false)
  assert.equal(f.busy(), false)
  assert.equal(f.calls[0].signal.aborted, true)
  f.session.set_open(true)
  f.calls[0].resolve(status('checking'))
  await flush()
  assert.equal(f.busy(), true, 'the new refresh is still pending')
  assert.deepEqual(f.statuses, [])
  assert.equal(f.timers.size, 0)
  f.calls[1].resolve(status('ready'))
  await flush()
  assert.equal(f.busy(), false)
  assert.deepEqual(f.statuses.map((value) => value.state), ['ready'])
})

test('closing during a poll ignores its later error and reopening refreshes again', async () => {
  const f = fixture()
  f.session.set_open(true)
  f.calls[0].resolve(status('checking'))
  await flush()
  f.tick()
  f.session.set_open(false)
  assert.equal(f.calls[1].signal.aborted, true)
  f.session.set_open(true)
  f.calls[2].resolve(status('available'))
  await flush()
  f.calls[1].reject(new Error('old connection failed'))
  await flush()
  assert.deepEqual(f.errors, [])
  assert.deepEqual(f.statuses.map((value) => value.state), ['checking', 'available'])
  assert.equal(f.timers.size, 0)
})

test('actions cannot overlap a refresh or another action and dismissal cancels their response', async () => {
  const f = fixture()
  f.session.set_open(true)
  await f.session.run_action('check')
  assert.equal(f.calls.length, 1)
  f.calls[0].resolve(status('idle'))
  await flush()
  const action = f.session.run_action('check')
  await f.session.run_action('check')
  assert.deepEqual(f.calls.map((call) => call.action), ['status', 'check'])
  f.session.set_open(false)
  assert.equal(f.calls[1].signal.aborted, true)
  f.calls[1].resolve(status('checking'))
  await action
  assert.equal(f.timers.size, 0)
  assert.deepEqual(f.statuses.map((value) => value.state), ['idle'])
  await f.session.run_action('check')
  assert.equal(f.calls.length, 2)
})

test('an action cancels an older poll and only its own result starts further polling', async () => {
  const f = fixture()
  f.session.set_open(true)
  f.calls[0].resolve(status('checking'))
  await flush()
  f.tick()
  const action = f.session.run_action('check')
  assert.equal(f.calls[1].signal.aborted, true)
  f.calls[2].resolve(status('checking'))
  await action
  f.calls[1].resolve(status('available'))
  await flush()
  assert.deepEqual(f.statuses.map((value) => value.state), ['checking', 'checking'])
  assert.equal(f.timers.size, 1)
  f.session.destroy()
  assert.equal(f.timers.size, 0)
})

test('destroying aborts pending requests and prevents callbacks or subsequent work', async () => {
  const f = fixture()
  f.session.set_open(true)
  f.session.destroy()
  assert.equal(f.calls[0].signal.aborted, true)
  f.calls[0].reject(new Error('aborted'))
  await flush()
  f.session.set_open(false)
  f.session.set_open(true)
  await f.session.run_action('check')
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.statuses, [])
  assert.deepEqual(f.errors, [])
  assert.equal(f.timers.size, 0)
})

test('refresh and action failures clear busy state and allow a retry', async () => {
  const f = fixture()
  f.session.set_open(true)
  const refresh_error = new Error('status failed')
  f.calls[0].reject(refresh_error)
  await flush()
  assert.deepEqual(f.errors, [refresh_error])
  assert.equal(f.busy(), false)
  const action = f.session.run_action('check')
  const action_error = new Error('check failed')
  f.calls[1].reject(action_error)
  await action
  assert.deepEqual(f.errors, [refresh_error, action_error])
  assert.equal(f.busy(), false)
  const retry = f.session.run_action('check')
  f.calls[2].resolve(status('available'))
  await retry
  assert.equal(f.statuses.at(-1)?.state, 'available')
  assert.equal(f.timers.size, 0)
})
