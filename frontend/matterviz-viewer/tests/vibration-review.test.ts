import assert from 'node:assert/strict'
import test from 'node:test'
import {
  api_url,
  load_vibration_session,
  sanitize_save_file_name,
  save_file_via_dialog,
} from '../src/vibration.ts'

const page = new URL('http://127.0.0.1:43123/vibration.html?cap=secret-session-cap')
const manifest = {
  format: 'multiwfn-matterviz-vibration', version: 1,
  structure: { path: 'structure.json', format: 'json' },
  vibrations: {
    atomCount: 1, modeCount: 1, coordinateUnit: 'angstrom', frequencyUnit: 'cm^-1',
    modes: [{ index: 1, frequency: 1000, intensity: null }],
    displacements: {
      datasetId: 1, format: 'mwfn-plot-data-v1', role: 'u',
      layout: 'mode-major-atom-xyz', shape: [1, 1, 3],
    },
  },
}
const structure = { sites: [{ xyz: [0, 0, 0], species: [{ element: 'H', occu: 1 }] }] }

test('export names cannot carry Windows drive prefixes or alternate streams', () => {
  for (const name of ['C:evil.exe', 'D:out.webm', 'movie.webm:payload', '::']) {
    assert.ok(!sanitize_save_file_name(name).includes(':'))
  }
  assert.equal(sanitize_save_file_name('../../movie.webm'), 'movie.webm')
})

test('capability URL preserves existing query and replaces a stale capability', () => {
  const result = api_url('/api/save-file?name=movie.webm&cap=stale', page)
  assert.equal(result.searchParams.get('name'), 'movie.webm')
  assert.deepEqual(result.searchParams.getAll('cap'), ['secret-session-cap'])
})

test('capability URL refuses to send bearer capability to another origin', () => {
  for (const path of ['https://example.invalid/collect', '//example.invalid/collect']) {
    assert.throws(() => api_url(path, page), /same.origin/i)
  }
})

test('manifest, structure and displacement requests all carry the session capability', async () => {
  const requested: URL[] = []
  const stopAtCodec = new Error('stop before the independent binary decoder')
  const request: typeof fetch = async (input) => {
    const url = new URL(String(input))
    requested.push(url)
    if (requested.length === 1) return Response.json(manifest)
    if (requested.length === 2) return Response.json(structure)
    throw stopAtCodec
  }
  await assert.rejects(load_vibration_session(page, request), (error) => error === stopAtCodec)
  assert.deepEqual(requested.map((url) => url.pathname), [
    '/session/manifest.json', '/session/structure.json', '/api/plot-data/1',
  ])
  for (const url of requested) {
    assert.equal(url.origin, page.origin)
    assert.deepEqual(url.searchParams.getAll('cap'), ['secret-session-cap'])
  }
})

test('cross-origin manifest is rejected before any request', async () => {
  const hostile = new URL(page)
  hostile.searchParams.set('manifest', 'https://example.invalid/manifest.json')
  let calls = 0
  const request: typeof fetch = async () => { calls++; return Response.json(manifest) }
  await assert.rejects(load_vibration_session(hostile, request), /same.origin/i)
  assert.equal(calls, 0)
})

test('cross-origin structure is rejected before disclosing the capability', async () => {
  const calls: URL[] = []
  const request: typeof fetch = async (input) => {
    calls.push(new URL(String(input)))
    return Response.json({ ...manifest, structure: { path: 'https://example.invalid/structure.json' } })
  }
  await assert.rejects(load_vibration_session(page, request), /same.origin/i)
  assert.equal(calls.length, 1)
})

test('save request includes the capability and sanitized name', async () => {
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    assert.equal(url.searchParams.get('cap'), 'secret-session-cap')
    assert.equal(url.searchParams.get('name'), 'Cmovie.webm')
    assert.equal(init?.method, 'POST')
    assert.deepEqual(Array.from(init?.body as Uint8Array), [1, 2, 3])
    return Response.json({ ok: true })
  }
  const result = await save_file_via_dialog(new Uint8Array([1, 2, 3]), 'C:movie.webm', page, request)
  assert.equal(result.ok, true)
})
