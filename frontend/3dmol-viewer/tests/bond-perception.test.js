'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const perception = require('../bond-perception.js');

function atom(elem, x, y = 0, z = 0) {
  return { elem, x, y, z };
}

function regularRing(elements, side, zAt = () => 0) {
  const radius = side / (2 * Math.sin(Math.PI / elements.length));
  return elements.map((elem, index) => {
    const angle = 2 * Math.PI * index / elements.length;
    return atom(elem, radius * Math.cos(angle), radius * Math.sin(angle), zAt(index));
  });
}

function onlyOrder(atoms) {
  const result = perception.perceiveBondOrders(atoms);
  assert.equal(result.bonds.length, 1);
  return result.bonds[0].order;
}

test('classifies representative single, double, and triple bonds', () => {
  assert.equal(onlyOrder([atom('C', 0), atom('C', 1.54)]), 1);
  assert.equal(onlyOrder([atom('C', 0), atom('C', 1.34)]), 2);
  assert.equal(onlyOrder([atom('C', 0), atom('C', 1.20)]), 3);
  assert.equal(onlyOrder([atom('N', 0), atom('N', 1.10)]), 3);
  assert.equal(onlyOrder([atom('C', 0), atom('O', 1.21)]), 2);
});

test('applies the default order thresholds without an added tolerance', () => {
  const carbonRadiusSum = 1.54;
  assert.equal(onlyOrder([atom('C', 0), atom('C', carbonRadiusSum * 0.9000)]), 2);
  assert.equal(onlyOrder([atom('C', 0), atom('C', carbonRadiusSum * 0.9002)]), 1);
});

test('caps hydrogen and halogen pairs at single order', () => {
  assert.equal(onlyOrder([atom('H', 0), atom('H', 0.50)]), 1);
  assert.equal(onlyOrder([atom('C', 0), atom('F', 0.90)]), 1);
});

test('uses valence to choose one double bond at a two-coordinate nitrogen', () => {
  const result = perception.perceiveBondOrders([
    atom('C', -1.323),
    atom('N', 0),
    atom('C', 1.325)
  ]);
  assert.equal(result.stats.double, 1);
  assert.equal(result.stats.single, 1);
});

test('uses the Multiwfn CSD connectivity criterion for Pt-N', () => {
  const result = perception.perceiveBondOrders([atom('Pt', 0), atom('N', 2.20)]);
  assert.equal(result.bonds.length, 1);
  assert.equal(result.bonds[0].order, 1);
  assert.ok(result.bonds[0].connectivityRatio < 1.15);
});

test('recognizes a planar six-membered resonant ring as aromatic', () => {
  const result = perception.perceiveBondOrders(regularRing(Array(6).fill('C'), 1.40));
  assert.equal(result.stats.aromaticRings, 1);
  assert.equal(result.stats.aromatic, 6);
  assert.ok(result.bonds.every((bond) => bond.order === 1.5));
});

test('recognizes a five-membered heteroaromatic ring with a lone-pair donor', () => {
  const result = perception.perceiveBondOrders(regularRing(['O', 'C', 'C', 'C', 'C'], 1.38));
  assert.equal(result.stats.aromaticRings, 1);
  assert.equal(result.stats.aromatic, 5);
});

test('does not label a puckered saturated ring aromatic', () => {
  const ring = regularRing(Array(6).fill('C'), 1.53, (index) => index % 2 ? 0.28 : -0.28);
  const result = perception.perceiveBondOrders(ring);
  assert.equal(result.stats.aromaticRings, 0);
  assert.equal(result.stats.aromatic, 0);
});

test('keeps weak bonds only between otherwise disconnected components', () => {
  const isolated = perception.perceiveBondOrders([atom('C', 0), atom('C', 2.0)]);
  assert.equal(isolated.stats.weak, 1);
  assert.equal(isolated.bonds[0].order, 0.5);

  const triangle = perception.perceiveBondOrders([
    atom('C', 0, 0),
    atom('C', 1, 1.174),
    atom('C', 2, 0)
  ]);
  assert.equal(triangle.stats.weak, 0);
  assert.equal(triangle.stats.single, 2);
});

test('honors a zero bonding threshold as no displayed bonds', () => {
  const result = perception.perceiveBondOrders([atom('C', 0), atom('C', 1.34)], { bondingScale: 0 });
  assert.equal(result.stats.total, 0);
});

test('writes reciprocal 3Dmol bond and bondOrder arrays', () => {
  const atoms = [atom('C', 0), atom('C', 1.34)];
  perception.applyBondOrders(atoms);
  assert.deepEqual(atoms[0].bonds, [1]);
  assert.deepEqual(atoms[1].bonds, [0]);
  assert.deepEqual(atoms[0].bondOrder, [2]);
  assert.deepEqual(atoms[1].bondOrder, [2]);
});

test('infers orders without replacing explicit topology-only bonds', () => {
  const atoms = [
    { ...atom('C', 0), bonds: [1], bondOrder: [1] },
    { ...atom('C', 1.34), bonds: [0], bondOrder: [1] }
  ];
  const result = perception.assignOrdersToExistingTopology(atoms);
  assert.equal(result.stats.double, 1);
  assert.deepEqual(atoms[0].bonds, [1]);
  assert.deepEqual(atoms[1].bonds, [0]);
  assert.deepEqual(atoms[0].bondOrder, [2]);
  assert.deepEqual(atoms[1].bondOrder, [2]);
});

test('detects explicit topology in supported structure formats', () => {
  const sdf = ['mol', 'source', '', '  2  1  0  0  0  0            999 V2000'].join('\n');
  const sdfV3000 = ['mol', 'source', '', '  0  0  0     0  0            999 V3000', 'M  V30 COUNTS 2 1 0 0 0'].join('\n');
  const mol2 = '@<TRIPOS>BOND\n     1     1     2 2\n@<TRIPOS>SUBSTRUCTURE\n';
  const pdb = 'ATOM      1  C   MOL A   1       0.000   0.000   0.000\nCONECT    1    2\n';
  assert.equal(perception.hasExplicitBondTopology(sdf, 'sdf'), true);
  assert.equal(perception.hasExplicitBondTopology(sdfV3000, 'sdf'), true);
  assert.equal(perception.hasExplicitBondTopology(mol2, 'mol2'), true);
  assert.equal(perception.hasExplicitBondTopology(pdb, 'pdb'), true);
  assert.equal(perception.hasExplicitBondTopology('2\nplain xyz\nC 0 0 0\nC 1.3 0 0\n', 'xyz'), false);
});

test('restores aromatic MOL2 orders that 3Dmol parses as single', () => {
  const atoms = [
    { bonds: [1], bondOrder: [1] },
    { bonds: [0], bondOrder: [1] }
  ];
  const mol2 = [
    '@<TRIPOS>ATOM',
    '1 C1 0 0 0 C',
    '2 C2 1 0 0 C',
    '@<TRIPOS>BOND',
    '1 1 2 ar'
  ].join('\n');
  assert.equal(perception.applyExplicitBondOrders(atoms, mol2, 'mol2'), 1);
  assert.deepEqual(atoms.map((entry) => entry.bondOrder), [[1.5], [1.5]]);
  assert.equal(perception.summarizeExistingBonds(atoms).aromatic, 1);
});
