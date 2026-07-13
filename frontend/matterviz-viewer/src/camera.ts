import type { CameraProjection, Vec3 } from 'matterviz'

export type CameraPose = {
  position: Vec3
  target: Vec3
  up: Vec3
  projection: CameraProjection
  zoom?: number
}

export type CameraAxis = 'x' | 'y' | 'z'
export type CameraStepKind = 'rotation' | 'pan' | 'zoom'

const EPSILON = 1e-10

const STEP_LIMITS: Record<CameraStepKind, readonly [number, number]> = {
  rotation: [0.1, 180],
  pan: [0.001, 100],
  zoom: [0.1, 500],
}

export const normalize_camera_step = (value: unknown, kind: CameraStepKind): number | undefined => {
  if (value === '' || value === null || value === undefined) return undefined
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return undefined
  const [minimum, maximum] = STEP_LIMITS[kind]
  return Math.min(maximum, Math.max(minimum, numeric))
}

const finite_vec3 = (value: unknown): Vec3 | undefined => {
  if (!Array.isArray(value) || value.length !== 3) return undefined
  const vector = value.map(Number)
  return vector.every(Number.isFinite) ? vector as Vec3 : undefined
}

const add = (left: Vec3, right: Vec3): Vec3 => left.map((value, idx) => value + right[idx]) as Vec3
const subtract = (left: Vec3, right: Vec3): Vec3 => left.map((value, idx) => value - right[idx]) as Vec3
const scale = (vector: Vec3, factor: number): Vec3 => vector.map((value) => value * factor) as Vec3
const dot = (left: Vec3, right: Vec3): number => left.reduce((sum, value, idx) => sum + value * right[idx], 0)
const cross = (left: Vec3, right: Vec3): Vec3 => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
]
const length = (vector: Vec3): number => Math.hypot(...vector)

const normalize = (vector: Vec3): Vec3 | undefined => {
  const magnitude = length(vector)
  return Number.isFinite(magnitude) && magnitude > EPSILON ? scale(vector, 1 / magnitude) : undefined
}

const fallback_up = (back: Vec3): Vec3 => {
  const candidates: Vec3[] = [[0, 1, 0], [1, 0, 0], [0, 0, 1]]
  const seed = candidates.reduce((best, candidate) =>
    Math.abs(dot(candidate, back)) < Math.abs(dot(best, back)) ? candidate : best)
  return normalize(subtract(seed, scale(back, dot(seed, back)))) ?? [0, 1, 0]
}

export const normalize_camera_pose = (value: Partial<CameraPose>): CameraPose | undefined => {
  const position = finite_vec3(value.position)
  const target = finite_vec3(value.target)
  const rawUp = finite_vec3(value.up) ?? [0, 1, 0]
  const projection = value.projection === 'perspective' || value.projection === 'orthographic'
    ? value.projection
    : undefined
  if (!position || !target || !projection) return undefined
  const back = normalize(subtract(position, target))
  if (!back) return undefined
  let up = normalize(rawUp) ?? fallback_up(back)
  if (!normalize(cross(up, back))) up = fallback_up(back)
  const zoom = Number.isFinite(value.zoom) && Number(value.zoom) > 0 ? Number(value.zoom) : undefined
  return { position, target, up, projection, ...(zoom !== undefined ? { zoom } : {}) }
}

export const camera_basis = (pose: CameraPose): { right: Vec3; up: Vec3; back: Vec3 } => {
  const normalized = normalize_camera_pose(pose)
  if (!normalized) return { right: [1, 0, 0], up: [0, 1, 0], back: [0, 0, 1] }
  const back = normalize(subtract(normalized.position, normalized.target)) ?? [0, 0, 1]
  const right = normalize(cross(normalized.up, back)) ?? [1, 0, 0]
  const up = normalize(cross(back, right)) ?? normalized.up
  return { right, up, back }
}

const rodrigues = (vector: Vec3, axis: Vec3, radians: number): Vec3 => {
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return add(
    add(scale(vector, cosine), scale(cross(axis, vector), sine)),
    scale(axis, dot(axis, vector) * (1 - cosine)),
  )
}

export const rotate_camera = (pose: CameraPose, axis: CameraAxis, degrees: number): CameraPose => {
  const normalized = normalize_camera_pose(pose)
  if (!normalized || !Number.isFinite(degrees)) return pose
  const basis = camera_basis(normalized)
  const rotationAxis = axis === 'x' ? basis.right : axis === 'y' ? normalized.up : basis.back
  const radians = degrees * Math.PI / 180
  const offset = subtract(normalized.position, normalized.target)
  const rotatedOffset = axis === 'z' ? offset : rodrigues(offset, rotationAxis, radians)
  const rotatedUp = axis === 'z' ? rodrigues(normalized.up, rotationAxis, radians) : normalized.up
  return normalize_camera_pose({
    ...normalized,
    position: add(normalized.target, rotatedOffset),
    up: rotatedUp,
  }) ?? normalized
}

export const pan_camera = (pose: CameraPose, horizontal: number, vertical: number): CameraPose => {
  const normalized = normalize_camera_pose(pose)
  if (!normalized || !Number.isFinite(horizontal) || !Number.isFinite(vertical)) return pose
  const { right, up } = camera_basis(normalized)
  const delta = add(scale(right, horizontal), scale(up, vertical))
  return { ...normalized, position: add(normalized.position, delta), target: add(normalized.target, delta) }
}

export const zoom_camera = (
  pose: CameraPose,
  percent: number,
  direction: 'in' | 'out',
): CameraPose => {
  const normalized = normalize_camera_pose(pose)
  if (!normalized || !Number.isFinite(percent) || percent <= 0) return pose
  const factor = 1 + Math.min(500, percent) / 100
  if (normalized.projection === 'orthographic') {
    if (normalized.zoom === undefined) return normalized
    const zoom = direction === 'in' ? normalized.zoom * factor : normalized.zoom / factor
    return { ...normalized, zoom: Math.min(1e6, Math.max(1e-4, zoom)) }
  }
  const offset = subtract(normalized.position, normalized.target)
  const distance = length(offset)
  if (!Number.isFinite(distance) || distance <= EPSILON) return normalized
  const nextDistance = direction === 'in' ? distance / factor : distance * factor
  return {
    ...normalized,
    position: add(normalized.target, scale(offset, Math.min(1e6, Math.max(1e-4, nextDistance)) / distance)),
  }
}
