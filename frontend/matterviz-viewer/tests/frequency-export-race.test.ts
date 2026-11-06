import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../node_modules/matterviz/dist/trajectory/Trajectory.svelte', import.meta.url), 'utf8')
// Execute the exact production transaction functions. Only TS syntax is removed;
// their loader/tick/RAF/scene boundaries are deterministic test dependencies.
const functions = ts.transpile(source.slice(source.indexOf('  async function go_to_export_step('), source.indexOf('  // Handle plot point clicks')), { target: ts.ScriptTarget.ES2022 })
function harness() {
  const frame = { structure: { sites: [] } }, owner = { frames: [frame], frame_loader: {} }, canvas = {}
  let raf: (() => void) | undefined
  const calls = { save: 0, render: 0, camera: 0, resume: 0 }
  const context: any = {
    trajectory: owner, disposed: false, current_step_idx: 0, current_frame: frame,
    frame_cache: new Map([[0, frame]]), frame_cache_owner: owner, displayed_frame_owner: owner, displayed_frame_idx: 0,
    export_snapshot: { owner, index: 0, playing: true, camera: { copy() { calls.camera++ } }, pose: {} },
    go_to_step(index: number) { context.current_step_idx = index },
    async tick() {}, clear_frame_load_timeout() {}, async load_frame_on_demand() {},
    requestAnimationFrame(callback: () => void) { raf = callback }, DOMException, Promise,
    wrapper: { querySelector() { return canvas } },
    scene_registry: new Map([[canvas, { scene: {}, camera: {} }]]),
    renderer_registry: new Map([[canvas, { render() { calls.render++; context.onRender?.() } }]]),
    start_playback() { calls.resume++ },
  }
  const api = runInNewContext(`${functions}\n({ go_to_export_step, finish_export })`, context)
  return { context, calls, api, frame, async ready() { await new Promise(setImmediate); assert.ok(raf); return raf! } }
}

test('replacement, close, index or ready-frame change during the final RAF never renders or saves', async () => {
  for (const change of [
    (state: any) => { state.trajectory = { frames: [] } },
    (state: any) => { state.disposed = true },
    (state: any) => { state.current_step_idx = 1 },
    (state: any) => { state.current_frame = { structure: {} } },
  ]) {
    const h = harness()
    const result = h.api.go_to_export_step(0).then(() => { h.calls.save++; return 'saved' }, (error: Error) => error.name)
    const render = await h.ready(); change(h.context); render()
    assert.equal(await result, 'AbortError')
    assert.deepEqual(h.calls, { save: 0, render: 0, camera: 0, resume: 0 })
  }
})

test('restore cannot copy an old camera or resume a replacement owner during its final RAF', async () => {
  const h = harness()
  const result = h.api.finish_export().then(() => 'finished', (error: Error) => error.name)
  const render = await h.ready(); h.context.trajectory = { frames: [] }; render()
  await result
  assert.equal(h.calls.camera, 0); assert.equal(h.calls.resume, 0)
})

test('restore rechecks after its await and never clears a newer transaction', async () => {
  const h = harness(), replacement = { frames: [] }
  const next = { owner: replacement, index: 0, playing: false }
  h.context.onRender = () => queueMicrotask(() => { h.context.trajectory = replacement; h.context.export_snapshot = next })
  const pending = h.api.finish_export()
  const render = await h.ready(); render(); await pending
  assert.equal(h.calls.camera, 0); assert.equal(h.calls.resume, 0)
  assert.equal(h.context.export_snapshot, next)
})

test('Structure save keeps its initiating sink and cleanup while waiting for frame readiness', async () => {
  const pane = await readFile(new URL('../node_modules/matterviz/dist/structure/StructureExportPane.svelte', import.meta.url), 'utf8')
  const save = ts.transpile(pane.slice(pane.indexOf('  async function save_export('), pane.indexOf('  async function handle_3d_export(')), { target: ts.ScriptTarget.ES2022 })
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  const calls = { oldSink: 0, newSink: 0, oldEnd: 0, newEnd: 0 }
  const context: any = {
    is_exporting: false, export_error: null, Error,
    before_export: () => wait, on_export_start: () => () => {},
    on_download: async () => { calls.oldSink++ },
    on_export_end: async () => { calls.oldEnd++ },
  }
  const api = runInNewContext(`${save}\n({ save_export })`, context)
  const pending = api.save_export(async (sink: (...args: any[]) => Promise<void>) => { await sink('bytes', 'frame.xyz', 'text/plain') })
  context.on_download = async () => { calls.newSink++ }
  context.on_export_end = async () => { calls.newEnd++ }
  release(); await pending
  assert.deepEqual(calls, { oldSink: 1, newSink: 0, oldEnd: 1, newEnd: 0 })
})

test('Structure never saves through live replacement props after the ready-frame promise resolves', async () => {
  const h = harness()
  const begin = ts.transpile(source.slice(source.indexOf('  function begin_export()'), source.indexOf('  // Await the requested data')), { target: ts.ScriptTarget.ES2022 })
  h.context.export_snapshot = undefined
  h.context.is_playing = true
  h.context.pause_playback = () => { h.context.is_playing = false }
  const canvas = h.context.wrapper.querySelector()
  h.context.scene_registry.set(canvas, { scene: {}, camera: { clone() { return {} }, copy() { h.calls.camera++ } } })
  const api = runInNewContext(`${begin}\n${functions}\n({ begin_export, go_to_export_step, finish_export })`, h.context)
  const pane = await readFile(new URL('../node_modules/matterviz/dist/structure/StructureExportPane.svelte', import.meta.url), 'utf8')
  const save = ts.transpile(pane.slice(pane.indexOf('  async function save_export('), pane.indexOf('  async function handle_3d_export(')), { target: ts.ScriptTarget.ES2022 })
  Object.assign(h.context, {
    is_exporting: false, export_error: null, Error,
    on_export_start: api.begin_export, before_export: () => api.go_to_export_step(0), on_export_end: api.finish_export,
    on_download: async () => { h.calls.save++ },
    onRender: () => queueMicrotask(() => { h.context.trajectory = { frames: [] }; h.context.on_download = async () => { h.calls.save++ } }),
  })
  const paneApi = runInNewContext(`${save}\n({ save_export })`, h.context)
  const pending = paneApi.save_export(async (sink: (...args: any[]) => Promise<void>) => { await (sink ?? h.context.on_download)('bytes', 'frame.xyz', 'text/plain') })
  const render = await h.ready(); render(); await pending
  assert.equal(h.calls.save, 0); assert.equal(h.calls.camera, 0); assert.equal(h.calls.resume, 0)
  assert.match(h.context.export_error, /interrupted/)
})

test('a published Svelte-proxied frame remains ready even when the cache holds its raw object', async () => {
  const h = harness()
  h.context.current_frame = new Proxy(h.frame, {})
  const pending = h.api.go_to_export_step(0).then(() => 'ready', (error: Error) => error.name)
  const render = await h.ready(); render()
  assert.equal(await pending, 'ready')
  assert.equal(h.calls.render, 1)
})
