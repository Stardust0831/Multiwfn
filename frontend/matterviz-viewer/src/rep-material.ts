import { Material, Mesh, MeshBasicMaterial, Plane, type Object3D } from 'three'
import type { RepMaterial } from './reps.ts'

const installed = new WeakMap<Material, { value: number }>()
const raycasts = new WeakSet<Object3D>()
const clipping = new WeakMap<Object3D, () => Plane[]>()

/** All Rep atoms, bonds and surfaces use standard Three materials. Preserve
 * their rim/gradient hooks while scaling only the actual diffuse response. */
export const update_rep_material = (material: Material, appearance: RepMaterial, planes: Plane[]): void => {
  let uniform = installed.get(material)
  if (!uniform) {
    uniform = { value: appearance.diffuse }
    installed.set(material, uniform)
    const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey()
    const diffuse = uniform
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer)
      shader.uniforms.repDiffuse = diffuse
      shader.fragmentShader = 'uniform float repDiffuse;\n' + shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>',
        '#include <aomap_fragment>\nreflectedLight.directDiffuse *= repDiffuse;\nreflectedLight.indirectDiffuse *= repDiffuse;')
    }
    material.customProgramCacheKey = () => `${previousKey}:multiwfn-rep-v1`
    material.needsUpdate = true
  }
  uniform.value = material instanceof MeshBasicMaterial ? 1 : appearance.diffuse
  if ((material.clippingPlanes?.length ?? 0) !== planes.length) material.needsUpdate = true
  material.clippingPlanes = planes
}

/** Clipped atoms/bonds must not remain invisible click targets. */
export const clip_rep_raycast = (object: Object3D, planes: () => Plane[]): void => {
  clipping.set(object, planes)
  if (!(object instanceof Mesh) || raycasts.has(object)) return
  raycasts.add(object)
  const original = object.raycast
  object.raycast = function (raycaster, intersections) {
    const hits: typeof intersections = []
    original.call(this, raycaster, hits)
    const active = clipping.get(object)?.() ?? []
    intersections.push(...hits.filter((hit) => active.every((plane) => plane.distanceToPoint(hit.point) >= -1e-6)))
  }
}
