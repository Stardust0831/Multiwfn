import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const installed = (path: string): URL => new URL(`../node_modules/matterviz/dist/${path}`, import.meta.url)

test('vendored MatterViz declarations expose the bindable camera API', async () => {
  const [sceneDeclaration, structureDeclaration] = await Promise.all([
    readFile(installed('structure/StructureScene.svelte.d.ts'), 'utf8'),
    readFile(installed('structure/index.d.ts'), 'utf8'),
  ])
  assert.match(sceneDeclaration, /camera_up\?: Vec3;/)
  assert.match(sceneDeclaration, /camera_zoom\?: number;/)
  const componentDeclaration = sceneDeclaration.match(/declare const StructureScene:.*;/)?.[0] ?? ''
  assert.match(componentDeclaration, /"camera_up"/)
  assert.match(componentDeclaration, /"camera_zoom"/)
  assert.match(structureDeclaration, /camera_up\?: Vec3;/)
  assert.match(structureDeclaration, /camera_zoom\?: number;/)
})

test('vendored MatterViz revision invalidates only supercell derivation', async () => {
  const [declaration, implementation, viewportDeclaration, viewportImplementation] = await Promise.all([
    readFile(installed('structure/Structure.svelte.d.ts'), 'utf8'),
    readFile(installed('structure/Structure.svelte'), 'utf8'),
    readFile(installed('structure/StructureViewport.svelte.d.ts'), 'utf8'),
    readFile(installed('structure/StructureViewport.svelte'), 'utf8'),
  ])
  assert.match(declaration, /structure_revision\?: number;/)
  assert.match(declaration, /structure_frame_delta\?: Vec3;/)
  assert.match(implementation, /\$effect\(\(\) => \{\s+void structure_revision\s+const base_structure = cell_transformed_structure/)
  assert.match(viewportDeclaration, /structure_revision\?: number;/)
  assert.match(viewportDeclaration, /structure_frame_delta\?: Vec3;/)
  assert.match(viewportDeclaration, /logical_structure\?: AnyStructure;/)
  assert.match(implementation, /logical_structure: structure,/)
  assert.match(viewportImplementation, /const current_structure = logical_structure/)
  assert.match(viewportImplementation, /if \(revision === applied_structure_revision\) return/)
  assert.match(viewportImplementation, /camera_position = camera_position\.map/)
  assert.match(viewportImplementation, /camera_target = camera_target\.map/)
  assert.match(viewportImplementation, /initial_camera_position = initial_camera_position\.map/)
  assert.match(viewportImplementation, /initial_camera_target = initial_camera_target\.map/)
})
