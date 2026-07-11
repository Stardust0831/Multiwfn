const assert = require('node:assert/strict');
const test = require('node:test');

const { estimateSymmetricRange, transFlagColorHex } = require('../esp-scale.js');

function volume(size, data) {
  return { size, data: Float32Array.from(data) };
}

test('interpolates ESP where the density isosurface crosses grid edges', () => {
  const size = { x: 2, y: 1, z: 1 };
  const density = volume(size, [0, 2]);
  const esp = volume(size, [-0.2, 0.4]);
  assert.ok(Math.abs(estimateSymmetricRange(density, esp, 1) - 0.1) < 1e-7);
});

test('uses a robust percentile instead of a single surface outlier', () => {
  const size = { x: 6, y: 1, z: 1 };
  const density = volume(size, [0, 2, 0, 2, 0, 2]);
  const esp = volume(size, [-0.04, 0.04, -0.04, 0.04, -0.04, 10]);
  assert.ok(estimateSymmetricRange(density, esp, 1) < 1);
});

test('falls back for incompatible volumes or a missing crossing', () => {
  const density = volume({ x: 2, y: 1, z: 1 }, [0, 0]);
  const esp = volume({ x: 2, y: 1, z: 1 }, [1, 1]);
  assert.equal(estimateSymmetricRange(density, esp, 1), 0.05);
  assert.equal(estimateSymmetricRange(density, volume({ x: 1, y: 1, z: 1 }, [1]), 1), 0.05);
});

test('ignores a trailing parser value beyond the declared cube dimensions', () => {
  const size = { x: 2, y: 1, z: 1 };
  const density = volume(size, [0, 2, Number.NaN]);
  const esp = volume(size, [-0.2, 0.4, Number.NaN]);
  assert.ok(Math.abs(estimateSymmetricRange(density, esp, 1) - 0.1) < 1e-7);
});

test('maps negative, zero, and positive ESP to exact trans flag colors', () => {
  assert.equal(transFlagColorHex(-0.05, -0.05, 0.05), 0xf5a9b8);
  assert.equal(transFlagColorHex(0, -0.05, 0.05), 0xffffff);
  assert.equal(transFlagColorHex(0.05, -0.05, 0.05), 0x5bcefa);
});
