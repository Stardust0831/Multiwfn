'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cubeCoordinates = require('../cube-coordinates.js');

const { BOHR_TO_ANGSTROM } = cubeCoordinates;

function closeTo(actual, expected, tolerance = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

function makeCube({ angstrom = false } = {}) {
  const sign = angstrom ? -1 : 1;
  return [
    'Cube coordinate test',
    angstrom ? 'coordinates in Angstrom' : 'coordinates in Bohr',
    '    1    2.000000   -1.000000    0.500000',
    `${String(sign * 2).padStart(5)}    0.400000    0.100000    0.000000`,
    `${String(sign * 2).padStart(5)}    0.000000    0.500000    0.100000`,
    `${String(sign * 2).padStart(5)}    0.100000    0.000000    0.600000`,
    '    8    0.000000    1.250000   -0.750000    0.500000',
    '  1.000000E-01  2.000000E-01  3.000000E-01  4.000000E-01',
    '  5.000000E-01  6.000000E-01  7.000000E-01  8.000000E-01'
  ].join('\n');
}

test('normalizes positive-count cube metadata from Bohr to Angstrom', () => {
  const meta = cubeCoordinates.parseCubeMetadata(makeCube());

  assert.equal(meta.coordinateUnit, 'bohr');
  assert.equal(meta.coordinateScale, BOHR_TO_ANGSTROM);
  assert.deepEqual(meta.dims, [2, 2, 2]);
  assert.deepEqual(meta.rawOrigin, [2, -1, 0.5]);
  closeTo(meta.origin[0], 2 * BOHR_TO_ANGSTROM);
  closeTo(meta.origin[1], -BOHR_TO_ANGSTROM);
  closeTo(meta.vectors[0][0], 0.4 * BOHR_TO_ANGSTROM);
  closeTo(meta.vectors[0][1], 0.1 * BOHR_TO_ANGSTROM);
});

test('keeps negative-count cube metadata in Angstrom', () => {
  const meta = cubeCoordinates.parseCubeMetadata(makeCube({ angstrom: true }));

  assert.equal(meta.coordinateUnit, 'angstrom');
  assert.equal(meta.coordinateScale, 1);
  assert.deepEqual(meta.origin, [2, -1, 0.5]);
  assert.deepEqual(meta.vectors[2], [0.1, 0, 0.6]);
});

test('converts Angstrom translations back to the cube declared unit', () => {
  const original = cubeCoordinates.parseCubeMetadata(makeCube());
  const worldOffset = [BOHR_TO_ANGSTROM, 2 * BOHR_TO_ANGSTROM, -BOHR_TO_ANGSTROM];
  const shiftedText = cubeCoordinates.shiftCubeText(makeCube(), worldOffset);
  const shifted = cubeCoordinates.parseCubeMetadata(shiftedText);

  assert.deepEqual(shifted.rawOrigin, [3, 1, -0.5]);
  shifted.origin.forEach((value, index) => {
    closeTo(value, original.origin[index] + worldOffset[index]);
  });
});

test('keeps Angstrom translations unchanged for negative-count cubes', () => {
  const originalText = makeCube({ angstrom: true });
  const original = cubeCoordinates.parseCubeMetadata(originalText);
  const worldOffset = [1, -2, 0.25];
  const shifted = cubeCoordinates.parseCubeMetadata(
    cubeCoordinates.shiftCubeText(originalText, worldOffset)
  );

  assert.deepEqual(shifted.rawOrigin, [3, -3, 0.75]);
  shifted.origin.forEach((value, index) => {
    closeTo(value, original.origin[index] + worldOffset[index]);
  });
});

test('normalizes cube-derived atom coordinates to Angstrom', () => {
  const xyz = cubeCoordinates.cubeAtomsToXYZ(makeCube(), { 8: 'O' });
  const coordinates = xyz.trim().split(/\r?\n/)[2].split(/\s+/).slice(1).map(Number);

  closeTo(coordinates[0], 1.25 * BOHR_TO_ANGSTROM, 1e-9);
  closeTo(coordinates[1], -0.75 * BOHR_TO_ANGSTROM, 1e-9);
  closeTo(coordinates[2], 0.5 * BOHR_TO_ANGSTROM, 1e-9);
});

test('replicates an independent cube over a triclinic non-integer range', () => {
  const structurePeriodic = {
    enabled: false,
    tileCubes: false,
    cell: { a: [9, 0, 0], b: [0, 9, 0], c: [0, 0, 9] },
    ranges: { a: [0, 1], b: [0, 1], c: [0, 1] },
    repeatMode: 'range',
    cubeRepeatCap: 8
  };
  const layerPeriodic = {
    relationship: 'independent',
    enabled: true,
    tileCubes: true,
    cell: {
      a: [4, 0, 0],
      b: [1, 3.5, 0],
      c: [0.5, 0.25, 5]
    },
    ranges: {
      a: [-0.5, 1.5],
      b: [0, 1],
      c: [0, 1]
    },
    repeatMode: 'range',
    cubeRepeatCap: 8
  };

  const resolved = cubeCoordinates.resolveLayerPeriodic(layerPeriodic, structurePeriodic);
  const offsets = cubeCoordinates.periodicOffsets(resolved);

  assert.equal(structurePeriodic.enabled, false);
  assert.equal(resolved.enabled, true);
  assert.deepEqual(offsets, [[-4, 0, 0], [0, 0, 0], [4, 0, 0]]);

  const original = cubeCoordinates.parseCubeMetadata(makeCube());
  const translated = cubeCoordinates.parseCubeMetadata(
    cubeCoordinates.shiftCubeText(makeCube(), offsets[0])
  );
  translated.origin.forEach((value, index) => {
    closeTo(value, original.origin[index] + offsets[0][index], 1e-9);
  });
});
