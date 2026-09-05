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

test('vendored MatterViz exposes and threads ordered measurement interaction props', async () => {
  const [
    structureDeclaration,
    viewportDeclaration,
    sceneDeclaration,
    structureImplementation,
    viewportImplementation,
    sceneImplementation,
    structureIndex,
  ] = await Promise.all([
    readFile(installed('structure/Structure.svelte.d.ts'), 'utf8'),
    readFile(installed('structure/StructureViewport.svelte.d.ts'), 'utf8'),
    readFile(installed('structure/StructureScene.svelte.d.ts'), 'utf8'),
    readFile(installed('structure/Structure.svelte'), 'utf8'),
    readFile(installed('structure/StructureViewport.svelte'), 'utf8'),
    readFile(installed('structure/StructureScene.svelte'), 'utf8'),
    readFile(installed('structure/index.d.ts'), 'utf8'),
  ])

  const propDeclarations = [
    /show_atom_tooltip\?: boolean;/,
    /measure_selection_policy\?: MeasureSelectionPolicy;/,
    /measure_geometry\?: MeasureGeometry;/,
    /on_selected_bond_context\?: \(detail: SelectedBondContext\) => void;/,
  ]
  for (const declaration of [structureDeclaration, viewportDeclaration, sceneDeclaration]) {
    for (const prop of propDeclarations) assert.match(declaration, prop)
  }

  for (const prop of [
    'show_atom_tooltip',
    'measure_selection_policy',
    'measure_geometry',
    'on_selected_bond_context',
  ]) {
    assert.ok(structureImplementation.includes(`    ${prop},`))
    assert.ok(viewportImplementation.includes(`{${prop}}`))
  }

  assert.match(structureIndex, /export type MeasureGeometry = `combinatorial` \| `ordered`;/)
  assert.match(structureIndex, /export type SelectedBondContext = \{/)
  assert.match(structureIndex, /displayed_site_indices: \[number, number\];/)
  assert.match(structureIndex, /source_site_indices: \[number, number\];/)
  assert.match(structureIndex, /bond_order\?: BondOrder;/)
  assert.match(structureIndex, /cell_shift\?: Vec3;/)
  assert.match(structureIndex, /client_x: number;/)
  assert.match(structureIndex, /client_y: number;/)
  assert.ok(structureIndex.includes("export * from './measure';"))

  assert.ok(sceneImplementation.includes('show_atom_tooltip = true'))
  assert.ok(sceneImplementation.includes('measure_geometry = `combinatorial`'))
  assert.ok(sceneImplementation.includes('{#if show_atom_tooltip && hovered_site'))
  assert.ok(sceneImplementation.includes('add(`hover`, hovered_site, hovered_idx, `white`)'))
  assert.ok(sceneImplementation.includes('measure.next_measured_sites('))
  assert.ok(sceneImplementation.includes('measure.bond_angle('))
  assert.ok(sceneImplementation.includes('measure.dihedral_angle('))
  assert.ok(sceneImplementation.includes('distance_measurement(measured_sites[0], measured_sites[1])'))
  assert.ok(sceneImplementation.includes('{@render ordered_angle_measurement('))
  assert.ok(sceneImplementation.includes('{@render ordered_dihedral_measurement('))
})

test('vendored MatterViz only emits bond context for a selected visible bond', async () => {
  const scene = await readFile(installed('structure/StructureScene.svelte'), 'utf8')

  assert.ok(scene.includes('(measure_mode !== `distance` && measure_mode !== `angle`)'))
  assert.ok(scene.includes('measured_sites.length !== 2'))
  assert.ok(scene.includes('(site_idx != null && !measured_sites.includes(site_idx))'))
  assert.ok(scene.includes('!selected_context_bond'))
  assert.ok(scene.includes('const exact = bonds_to_render.find('))
  assert.ok(scene.includes('const source_matches ='))
  assert.ok(scene.includes('measure.positions_match(bond.pos_1, selected_site_a.xyz)'))
  assert.ok(scene.includes('measure.positions_match(bond.pos_2, selected_site_b.xyz)'))
  assert.ok(scene.includes('measure.positions_match(bond.pos_1, selected_site_b.xyz)'))
  assert.ok(scene.includes('measure.positions_match(bond.pos_2, selected_site_a.xyz)'))
  assert.ok(scene.includes('function suppress_selected_bond_pointerdown('))
  assert.ok(scene.includes('native_event.button !== 2'))
  const suppressionStart = scene.indexOf('function suppress_selected_bond_pointerdown(')
  const suppressionEnd = scene.indexOf('const handle_atom_pointerdown', suppressionStart)
  const suppression = scene.slice(suppressionStart, suppressionEnd)
  assert.ok(suppression.includes('native_event.preventDefault?.()'))
  assert.ok(suppression.includes('native_event.stopPropagation?.()'))
  assert.ok(suppression.includes('native_event.stopImmediatePropagation?.()'))
  assert.ok(suppression.includes('event.preventDefault?.()'))
  assert.ok(suppression.includes('event.stopPropagation?.()'))
  assert.ok(suppression.includes('event.stopImmediatePropagation?.()'))
  assert.ok(scene.includes('if ((event.nativeEvent ?? event).button !== 0) return'))
  assert.ok(scene.includes('oncontextmenu: (event: BondContextMenuEvent) =>'))
  assert.ok(scene.includes('emit_selected_bond_context(event, site_idx)'))
  assert.ok(scene.includes('{#if selected_context_bond}'))
  assert.ok(scene.includes('suppress_selected_bond_pointerdown(event)'))
  assert.ok(scene.includes('emit_selected_bond_context(event)'))
  assert.ok(scene.includes('measure_mode === `edit-bonds` && bond_context_menu'))
})

test('vendored package exports interaction helpers and types from the public entry point', () => {
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
  const exportedNames = new Set(exported.map((symbol) => symbol.name))
  for (const name of [
    'CameraControlMode',
    'MeasureGeometry',
    'MeasureSelectionPolicy',
    'SelectedBondContext',
    'bond_angle',
    'dihedral_angle',
    'next_measured_sites',
  ]) {
    assert.ok(exportedNames.has(name), `expected MatterViz to export ${name}`)
  }
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
