import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { AIM_DEFAULTS, BOHR_TO_ANGSTROM, normalize_topology_display, parse_topology, resolve_topology, topology_csv, topology_document, topology_path_length, topology_path_points, topology_scene_data, type Topology } from '../src/topology.ts'
import { create_workbench_state, parse_workbench_state, restore_workbench_state } from '../src/state.ts'

const metadata = (): Topology => ({ version: 1, coordinateUnit: 'bohr', functionId: 1, datasetId: 9, hasDensity: true, eulerCount: 1, missingPathDirections: 1,
  criticalPoints: [{ id: 1, type: 2, density: .1, laplacian: -.3 }, { id: 2, type: 1, density: .8, laplacian: -2 }],
  paths: [{ id: 1, type: 1, offset: 2, count: 3, start: 1, end: 2 }],
})
const dataset = () => ({ x: Float64Array.of(9.8, .2, 9.8, 0, .2), y: new Float64Array(5), z: new Float64Array(5) })

test('AIM defaults match the original density topology parameters', () => {
  assert.deepEqual(AIM_DEFAULTS, { seeds: 15, distance: 1.5, gradient: 1e-6, displacement: 1e-7, cycles: 120, step: .03, pathPoints: 451 })
})

test('topology validates scientific metadata and refuses malformed ranges', () => {
  assert.deepEqual(parse_topology(metadata()), metadata())
  for (const change of [ { coordinateUnit: 'angstrom' }, { version: 2 }, { datasetId: -1 }, { criticalPoints: [{ id: 5, type: 1, density: 0, laplacian: 0 }] },
    { paths: [{ ...metadata().paths[0], count: 1501 }] }, { paths: [{ ...metadata().paths[0], offset: 0 }] }, { paths: [{ ...metadata().paths[0], start: 9 }] },
    { eulerCount: NaN }, { missingPathDirections: -1 }]) assert.throws(() => parse_topology({ ...metadata(), ...change }))
})

test('binary topology requires complete finite double-precision coordinates', async () => {
  const result = await resolve_topology(metadata(), async (id) => { assert.equal(id, 9); return dataset() })
  assert.equal(result.coordinates.x.length, 5)
  await assert.rejects(resolve_topology(metadata(), async () => ({ ...dataset(), z: undefined })))
  await assert.rejects(resolve_topology(metadata(), async () => ({ ...dataset(), y: new Float64Array(2) })))
  await assert.rejects(resolve_topology(metadata(), async () => ({ ...dataset(), x: Float64Array.of(NaN, 0, 0, 0, 0) })))
  const empty = await resolve_topology({ ...metadata(), datasetId: 0, criticalPoints: [], paths: [] }, async () => { throw new Error('Empty topology must not download data') })
  assert.equal(empty.coordinates.x.length, 0)
})

test('periodic paths unwrap integration steps and retain original endpoint identities', async () => {
  const result = await resolve_topology(metadata(), async () => dataset())
  const a = 10 * BOHR_TO_ANGSTROM
  const cell = [[a, 0, 0], [0, a, 0], [0, 0, a]]
  const points = topology_path_points(result, result.metadata.paths[0], cell)
  assert.ok(Math.abs(topology_path_length(points) - .4 * BOHR_TO_ANGSTROM) < 1e-12)
  assert.ok(topology_path_length(topology_path_points(result, result.metadata.paths[0])) > 5)
  const scene = topology_scene_data(result, cell)
  assert.equal(scene.points.length, 3)
  assert.equal(scene.points[2].id, 2)
  assert.ok(Math.abs(scene.points[2].position[0] - 10.2 * BOHR_TO_ANGSTROM) < 1e-12)
  assert.throws(() => topology_path_points(result, result.metadata.paths[0], [[0,0,0],[0,0,0],[0,0,0]]))
  const skewed = await resolve_topology({ ...metadata(), paths: [{ ...metadata().paths[0], count: 2 }] }, async () => ({
    x: Float64Array.of(0, 9.31, 0, 9.31), y: Float64Array.of(0, .49, 0, .49), z: new Float64Array(4),
  }))
  const skewCell = [[10,0,0],[9,1,0],[0,0,10]].map((row) => row.map((value) => value * BOHR_TO_ANGSTROM))
  const shortPath = topology_path_points(skewed, skewed.metadata.paths[0], skewCell)
  assert.ok(Math.abs(topology_path_length(shortPath) - Math.hypot(.31, -.51) * BOHR_TO_ANGSTROM) < 1e-12)
})

test('exports retain raw Bohr coordinates, scalar properties and every path point', async () => {
  const result = await resolve_topology(metadata(), async () => dataset())
  const exported = JSON.parse(topology_document(result))
  assert.deepEqual(exported.coordinates.x, [9.8, .2, 9.8, 0, .2])
  assert.deepEqual(exported.paths, result.metadata.paths)
  assert.equal(exported.coordinateUnit, 'bohr')
  const csv = topology_csv(result).trim().split('\n')
  assert.equal(csv.length, 6)
  assert.match(csv[0], /x_bohr.*density_au.*start_cp,end_cp/)
  assert.match(csv.at(-1)!, /path,1,1,2,0.2,0,0,,,1,2/)
})

test('display settings round-trip independently of topology scientific data', () => {
  const display = normalize_topology_display({ labels: true, radius: .13, width: 4, cpTypes: [false,true,true,false,true], pathTypes: [true,false,true,false] })
  const state = create_workbench_state({ manifest: {}, entries: [], isosurfaceSettings: {}, activeVolume: 0, atomSupercell: '1x1x1', showBoundaryAtoms: true, showUnitCell: false, topologyDisplay: display })
  const parsed = parse_workbench_state(JSON.parse(JSON.stringify(state)))
  assert.deepEqual(parsed.topologyDisplay, display)
  const restored = restore_workbench_state(parsed, { entries: [], isosurfaceSettings: {} })
  assert.deepEqual(restored.topologyDisplay, display)
  assert.equal('criticalPoints' in state, false)
  assert.deepEqual(normalize_topology_display({ radius: NaN, width: 100, cpTypes: [1] }), { cpTypes: [true,true,true,true,true], pathTypes: [true,true,true,true], radius: .09, width: 6, labels: false })
})

test('vendor exposes a shared scene slot and hides surfaces without unmounting', async () => {
  const base = new URL('../node_modules/matterviz/dist/structure/', import.meta.url)
  const scene = await readFile(new URL('StructureScene.svelte', base), 'utf8')
  const structure = await readFile(new URL('Structure.svelte', base), 'utf8')
  const declarations = await readFile(new URL('Structure.svelte.d.ts', base), 'utf8')
  assert.match(scene, /\{@render scene_children\?\.\(\)\}/)
  assert.match(scene, /<T.Group visible=\{!topology_view\}>/)
  assert.match(scene, /show_atoms \|\| topology_view/)
  assert.doesNotMatch(scene, /\{#if !topology_view\}/)
  assert.match(structure, /scene_props,\s+scene_children,\s+topology_view,/)
  assert.match(declarations, /scene_children\?: Snippet/)
  assert.match(declarations, /topology_view\?: boolean/)
})

test('the overlay does not alter atom identities or scalar geometry', async () => {
  const overlay = await readFile(new URL('../src/TopologyOverlay.svelte', import.meta.url), 'utf8')
  assert.match(overlay, /InstancedMesh/)
  assert.match(overlay, /LineSegments2/)
  assert.doesNotMatch(overlay, /marching|addIsosurface|fetch\(|measured_sites\s*=/)
  assert.match(overlay, /stopImmediatePropagation/)
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8')
  const request = app.split('const request_topology =')[1].split('const export_topology =')[0]
  assert.equal(request.match(/generation !== topologyGeneration \|\| geometry !== geometryKey/g)?.length, 2)
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  assert.match(css, /\.workspace\.has-topology \.structure\s*\{\s*--struct-min-width: 0px/)
})

test('hidden paths are excluded from both rendered instances and picking indices', async () => {
  const overlay = await readFile(new URL('../src/TopologyOverlay.svelte', import.meta.url), 'utf8')
  const update = overlay.slice(overlay.indexOf('let offset = 0'), overlay.indexOf('starts.needsUpdate = true'))
  assert.match(update, /pathIndices = \[\]/)
  assert.match(update, /if \(!display\.pathTypes\[path\.type\]\) continue/)
  assert.match(update, /ends\.setXYZ\(offset, \.\.\.points\[index\]\)/)
  assert.match(update, /pathIndices\.push\(path\.id\)/)
  assert.match(update, /lines\.geometry\.instanceCount = offset/)
  assert.doesNotMatch(update, /display\.pathTypes\[path\.type\]\s*\?/)
})
