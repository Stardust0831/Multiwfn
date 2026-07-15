import assert from 'node:assert/strict'
import test from 'node:test'
import { camera_basis, camera_update_matches, normalize_camera_pose, normalize_camera_step, pan_camera, rotate_camera, zoom_camera, type CameraDirection, type CameraPose } from '../src/camera.ts'

const pose = (projection: CameraPose['projection'] = 'perspective'): CameraPose => ({
  position: [4, 3, 8],
  target: [1, -2, 0.5],
  up: [0, 1, 0],
  projection,
  ...(projection === 'orthographic' ? { zoom: 2.5 } : {}),
})

const close_vec = (actual: number[], expected: number[], tolerance = 1e-9): void => {
  assert.equal(actual.length, expected.length)
  actual.forEach((value, idx) => assert.ok(Math.abs(value - expected[idx]) < tolerance, `${value} != ${expected[idx]}`))
}

test('normalizes camera bases and handles parallel up vectors', () => {
  const normalized = normalize_camera_pose({ ...pose(), up: [3, 5, 2] })
  assert.ok(normalized)
  const basis = camera_basis(normalized)
  assert.ok(Math.abs(Math.hypot(...basis.right) - 1) < 1e-12)
  assert.ok(Math.abs(Math.hypot(...basis.up) - 1) < 1e-12)
  assert.ok(Math.abs(Math.hypot(...basis.back) - 1) < 1e-12)
  assert.ok(Math.abs(basis.right.reduce((sum, value, idx) => sum + value * basis.up[idx], 0)) < 1e-12)
  assert.ok(normalize_camera_pose({ ...pose(), up: [3, 5, 7.5] }))
})

test('opposite semantic rotations are inverse', () => {
  for (const [positive, negative] of [
    ['up', 'down'],
    ['left', 'right'],
    ['clockwise', 'counterclockwise'],
  ] as const) {
    const initial = pose()
    const restored = rotate_camera(rotate_camera(initial, positive, 17.5), negative, 17.5)
    close_vec(restored.position, initial.position)
    close_vec(restored.target, initial.target)
    close_vec(restored.up, normalize_camera_pose(initial)?.up ?? initial.up)
  }
})

test('four repeated quarter-turns return the original pose', () => {
  for (const direction of ['up', 'left', 'clockwise'] as const) {
    let current = pose()
    for (let index = 0; index < 4; index += 1) current = rotate_camera(current, direction, 90)
    close_vec(current.position, pose().position, 1e-8)
    close_vec(current.up, normalize_camera_pose(pose())?.up ?? pose().up, 1e-8)
  }
})

test('rotations preserve target, camera distance, and orthonormal basis', () => {
  for (const direction of ['up', 'down', 'left', 'right', 'clockwise', 'counterclockwise'] as CameraDirection[]) {
    const initial = pose('orthographic')
    const rotated = rotate_camera(initial, direction, 37)
    close_vec(rotated.target, initial.target)
    assert.ok(Math.abs(Math.hypot(...rotated.position.map((value, idx) => value - rotated.target[idx])) - Math.hypot(...initial.position.map((value, idx) => value - initial.target[idx]))) < 1e-9)
    const basis = camera_basis(rotated)
    assert.ok(Math.abs(Math.hypot(...basis.right) - 1) < 1e-12)
    assert.ok(Math.abs(Math.hypot(...basis.up) - 1) < 1e-12)
    assert.ok(Math.abs(Math.hypot(...basis.back) - 1) < 1e-12)
    assert.ok(Math.abs(basis.right.reduce((sum, value, idx) => sum + value * basis.up[idx], 0)) < 1e-12)
  }
})

test('screen-following directions have the expected projection sign', () => {
  const initial: CameraPose = { position: [0, 0, 10], target: [0, 0, 0], up: [0, 1, 0], projection: 'perspective' }
  const point: [number, number, number] = [0.25, 0.15, 1]
  const screen = (camera: CameraPose): [number, number] => {
    const basis = camera_basis(camera)
    return [
      point.reduce((sum, value, idx) => sum + value * basis.right[idx], 0),
      point.reduce((sum, value, idx) => sum + value * basis.up[idx], 0),
    ]
  }
  const base = screen(initial)
  assert.ok(screen(rotate_camera(initial, 'up', 5))[1] > base[1])
  assert.ok(screen(rotate_camera(initial, 'down', 5))[1] < base[1])
  assert.ok(screen(rotate_camera(initial, 'left', 5))[0] < base[0])
  assert.ok(screen(rotate_camera(initial, 'right', 5))[0] > base[0])
})

test('roll rotates screen orientation while preserving view direction', () => {
  const initial: CameraPose = { position: [0, 0, 10], target: [0, 0, 0], up: [0, 1, 0], projection: 'orthographic', zoom: 2 }
  const rolled = rotate_camera(initial, 'clockwise', 90)
  close_vec(rolled.position, initial.position)
  close_vec(rolled.target, initial.target)
  close_vec(rolled.up, [-1, 0, 0], 1e-10)
  assert.equal(rolled.zoom, initial.zoom)
})

test('camera-relative pan preserves view direction and is reversible', () => {
  const initial = pose()
  const moved = pan_camera(initial, 0.4, -0.25)
  close_vec(moved.position.map((value, idx) => value - moved.target[idx]), initial.position.map((value, idx) => value - initial.target[idx]))
  const restored = pan_camera(moved, -0.4, 0.25)
  close_vec(restored.position, initial.position)
  close_vec(restored.target, initial.target)
})

test('perspective and orthographic zoom use reciprocal inverse steps', () => {
  const perspective = pose('perspective')
  const perspectiveRestored = zoom_camera(zoom_camera(perspective, 12, 'in'), 12, 'out')
  close_vec(perspectiveRestored.position, perspective.position)
  const orthographic = pose('orthographic')
  const orthographicRestored = zoom_camera(zoom_camera(orthographic, 12, 'in'), 12, 'out')
  assert.ok(Math.abs((orthographicRestored.zoom ?? 0) - (orthographic.zoom ?? 0)) < 1e-12)
})

test('invalid and degenerate camera inputs are rejected or left unchanged', () => {
  assert.equal(normalize_camera_pose({ ...pose(), position: [1, 1, 1], target: [1, 1, 1] }), undefined)
  assert.deepEqual(rotate_camera(pose(), 'up', Number.NaN), pose())
  assert.deepEqual(rotate_camera(pose(), 'invalid' as CameraDirection, 15), pose())
  assert.deepEqual(pan_camera(pose(), Number.POSITIVE_INFINITY, 1), pose())
  assert.deepEqual(zoom_camera(pose(), 0, 'in'), pose())
})

test('normalizes camera steps to finite per-control limits', () => {
  assert.equal(normalize_camera_step(15, 'rotation'), 15)
  assert.equal(normalize_camera_step(-1, 'rotation'), 0.1)
  assert.equal(normalize_camera_step(1000, 'rotation'), 180)
  assert.equal(normalize_camera_step(0, 'pan'), 0.001)
  assert.equal(normalize_camera_step(1000, 'pan'), 100)
  assert.equal(normalize_camera_step(0, 'zoom'), 0.1)
  assert.equal(normalize_camera_step(1000, 'zoom'), 500)
  assert.equal(normalize_camera_step('', 'rotation'), undefined)
  assert.equal(normalize_camera_step(Number.NaN, 'pan'), undefined)
  assert.equal(normalize_camera_step(Number.POSITIVE_INFINITY, 'zoom'), undefined)
})

test('camera state updates are idempotent within numerical tolerance', () => {
  const current = {
    camera_position: [1, 2, 3] as [number, number, number],
    camera_target: [0, 0, 0] as [number, number, number],
    camera_up: [0, 1, 0] as [number, number, number],
    camera_zoom: 2,
    camera_projection: 'orthographic' as const,
  }
  assert.equal(camera_update_matches(current, {
    camera_position: [1 + 5e-13, 2, 3],
    camera_target: [0, 0, 0],
    camera_up: [0, 1, 0],
    camera_zoom: 2,
  }), true)
  assert.equal(camera_update_matches(current, { ...current, camera_position: [1.01, 2, 3] }), false)
  assert.equal(camera_update_matches(current, { ...current, camera_target: [0, 0.01, 0] }), false)
  assert.equal(camera_update_matches(current, { ...current, camera_up: [0.01, 1, 0] }), false)
  assert.equal(camera_update_matches(current, { camera_zoom: undefined }), false)
})
