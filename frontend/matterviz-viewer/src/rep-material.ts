import { Material, Mesh, MeshBasicMaterial, Plane, type Object3D } from 'three'
import type { RepMaterial } from './reps.ts'

const installed = new WeakMap<Material, { diffuse: { value: number }; saturation: { value: number } }>()
const raycasts = new WeakSet<Object3D>()
const clipping = new WeakMap<Object3D, () => Plane[]>()

/** Preserve the standard materials' rim/gradient hooks. Diffuse gain scales
 * reflected light; saturation adjusts the tone-mapped linear RGB before output
 * conversion and alpha compositing. Neither modifies source colors or data. */
export const update_rep_material = (material: Material, appearance: RepMaterial, planes: Plane[]): void => {
  let uniforms = installed.get(material)
  if (!uniforms) {
    uniforms = { diffuse: { value: appearance.diffuse }, saturation: { value: appearance.saturation } }
    installed.set(material, uniforms)
    const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey()
    const { diffuse, saturation } = uniforms
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer)
      shader.uniforms.repDiffuse = diffuse
      shader.uniforms.repSaturation = saturation
      shader.fragmentShader = 'uniform float repDiffuse;\nuniform float repSaturation;\n' + shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>',
        '#include <aomap_fragment>\nreflectedLight.directDiffuse *= repDiffuse;\nreflectedLight.indirectDiffuse *= repDiffuse;')
      shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>', `#include <tonemapping_fragment>
        if (repSaturation != 1.0) {
          float repLuminance = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor.rgb = max(vec3(0.0), mix(vec3(repLuminance), gl_FragColor.rgb, repSaturation));
        }`)
    }
    material.customProgramCacheKey = () => `${previousKey}:multiwfn-rep-v2`
    material.needsUpdate = true
  }
  uniforms.diffuse.value = material instanceof MeshBasicMaterial ? 1 : appearance.diffuse
  uniforms.saturation.value = appearance.saturation
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
