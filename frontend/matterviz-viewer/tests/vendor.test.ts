import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'
import type { VolumetricData } from 'matterviz/isosurface'
import { createServer } from 'vite'

const installed = (path: string): URL => new URL(`../node_modules/matterviz/dist/${path}`, import.meta.url)

test('vendored MatterViz declarations expose the bindable camera API', async () => {
  const [sceneDeclaration, structureDeclaration, cameraDeclaration, cameraModeDeclaration, arcballImplementation] = await Promise.all([
    readFile(installed('structure/StructureScene.svelte.d.ts'), 'utf8'),
    readFile(installed('structure/index.d.ts'), 'utf8'),
    readFile(installed('scene/SceneCamera.svelte.d.ts'), 'utf8'),
    readFile(installed('scene/camera-controls.svelte.d.ts'), 'utf8'),
    readFile(installed('scene/ArcballControls.svelte'), 'utf8'),
  ])
  assert.match(sceneDeclaration, /camera_control_mode\?: CameraControlMode;/)
  assert.match(sceneDeclaration, /camera_up\?: Vec3;/)
  assert.match(sceneDeclaration, /camera_zoom\?: number;/)
  const componentDeclaration = sceneDeclaration.match(/declare const StructureScene:.*;/)?.[0] ?? ''
  assert.match(componentDeclaration, /"camera_up"/)
  assert.match(componentDeclaration, /"camera_zoom"/)
  assert.match(structureDeclaration, /camera_up\?: Vec3;/)
  assert.match(structureDeclaration, /camera_zoom\?: number;/)
  assert.match(cameraDeclaration, /camera_control_mode\?: CameraControlMode;/)
  assert.match(cameraModeDeclaration, /export type CameraControlMode = `orbit` \| `arcball`;/)
  assert.match(arcballImplementation, /controls\.enableAnimations = false/)
  assert.match(arcballImplementation, /let interaction_active = \$state\(false\)/)
})

test('vendored package exports CameraControlMode as a real public type', () => {
  const declarationPath = fileURLToPath(installed('index.d.ts'))
  const program = ts.createProgram([declarationPath], {
    allowJs: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: false,
    target: ts.ScriptTarget.ES2022,
  })
  const source = program.getSourceFile(declarationPath)
  assert.ok(source)
  const moduleSymbol = program.getTypeChecker().getSymbolAtLocation(source)
  assert.ok(moduleSymbol)
  const exported = program.getTypeChecker().getExportsOfModule(moduleSymbol)
  assert.ok(exported.some((symbol) => symbol.name === 'CameraControlMode'))
})

test('vendored Arcball package retains r19 volume release lifecycle', async () => {
  const [geometry, isosurface, scene, viewport] = await Promise.all([
    readFile(installed('isosurface/geometry.js'), 'utf8'),
    readFile(installed('isosurface/Isosurface.svelte'), 'utf8'),
    readFile(installed('structure/StructureScene.svelte'), 'utf8'),
    readFile(installed('structure/StructureViewport.svelte'), 'utf8'),
  ])
  assert.match(geometry, /const release_epochs = new WeakMap\(\)/)
  assert.match(geometry, /release_isosurface_geometry/)
  assert.match(isosurface, /release_isosurface_geometry/)
  assert.match(scene, /on_geometry_error\?: \(message: string\) => void/)
  assert.match(scene, /\{on_geometry_error\}/)
  assert.match(viewport, /on_geometry_error\?: \(message: string\) => void/)
  assert.match(viewport, /\{on_geometry_error\}/)
})

test('vendored r26 preserves Multiwfn geometry contracts and adds material controls', async () => {
  const [packageMetadata, declaration, implementation, coloring, geometryWorker, colorBar] = await Promise.all([
    readFile(installed('../package.json'), 'utf8').then(JSON.parse),
    readFile(installed('isosurface/types.d.ts'), 'utf8'),
    readFile(installed('isosurface/Isosurface.svelte'), 'utf8'),
    readFile(installed('isosurface/coloring.js'), 'utf8'),
    readFile(installed('isosurface/marching-cubes-worker.js'), 'utf8'),
    readFile(installed('plot/core/components/ColorBar.svelte'), 'utf8'),
  ])
  assert.equal(packageMetadata.version, '0.4.2-multiwfn.d8719d12.r26')
  assert.match(declaration, /grid: ScalarGridLike;/)
  assert.match(declaration, /geometry_memory_budget_bytes\?: number;/)
  assert.match(declaration, /outline\?: number;/)
  assert.match(declaration, /outlineWidth\?: number;/)
  assert.match(declaration, /transmode\?: number;/)
  assert.match(implementation, /request_isosurface_geometry/)
  assert.match(implementation, /install_vmd_shading/)
  assert.match(implementation, /settings\.outlineWidth/)
  assert.match(implementation, /settings\.transmode/)
  assert.match(coloring, /interpolateTransFlag/)
  assert.match(geometryWorker, /typeof SharedArrayBuffer !== `undefined`/)
  assert.doesNotMatch(geometryWorker, /!\(return_buffer instanceof SharedArrayBuffer\)/)
  assert.match(colorBar, /func_name === `interpolateTransFlag`/)
  const geometrySignature = implementation.slice(
    implementation.indexOf('let geo_sig ='),
    implementation.indexOf('let volume_sig ='),
  )
  assert.ok(geometrySignature)
  assert.doesNotMatch(geometrySignature, /material|outline|transmode|flat_shading/)
})

test('vendored trans-flag colormap has exact pink, white, and blue stops', async () => {
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, watch: null, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  })
  try {
    const { get_d3_interpolator, TRANS_FLAG_STOPS } = await vite.ssrLoadModule(
      '/node_modules/matterviz/dist/colors/index.js',
    )
    const interpolate = get_d3_interpolator('interpolateTransFlag')
    assert.deepEqual(TRANS_FLAG_STOPS, ['#f5a9b8', '#ffffff', '#5bcefa'])
    assert.equal(interpolate(0), '#f5a9b8')
    assert.equal(interpolate(0.5), '#ffffff')
    assert.equal(interpolate(1), '#5bcefa')
  } finally {
    await vite.close()
  }
})

test('vendored MatterViz preserves explicitly absolute volume origins', async () => {
  const [declaration, implementation] = await Promise.all([
    readFile(installed('isosurface/types.d.ts'), 'utf8'),
    readFile(installed('isosurface/Isosurface.svelte'), 'utf8'),
  ])
  assert.match(declaration, /origin_mode\?: `relative-first` \| `absolute`;/)
  assert.equal(implementation.match(/volume_reference_origin\(all_volumes\)/g)?.length, 3)
})

test('absolute and relative-first scene coordinates sample the same physical point', async () => {
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  })
  try {
    const { create_volume_sampler, volume_reference_origin } = await vite.ssrLoadModule(
      '/node_modules/matterviz/dist/isosurface/sampling.js',
    )
    const base: VolumetricData = {
      grid: [
        [[0, 0], [0, 0]],
        [[4, 4], [4, 4]],
      ],
      grid_dims: [2, 2, 2],
      lattice: [[2, 0, 0], [0, 2, 0], [0, 0, 2]],
      origin: [10, 20, 30],
      data_range: { min: 0, max: 4, abs_max: 4, mean: 2 },
      periodic: false,
    }
    const sample = create_volume_sampler(base, { out_of_bounds: 'fallback' })

    const absolute = { ...base, origin_mode: 'absolute' as const }
    const absolute_ref = volume_reference_origin([absolute])
    assert.deepEqual(absolute_ref, [0, 0, 0])
    assert.equal(sample([11 + absolute_ref[0], 20, 30]), 2)

    const relative_ref = volume_reference_origin([base])
    assert.deepEqual(relative_ref, [10, 20, 30])
    assert.equal(sample([1 + relative_ref[0], relative_ref[1], relative_ref[2]]), 2)
  } finally {
    await vite.close()
  }
})
