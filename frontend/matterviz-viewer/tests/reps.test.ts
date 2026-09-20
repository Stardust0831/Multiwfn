import assert from 'node:assert/strict'
import test from 'node:test'
import { MeshPhongMaterial, MeshBasicMaterial, ShaderLib, Mesh, SphereGeometry, Raycaster, Vector3, Plane, Box3 } from 'three'
import type { AnyStructure } from 'matterviz/structure'
import { create_rep, copy_rep, normalize_reps, migrate_reps, rep_surface_settings, remap_rep_sources, dataset_source, material_preset, rep_scene_props, type Cell } from '../src/reps.ts'
import { rep_clip_planes, rep_translations, rep_structure, fractional_position, translate_cell, select_rep_sites, clipped_rep_bounds, rep_bonds } from '../src/rep-periodic.ts'
import { update_rep_material, clip_rep_raycast } from '../src/rep-material.ts'
import { create_workbench_state, parse_workbench_state, restore_workbench_state } from '../src/state.ts'

const source: AnyStructure = {
  sites: [
    { xyz: [0.5, 0.5, 0.5], abc: [0.125, 0.125, 0.125], species: [{ element: 'C', occu: 1, oxidation_state: 0 }], label: 'C1', properties: {} },
    { xyz: [1.5, 0.5, 0.5], abc: [0.375, 0.125, 0.125], species: [{ element: 'O', occu: 1, oxidation_state: 0 }], label: 'O2', properties: {} },
  ], properties: { bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 2 }] },
}
const cubic: Cell = [[4, 0, 0], [0, 4, 0], [0, 0, 4]]

test('duplicated Reps independently own geometry controls, material, data mapping and PBC', () => {
  const first = create_rep({ kind: 'volume', index: 0, path: 'density.cube' }, 'first')
  first.volume.color_volume_idx = 1; first.volume.colorSourcePath = 'esp.cube'
  const second = copy_rep(first, 'second')
  second.material.opacity = 0.3; second.material.shininess = 90
  second.periodic.enabled = true; second.periodic.range[0] = [-0.5, 1.5]
  second.volume.isovalue = 0.008; second.volume.color = '#ff0000'
  assert.equal(first.material.opacity, 1)
  assert.deepEqual(first.periodic.range[0], [0, 1])
  assert.equal(first.volume.isovalue, 0.02)
  assert.equal(second.followData, false)
  assert.equal(rep_surface_settings(second).layers?.[0].color_volume_idx, 1)
  assert.equal(rep_surface_settings(second).layers?.[0].opacity, 0.3)
})

test('fractional clipping uses actual skew/reflected vectors and shifted origins', () => {
  for (const cell of [cubic, [[4, 0, 0], [1, 3, 0], [0.5, 0.3, 5]], [[-4, 0, 0], [1, 3, 0], [0, 0, 5]]] as Cell[]) {
    const rep = create_rep({ kind: 'structure' }, 'pbc')
    rep.periodic.enabled = true; rep.periodic.range = [[-0.5, 1.5], [0.25, 1.1], [-0.2, 0.8]]
    const origin: [number, number, number] = [2, -1, 3]
    const planes = rep_clip_planes(rep.periodic, cell, origin)
    for (const frac of [[0, 0.5, 0.5], [-0.6, 0.5, 0.5], [1.6, 0.5, 0.5], [0, 0.2, 0.5], [0, 0.5, 0.9]] as [number, number, number][]) {
      const point = new Vector3(...translate_cell(cell, frac)).add(new Vector3(...origin))
      const expected = frac.every((n, axis) => n >= rep.periodic.range[axis][0] && n <= rep.periodic.range[axis][1])
      assert.equal(planes.every((plane) => plane.distanceToPoint(point) >= -1e-8), expected)
      const roundTrip = fractional_position(cell, point.toArray(), origin)
      roundTrip.forEach((n, axis) => assert.ok(Math.abs(n - frac[axis]) < 1e-12))
    }
  }
})

test('periodic copies translate in custom vectors, allow noninteger ranges, and bound allocation', () => {
  const rep = create_rep({ kind: 'structure' }, 'pbc')
  rep.periodic.enabled = true; rep.periodic.range[0] = [-0.5, 1.5]
  assert.deepEqual(rep_translations(rep.periodic, cubic), [[-4, 0, 0], [0, 0, 0], [4, 0, 0]])
  rep.periodic.axes[0] = false
  assert.deepEqual(rep_translations(rep.periodic, cubic), [[0, 0, 0]])
  assert.equal(rep_clip_planes(rep.periodic, cubic).length, 4)
  rep.periodic.axes = [true, true, true]; rep.periodic.range = [[-20, 20], [-20, 20], [-20, 20]]
  assert.throws(() => rep_translations(rep.periodic, cubic), /exceeds 512/)
  assert.throws(() => rep_clip_planes(rep.periodic, [[1, 0, 0], [2, 0, 0], [0, 0, 1]]), /valid lattice/)
})

test('finite structure display retains source positions, atom identities and explicit bond orders', () => {
  const original = structuredClone(source), rep = create_rep({ kind: 'structure' }, 'structure')
  rep.periodic.enabled = true; rep.periodic.axes = [true, false, false]; rep.periodic.range[0] = [0, 1.5]
  rep.periodic.cell = [[5, 1, 0], [0, 4, 0], [0, 0, 4]]
  const result = rep_structure(source, rep, cubic)
  for (const [index, site] of result.structure.sites.entries()) {
    const input = source.sites[result.sourceIndices[index]], translation = translate_cell(rep.periodic.cell, result.shifts[index])
    assert.deepEqual(site.xyz, input.xyz.map((n, axis) => n + translation[axis]))
    assert.equal(site.properties.rep_source_index, result.sourceIndices[index])
  }
  assert.ok(result.structure.properties?.bonds?.length)
  for (const bond of result.structure.properties!.bonds!) {
    assert.equal(bond.order, 2)
    const [a, b] = [bond.site_idx_1, bond.site_idx_2].map((index) => result.structure.sites[index].xyz)
    assert.ok(Math.abs(new Vector3(...a).distanceTo(new Vector3(...b)) - 1) < 1e-12)
  }
  assert.deepEqual(source, original)
})

test('atom selection is explicit and cannot accidentally select a different atom', () => {
  assert.deepEqual(select_rep_sites(source, 'all'), [0, 1])
  assert.deepEqual(select_rep_sites(source, 'element O'), [1])
  assert.deepEqual(select_rep_sites(source, 'index 1-2, 2'), [0, 1])
  assert.throws(() => select_rep_sites(source, 'index 0'), /outside/)
  assert.throws(() => select_rep_sites(source, 'name protein'), /Use all/)
})

test('all independent Reps round trip and remap geometry and color sources by identity', () => {
  const first = create_rep({ kind: 'volume', index: 0, path: 'density.cube' }, 'density')
  first.volume.color_volume_idx = 1; first.volume.colorSourcePath = 'esp.cube'
  first.material.diffuse = 2.4; first.material.saturation = 2.6; first.material.opacity = 0.6
  const second = copy_rep(first, 'copy')
  second.material.saturation = 0
  second.periodic.cell = cubic; second.periodic.range[1] = [-0.25, 1.25]; second.periodic.enabled = true
  const representations = { items: [first, second], selectedId: 'copy' }
  const entries = [{ path: 'density.cube' }, { path: 'esp.cube' }]
  const isosurfaceSettings = rep_surface_settings(first)
  const state = parse_workbench_state(JSON.parse(JSON.stringify(create_workbench_state({ representations, manifest: {}, entries, isosurfaceSettings, activeVolume: 0, atomSupercell: '1x1x1', showBoundaryAtoms: true, showUnitCell: true }))))
  assert.deepEqual(state.representations, normalize_reps(representations))
  const restored = restore_workbench_state(state, { entries: [...entries].reverse(), isosurfaceSettings }).representations!
  assert.equal(restored.selectedId, 'copy')
  assert.equal(restored.items[0].source.kind === 'volume' && restored.items[0].source.index, 1)
  assert.equal(restored.items[0].volume.color_volume_idx, 0)
  assert.equal(restored.items[0].material.diffuse, 2.4)
  assert.equal(restored.items[0].material.saturation, 2.6)
  assert.equal(restored.items[1].material.saturation, 0)
  assert.deepEqual(restored.items[1].periodic.range[1], [-0.25, 1.25])
  assert.equal((remap_rep_sources(representations, [{ path: 'unrelated.cube' }]).items[0].source as { index: number }).index, -1)
})

test('malformed saved cells and duplicate IDs are rejected instead of silently changing the display', () => {
  const rep = create_rep({ kind: 'structure' }, 'same')
  assert.throws(() => normalize_reps({ items: [rep, rep], selectedId: rep.id }), /Duplicate/)
  rep.periodic.cell = [[1, 0, 0], [2, 0, 0], [0, 0, 1]]
  assert.throws(() => normalize_reps({ items: [rep] }), /nonsingular/)
})

test('legacy layers migrate with their sign, palette, opacity, material and cross-volume mapping', () => {
  const volume = create_rep({ kind: 'volume', index: 0 }, 'legacy')
  volume.material.opacity = 0.25; volume.material.outline = 0.7; volume.volume.color_volume_idx = 1; volume.volume.colormap = 'interpolateTransFlag'
  const migrated = migrate_reps({ atom_opacity: 0.6, show_bonds: 'never' }, rep_surface_settings(volume), [{ path: 'density' }, { path: 'esp' }], true)
  assert.equal(migrated.items[0].structure.style, 'spacefill')
  assert.equal(migrated.items[0].material.opacity, 0.6)
  assert.equal(migrated.items[1].material.opacity, 0.25)
  assert.equal(migrated.items[1].material.outline, 0.7)
  assert.equal(migrated.items[1].volume.colorSourcePath, 'esp')
})

test('diffuse gain and saturation update live uniforms without rebuilding the material', () => {
  const rep = create_rep({ kind: 'structure' }, 'appearance'), material = new MeshPhongMaterial()
  update_rep_material(material, rep.material, [])
  const shader = { vertexShader: ShaderLib.phong.vertexShader, fragmentShader: ShaderLib.phong.fragmentShader, uniforms: {} }
  material.onBeforeCompile(shader, null as never)
  assert.match(shader.fragmentShader, /reflectedLight.directDiffuse \*= repDiffuse/)
  const uniform = (shader.uniforms as Record<string, { value: number }>).repDiffuse
  const saturation = (shader.uniforms as Record<string, { value: number }>).repSaturation
  assert.equal(saturation.value, 1)
  assert.ok(shader.fragmentShader.indexOf('float repLuminance') > shader.fragmentShader.indexOf('#include <tonemapping_fragment>'))
  assert.ok(shader.fragmentShader.indexOf('float repLuminance') < shader.fragmentShader.indexOf('#include <colorspace_fragment>'))
  const version = material.version
  update_rep_material(material, { ...rep.material, diffuse: 3, saturation: 2.5 }, [])
  assert.equal(uniform.value, 3)
  assert.equal(saturation.value, 2.5)
  assert.equal(material.version, version)
  material.dispose()
  const unlit = new MeshBasicMaterial()
  update_rep_material(unlit, { ...rep.material, model: 'unlit', diffuse: 0.2, saturation: 0 }, [])
  const basicShader = { vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader, uniforms: {} }
  unlit.onBeforeCompile(basicShader, null as never)
  assert.equal((basicShader.uniforms as Record<string, { value: number }>).repDiffuse.value, 1,
    'unlit and wireframe colors ignore inactive diffuse controls')
  assert.equal((basicShader.uniforms as Record<string, { value: number }>).repSaturation.value, 0,
    'unlit and wireframe still support saturation')
  unlit.dispose()
})

test('legacy saturation defaults to 1 and gain controls clamp independently from opacity', () => {
  const rep = create_rep({ kind: 'structure' }, 'legacy')
  const normalize = (material: Record<string, unknown>) => normalize_reps({ items: [{ ...rep, material }], selectedId: rep.id })!.items[0].material
  assert.equal(normalize({ diffuse: 0.4 }).saturation, 1)
  assert.equal(normalize({ diffuse: 0.4 }).diffuse, 0.4)
  for (const value of [0, 1, 2.5, 3]) {
    const material = normalize({ diffuse: value, saturation: value, opacity: value })
    assert.equal(material.diffuse, value)
    assert.equal(material.saturation, value)
    assert.equal(material.opacity, Math.min(value, 1))
  }
  for (const [value, expected] of [[-4, 0], [8, 3], [Infinity, 1], [NaN, 1], [undefined, 1]] as const) {
    const material = normalize({ diffuse: value, saturation: value })
    assert.equal(material.diffuse, expected)
    assert.equal(material.saturation, expected)
  }
  const reset = material_preset({ ...rep.material, diffuse: 2, saturation: 3 }, 'glass1')
  assert.equal(reset.diffuse, 1); assert.equal(reset.saturation, 1)
})

test('clipped atoms cannot be picked and changing planes updates existing hit targets', () => {
  const mesh = new Mesh(new SphereGeometry(1), new MeshPhongMaterial())
  mesh.updateMatrixWorld(true)
  const ray = new Raycaster(new Vector3(0.1, 0.1, 5), new Vector3(0, 0, -1))
  clip_rep_raycast(mesh, () => [new Plane(new Vector3(1, 0, 0), -2)])
  assert.equal(ray.intersectObject(mesh).length, 0)
  clip_rep_raycast(mesh, () => [])
  assert.ok(ray.intersectObject(mesh).length > 0)
  mesh.geometry.dispose(); (mesh.material as MeshPhongMaterial).dispose()
})


test('datasets sharing one file keep their independent slot identities after reordering', () => {
  const entries = [{ path: 'both.cube' }, { path: 'both.cube' }, { path: 'other.cube' }]
  const rep = create_rep(dataset_source(entries, 1), 'second-grid')
  rep.volume.colorSourcePath = 'both.cube'; rep.volume.colorSourceSlot = 0
  const restored = remap_rep_sources({ items: [rep], selectedId: rep.id }, [{ path: 'other.cube' }, ...entries.slice(0, 2)]).items[0]
  assert.equal(restored.source.kind === 'volume' && restored.source.index, 2)
  assert.equal(restored.volume.color_volume_idx, 1)
  assert.equal((remap_rep_sources({ items: [rep], selectedId: rep.id }, entries.slice(0, 1)).items[0].source as { index: number }).index, -1)
})

test('legacy supercells and whole boundary atom choices survive migration', () => {
  const migrated = migrate_reps({}, rep_surface_settings(create_rep({ kind: 'structure' })), [], true,
    { atomSupercell: '2x1x1', showBoundaryAtoms: false, showUnitCell: false }).items[0]
  assert.deepEqual(migrated.periodic.range, [[0, 2], [0, 1], [0, 1]])
  assert.equal(migrated.periodic.showCell, false)
  const boundarySource = { ...source, sites: [{ ...source.sites[0], xyz: [0, 0, 0] as [number, number, number] }] }
  assert.equal(rep_structure(boundarySource, migrated, cubic).structure.sites.length, 2)
  migrated.periodic.boundary = 'atoms'
  assert.equal(rep_structure(boundarySource, migrated, cubic).structure.sites.length, 12)
})

test('numeric radii match the renderer, glass is transparent, malformed collections are rejected', () => {
  const rep = create_rep({ kind: 'structure' })
  rep.structure.style = 'spacefill'; rep.structure.radius = 1.1
  assert.equal(rep_scene_props(rep).atom_radius, 1.1)
  assert.equal(material_preset(rep.material, 'glass1').opacity, 0.35)
  assert.throws(() => normalize_reps({}), /Invalid representations/)
  assert.throws(() => normalize_reps(null), /Invalid representations/)
  assert.equal(normalize_reps(undefined), undefined)
})


test('fit-to-view excludes clipped guard geometry and handles empty and skew intersections', () => {
  const bounds = new Box3(new Vector3(-5, -5, -5), new Vector3(5, 5, 5))
  const rep = create_rep({ kind: 'structure' })
  rep.periodic.enabled = true
  rep.periodic.range = [[0, 0.5], [0, 0.5], [0, 0.5]]
  const clipped = clipped_rep_bounds(bounds, rep_clip_planes(rep.periodic, [[4, 0, 0], [1, 4, 0], [0, 0, 4]]))
  assert.deepEqual(clipped.min.toArray(), [0, 0, 0])
  assert.deepEqual(clipped.max.toArray(), [2.5, 2, 2])
  assert.equal(clipped_rep_bounds(bounds, [new Plane(new Vector3(1, 0, 0), -6)]).isEmpty(), true)
})


test('removing an earlier dataset from the same file preserves the retained dataset identity', () => {
  const entries = [{ path: 'both.cube', datasetSlot: 0 }, { path: 'both.cube', datasetSlot: 1 }]
  const rep = create_rep(dataset_source(entries, 1), 'second-grid')
  rep.volume.colorSourcePath = 'both.cube'; rep.volume.colorSourceSlot = 0
  const restored = remap_rep_sources({ items: [rep], selectedId: rep.id }, entries.slice(1)).items[0]
  assert.equal(restored.source.kind === 'volume' && restored.source.index, 0)
  assert.equal(restored.volume.color_volume_idx, -1, 'missing color source cannot silently use another grid')
})


test('native bond edits map to each independently selected and repeated display', () => {
  const rep = create_rep({ kind: 'structure' })
  rep.periodic.enabled = true; rep.periodic.boundary = 'none'; rep.periodic.range[0] = [0, 2]
  const display = rep_structure(source, rep, cubic)
  const edits = [{ site_idx_1: 0, site_idx_2: 1, order: 3 as const }]
  const mapped = rep_bonds(display, edits, true)
  assert.equal(mapped.length, 2)
  for (const bond of mapped) {
    assert.equal(display.sourceIndices[bond.site_idx_1], 0)
    assert.equal(display.sourceIndices[bond.site_idx_2], 1)
    assert.deepEqual(display.shifts[bond.site_idx_1], display.shifts[bond.site_idx_2])
    assert.equal(bond.order, 3)
  }
  rep.structure.selection = 'index 1'
  assert.deepEqual(rep_bonds(rep_structure(source, rep, cubic), edits, true), [])
})
