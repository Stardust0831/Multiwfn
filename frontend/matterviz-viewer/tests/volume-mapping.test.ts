import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

let server: Awaited<ReturnType<typeof createServer>>
let api: typeof import('../src/session-fields.ts')
test.before(async () => {
  server = await createServer({ appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false } })
  api = await server.ssrLoadModule('/src/session-fields.ts')
})
test.after(async () => { await server?.close() })

test('mapped layers retain stable source IDs, physical range and color order when fields move', () => {
  const text = ['Cube','Finite', '1 -1 2 0', '-2 1 0 0', '-2 0 1 0', '-2 0 0 1', '1 0 0 2 0', '0 1 2 3 4 5 6 7'].join('\n')
  const { structure, volumes: [base] } = api.parse_session_cube(text, false)
  assert.deepEqual(base.origin, [-1, 2, 0])
  assert.deepEqual(structure.sites[0].xyz, [0, 2, 0])
  const source = { entry: { path: 'surface.cube', colorMapping: { path: 'color.cube', range: [-1, 1] as [number, number], stops: [
    { position: 0, color: '#ff0000' }, { position: .5, color: '#ffffff' }, { position: 1, color: '#0000ff' }] } }, volume: { ...base, id: 'density' } }
  const color = { entry: { path: 'color.cube' }, volume: { ...base, id: 'potential' } }
  const layer = api.layer_for_field(source, [color, source])
  assert.equal(layer.volume_id, 'density')
  assert.equal(layer.color_volume_id, 'potential')
  assert.deepEqual(layer, api.layer_for_field(source, [source, color]))
  assert.deepEqual(layer.color_scale?.value_range, [-1, 1])
  assert.ok(typeof layer.color_scale?.scheme === 'string')
  assert.throws(() => api.layer_for_field(source, [source]), /separate coloring dataset/)
  assert.throws(() => api.layer_for_field(source, [source, { ...color, volume: { ...color.volume, origin: [1,0,0] } }]), /same grid/)
  assert.notEqual(api.field_id({path: '/api/orbital', orbitalIndex: 1}), api.field_id({path: '/api/orbital', orbitalIndex: 2}))
  assert.notEqual(api.field_id({path: 'multi.cube'}, 0), api.field_id({path: 'multi.cube'}, 1))
})
