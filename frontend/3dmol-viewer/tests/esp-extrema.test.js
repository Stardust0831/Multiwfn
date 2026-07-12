const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildInterpolatedIsosurface,
  extremaCacheKey,
  findSurfaceExtrema,
  gridPointToWorld
} = require('../esp-extrema.js');

function volume(size, data, options = {}) {
  return {
    size,
    data: Float32Array.from(data),
    origin: options.origin || { x: 0, y: 0, z: 0 },
    unit: options.unit || { x: 1, y: 1, z: 1 },
    matrixElements: options.matrixElements || null
  };
}

function oneCornerTriangleTable() {
  const table = Array.from({ length: 256 }, () => []);
  table[1] = [0, 3, 8];
  return table;
}

test('interpolates surface positions and ESP values along density crossing edges', () => {
  const size = { x: 2, y: 2, z: 2 };
  const density = volume(size, [2, 0, 0, 0, 0, 0, 0, 0]);
  const esp = volume(size, [0, 2, 4, 0, 6, 0, 0, 0]);
  const mesh = buildInterpolatedIsosurface(density, esp, 1, {
    triTable: oneCornerTriangleTable()
  });

  assert.equal(mesh.vertices.length, 3);
  assert.deepEqual(mesh.faces, [0, 1, 2]);
  const byValue = [...mesh.vertices].sort((left, right) => left.value - right.value);
  assert.deepEqual(byValue.map((point) => point.value), [1, 2, 3]);
  assert.deepEqual(byValue[0], { x: 0, y: 0, z: 0.5, value: 1, boundary: true });
  assert.deepEqual(byValue[1], { x: 0, y: 0.5, z: 0, value: 2, boundary: true });
  assert.deepEqual(byValue[2], { x: 0.5, y: 0, z: 0, value: 3, boundary: true });
});

test('uses cube matrix coordinates when present', () => {
  const point = gridPointToWorld({
    matrixElements: [
      2, 0, 0, 0,
      0, 3, 0, 0,
      0, 0, 4, 0,
      5, 6, 7, 1
    ]
  }, 1, 2, 3);
  assert.deepEqual(point, { x: 7, y: 12, z: 19 });
});

test('rejects a pseudo-minimum that has a lower second-order neighbour', () => {
  const vertices = [
    { x: 0, y: 0, z: 0, value: 0 },
    { x: 1, y: 0, z: 0, value: 1 },
    { x: 2, y: 0, z: 0, value: -1 },
    { x: 1, y: 1, z: 0, value: 2 }
  ];
  const result = findSurfaceExtrema(vertices, [0, 1, 3, 1, 2, 3]);
  assert.deepEqual(result.minima.map((point) => point.value), [-1]);
  assert.deepEqual(result.maxima.map((point) => point.value), [2]);
  assert.equal(result.minima[0].global, true);
  assert.equal(result.maxima[0].global, true);
});

test('always includes deterministic global extrema on a flat surface', () => {
  const vertices = [
    { x: 0, y: 0, z: 0, value: 1 },
    { x: 1, y: 0, z: 0, value: 1 },
    { x: 0, y: 1, z: 0, value: 1 }
  ];
  const result = findSurfaceExtrema(vertices, [0, 1, 2]);
  assert.equal(result.minima.length, 1);
  assert.equal(result.maxima.length, 1);
  assert.equal(result.minima[0].id, 'min-1');
  assert.equal(result.maxima[0].id, 'max-1');
  assert.equal(result.minima[0].global, true);
  assert.equal(result.maxima[0].global, true);
});

test('filters extrema on the outer grid shell and its surface neighbourhood', () => {
  const vertices = [
    { x: 0, y: 0, z: 0, value: -10, boundary: true },
    { x: 1, y: 0, z: 0, value: -9 },
    { x: 0, y: 1, z: 0, value: -8 },
    { x: 3, y: 0, z: 0, value: -2 },
    { x: 4, y: 0, z: 0, value: 0 },
    { x: 3, y: 1, z: 0, value: 2 }
  ];
  const result = findSurfaceExtrema(vertices, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(result.minima.map((point) => point.value), [-2]);
  assert.deepEqual(result.maxima.map((point) => point.value), [2]);
  assert.equal(result.boundaryFiltered, 3);
});

test('cache keys vary by structure session, quality, and isovalue', () => {
  const baseline = extremaCacheKey(2, 120000, 0.001);
  assert.equal(baseline, extremaCacheKey(2, 120000, 0.001));
  assert.notEqual(baseline, extremaCacheKey(3, 120000, 0.001));
  assert.notEqual(baseline, extremaCacheKey(2, 300000, 0.001));
  assert.notEqual(baseline, extremaCacheKey(2, 120000, 0.002));
});

test('rejects incompatible cube dimensions', () => {
  const density = volume({ x: 2, y: 2, z: 2 }, new Array(8).fill(0));
  const esp = volume({ x: 2, y: 2, z: 1 }, new Array(4).fill(0));
  assert.throws(() => buildInterpolatedIsosurface(density, esp, 0.001, {
    triTable: oneCornerTriangleTable()
  }), /dimensions do not match/);
});

test('rejects cube volumes with missing or incomplete data arrays', () => {
  const size = { x: 2, y: 2, z: 2 };
  const complete = volume(size, new Array(8).fill(0));
  const missing = { size };
  const incomplete = volume(size, new Array(7).fill(0));
  const options = { triTable: oneCornerTriangleTable() };

  assert.throws(
    () => buildInterpolatedIsosurface(missing, complete, 0.001, options),
    /cube data is incomplete/
  );
  assert.throws(
    () => buildInterpolatedIsosurface(complete, missing, 0.001, options),
    /cube data is incomplete/
  );
  assert.throws(
    () => buildInterpolatedIsosurface(incomplete, complete, 0.001, options),
    /cube data is incomplete/
  );
});

test('skips marching-cubes cells containing non-finite density or ESP samples', () => {
  const size = { x: 2, y: 2, z: 2 };
  const densityValues = [2, 0, 0, 0, 0, 0, 0, 0];
  const espValues = [0, 2, 4, 0, 6, 0, 0, 0];
  const options = { triTable: oneCornerTriangleTable() };
  const cases = [
    { density: [NaN, ...densityValues.slice(1)], esp: espValues },
    { density: densityValues, esp: [Infinity, ...espValues.slice(1)] },
    { density: densityValues, esp: [-Infinity, ...espValues.slice(1)] }
  ];

  cases.forEach((sample) => {
    const mesh = buildInterpolatedIsosurface(
      volume(size, sample.density),
      volume(size, sample.esp),
      1,
      options
    );
    assert.deepEqual(mesh.vertices, []);
    assert.deepEqual(mesh.faces, []);
  });
});
