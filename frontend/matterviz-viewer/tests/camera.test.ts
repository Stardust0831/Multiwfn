import assert from 'node:assert/strict'
import test from 'node:test'
import { camera_basis, normalize_camera_pose, normalize_camera_step, pan_camera, rotate_camera, zoom_camera, type CameraPose } from '../src/camera.ts'

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

test('positive and negative rotations are inverse for all camera-relative axes', () => {
  for (const axis of ['x', 'y', 'z'] as const) {
    const initial = pose()
    const restored = rotate_camera(rotate_camera(initial, axis, 17.5), axis, -17.5)
    close_vec(restored.position, initial.position)
    close_vec(restored.target, initial.target)
    close_vec(restored.up, normalize_camera_pose(initial)?.up ?? initial.up)
  }
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
  assert.deepEqual(rotate_camera(pose(), 'x', Number.NaN), pose())
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
