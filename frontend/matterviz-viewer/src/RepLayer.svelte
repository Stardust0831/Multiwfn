<script lang="ts">
  import { StructureScene, Lattice, compare_volume_grids, type AnyStructure, type VolumetricData, type MeasureMode, type SelectedBondContext } from 'matterviz'
  import { T } from '@threlte/core'
  import { untrack } from 'svelte'
  import { rep_scene_props, valid_cell, type Rep, type Cell, type Vec } from './reps'
  import { rep_structure, rep_clip_planes, rep_translations, rep_bonds, type RepBondEdits } from './rep-periodic'
  import RepAppearance from './RepAppearance.svelte'
  import RepVolume from './RepVolume.svelte'
  let { rep, structure, volumes, bondEdits, measureMode, measurementOwner, budget, sceneProps, onmeasure, oncontext, onerror, order = 0 }: {
    rep: Rep; structure: AnyStructure; volumes: VolumetricData[]; measureMode: MeasureMode; measurementOwner: string; budget?: number
    bondEdits: RepBondEdits
    sceneProps: Record<string, unknown>
    onmeasure: (id: string, structure: AnyStructure, sites: number[]) => void
    oncontext: (detail: SelectedBondContext) => void; onerror: (id: string, message: string) => void
    order?: number
  } = $props()
  let sites = $state<number[]>([])
  const sourceVolume = $derived(rep.source.kind === 'volume' ? volumes[rep.source.index] : undefined)
  const cell = $derived(rep.periodic.cell ?? (rep.source.kind === 'volume' ? sourceVolume?.lattice : 'lattice' in structure ? structure.lattice.matrix : undefined))
  const data = $derived.by(() => {
    try {
      if (rep.source.kind === 'volume' && !sourceVolume) throw new Error('Source dataset is unavailable')
      if (rep.volume.color_volume_idx !== undefined && rep.source.kind === 'volume' && !volumes[rep.volume.color_volume_idx]) throw new Error('Color dataset is unavailable')
      if (sourceVolume && rep.volume.color_volume_idx !== undefined && !compare_volume_grids(sourceVolume, volumes[rep.volume.color_volume_idx]).ok) throw new Error('The selected color grid is incompatible with this source')
      const referenceOrigin = volumes[0]?.origin_mode === 'absolute' ? [0, 0, 0] : volumes[0]?.origin ?? [0, 0, 0]
      const origin: Vec = sourceVolume ? sourceVolume.origin.map((n, axis) => n - referenceOrigin[axis]) as Vec : [0, 0, 0]
      return { planes: rep_clip_planes(rep.source.kind === 'structure' && rep.periodic.boundary !== 'clip' ? { ...rep.periodic, enabled: false } : rep.periodic, cell as Cell | undefined, origin), origin,
        atoms: rep.source.kind === 'structure' ? rep_structure(structure, rep, cell as Cell | undefined) : undefined,
        translations: rep.source.kind === 'volume' ? rep_translations(rep.periodic, cell as Cell | undefined) : [], error: '' }
    } catch (error) { return { error: (error as Error).message } }
  })
  $effect(() => { onerror(rep.id, data.error) })
  const measurementKey = $derived(JSON.stringify([rep.source.kind, rep.structure.selection, rep.structure.radius, rep.periodic]))
  $effect(() => {
    // Geometry changes can reorder the finite display's atom indices.
    structure; measurementKey
    untrack(() => { sites = [] })
  })
  $effect(() => {
    const measured = sites
    const displayed = data.atoms?.structure
    untrack(() => {
      if (displayed && measured.length) onmeasure(rep.id, displayed, measured)
      else if (!measured.length && measurementOwner === rep.id) onmeasure(rep.id, displayed ?? structure, [])
    })
  })
  $effect(() => { if (measurementOwner !== rep.id) sites = [] })
  const edits = $derived(data.atoms ? {
    added: rep_bonds(data.atoms, bondEdits.added, rep.periodic.enabled),
    removed: rep_bonds(data.atoms, bondEdits.removed, rep.periodic.enabled),
    overrides: rep_bonds(data.atoms, bondEdits.overrides, rep.periodic.enabled),
  } : { added: [], removed: [], overrides: [] })
  const localProps = $derived(rep_scene_props(rep))
</script>

{#if !data.error}
  <RepAppearance appearance={rep.material} planes={data.planes} name={`representation-${rep.id}`} {order}>
    {#if rep.source.kind === 'structure' && data.atoms}
      <StructureScene
        geometry_only
        structure={data.atoms.structure}
        base_structure={structure}
        added_bonds={edits.added} removed_bonds={edits.removed} bond_order_overrides={edits.overrides}
        {...localProps}
        ambient_light={Number(sceneProps.ambient_light ?? 0.72)}
        directional_light={Number(sceneProps.directional_light ?? 1.2)}
        lighting_rig={sceneProps.lighting_rig === 'tmim' ? 'tmim' : 'default'}
        fill_light={Number(sceneProps.fill_light ?? 0.38)} rim_light={Number(sceneProps.rim_light ?? 0.24)}
        bond_shininess={rep.material.shininess}
        bind:measured_sites={sites}
        measure_mode={measureMode === 'angle' ? 'angle' : 'distance'}
        measure_geometry="ordered"
        measure_selection_policy={{ distance: { max_sites: 2, overflow: 'restart' }, angle: { max_sites: 4, overflow: 'reject' } }}
        show_atom_tooltip={false}
        on_selected_bond_context={oncontext}
      />
    {:else if rep.source.kind === 'volume'}
      <RepVolume {rep} {volumes} translations={data.translations!} {budget} onerror={(message) => onerror(rep.id, message)} />
    {/if}
  </RepAppearance>
  {#if rep.periodic.showCell && valid_cell(cell)}
    <T.Group position={data.origin}><Lattice matrix={cell} show_cell_vectors={false} cell_edge_opacity={0.5} cell_edge_color="#71869b" cell_surface_opacity={0} /></T.Group>
  {/if}
{/if}
