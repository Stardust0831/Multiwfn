import assert from 'node:assert/strict'
import test from 'node:test'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

let server: Awaited<ReturnType<typeof createServer>>
let structures: any, io: any, three: any
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
test.before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', cacheDir: 'node_modules/.vite-frequency-export-tests' })
  structures = await server.ssrLoadModule('/node_modules/matterviz/dist/structure/export.js')
  io = await server.ssrLoadModule('/node_modules/matterviz/dist/io/export.js')
  three = createRequire(realpathSync(new URL('../node_modules/matterviz/dist/structure/export.js', import.meta.url)))('three')
})
test.after(async () => { await server?.close() })
const molecule = { sites: [{ species: [{ element: 'H', occu: 1 }], xyz: [1,2,3], abc: [0,0,0], label: 'H1' }] }

test('native text sinks are isolated per call, return serialized current structure, and await saves/errors', async () => {
  const a: any[] = [], b: any[] = [], wait = deferred()
  let settled = false
  const first = structures.export_structure_as('xyz', molecule, async (...args: any[]) => { a.push(args); await wait.promise }).then(() => { settled = true })
  await structures.export_structure_as('json', molecule, async (...args: any[]) => { b.push(args) })
  assert.equal(a.length, 1); assert.equal(b.length, 1); assert.equal(settled, false)
  assert.equal(a[0][0], structures.structure_to_xyz_str(molecule))
  assert.equal(b[0][0], structures.structure_to_json_str(molecule))
  assert.equal(a[0][2], 'text/plain'); assert.equal(b[0][2], 'application/json')
  wait.resolve(); await first
  await assert.rejects(structures.export_structure_as('xyz', molecule, async () => { throw new DOMException('cancelled', 'AbortError') }), { name: 'AbortError' })
  await assert.rejects(structures.export_structure_as('xyz', molecule, async () => { throw Error('write failed') }), /write failed/)
})

test('PNG callback receives actual blob bytes and completion waits for its save', async () => {
  const bytes = new Uint8Array([137,80,78,71,13,10,26,10])
  const canvas = { toBlob(callback: (blob: Blob) => void) { callback(new Blob([bytes], { type: 'image/png' })) } }
  const wait = deferred(); let saved: any[] = [], settled = false
  const pending = io.export_canvas_as_png(canvas, 'water.png', 72, null, null, async (...args: any[]) => { saved = args; await wait.promise }).then(() => { settled = true })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(settled, false)
  assert.equal(saved[1], 'water-72dpi.png'); assert.equal(saved[2], 'image/png')
  assert.deepEqual(new Uint8Array(await saved[0].arrayBuffer()), bytes)
  wait.resolve(); await pending
})

test('OBJ waits for both ordered saves and propagates companion cancellation/failure', async () => {
  const scene = new three.Scene()
  scene.add(new three.InstancedMesh(new three.BoxGeometry(), new three.MeshStandardMaterial({ color: 'red' }), 1))
  const wait = deferred(), calls: any[][] = []
  const pending = structures.export_structure_as_obj(scene, molecule, async (...args: any[]) => { calls.push(args); if (calls.length === 1) await wait.promise })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(calls.length, 1, 'must not open/save the MTL before OBJ completes')
  wait.resolve(); await pending
  assert.equal(calls.length, 2)
  assert.match(await calls[0][0].text(), new RegExp(`^mtllib ${calls[1][1].replace('.', '\\.')}`))
  assert.match(await calls[1][0].text(), /newmtl/)
  for (const failure of [new DOMException('MTL save cancelled', 'AbortError'), Error('MTL write failed')]) {
    let count = 0
    await assert.rejects(structures.export_structure_as_obj(scene, molecule, async () => { if (++count === 2) throw failure }), (error: Error) => error.name === failure.name && error.cause === failure && /companion MTL was not saved/.test(error.message))
    assert.equal(count, 2)
  }
})

test('WebM waits for requested asynchronous frames and native save, then stops every track', async () => {
  const original = { MediaRecorder: globalThis.MediaRecorder, requestAnimationFrame: globalThis.requestAnimationFrame }
  const frames: number[] = [], loaded: number[] = [], saved: any[] = [], wait = deferred()
  let stopped = 0, current = -1
  const canvas = { width: 32, height: 32, captureStream() { return { getVideoTracks: () => [{ requestFrame() { frames.push(current) }, stop() { stopped++ } }], getTracks() { return this.getVideoTracks() } } } }
  class Recorder extends EventTarget {
    static isTypeSupported() { return true }
    state = 'inactive'
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; queueMicrotask(() => { const event = new Event('dataavailable'); Object.assign(event, { data: new Blob([new Uint8Array([26,69,223,163]), 'webm'], { type: 'video/webm' }) }); this.dispatchEvent(event); this.dispatchEvent(new Event('stop')) }) }
  }
  Object.assign(globalThis, { MediaRecorder: Recorder, requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0) })
  try {
    let settled = false
    const pending = io.export_trajectory_video(canvas, 'water.webm', {
      fps: 1000, total_frames: 3,
      on_step: async (index: number) => { await new Promise(resolve => setTimeout(resolve, 30)); current = index; loaded.push(index) },
      on_download: async (...args: any[]) => { saved.push(args); await wait.promise },
    }).then(() => { settled = true })
    for (let attempt = 0; !saved.length && attempt < 150; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(saved.length, 1)
    assert.deepEqual(loaded, [0,1,2]); assert.deepEqual(frames, [0,1,2]); assert.equal(settled, false)
    assert.equal(saved[0][1], 'water.webm'); assert.equal(saved[0][2], 'video/webm')
    assert.deepEqual(new Uint8Array((await saved[0][0].arrayBuffer()).slice(0,4)), new Uint8Array([26,69,223,163]))
    wait.resolve(); await pending; assert.equal(stopped, 1)
    await assert.rejects(io.export_trajectory_video(canvas, 'fail.webm', { total_frames: 1, on_step: async () => { throw Error('frame failed') } }), /frame failed/)
    assert.equal(stopped, 2, 'frame failure must stop the capture track too')
    Recorder.isTypeSupported = () => false
    await assert.rejects(io.export_trajectory_video(canvas, 'unsupported.webm'), /not supported/)
    assert.equal(stopped, 2)
  } finally { Object.assign(globalThis, original) }
})

test('public components forward instance sinks and recording awaits its own exact lazy-frame/render boundary', async () => {
  const { readFile } = await import('node:fs/promises')
  const read = (path: string) => readFile(new URL(`../node_modules/matterviz/dist/${path}`, import.meta.url), 'utf8')
  for (const component of ['structure/Structure', 'structure/StructureExportPane', 'trajectory/Trajectory', 'trajectory/TrajectoryExportPane']) {
    assert.match(await read(`${component}.svelte.d.ts`), /on_download\?\s*:/)
    assert.match(await read(`${component}.svelte`), /on_download/)
  }
  const trajectory = await read('trajectory/Trajectory.svelte')
  assert.match(trajectory, /on_step_change=\{go_to_export_step\}/)
  assert.match(trajectory, /await load_frame_on_demand\(idx\)/)
  assert.match(trajectory, /await tick\(\)/)
  assert.match(trajectory, /renderer\.render\(registered\.scene, registered\.camera\)/)
  const originalDownload = await read('io/fetch.js')
  const { execFileSync } = await import('node:child_process')
  const base = execFileSync('tar', ['-xOf', 'vendor/matterviz-0.4.2-multiwfn.d8719d12.r25.freq1.tgz', 'package/dist/io/fetch.js'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' })
  assert.equal(originalDownload, base, 'global download behavior must remain byte-identical')
})

test('GLB native sink gets a complete binary GLTF and its save error is propagated', async () => {
  const Original = globalThis.FileReader
  // GLTFExporter uses browser FileReader only to turn its already-produced Blob
  // into an ArrayBuffer; preserve the real exporter, geometry and binary bytes.
  class Reader {
    result: ArrayBuffer | null = null
    onloadend?: () => void
    readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.() }) }
  }
  Object.assign(globalThis, { FileReader: Reader })
  try {
    const scene = new three.Scene()
    scene.add(new three.InstancedMesh(new three.BoxGeometry(), new three.MeshStandardMaterial({ color: 'red' }), 1))
    let payload!: Blob
    await structures.export_structure_as_glb(scene, molecule, async (blob: Blob, name: string, mime: string) => {
      payload = blob; assert.match(name, /\.glb$/); assert.equal(mime, 'model/gltf-binary')
    })
    const bytes = await payload.arrayBuffer(), view = new DataView(bytes)
    assert.equal(new TextDecoder().decode(bytes.slice(0,4)), 'glTF')
    assert.equal(view.getUint32(4, true), 2); assert.equal(view.getUint32(8, true), bytes.byteLength)
    await assert.rejects(structures.export_structure_as_glb(scene, molecule, async () => { throw Error('native write failed') }), /native write failed/)
  } finally { Object.assign(globalThis, { FileReader: Original }) }
})

test('cancelling OBJ first save never starts the companion save', async () => {
  const scene = new three.Scene(); let calls = 0
  await assert.rejects(structures.export_structure_as_obj(scene, molecule, async () => { calls++; throw new DOMException('cancelled', 'AbortError') }), { name: 'AbortError' })
  assert.equal(calls, 1)
})

test('interrupting an unresolved lazy frame stops recording without saving or waiting for its loader', async () => {
  const original = { MediaRecorder: globalThis.MediaRecorder, requestAnimationFrame: globalThis.requestAnimationFrame }
  const wait = deferred(), controller = new AbortController()
  let stopped = 0, saved = 0, requested = 0
  class Recorder extends EventTarget {
    static isTypeSupported() { return true }
    state = 'inactive'
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; this.dispatchEvent(new Event('stop')) }
  }
  const track = { requestFrame() { requested++ }, stop() { stopped++ } }
  const canvas = { width: 2, height: 2, captureStream() { return { getVideoTracks: () => [track], getTracks: () => [track] } } }
  Object.assign(globalThis, { MediaRecorder: Recorder, requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0) })
  try {
    const pending = io.export_trajectory_video(canvas, 'cancelled.webm', { total_frames: 2, signal: controller.signal, on_step: () => wait.promise, on_download: async () => { saved++ } })
    controller.abort()
    const outcome = await Promise.race([pending.then(() => 'saved', (error: Error) => error.name), new Promise(resolve => setTimeout(() => resolve('still waiting'), 100))])
    assert.equal(outcome, 'AbortError')
    assert.equal(stopped, 1); assert.equal(saved, 0); assert.equal(requested, 0)
  } finally { wait.resolve(); Object.assign(globalThis, original) }
})

test('structure exports use the same awaited current-frame transaction and only restore transactions they started', async () => {
  const { readFile } = await import('node:fs/promises')
  const read = (path: string) => readFile(new URL(`../node_modules/matterviz/dist/${path}`, import.meta.url), 'utf8')
  const structure = await read('structure/StructureExportPane.svelte')
  assert.match(structure, /await callbacks\.before_export\?\.\(\)/)
  assert.ok(structure.indexOf('await callbacks.before_export?.()') < structure.indexOf('await action(sink)'))
  assert.match(structure, /if \(started\) await callbacks\.on_export_end\?\.\(\)/)
  assert.match(await read('trajectory/Trajectory.svelte'), /before_export=\{\(\) => go_to_export_step\(current_step_idx\)\}/)
  assert.match(await read('trajectory/TrajectoryExportPane.svelte'), /if \(started\) await callbacks\.on_export_end\?\.\(\)/)
})
