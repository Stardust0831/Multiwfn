<script lang="ts">
  import { T, useTask, useThrelte } from '@threlte/core'
  import { Group, Mesh, Plane } from 'three'
  import type { Snippet } from 'svelte'
  import type { RepMaterial } from './reps'
  import { update_rep_material, clip_rep_raycast } from './rep-material'

  let { appearance, planes = [], children, name, order = 0 }: { appearance: RepMaterial; planes?: Plane[]; children: Snippet; name: string; order?: number } = $props()
  let group = $state.raw<Group>()
  const { renderer, invalidate } = useThrelte()
  $effect(() => { renderer.localClippingEnabled = true })
  $effect(() => { void appearance; void planes; invalidate() })
  useTask(() => {
    if (!group) return
    // Planes are specified in data coordinates. The host may rotate the whole
    // scene, so clipping and picking must use the same world transformation.
    group.updateWorldMatrix(true, false)
    const worldPlanes = planes.map((plane) => plane.clone().applyMatrix4(group!.matrixWorld))
    group.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) update_rep_material(material, appearance, worldPlanes)
      clip_rep_raycast(object, () => worldPlanes)
    })
  }, { autoInvalidate: false })
</script>

<T.Group bind:ref={group} {name} renderOrder={order}>
  {@render children()}
</T.Group>
