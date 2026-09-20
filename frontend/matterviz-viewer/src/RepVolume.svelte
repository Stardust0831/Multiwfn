<script lang="ts">
  import { VolumetricIsosurface, type VolumetricData } from 'matterviz'
  import { T, useTask, useThrelte } from '@threlte/core'
  import { Group, Mesh } from 'three'
  import { rep_surface_settings, type Rep, type Vec } from './reps'
  let { rep, volumes, translations, budget, onerror, oncolorrange }: { rep: Rep; volumes: VolumetricData[]; translations: Vec[]; budget?: number; onerror: (message: string) => void; oncolorrange?: (range: [number, number] | undefined) => void } = $props()
  let source = $state.raw<Group>()
  const copies = new Group()
  const { invalidate } = useThrelte()
  let lastSignature = ''
  const settings = $derived(rep_surface_settings(rep, budget))
  useTask(() => {
    if (!source) return
    const parts: string[] = [JSON.stringify(translations)]
    source.traverse((object) => {
      if (object instanceof Mesh) parts.push(object.uuid, object.geometry.uuid, ...[object.material].flat().map((material) => material.uuid))
    })
    const signature = parts.join('|')
    if (signature === lastSignature) return
    lastSignature = signature
    copies.clear()
    for (const translation of translations) {
      const copy = source.clone(true)
      copy.visible = true
      copy.position.set(...translation)
      copies.add(copy)
    }
    invalidate()
  }, { autoInvalidate: false })
  $effect(() => () => copies.clear())
</script>

<!-- Extract once per Rep; translated copies borrow the same geometry/materials.
     Only the source owns their lifetime. -->
<T.Group visible={false} bind:ref={source}>
  <VolumetricIsosurface {volumes} {settings} on_geometry_error={onerror} on_color_ranges={(ranges) => oncolorrange?.(ranges[0])} />
</T.Group>
<T is={copies} dispose={false} name={`rep-copies-${rep.id}`} />
