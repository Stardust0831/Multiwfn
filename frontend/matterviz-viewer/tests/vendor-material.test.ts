import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { createServer } from 'vite'

const installed = (path: string): URL => new URL(`../node_modules/matterviz/dist/${path}`, import.meta.url)
const three = createRequire(realpathSync(installed('isosurface/material.js')))('three')

test('material shading modifies actual Three shader templates before include expansion', async () => {
  const { install_isosurface_shading } = await import(installed('isosurface/material.js').href)
  for (const [name, Material] of [
    ['lambert', three.MeshLambertMaterial],
    ['phong', three.MeshPhongMaterial],
    ['standard', three.MeshStandardMaterial],
  ] as const) {
    const material = new Material()
    const original = three.ShaderLib[name].fragmentShader
    assert.ok(!original.includes('gl_FragColor = vec4( outgoingLight, diffuseColor.a );'))
    const shader = { fragmentShader: original, uniforms: {} as Record<string, { value: number }> }
    install_isosurface_shading(material, { outline: 0.6, outlineWidth: 0.8, transmode: 1 })
    material.onBeforeCompile(shader, null)
    assert.notEqual(shader.fragmentShader, original, `${name} must actually receive the effect`)
    for (const [uniform, value] of [['mvOutline', 0.6], ['mvOutlineWidth', 0.8], ['mvTransmode', 1]] as const) {
      assert.equal(shader.uniforms[uniform].value, value)
      assert.ok(shader.fragmentShader.includes(`uniform float ${uniform};`))
    }
    const output = shader.fragmentShader.indexOf('#include <opaque_fragment>')
    const shading = shader.fragmentShader.indexOf('gl_FragColor.rgb *=')
    const toneMapping = shader.fragmentShader.indexOf('#include <tonemapping_fragment>')
    assert.ok(output < shading && shading < toneMapping)
    assert.match(shader.fragmentShader, /dot\(normal, geometryViewDir\)/)
    assert.match(shader.fragmentShader, /gl_FragColor\.a > 0\.0 && gl_FragColor\.a < 1\.0/)
    material.dispose()
  }
})

test('material uniforms are bounded and a changed Three shader fails explicitly', async () => {
  const { install_isosurface_shading } = await import(installed('isosurface/material.js').href)
  const material = new three.MeshPhongMaterial()
  install_isosurface_shading(material, { outline: 10, outlineWidth: Number.NaN, transmode: -1 })
  const shader = { fragmentShader: three.ShaderLib.phong.fragmentShader, uniforms: {} as Record<string, { value: number }> }
  material.onBeforeCompile(shader, null)
  assert.deepEqual(Object.fromEntries(Object.entries(shader.uniforms).map(([key, uniform]) => [key, uniform.value])), {
    mvOutline: 1, mvOutlineWidth: 0.6, mvTransmode: 0,
  })
  assert.throws(() => material.onBeforeCompile({ fragmentShader: 'void main() {}', uniforms: {} }, null), /missing isosurface output chunk/)
  material.dispose()
})

test('ESP vertex colors and colorbar share physical zero for asymmetric and one-sided ranges', async () => {
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, watch: null, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  })
  try {
    const { get_d3_interpolator, trans_flag_color } = await vite.ssrLoadModule('/node_modules/matterviz/dist/colors/index.js')
    const { scalars_to_vertex_colors } = await vite.ssrLoadModule('/node_modules/matterviz/dist/isosurface/coloring.js')
    const palette = get_d3_interpolator('interpolateTransFlag')
    assert.deepEqual([palette(0), palette(0.5), palette(1)], ['#f5a9b8', '#ffffff', '#5bcefa'])
    for (const range of [[-5, 20], [20, -5], [0, 20], [-5, 0], [2, 20], [-5, -2]]) {
      const samples = new Float64Array([-5, 0, 20])
      const output = new Float32Array(samples.length * 3)
      const colors = scalars_to_vertex_colors(samples, { colormap: 'interpolateTransFlag', color_range: range }, output)
      assert.equal(colors, output, 'recoloring must reuse the provided allocation')
      assert.deepEqual(Array.from(colors.slice(3, 6)), [1, 1, 1], `zero in ${range} must stay white`)
      for (const [index, value] of samples.entries()) {
        const expected = new three.Color(trans_flag_color(value, range))
        for (const [channel, component] of [expected.r, expected.g, expected.b].entries()) {
          assert.ok(Math.abs(colors[index * 3 + channel] - component) < 1e-6)
        }
      }
    }
    assert.equal(trans_flag_color(-5, [-5, 20]), '#f5a9b8')
    assert.equal(trans_flag_color(20, [-5, 20]), '#5bcefa')
    const { trans_flag_color_css, esp_legend_gradient } = await vite.ssrLoadModule('/src/esp.ts')
    for (const range of [[-5, 20], [2, 20], [-5, -2], [1, 1], [-1, -1], [0, 0]]) {
      for (const value of [-5, 0, 1, 20]) {
        assert.equal(trans_flag_color(value, range), trans_flag_color_css(value, ...range))
      }
      if (range[0] === range[1]) {
        assert.equal(esp_legend_gradient(...range), '#ffffff')
        assert.deepEqual(Array.from(scalars_to_vertex_colors(new Float64Array([range[0]]), {
          colormap: 'interpolateTransFlag', color_range: range,
        })), [1, 1, 1])
      }
    }
    const colorbar = await readFile(installed('plot/core/components/ColorBar.svelte'), 'utf8')
    assert.ok(colorbar.includes('trans_flag_color(value, range)'))
  } finally {
    await vite.close()
  }
})

test('meshing Worker returns ordinary buffers on success and failure without SharedArrayBuffer', async () => {
  const source = (await readFile(installed('isosurface/marching-cubes-worker.js'), 'utf8'))
    .replace(/^import .*\n/, '')
  const replies: { message: { ok: boolean; code?: string; data_buffer: ArrayBuffer }; transfer: ArrayBuffer[] }[] = []
  const context = {
    SharedArrayBuffer: undefined,
    preflight_marching_cubes: () => ({ total_bytes: 12 }),
    marching_cubes_typed: () => ({ positions: new Float32Array(3), normals: new Float32Array(3), indices: new Uint32Array(3) }),
    postMessage: (message: (typeof replies)[number]['message'], transfer: ArrayBuffer[]) => replies.push({ message, transfer }),
    onmessage: (_event: unknown) => {},
  }
  runInNewContext(source, context)
  const data = new Float64Array(8)
  const grid = { data, dims: [2, 2, 2], order: 'z_fastest' }
  context.onmessage({ data: { job_id: 1, grid, iso_value: 0 } })
  assert.equal(replies[0].message.ok, true)
  assert.equal(replies[0].message.data_buffer, data.buffer)
  assert.ok(replies[0].transfer.includes(data.buffer))
  context.onmessage({ data: { job_id: 2, grid, iso_value: 0, options: { geometry_memory_budget_bytes: 0 } } })
  assert.equal(replies[1].message.ok, false)
  assert.equal(replies[1].message.code, 'geometry-memory-budget')
  assert.equal(replies[1].message.data_buffer, data.buffer)
  assert.ok(replies[1].transfer.includes(data.buffer))
})

test('Arcball restore repairs stale orientation after position and up were already assigned', async () => {
  const { apply_arcball_camera_pose } = await import(installed('scene/arcball-runtime.js').href)
  const { ArcballControls } = createRequire(realpathSync(installed('scene/arcball-runtime.js')))('three/examples/jsm/controls/ArcballControls.js')
  const camera = new three.PerspectiveCamera()
  camera.position.set(4, 3, 8)
  const controls = new ArcballControls(camera, null)
  const savedQuaternion = camera.quaternion.clone()
  camera.position.set(-4, 8, -3)
  camera.up.set(0, 0, 1)
  controls.update()
  assert.ok(1 - Math.abs(savedQuaternion.dot(camera.quaternion)) > 0.01)
  // Reproduce declarative setters restoring fields before the Arcball effect.
  camera.position.set(4, 3, 8)
  camera.up.set(0, 1, 0)
  assert.equal(apply_arcball_camera_pose(controls, { position: [4, 3, 8], up: [0, 1, 0], target: [0, 0, 0] }), true)
  assert.ok(1 - Math.abs(savedQuaternion.dot(camera.quaternion)) < 1e-12)
  const direction = camera.getWorldDirection(new three.Vector3())
  const expectedDirection = camera.position.clone().negate().normalize()
  assert.ok(direction.distanceTo(expectedDirection) < 1e-12)
})

test('Arcball target-only commands and orthographic zoom preserve exact no-op live feedback', async () => {
  const { apply_arcball_camera_pose } = await import(installed('scene/arcball-runtime.js').href)
  const { ArcballControls } = createRequire(realpathSync(installed('scene/arcball-runtime.js')))('three/examples/jsm/controls/ArcballControls.js')
  const camera = new three.OrthographicCamera(-5, 5, 5, -5)
  camera.position.set(4, 3, 8)
  const controls = new ArcballControls(camera, null)
  assert.equal(apply_arcball_camera_pose(controls, { target: [2, -1, 0], zoom: 2.5 }), true)
  assert.deepEqual(controls._gizmos.position.toArray(), [2, -1, 0])
  assert.equal(camera.zoom, 2.5)
  const expected = camera.clone()
  expected.lookAt(2, -1, 0)
  assert.ok(1 - Math.abs(expected.quaternion.dot(camera.quaternion)) < 1e-12)

  // A rolled/panned live pose, including the equivalent negative quaternion,
  // must not be rewritten when gesture-end bindings echo it back.
  const roll = new three.Quaternion().setFromAxisAngle(camera.getWorldDirection(new three.Vector3()), 0.7)
  camera.up.applyQuaternion(roll)
  controls.update()
  camera.quaternion.set(-camera.quaternion.x, -camera.quaternion.y, -camera.quaternion.z, -camera.quaternion.w)
  const before = camera.quaternion.toArray()
  assert.equal(apply_arcball_camera_pose(controls, {
    position: camera.position.toArray(), up: camera.up.toArray(), target: controls._gizmos.position.toArray(), zoom: camera.zoom,
  }), false)
  assert.deepEqual(camera.quaternion.toArray(), before)
})
