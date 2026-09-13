<script>
  import { Canvas } from '@threlte/core'
  import Scene from 'fixture-matterviz/structure/StructureScene.svelte'
  let topology = $state(false)
  let mode = $state('distance')
  let editMode = $state('delete')
  let measured = $state([0, 1])
  let removed = $state([])
  let added = $state([])
  let showLabels = $state(false)
  let showAtoms = $state(true)
  let controls = $state()
  $effect(() => { if (controls) { controls.enabled = false; controls.autoRotate = false } })
  const contexts = []
  let structure = $state({
    sites: [-0.7, 0.7].map((x) => ({ species: [{ element: 'C', occu: 1 }], xyz: [x, 0, 0], abc: [x, 0, 0], properties: {} })),
    properties: { bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 1 }] },
  })
  window.fixture = {
    topology(value) { topology = value },
    mode(value) { mode = value },
    editMode(value) { editMode = value },
    measured(value) { measured = value },
    labels(value) { showLabels = value },
    atoms(value) { showAtoms = value },
    partial(value) { structure = { ...structure, sites: structure.sites.map((site, index) => index ? site : { ...site, species: value ? [{ element: 'C', occu: 0.5 }, { element: 'N', occu: 0.5 }] : [{ element: 'C', occu: 1 }] }) } },
    resetEdits() { removed = []; added = [] },
    state() { return { topology, mode, editMode, measured: [...measured], removed: [...removed], added: [...added], contexts: [...contexts] } },
  }
</script>
<div style="width: 800px; height: 600px">
  <Canvas>
    <Scene {structure} topology_view={topology} show_atoms={showAtoms} atom_radius={0.35} show_bonds="always"
      show_site_labels={showLabels} show_site_indices={showLabels} show_atom_tooltip={false} gizmo={false}
      site_label_offset={[0, 1, 0]}
      bind:measure_mode={mode} bind:bond_edit_mode={editMode}
      bind:orbit_controls={controls} auto_rotate={0} initial_zoom={5} fov={45}
      bind:measured_sites={measured} bind:removed_bonds={removed} bind:added_bonds={added}
      camera_position={[0, 0, 4]} camera_target={[0, 0, 0]} camera_projection="perspective" camera_control_mode="orbit"
      on_selected_bond_context={(detail) => contexts.push(detail)} />
  </Canvas>
</div>
