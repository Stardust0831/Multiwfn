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
