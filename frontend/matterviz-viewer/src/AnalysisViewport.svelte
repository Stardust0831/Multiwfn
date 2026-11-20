<script lang="ts">
  import { Canvas, T } from '@threlte/core'
  import { OrbitControls } from '@threlte/extras'
  import { Box3, Group, PerspectiveCamera, Sphere, Vector3, WebGLRenderer } from 'three'
  import type { OrbitControls as Controls } from 'three/examples/jsm/controls/OrbitControls.js'
  import { tick } from 'svelte'
  import { with_png_background } from './scene-export'
  import TopologyOverlay from './TopologyOverlay.svelte'
  import SurfaceAnalysisOverlay from './SurfaceAnalysisOverlay.svelte'
  import type { TopologyDisplay, TopologyResult, TopologySelection } from './topology'
  import type { SurfaceDisplay, SurfaceResult } from './surface-analysis'

  let { topology, topologyDisplay, topologySelection = $bindable(), surface, surfaceDisplay,
    surfaceSelection = $bindable(), cell }: {
    topology?: TopologyResult; topologyDisplay: TopologyDisplay; topologySelection?: TopologySelection
    surface?: SurfaceResult; surfaceDisplay: SurfaceDisplay; surfaceSelection?: number; cell?: number[][]
  } = $props()
  const group = new Group()
  const camera = new PerspectiveCamera(45, 1, 0.01, 10000)
  let controls = $state.raw<Controls>()
  let renderer: WebGLRenderer

  function createRenderer(canvas: HTMLCanvasElement) {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    return renderer
  }
  export function fit() {
    if (!controls) return
    const bounds = new Box3().setFromObject(group)
    if (bounds.isEmpty()) return
    const { center, radius } = bounds.getBoundingSphere(new Sphere())
    const distance = Math.max(1, radius) * 1.12 / Math.sin(Math.atan(Math.tan(Math.PI / 8) * Math.min(1, camera.aspect)))
    camera.position.copy(center).addScaledVector(new Vector3(1, 1, 1).normalize(), distance)
    controls.target.copy(center)
    controls.update()
  }
  export async function capture(background?: string): Promise<Blob> {
    if (!group.parent) throw new Error('The analysis scene is not ready')
    renderer.render(group.parent, camera)
    const png = await new Promise<Blob>((resolve, reject) => renderer.domElement.toBlob(blob =>
      blob ? resolve(blob) : reject(new Error('Unable to encode scene PNG')), 'image/png'))
    return with_png_background(png, background)
  }
  $effect(() => {
    topology; surface; controls
    let pending = true
    void tick().then(() => { if (pending) fit() })
    return () => { pending = false }
  })
</script>

<Canvas {createRenderer}>
  <T is={camera} makeDefault><OrbitControls bind:ref={controls} /></T>
  <T.AmbientLight intensity={1.5} />
  <T.DirectionalLight position={[4, 6, 8]} intensity={2} />
  <T is={group}>
    {#if surface}
      <SurfaceAnalysisOverlay result={surface} display={surfaceDisplay} selection={surfaceSelection}
        onselect={value => surfaceSelection = value} onready={fit} />
    {:else if topology}
      <TopologyOverlay result={topology} display={topologyDisplay} selection={topologySelection}
        {cell} onselect={value => topologySelection = value} />
    {/if}
  </T>
</Canvas>
