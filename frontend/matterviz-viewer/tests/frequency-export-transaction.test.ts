// The export pane, the Trajectory transaction and the native byte sink together.
// The production functions are executed exactly (only TS syntax is removed); the
// HTTP boundary is a deferred fetch, so the owner can change while a save is open.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { createServer } from 'vite'

let server: Awaited<ReturnType<typeof createServer>>
let structures: any, io: any, three: any, create_frequency_save: any
test.before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', cacheDir: 'node_modules/.vite-frequency-transaction-tests' })
  structures = await server.ssrLoadModule('/node_modules/matterviz/dist/structure/export.js')
  io = await server.ssrLoadModule('/node_modules/matterviz/dist/io/export.js')
  ;({ create_frequency_save } = await server.ssrLoadModule('/src/frequency-save.ts'))
  three = createRequire(realpathSync(new URL('../node_modules/matterviz/dist/structure/export.js', import.meta.url)))('three')
})
test.after(async () => { await server?.close() })

const read = (path: string) => readFile(new URL(`../node_modules/matterviz/dist/${path}`, import.meta.url), 'utf8')
const slice = (source: string, start: string, end: string) => {
  const from = source.indexOf(start), to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from, `missing ${start}`)
  return ts.transpile(source.slice(from, to), { target: ts.ScriptTarget.ES2022 })
}
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const settle = () => new Promise(resolve => setTimeout(resolve, 5))
const molecule = { sites: [{ species: [{ element: 'H', occu: 1 }], xyz: [1, 2, 3], abc: [0, 0, 0], label: 'H1' }] }

// A deferred native host: each request waits until the test answers it.
function host() {
  const requests: { filename: string; answer: (response: Response) => void }[] = []
  const controller = new AbortController()
  const sink = create_frequency_save(new URL('http://127.0.0.1/?cap=secret'), async (url: URL) => {
    const response = deferred<Response>()
    requests.push({ filename: new URL(String(url)).searchParams.get('filename')!, answer: response.resolve })
    return response.promise
  }, controller.signal)
  return { requests, sink, controller }
}

async function trajectory() {
  const source = await read('trajectory/Trajectory.svelte')
  const functions = slice(source, '  function begin_export()', '  // Handle plot point clicks')
  const frames = [0, 1, 2].map(() => ({ structure: molecule })), frame = frames[0], owner = { frames, frame_loader: {} }, canvas = {}
  const calls = { render: 0, camera: 0, resume: 0 }
  const context: any = {
    trajectory: owner, disposed: false, current_step_idx: 0, current_frame: frame, is_playing: true,
    displayed_frame_owner: owner, displayed_frame_idx: 0, export_snapshot: undefined,
    pause_playback() { context.is_playing = false }, start_playback() { calls.resume++ },
    // Publishes the requested frame as Trajectory's loader does.
    go_to_step(index: number) { context.current_step_idx = index; context.displayed_frame_idx = index; context.current_frame = frames[index] },
    async tick() {}, clear_frame_load_timeout() {}, async load_frame_on_demand() {},
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0), DOMException, Promise,
    wrapper: { querySelector: () => canvas },
    scene_registry: new Map([[canvas, { scene: {}, camera: { clone: () => ({}), copy() { calls.camera++ } } }]]),
    renderer_registry: new Map([[canvas, { render() { calls.render++ } }]]),
  }
  const api = runInNewContext(`${functions}\n({ begin_export, go_to_export_step, finish_export })`, context)
  // A mode/amplitude change publishes a new owner; Trajectory itself stays mounted.
  const replace = () => { const next = { frames }; context.trajectory = next; context.displayed_frame_owner = next }
  return { context, calls, api, replace }
}

async function structure_pane(t: Awaited<ReturnType<typeof trajectory>>, sink: unknown) {
  const pane = await read('structure/StructureExportPane.svelte')
  const save = slice(pane, '  async function save_export(', '  async function handle_3d_export(')
  const context: any = {
    is_exporting: false, export_error: null, Error,
    on_download: sink, on_export_start: t.api.begin_export,
    before_export: () => t.api.go_to_export_step(t.context.current_step_idx), on_export_end: t.api.finish_export,
  }
  return { context, api: runInNewContext(`${save}\n({ save_export })`, context) }
}

test('a host result after an owner change is reported as returned: saved, cancelled or failed', async () => {
  for (const [answer, expected] of [
    [() => Response.json({ status: 'saved' }), null],
    [() => Response.json({ status: 'cancelled' }), 'Save cancelled.'],
    [() => Response.json({ message: 'native write failed' }, { status: 500 }), 'native write failed'],
  ] as const) {
    const t = await trajectory(), h = host(), pane = await structure_pane(t, h.sink)
    const pending = pane.api.save_export((sink: any) => structures.export_structure_as('xyz', molecule, sink))
    for (let attempt = 0; !h.requests.length && attempt < 100; attempt++) await settle()
    assert.equal(h.requests.length, 1)
    // The viewer replaces the owner and aborts its sink while the native dialog is open.
    t.replace(); h.controller.abort()
    h.requests[0].answer(answer()); await pending
    assert.equal(pane.context.export_error, expected)
    assert.equal(pane.context.is_exporting, false)
    assert.deepEqual(t.calls, { render: 1, camera: 0, resume: 0 }, 'the replaced owner is never restored or resumed')
    assert.equal(t.context.export_snapshot, undefined, 'the transaction ends so the new owner can export')
  }
})

test('OBJ saved before an owner change never submits its MTL and reports the partial export', async () => {
  const t = await trajectory(), h = host(), pane = await structure_pane(t, h.sink)
  const scene = new three.Scene()
  scene.add(new three.InstancedMesh(new three.BoxGeometry(), new three.MeshStandardMaterial({ color: 'red' }), 1))
  const pending = pane.api.save_export((sink: any) => structures.export_structure_as_obj(scene, molecule, sink))
  for (let attempt = 0; !h.requests.length && attempt < 100; attempt++) await settle()
  t.replace()
  h.requests[0].answer(Response.json({ status: 'saved' })); await pending
  assert.equal(h.requests.length, 1, 'no companion dialog is opened for the replaced owner')
  assert.match(h.requests[0].filename, /\.obj$/)
  assert.match(pane.context.export_error, /^OBJ saved, but companion MTL was not saved: .*interrupted/)
})

test('OBJ companion cancellation or failure, without an owner change, is reported as partial', async () => {
  for (const [answer, reason] of [
    [() => Response.json({ status: 'cancelled' }), /Save cancelled/],
    [() => Response.json({ message: 'disk full' }, { status: 500 }), /disk full/],
  ] as const) {
    const t = await trajectory(), h = host(), pane = await structure_pane(t, h.sink)
    const scene = new three.Scene()
    scene.add(new three.InstancedMesh(new three.BoxGeometry(), new three.MeshStandardMaterial({ color: 'red' }), 1))
    const pending = pane.api.save_export((sink: any) => structures.export_structure_as_obj(scene, molecule, sink))
    for (let attempt = 0; !h.requests.length && attempt < 100; attempt++) await settle()
    h.requests[0].answer(Response.json({ status: 'saved' }))
    for (let attempt = 0; h.requests.length < 2 && attempt < 100; attempt++) await settle()
    assert.deepEqual(h.requests.map(request => request.filename.split('.').pop()), ['obj', 'mtl'])
    h.requests[1].answer(answer()); await pending
    assert.match(pane.context.export_error, /^OBJ saved, but companion MTL was not saved/)
    assert.match(pane.context.export_error, reason)
    assert.equal(t.calls.resume, 1, 'the unchanged owner is restored and resumed')
  }
})

test('an owner change before submission still refuses to save', async () => {
  const t = await trajectory(), h = host(), pane = await structure_pane(t, h.sink)
  const pending = pane.api.save_export(async (sink: any) => { t.replace(); await structures.export_structure_as('xyz', molecule, sink) })
  await pending
  assert.equal(h.requests.length, 0)
  assert.match(pane.context.export_error, /interrupted/)
})

test('a submitted WebM save survives the owner change and pane abort that follow it', async () => {
  const pane = await read('trajectory/TrajectoryExportPane.svelte')
  const save = slice(pane, '  async function handle_video_export(', '  let is_video_supported')
  const original = { MediaRecorder: globalThis.MediaRecorder, requestAnimationFrame: globalThis.requestAnimationFrame }
  class Recorder extends EventTarget {
    static isTypeSupported() { return true }
    state = 'inactive'
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; queueMicrotask(() => { const event = new Event('dataavailable'); Object.assign(event, { data: new Blob([new Uint8Array([26, 69, 223, 163])], { type: 'video/webm' }) }); this.dispatchEvent(event); this.dispatchEvent(new Event('stop')) }) }
  }
  const track = { requestFrame() {}, stop() {} }
  const canvas = { width: 2, height: 2, captureStream: () => ({ getVideoTracks: () => [track], getTracks: () => [track] }) }
  Object.assign(globalThis, { MediaRecorder: Recorder, requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0) })
  try {
    for (const [answer, expected] of [
      [() => Response.json({ status: 'saved' }), null],
      [() => Response.json({ status: 'cancelled' }), 'Save cancelled.'],
    ] as const) {
      const t = await trajectory(), h = host()
      const context: any = {
        is_exporting: false, export_error: null, export_progress: 0, export_format: 'webm', export_controller: undefined,
        trajectory: t.context.trajectory, canvas, export_frame_count: 2, start_frame: 0, filename: 'water',
        video_fps: 1000, resolution_multiplier: 1, AbortController, setTimeout, navigator: { clipboard: { writeText: async () => {} } },
        export_trajectory_video: io.export_trajectory_video, get_ffmpeg_conversion_command: io.get_ffmpeg_conversion_command,
        to_error: (error: unknown) => error instanceof Error ? error : new Error(String(error)),
        on_download: h.sink, on_step_change: t.api.go_to_export_step, on_export_start: t.api.begin_export, on_export_end: t.api.finish_export,
      }
      const api = runInNewContext(`${save}\n({ handle_video_export })`, context)
      const pending = api.handle_video_export('webm')
      for (let attempt = 0; !h.requests.length && attempt < 200; attempt++) await settle()
      assert.equal(h.requests.length, 1); assert.match(h.requests[0].filename, /\.webm$/)
      // Mode change: the owner is replaced, the pane's $effect aborts, the viewer aborts its sink.
      t.replace(); context.export_controller.abort(); h.controller.abort()
      h.requests[0].answer(answer()); await pending
      assert.equal(context.export_error, expected)
      assert.equal(t.calls.camera, 0); assert.equal(t.calls.resume, 0)
      assert.equal(t.context.export_snapshot, undefined)
    }
  } finally { Object.assign(globalThis, original) }
})

test('long formulas produce bounded structure filenames and a matching OBJ/MTL reference', async () => {
  const sites = Array.from({ length: 40 }, (_, number) => ({ species: [{ element: ['H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca'][number % 20], occu: 1 }], xyz: [number, 0, 0], abc: [0, 0, 0], label: `X${number}` }))
  const long = { sites: sites.map((site, index) => ({ ...site, species: [{ element: index < 20 ? site.species[0].element : ['Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr'][index - 20], occu: 1 }] })) }
  const unbounded = structures.create_structure_filename(long, 'xyz')
  assert.ok(unbounded.length <= structures.MAX_STRUCTURE_FILENAME_STEM + 4)
  assert.ok(!/[-_. ]\.xyz$/.test(unbounded))
  for (const extension of ['json', 'xyz', 'cif', 'poscar', 'glb', 'obj', 'mtl']) assert.ok(structures.create_structure_filename(long, extension).length <= 128)
  const saved: string[] = []
  await io.export_canvas_as_png({ toBlob: (callback: (blob: Blob) => void) => callback(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])])) }, long, 1200, null, null, async (_: Blob, name: string) => { saved.push(name) })
  assert.ok(saved[0].length <= 128 && saved[0].endsWith('-1200dpi.png'))
  const scene = new three.Scene()
  scene.add(new three.InstancedMesh(new three.BoxGeometry(), new three.MeshStandardMaterial({ color: 'red' }), 1))
  const files: [string, string][] = []
  await structures.export_structure_as_obj(scene, long, async (blob: Blob, name: string) => { files.push([name, await blob.text()]) })
  assert.ok(files.every(([name]) => name.length <= 128))
  assert.equal(files[0][1].split('\n')[0], `mtllib ${files[1][0]}`)
  assert.equal(files[0][0].replace(/\.obj$/, ''), files[1][0].replace(/\.mtl$/, ''))
})
