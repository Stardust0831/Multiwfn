<script lang="ts">
  import { T, useThrelte } from '@threlte/core'
  import { onMount } from 'svelte'
  import { BufferGeometry, CanvasTexture, Color, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Raycaster, SphereGeometry, Sprite, SpriteMaterial, Vector2 } from 'three'
  import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
  import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
  import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
  import { CP_COLORS, topology_scene_data, type TopologyDisplay, type TopologyResult, type TopologySelection } from './topology'
  let { result, display, selection, cell, onselect }: { result: TopologyResult; display: TopologyDisplay; selection: TopologySelection; cell?: number[][]; onselect: (selection: TopologySelection) => void } = $props()
  const { renderer, camera, invalidate } = useThrelte()
  const group = new Group()
  let pointsMesh: InstancedMesh | undefined
  let lines: LineSegments2 | undefined
  let cpIndices: number[] = []
  let pathIndices: number[] = []
  let geometries: BufferGeometry[] = []
  let materials: Array<MeshBasicMaterial | LineMaterial | SpriteMaterial> = []
  let labels: Sprite[] = []
  let sceneData = $state.raw<ReturnType<typeof topology_scene_data>>()
  const clearLabels = () => {
    labels.forEach((sprite) => { group.remove(sprite); sprite.material.map?.dispose(); sprite.material.dispose() }); labels = []
  }

  const clear = () => {
    clearLabels(); group.clear(); geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose())
    geometries = []; materials = []; cpIndices = []; pathIndices = []
    pointsMesh = undefined; lines = undefined
  }
  const label = (text: string, position: number[]) => {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 48
    const context = canvas.getContext('2d')!
    context.fillStyle = 'rgba(255,255,255,0.92)'; context.fillRect(0, 0, 128, 48)
    context.fillStyle = '#263238'; context.font = 'bold 27px sans-serif'; context.textAlign = 'center'; context.fillText(text, 64, 34)
    const texture = new CanvasTexture(canvas)
    const material = new SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, toneMapped: false })
    const sprite = new Sprite(material); sprite.position.set(position[0] + .2, position[1] + .15, position[2]); sprite.scale.set(.5, .1875, 1)
    sprite.renderOrder = 30; sprite.raycast = () => {}; labels.push(sprite); group.add(sprite)
  }
  $effect(() => {
    const current = result
    const lattice = cell
    clear()
    const data = topology_scene_data(current, lattice)
    const geometry = new SphereGeometry(1, 16, 12); geometries.push(geometry)
    const material = new MeshBasicMaterial({ toneMapped: false }); materials.push(material)
    pointsMesh = new InstancedMesh(geometry, material, data.points.length)
    cpIndices = data.points.map((cp) => cp.id)
    group.add(pointsMesh)
    const positions: number[] = []
    const colors: number[] = []
    for (const path of data.paths) {
      const points = path.points
      const color = new Color(path.type === 2 ? '#ad6589' : '#397d89')
      for (let index = 1; index < points.length; index++) {
        positions.push(...points[index - 1], ...points[index]); colors.push(color.r, color.g, color.b, color.r, color.g, color.b); pathIndices.push(path.id)
      }
    }
    const lineGeometry = new LineSegmentsGeometry(); lineGeometry.setPositions(positions); lineGeometry.setColors(colors); geometries.push(lineGeometry)
    const lineMaterial = new LineMaterial({ vertexColors: true, linewidth: 2, toneMapped: false }); materials.push(lineMaterial)
    lineMaterial.resolution.set(renderer.domElement.clientWidth, renderer.domElement.clientHeight)
    lines = new LineSegments2(lineGeometry, lineMaterial); group.add(lines)
    sceneData = data
    invalidate()
    return clear
  })
  $effect(() => {
    // Visibility, selection and sizes only touch the overlay; scalar geometry is unaffected.
    const data = sceneData
    if (!data || !pointsMesh || !lines) return
    const matrix = new Matrix4()
    for (const [index, cp] of data.points.entries()) {
      const position = cp.position
      const radius = display.cpTypes[cp.type] ? Number(display.radius) : 0
      matrix.makeScale(radius, radius, radius).setPosition(...position); pointsMesh.setMatrixAt(index, matrix)
      pointsMesh.setColorAt(index, new Color(selection?.kind === 'cp' && selection.id === cp.id ? '#ffd400' : CP_COLORS[cp.type]))
    }
    pointsMesh.instanceMatrix.needsUpdate = true
    if (pointsMesh.instanceColor) pointsMesh.instanceColor.needsUpdate = true
    pointsMesh.computeBoundingSphere()
    const starts = lines.geometry.getAttribute('instanceStart')
    const ends = lines.geometry.getAttribute('instanceEnd')
    const firstColors = lines.geometry.getAttribute('instanceColorStart')
    const lastColors = lines.geometry.getAttribute('instanceColorEnd')
    let offset = 0
    pathIndices = []
    for (const path of data.paths) {
      if (!display.pathTypes[path.type]) continue
      const points = path.points
      const color = new Color(selection?.kind === 'path' && selection.id === path.id ? '#ffd400' : path.type === 2 ? '#ad6589' : '#397d89')
      for (let index = 1; index < points.length; index++, offset++) {
        starts.setXYZ(offset, ...points[index - 1]); ends.setXYZ(offset, ...points[index])
        firstColors.setXYZ(offset, color.r, color.g, color.b); lastColors.setXYZ(offset, color.r, color.g, color.b)
        pathIndices.push(path.id)
      }
    }
    // Zero-length wide lines still draw caps; exclude hidden segments from drawing and picking.
    lines.geometry.instanceCount = offset
    starts.needsUpdate = true; ends.needsUpdate = true; firstColors.needsUpdate = true; lastColors.needsUpdate = true
    lines.material.linewidth = Number(display.width)
    clearLabels()
    if (display.labels) {
      for (const cp of data.points) if (display.cpTypes[cp.type]) label(`CP ${cp.id}`, cp.position)
      for (const path of data.paths) if (display.pathTypes[path.type]) {
        label(`P ${path.id}`, path.points[Math.floor(path.points.length / 2)])
      }
    }
    invalidate()
  })
  onMount(() => {
    const canvas = renderer.domElement
    const raycaster = new Raycaster()
    const pointer = new Vector2()
    let down: { x: number; y: number; target: TopologySelection } | undefined
    const pick = (event: PointerEvent): TopologySelection => {
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return undefined
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
      raycaster.setFromCamera(pointer, camera.current)
      group.updateWorldMatrix(true, true)
      for (const hit of raycaster.intersectObject(group, true)) {
        if (hit.object === pointsMesh && hit.instanceId !== undefined) {
          const id = cpIndices[hit.instanceId]
          if (display.cpTypes[result.metadata.criticalPoints[id - 1].type]) return { kind: 'cp', id }
        }
        if (hit.object === lines && hit.faceIndex != null) {
          const id = pathIndices[hit.faceIndex]
          if (id && display.pathTypes[result.metadata.paths[id - 1].type]) return { kind: 'path', id }
        }
      }
      return undefined
    }
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const target = pick(event)
      if (target) event.stopImmediatePropagation()
      down = target ? { x: event.clientX, y: event.clientY, target } : undefined
    }
    const pointerUp = (event: PointerEvent) => {
      if (event.button === 0 && down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 4) {
        const target = pick(event)
        if (target?.id === down.target?.id && target?.kind === down.target?.kind) { event.stopImmediatePropagation(); onselect(target) }
      }
      down = undefined
    }
    const click = (event: MouseEvent) => { if (event.button === 0 && pick(event as PointerEvent)) event.stopImmediatePropagation() }
    const resize = new ResizeObserver(() => { if (lines) lines.material.resolution.set(canvas.clientWidth, canvas.clientHeight); invalidate() })
    resize.observe(canvas); canvas.addEventListener('pointerdown', pointerDown, true); canvas.addEventListener('pointerup', pointerUp, true); canvas.addEventListener('click', click, true)
    return () => { resize.disconnect(); canvas.removeEventListener('pointerdown', pointerDown, true); canvas.removeEventListener('pointerup', pointerUp, true); canvas.removeEventListener('click', click, true) }
  })
</script>

<T is={group} />
