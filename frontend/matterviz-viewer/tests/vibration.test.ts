import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CM_INV_PER_THZ,
  DEFAULT_VIBRATION_AMPLITUDE,
  VIBRATION_AUTO_PLAY,
  frequency_thz,
  is_imaginary_frequency,
  load_vibration_session,
  normalized_mode_pattern,
  parse_vibration_manifest,
  sanitize_save_file_name,
  save_file_via_dialog,
  site_mass_center,
  synthesize_vibration_trajectory,
} from '../src/vibration.ts'
import { decode_plot_dataset } from '../src/plot.ts'
import type { AnyStructure } from 'matterviz/structure'
import type { TrajectoryType } from 'matterviz/trajectory'

// Mirror of the vendored validate_trajectory's runtime contract (kept local because the
// vendored matterviz dist cannot be imported by bare Node in tests).
const assert_valid_trajectory = (trajectory: TrajectoryType): void => {
  assert.ok(trajectory.frames.length > 0, 'trajectory needs at least one frame')
  for (const frame of trajectory.frames) {
    assert.ok(frame.structure?.sites?.length > 0, 'frame needs sites')
    assert.equal(typeof frame.step, 'number')
  }
}

const valid_manifest = () => ({
  format: 'multiwfn-matterviz-vibration',
  version: 1,
  generatedBy: 'Multiwfn_MatterViz',
  multiwfnGui: { entry: 'drawvibgui' },
  structure: { path: 'structure.json', format: 'json' },
  vibrations: {
    sourceProgram: 'gaussian',
    spectrumKind: 'ir',
    atomCount: 2,
    modeCount: 2,
    coordinateUnit: 'angstrom',
    frequencyUnit: 'cm^-1',
    intensityUnit: 'km/mol',
    modes: [
      { index: 1, frequency: -120.5, intensity: 10.25 },
      { index: 2, frequency: 3650.0, intensity: null },
    ],
    displacements: {
      datasetId: 7,
      format: 'mwfn-plot-data-v1',
      role: 'u',
      layout: 'mode-major-atom-xyz',
      shape: [2, 2, 3],
    },
  },
})

test('accepts a valid vibration manifest', () => {
  const manifest = parse_vibration_manifest(valid_manifest())
  assert.equal(manifest.vibrations?.modes.length, 2)
  assert.equal(manifest.vibrations?.displacements.datasetId, 7)
})

test('rejects invalid vibration manifests', () => {
  const rejects = (patch: (doc: ReturnType<typeof valid_manifest>) => void) => {
    const doc = valid_manifest()
    patch(doc)
    assert.throws(() => parse_vibration_manifest(doc), /Invalid vibration session/)
  }
  rejects((doc) => { doc.format = 'multiwfn-matterviz-workbench' })
  rejects((doc) => { doc.version = 2 })
  rejects((doc) => { doc.vibrations.atomCount = 0 })
  rejects((doc) => { doc.vibrations.modeCount = 0 })
  rejects((doc) => { doc.vibrations.coordinateUnit = 'bohr' })
  rejects((doc) => { doc.vibrations.frequencyUnit = 'THz' })
  rejects((doc) => { doc.vibrations.modes = doc.vibrations.modes.slice(1) })
  rejects((doc) => { doc.vibrations.modes[0].frequency = Number.NaN })
  rejects((doc) => { doc.vibrations.modes[0].intensity = 'strong' })
  rejects((doc) => { doc.vibrations.displacements.datasetId = 0 })
  rejects((doc) => { doc.vibrations.displacements.format = 'mwfn-plot-data-v2' })
  rejects((doc) => { doc.vibrations.displacements.role = 'x' })
  rejects((doc) => { doc.vibrations.displacements.layout = 'atom-major' })
  rejects((doc) => { doc.vibrations.displacements.shape = [2, 2, 1] })
  rejects((doc) => { doc.vibrations.displacements.shape = [1, 2, 3] })
})

test('converts frequencies and flags imaginary modes', () => {
  assert.ok(Math.abs(frequency_thz(CM_INV_PER_THZ) - 1) < 1e-12)
  assert.ok(Math.abs(frequency_thz(100) - 2.99792458) < 1e-6)
  assert.equal(is_imaginary_frequency(-0.01), true)
  assert.equal(is_imaginary_frequency(0), false)
  assert.equal(is_imaginary_frequency(3650), false)
})

// [mode][atom][xyz]: mode 0 moves both atoms along z, mode 1 along x
const displacements = new Float64Array([
  0, 0, 0.5, 0, 0, -2.0,
  3.0, 0, 0, -1.0, 0, 0,
])
const shape: [number, number, number] = [2, 2, 3]

test('normalizes a mode pattern to a 1 Angstrom maximum excursion', () => {
  const pattern = normalized_mode_pattern(displacements, shape, 0)
  assert.deepEqual([...pattern], [0, 0, 0.25, 0, 0, -1])
  const pattern_x = normalized_mode_pattern(displacements, shape, 1)
  assert.deepEqual([...pattern_x], [1, 0, 0, -1 / 3, 0, 0])
  assert.throws(() => normalized_mode_pattern(displacements, shape, 2), /outside 0-1/)
  assert.throws(
    () => normalized_mode_pattern(new Float64Array(12), shape, 0),
    /zero displacement/,
  )
})

const structure = {
  sites: [
    { species: [{ element: 'O', occu: 1, oxidation_state: 0 }], abc: [0, 0, 0], xyz: [0, 0, 0], label: 'O1', properties: {} },
    { species: [{ element: 'H', occu: 1, oxidation_state: 0 }], abc: [0, 0, 0], xyz: [0.96, 0, 0], label: 'H1', properties: {} },
  ],
  charge: 0,
  properties: {},
} as unknown as AnyStructure

test('synthesizes one harmonic phase cycle as a valid trajectory', () => {
  const pattern = normalized_mode_pattern(displacements, shape, 0)
  const trajectory = synthesize_vibration_trajectory(structure, pattern, { amplitude: 0.5, n_frames: 4 })
  assert_valid_trajectory(trajectory)
  assert.equal(trajectory.frames.length, 4)
  // relative displacements are unaffected by the center-of-mass pinning
  const rel_z = (frame: number) => {
    const sites = trajectory.frames[frame].structure.sites
    return sites[0].xyz[2] - sites[1].xyz[2]
  }
  // frame 0: +amplitude * u; frame 1: equilibrium; frame 2: -amplitude * u
  assert.ok(Math.abs(rel_z(0) - (0.5 * 0.25 + 0.5)) < 1e-12)
  assert.ok(Math.abs(rel_z(1)) < 1e-12)
  assert.ok(Math.abs(rel_z(2) - -(0.5 * 0.25 + 0.5)) < 1e-12)
  // the mass center of every frame coincides with the equilibrium one
  const expected_center = site_mass_center(structure.sites)
  for (const frame of trajectory.frames) {
    const center = site_mass_center(frame.structure.sites)
    assert.ok(Math.abs(center[0] - expected_center[0]) < 1e-9)
    assert.ok(Math.abs(center[1] - expected_center[1]) < 1e-9)
    assert.ok(Math.abs(center[2] - expected_center[2]) < 1e-9)
  }
  // the instantaneous displacement rides the per-site `force` vector property
  const force = trajectory.frames[0].structure.sites[1].properties.force as number[]
  assert.ok(Math.abs(force[2] - -0.5) < 1e-12)
  // default amplitude follows the upstream phonon default
  const defaulted = synthesize_vibration_trajectory(structure, pattern, { n_frames: 2 })
  assert.equal(defaulted.metadata?.amplitude, DEFAULT_VIBRATION_AMPLITUDE)
  assert.throws(() => synthesize_vibration_trajectory(structure, pattern, { amplitude: 0 }), /amplitude/)
  assert.throws(() => synthesize_vibration_trajectory(structure, pattern, { n_frames: 1 }), /at least 2 frames/)
})

// Regression guard for issue #65: the viewer must open paused on a static frame and
// only start animating after the user clicks Play. If someone flips
// VIBRATION_AUTO_PLAY back to true, this test fails.
test('vibration viewer starts paused (issue #65)', () => {
  assert.equal(VIBRATION_AUTO_PLAY, false)
})

const crc32c = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0x82f63b78 & -(crc & 1))
  }
  return (~crc) >>> 0
}

// Minimal MWFNP2D v1 single-array frame, mirroring docs/matterviz-plot-protocol-v2.md
const encode_plot_dataset = (dataset_id: number, role: number, values: Float64Array): ArrayBuffer => {
  const header_bytes = 80
  const entry_bytes = 32
  const body_bytes = values.length * 8
  const body = new Uint8Array(values.buffer, values.byteOffset, body_bytes)
  const directory = new ArrayBuffer(entry_bytes)
  const entry = new DataView(directory)
  entry.setUint8(0, role)
  entry.setBigUint64(8, BigInt(values.length), true)
  entry.setBigUint64(16, 0n, true)
  entry.setBigUint64(24, BigInt(body_bytes), true)

  const header = new ArrayBuffer(header_bytes)
  const view = new DataView(header)
  const bytes = new Uint8Array(header)
  bytes.set(new TextEncoder().encode('MWFNP2D\0'), 0)
  view.setUint16(8, 1, true)
  view.setUint16(10, 0, true)
  view.setUint16(12, 1, true)
  view.setUint16(14, 1, true)
  view.setUint32(16, header_bytes, true)
  view.setBigUint64(20, BigInt(dataset_id), true)
  view.setUint32(28, 1, true)
  view.setUint32(32, entry_bytes, true)
  view.setBigUint64(36, BigInt(entry_bytes), true)
  view.setBigUint64(44, BigInt(body_bytes), true)
  view.setBigUint64(52, BigInt(values.length), true)
  view.setBigUint64(72, BigInt(header_bytes + entry_bytes + body_bytes), true)
  view.setUint32(64, crc32c(body), true)
  // the header CRC covers the final header with its own field zeroed, so it comes last
  view.setUint32(60, crc32c(bytes), true)

  const frame = new Uint8Array(header_bytes + entry_bytes + body_bytes)
  frame.set(bytes, 0)
  frame.set(new Uint8Array(directory), header_bytes)
  frame.set(body, header_bytes + entry_bytes)
  return frame.buffer
}

test('round-trips the displacement dataset frame through the decoder', () => {
  const decoded = decode_plot_dataset(encode_plot_dataset(7, 4, displacements))
  assert.equal(decoded.datasetId, 7)
  assert.deepEqual([...(decoded.dataset.u ?? [])], [...displacements])
})

test('loads and validates a full vibration session over HTTP', async () => {
  const page = new URL('http://127.0.0.1/vibration.html?manifest=/session/manifest.json&cap=testcap')
  const structure_json = JSON.stringify({
    sites: [
      { species: [{ element: 'O', occu: 1, oxidation_state: 0 }], abc: [0, 0, 0], xyz: [0, 0, 0], label: 'O1', properties: {} },
      { species: [{ element: 'H', occu: 1, oxidation_state: 0 }], abc: [0, 0, 0], xyz: [0.96, 0, 0], label: 'H1', properties: {} },
    ],
    charge: 0,
    properties: { bonds: [] },
  })
  const requested: string[] = []
  const request = async (input: URL | RequestInfo): Promise<Response> => {
    const url = String(input)
    requested.push(url)
    if (url === 'http://127.0.0.1/session/manifest.json?cap=testcap') {
      return new Response(JSON.stringify(valid_manifest()))
    }
    if (url === 'http://127.0.0.1/session/structure.json?cap=testcap') return new Response(structure_json)
    if (url === 'http://127.0.0.1/api/plot-data/7?cap=testcap') {
      return new Response(encode_plot_dataset(7, 4, displacements), {
        headers: { 'content-type': 'application/vnd.multiwfn.matterviz-plot-data-v1' },
      })
    }
    return new Response('not found', { status: 404 })
  }
  const session = await load_vibration_session(page, request as typeof fetch)
  assert.equal(session.modes.length, 2)
  assert.equal(session.structure.sites.length, 2)
  assert.deepEqual([...session.displacements], [...displacements])
  // an explicitly empty bond list is removed so the renderer auto-detects bonds
  assert.equal(session.structure.properties?.bonds, undefined)
  assert.deepEqual(requested, [
    'http://127.0.0.1/session/manifest.json?cap=testcap',
    'http://127.0.0.1/session/structure.json?cap=testcap',
    'http://127.0.0.1/api/plot-data/7?cap=testcap',
  ])
  // the loaded session drives the animation pipeline end to end
  const pattern = normalized_mode_pattern(session.displacements, session.shape, 1)
  assert_valid_trajectory(synthesize_vibration_trajectory(session.structure, pattern))
})

test('rejects a session whose structure does not match the vibration data', async () => {
  const page = new URL('http://127.0.0.1/vibration.html?manifest=/session/manifest.json&cap=testcap')
  const structure_json = JSON.stringify({ sites: [], charge: 0, properties: {} })
  const request = async (input: URL | RequestInfo): Promise<Response> => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('manifest.json')) return new Response(JSON.stringify(valid_manifest()))
    return new Response(structure_json)
  }
  await assert.rejects(
    load_vibration_session(page, request as typeof fetch),
    /structure site count/,
  )
})

test('sanitizes suggested save-file names', () => {
  assert.equal(sanitize_save_file_name('mode\x1f9.webm'), 'mode9.webm')
  assert.equal(sanitize_save_file_name('mode\x7f9.webm'), 'mode9.webm')
  assert.equal(sanitize_save_file_name('a/b\\c.webm'), 'c.webm')
  assert.equal(sanitize_save_file_name('/tmp/'), 'export.bin')
  assert.equal(sanitize_save_file_name(''), 'export.bin')
  assert.equal(sanitize_save_file_name(undefined), 'export.bin')
  assert.equal(sanitize_save_file_name('..'), 'export.bin')
  assert.equal(sanitize_save_file_name('  spectrum.png  '), 'spectrum.png')
})

test('posts export payloads to the save-file endpoint with the session capability', async () => {
  const page = new URL('http://127.0.0.1/vibration.html?cap=testcap')
  const requested: { url: string; method?: string; type?: string; body?: number[] }[] = []
  const request = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    requested.push({
      url: String(input),
      method: init?.method,
      type: (init?.headers as Record<string, string>)?.['Content-Type'],
      body: [...new Uint8Array(init?.body as ArrayBuffer)],
    })
    return new Response(JSON.stringify({ ok: true, path: '/Users/test/mode9.webm' }))
  }
  const result = await save_file_via_dialog(
    new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'video/webm' }),
    'mode9.webm',
    page,
    request as typeof fetch,
  )
  assert.deepEqual(result, { ok: true, path: '/Users/test/mode9.webm' })
  assert.equal(requested.length, 1)
  assert.equal(requested[0].url, 'http://127.0.0.1/api/save-file?cap=testcap&name=mode9.webm')
  assert.equal(requested[0].method, 'POST')
  assert.equal(requested[0].type, 'application/octet-stream')
  assert.deepEqual(requested[0].body, [1, 2, 3, 4])
})

test('passes through a cancelled save and wraps service errors', async () => {
  const page = new URL('http://127.0.0.1/vibration.html?cap=testcap')
  const cancelled = await save_file_via_dialog(
    'svg',
    'plot.svg',
    page,
    (async () => new Response(JSON.stringify({ ok: false, cancelled: true }))) as typeof fetch,
  )
  assert.deepEqual(cancelled, { ok: false, cancelled: true })
  const unavailable = await save_file_via_dialog(
    'svg',
    'plot.svg',
    page,
    (async () => new Response('Save dialog is not available', { status: 409 })) as typeof fetch,
  )
  assert.deepEqual(unavailable, { ok: false, message: 'HTTP 409: Save dialog is not available' })
})
