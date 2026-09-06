<script lang="ts">
  import { T, useThrelte } from '@threlte/core'
  import { onMount, untrack } from 'svelte'
  import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, SphereGeometry, Vector2 } from 'three'
  import { surface_color, surface_position, surface_range, surface_render_indices, type SurfaceResult, type SurfaceDisplay } from './surface-analysis'
  let { result, display, selection, onselect, onready }: { result: SurfaceResult; display: SurfaceDisplay; selection: number | undefined; onselect: (index: number | undefined) => void; onready: () => void } = $props()
  const { renderer, camera, invalidate } = useThrelte()
  const group = new Group()
  let surface: Mesh<BufferGeometry, MeshStandardMaterial> | undefined
  let markers: InstancedMesh<SphereGeometry, MeshBasicMaterial> | undefined
  let revision = $state(0)
  $effect(() => {
    const current = result
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(current.xyz, (n) => n * current.metadata.bohrToAngstrom), 3))
    geometry.setIndex(new BufferAttribute(surface_render_indices(current), 1))
    const colors = new Float32Array(current.values.length * 3), range = surface_range(current)
    for (let i = 0; i < current.values.length; i++) new Color(current.metadata.mapped ? surface_color(current.values[i], range) : '#81a6b3').toArray(colors, 3 * i)
    geometry.setAttribute('color', new BufferAttribute(colors, 3)); geometry.computeVertexNormals()
    const material = new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, transparent: true, depthWrite: false, roughness: .65, metalness: 0 })
    surface = new Mesh(geometry, material); group.add(surface)
    const markerGeometry = new SphereGeometry(1, 16, 12)
    const markerMaterial = new MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 1, depthTest: true, depthWrite: false })
    markers = new InstancedMesh(markerGeometry, markerMaterial, current.extremeId.length)
    markers.renderOrder = 30; group.add(markers)
    untrack(() => revision++)
    invalidate()
    const frame = requestAnimationFrame(onready)
    return () => { cancelAnimationFrame(frame); group.clear(); geometry.dispose(); material.dispose(); markerGeometry.dispose(); markerMaterial.dispose(); surface = undefined; markers = undefined }
  })
  $effect(() => {
    void revision
    if (!surface || !markers) return
    surface.visible = display.surface; surface.material.opacity = Math.max(.05, Math.min(1, display.opacity)); surface.material.wireframe = display.wireframe
    const matrix = new Matrix4()
    for (let i = 0; i < result.extremeId.length; i++) {
      const visible = result.extremeKind[i] < 0 ? display.minima : display.maxima
      const v = result.extremeVertex[i], value = result.values[v], radius = visible ? .10 : 0
      matrix.makeScale(radius, radius, radius).setPosition(...surface_position(result, v)); markers.setMatrixAt(i, matrix)
      markers.setColorAt(i, new Color(selection === i ? '#ffd400' : Math.abs(value) < 1e-12 ? '#ffffff' : value < 0 ? '#f5a9b8' : '#5bcefa'))
    }
    markers.instanceMatrix.needsUpdate = true
    if (markers.instanceColor) markers.instanceColor.needsUpdate = true
    markers.computeBoundingSphere(); invalidate()
  })
  onMount(() => {
    const canvas = renderer.domElement, raycaster = new Raycaster(), pointer = new Vector2()
    let down: { x: number; y: number; index: number } | undefined
    const pick = (event: MouseEvent): number | undefined => {
      if (!markers || event.ctrlKey || event.metaKey || event.button !== 0) return undefined
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return undefined
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
      raycaster.setFromCamera(pointer, camera.current); group.updateWorldMatrix(true, true)
      return raycaster.intersectObject(markers).find((hit) => hit.instanceId !== undefined && (result.extremeKind[hit.instanceId] < 0 ? display.minima : display.maxima))?.instanceId
    }
    const start = (event: PointerEvent) => { const index = pick(event); down = index === undefined ? undefined : { x: event.clientX, y: event.clientY, index }; if (down) event.stopImmediatePropagation() }
    const finish = (event: PointerEvent) => {
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 4 && pick(event) === down.index) {
        event.stopImmediatePropagation(); onselect(selection === down.index ? undefined : down.index)
      }
      down = undefined
    }
    const click = (event: MouseEvent) => { if (pick(event) !== undefined) event.stopImmediatePropagation() }
    canvas.addEventListener('pointerdown', start, true); canvas.addEventListener('pointerup', finish, true); canvas.addEventListener('click', click, true)
    return () => { canvas.removeEventListener('pointerdown', start, true); canvas.removeEventListener('pointerup', finish, true); canvas.removeEventListener('click', click, true) }
  })
</script>

<T is={group} />
