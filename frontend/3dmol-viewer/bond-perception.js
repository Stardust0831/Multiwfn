(function initializeBondPerception(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MultiwfnBondPerception = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const SYMBOLS = [
    '', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
    'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
    'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
    'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr',
    'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn',
    'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd',
    'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb',
    'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',
    'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th',
    'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm',
    'Md', 'No', 'Lr', 'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds',
    'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og'
  ];

  // Used only to classify the order of an already connected pair. Values were
  // recovered from the GaussView SCUtil element table in analysis.md.
  const GAUSSVIEW_ORDER_RADII = [
    0, 0.300, 1.160, 1.230, 0.890, 0.880, 0.770, 0.700, 0.660, 0.580, 0.550,
    1.400, 1.360, 1.250, 1.170, 1.050, 1.010, 0.990, 1.580, 2.030, 1.740,
    1.440, 1.320, 1.200, 1.130, 1.170, 1.160, 1.160, 1.150, 1.170, 1.250,
    1.250, 1.220, 1.210, 1.170, 1.140, 1.890, 2.250, 1.920, 1.620, 1.450,
    1.340, 1.290, 1.230, 1.240, 1.250, 1.280, 1.340, 1.410, 1.500, 1.400,
    1.410, 1.370, 1.330, 2.090, 2.350, 1.980, 1.690, 1.650, 1.650, 1.640,
    1.640, 1.660, 1.850, 1.610, 1.590, 1.590, 1.580, 1.570, 1.560, 1.700,
    1.560, 1.440, 1.340, 1.300, 1.280, 1.260, 1.260, 1.290, 1.340, 1.440,
    1.550, 1.540, 1.520, 1.530, 1.520, 1.530, 2.450, 2.020, 1.700, 1.630,
    1.460, 1.400, 1.360, 1.250, 1.570, 1.580, 1.540, 1.530, 1.840, 1.610,
    1.500, 1.490, 1.380, 1.360, 1.260, 1.200, 1.160, 1.140, 1.060, 1.280,
    1.210, 1.500, 1.500, 1.500, 1.500, 1.500, 1.500, 1.500
  ];

  // Multiwfn's covr table (define.f90), from Dalton Trans. 2008, 2832-2838.
  // This is the connectivity baseline used by Multiwfn's GUI and genconnmat.
  const MULTIWFN_CSD_RADII = [
    0, 0.31, 0.28, 1.28, 0.96, 0.84, 0.76, 0.71, 0.66, 0.57, 0.58,
    1.66, 1.41, 1.21, 1.11, 1.07, 1.05, 1.02, 1.06, 2.03, 1.76,
    1.70, 1.60, 1.53, 1.39, 1.39, 1.32, 1.26, 1.24, 1.32, 1.22,
    1.22, 1.20, 1.19, 1.20, 1.20, 1.16, 2.20, 1.95, 1.90, 1.75,
    1.64, 1.54, 1.47, 1.46, 1.42, 1.39, 1.45, 1.44, 1.42, 1.39,
    1.39, 1.38, 1.39, 1.40, 2.44, 2.15, 2.07, 2.04, 2.03, 2.01,
    1.99, 1.98, 1.98, 1.96, 1.94, 1.92, 1.92, 1.89, 1.90, 1.87,
    1.87, 1.75, 1.70, 1.62, 1.51, 1.44, 1.41, 1.36, 1.36, 1.32,
    1.45, 1.46, 1.48, 1.40, 1.50, 1.50, 2.60, 2.21, 2.15, 2.06,
    2.00, 1.96, 1.90, 1.87, 1.80, 1.69,
    1.50, 1.50, 1.50, 1.50, 1.50, 1.50, 1.50, 1.50, 1.50, 1.50,
    1.50, 1.50, 1.50, 1.50, 1.50, 1.50, 1.50, 1.50, 1.50, 1.50,
    1.50, 1.50
  ];

  const ELEMENT_TO_Z = Object.fromEntries(SYMBOLS.map((symbol, z) => [symbol.toLowerCase(), z]));
  const NOBLE_GASES = new Set([2, 10, 18, 36, 54, 86, 118]);
  const HALOGENS = new Set([9, 17, 35, 53, 85, 117]);
  const ALKALI_METALS = new Set([3, 11, 19, 37, 55, 87]);
  const ALKALINE_EARTHS = new Set([4, 12, 20, 38, 56, 88]);
  const TRANSITION_METALS = new Set([
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
    57, 72, 73, 74, 75, 76, 77, 78, 79, 80,
    104, 105, 106, 107, 108, 109, 110, 111, 112
  ]);
  const CONJUGATABLE = new Set([5, 6, 7, 8, 14, 15, 16, 32, 33, 34]);
  const LONE_PAIR_DONORS = new Set([7, 8, 15, 16, 34]);

  const DEFAULTS = Object.freeze({
    bondingScale: 1.15,
    weakScale: 1.50,
    // Ratios reproduced by the element-pair table linked from analysis.md.
    tripleScale: 0.810,
    doubleScale: 0.900,
    resonantScale: 0.940,
    planarityTolerance: 0.18,
    maxWeakBondsPerAtom: 1,
    maxCycles: 5000
  });

  function normalizeElement(value) {
    const text = String(value || '').trim().replace(/[^A-Za-z]/g, '');
    if (!text) return '';
    return `${text[0].toUpperCase()}${text.slice(1).toLowerCase()}`;
  }

  function atomicNumber(atom) {
    const direct = Number(atom?.atomicNumber ?? atom?.atomicnum ?? atom?.atomic_number);
    if (Number.isInteger(direct) && direct > 0 && direct < SYMBOLS.length) return direct;
    return ELEMENT_TO_Z[normalizeElement(atom?.elem ?? atom?.element ?? atom?.atom).toLowerCase()] || 0;
  }

  function maxBondOrder(z) {
    if (!z || NOBLE_GASES.has(z)) return 0;
    if (z === 1 || HALOGENS.has(z) || ALKALI_METALS.has(z) || ALKALINE_EARTHS.has(z)) return 1;
    if (z === 8 || z === 16 || z === 34) return 2;
    return 3;
  }

  function maxCoordination(z) {
    if (!z || NOBLE_GASES.has(z)) return 0;
    if (z === 1 || HALOGENS.has(z)) return 1;
    // Coordination number is not oxidation state: ionic/coordination structures
    // routinely place more than one ligand around group 1/2 metals.
    if (ALKALI_METALS.has(z) || ALKALINE_EARTHS.has(z)) return 8;
    if (z === 5 || z === 7) return 3;
    if (z === 6 || z === 14 || z === 32) return 4;
    if (z === 8) return 2;
    if (z === 15 || z === 33) return 5;
    if (z === 16 || z === 34) return 6;
    if (TRANSITION_METALS.has(z) || z >= 57 && z <= 71 || z >= 89 && z <= 103) return 8;
    return 6;
  }

  function maxValence(z) {
    if (!z || NOBLE_GASES.has(z)) return 0;
    if (z === 1 || HALOGENS.has(z) || ALKALI_METALS.has(z)) return 1;
    if (ALKALINE_EARTHS.has(z)) return 2;
    if (z === 5) return 3;
    if (z === 6 || z === 7 || z === 14 || z === 32) return 4;
    if (z === 8) return 2;
    if (z === 15 || z === 33) return 5;
    if (z === 16 || z === 34) return 6;
    if (TRANSITION_METALS.has(z) || z >= 57 && z <= 71 || z >= 89 && z <= 103) return 8;
    return 6;
  }

  function distance(atom1, atom2) {
    const dx = Number(atom2.x) - Number(atom1.x);
    const dy = Number(atom2.y) - Number(atom1.y);
    const dz = Number(atom2.z) - Number(atom1.z);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function classifyCandidate(ratio, z1, z2, options) {
    const cap = Math.min(maxBondOrder(z1), maxBondOrder(z2));
    if (cap <= 0) return { targetOrder: 0, kind: 'none' };
    if (ratio <= options.tripleScale && cap >= 3) {
      return { targetOrder: 3, kind: 'triple' };
    }
    if (ratio <= options.doubleScale && cap >= 2) {
      return { targetOrder: 2, kind: 'double' };
    }
    if (ratio <= options.resonantScale && cap >= 2) {
      return { targetOrder: 1, kind: 'resonant-candidate' };
    }
    return { targetOrder: 1, kind: 'single' };
  }

  function buildCandidates(atoms, options) {
    const prepared = atoms.map((atom, index) => ({
      atom,
      index,
      z: atomicNumber(atom),
      x: Number(atom.x),
      y: Number(atom.y),
      zc: Number(atom.z)
    })).filter((entry) => (
      entry.z > 0 && Number.isFinite(entry.x) && Number.isFinite(entry.y) && Number.isFinite(entry.zc)
    ));
    const sorted = [...prepared].sort((left, right) => left.x - right.x || left.index - right.index);
    const maxConnectivityRadius = prepared.reduce((maximum, entry) => (
      Math.max(maximum, MULTIWFN_CSD_RADII[entry.z] || 0)
    ), 0);
    const maxOrderRadius = prepared.reduce((maximum, entry) => (
      Math.max(maximum, GAUSSVIEW_ORDER_RADII[entry.z] || 0)
    ), 0);
    const maxDistance = Math.max(
      2 * maxConnectivityRadius * options.bondingScale,
      2 * maxOrderRadius * options.weakScale
    );
    const normal = [];
    const weak = [];

    for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
      const left = sorted[leftIndex];
      const connectivityRadius1 = MULTIWFN_CSD_RADII[left.z];
      const orderRadius1 = GAUSSVIEW_ORDER_RADII[left.z];
      if (!connectivityRadius1 || !orderRadius1 || maxBondOrder(left.z) === 0) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
        const right = sorted[rightIndex];
        if (right.x - left.x > maxDistance) break;
        const connectivityRadius2 = MULTIWFN_CSD_RADII[right.z];
        const orderRadius2 = GAUSSVIEW_ORDER_RADII[right.z];
        if (!connectivityRadius2 || !orderRadius2 || maxBondOrder(right.z) === 0) continue;
        const d = distance(left.atom, right.atom);
        if (!Number.isFinite(d) || d < 0.1) continue;
        const connectivityRatio = d / (connectivityRadius1 + connectivityRadius2);
        const ratio = d / (orderRadius1 + orderRadius2);
        const isNormal = connectivityRatio <= options.bondingScale;
        if (!isNormal && ratio > options.weakScale) continue;
        const classification = classifyCandidate(ratio, left.z, right.z, options);
        if (!classification.targetOrder) continue;
        const candidate = {
          a: Math.min(left.index, right.index),
          b: Math.max(left.index, right.index),
          distance: d,
          ratio,
          connectivityRatio,
          ...classification
        };
        if (isNormal) normal.push(candidate);
        else weak.push({ ...candidate, targetOrder: 0.5, kind: 'weak' });
      }
    }
    const sorter = (left, right) => (
      left.connectivityRatio - right.connectivityRatio || left.ratio - right.ratio || left.a - right.a || left.b - right.b
    );
    return { normal: normal.sort(sorter), weak: weak.sort(sorter) };
  }

  function chooseConnectivity(atoms, candidates) {
    const degree = new Array(atoms.length).fill(0);
    const accepted = [];
    candidates.forEach((candidate) => {
      const z1 = atomicNumber(atoms[candidate.a]);
      const z2 = atomicNumber(atoms[candidate.b]);
      if (degree[candidate.a] >= maxCoordination(z1) || degree[candidate.b] >= maxCoordination(z2)) return;
      accepted.push({ ...candidate, order: 1 });
      degree[candidate.a] += 1;
      degree[candidate.b] += 1;
    });
    return { accepted, degree };
  }

  function assignMultipleOrders(atoms, bonds, degree) {
    const valence = [...degree];
    const upgradeOrder = [...bonds].sort((left, right) => (
      right.targetOrder - left.targetOrder || left.ratio - right.ratio || left.a - right.a || left.b - right.b
    ));
    upgradeOrder.forEach((bond) => {
      let target = Math.min(
        bond.targetOrder,
        maxBondOrder(atomicNumber(atoms[bond.a])),
        maxBondOrder(atomicNumber(atoms[bond.b]))
      );
      while (bond.order < target) {
        const canRaiseA = valence[bond.a] < maxValence(atomicNumber(atoms[bond.a]));
        const canRaiseB = valence[bond.b] < maxValence(atomicNumber(atoms[bond.b]));
        if (!canRaiseA || !canRaiseB) break;
        bond.order += 1;
        valence[bond.a] += 1;
        valence[bond.b] += 1;
      }
    });
    return valence;
  }

  function edgeKey(a, b) {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  function canonicalCycle(cycle) {
    const rotations = [];
    const variants = [cycle, [...cycle].reverse()];
    variants.forEach((variant) => {
      for (let offset = 0; offset < variant.length; offset += 1) {
        rotations.push([...variant.slice(offset), ...variant.slice(0, offset)].join(':'));
      }
    });
    return rotations.sort()[0];
  }

  function findCycles(atomCount, bonds, options) {
    const adjacency = Array.from({ length: atomCount }, () => []);
    bonds.forEach((bond) => {
      adjacency[bond.a].push(bond.b);
      adjacency[bond.b].push(bond.a);
    });
    adjacency.forEach((neighbors) => neighbors.sort((a, b) => a - b));
    const found = new Map();

    function visit(start, current, path, visited) {
      if (found.size >= options.maxCycles || path.length > 6) return;
      adjacency[current].forEach((next) => {
        if (next === start && path.length >= 5) {
          const key = canonicalCycle(path);
          if (!found.has(key)) found.set(key, [...path]);
          return;
        }
        if (path.length >= 6 || next < start || visited.has(next)) return;
        visited.add(next);
        path.push(next);
        visit(start, next, path, visited);
        path.pop();
        visited.delete(next);
      });
    }

    for (let start = 0; start < atomCount && found.size < options.maxCycles; start += 1) {
      visit(start, start, [start], new Set([start]));
    }
    return [...found.values()];
  }

  function ringIsPlanar(cycle, atoms, tolerance) {
    const points = cycle.map((index) => ({
      x: Number(atoms[index].x),
      y: Number(atoms[index].y),
      z: Number(atoms[index].z)
    }));
    const origin = points[0];
    let normal = null;
    for (let i = 1; i < points.length - 1 && !normal; i += 1) {
      for (let j = i + 1; j < points.length && !normal; j += 1) {
        const u = { x: points[i].x - origin.x, y: points[i].y - origin.y, z: points[i].z - origin.z };
        const v = { x: points[j].x - origin.x, y: points[j].y - origin.y, z: points[j].z - origin.z };
        const cross = {
          x: u.y * v.z - u.z * v.y,
          y: u.z * v.x - u.x * v.z,
          z: u.x * v.y - u.y * v.x
        };
        const length = Math.hypot(cross.x, cross.y, cross.z);
        if (length > 1e-6) normal = { x: cross.x / length, y: cross.y / length, z: cross.z / length };
      }
    }
    if (!normal) return false;
    return points.every((point) => Math.abs(
      (point.x - origin.x) * normal.x +
      (point.y - origin.y) * normal.y +
      (point.z - origin.z) * normal.z
    ) <= tolerance);
  }

  function aromaticContribution(atomIndex, cycle, atoms, adjacency, edgeMap) {
    const position = cycle.indexOf(atomIndex);
    const previous = cycle[(position + cycle.length - 1) % cycle.length];
    const next = cycle[(position + 1) % cycle.length];
    const ringBonds = [edgeMap.get(edgeKey(atomIndex, previous)), edgeMap.get(edgeKey(atomIndex, next))];
    const z = atomicNumber(atoms[atomIndex]);
    if (!CONJUGATABLE.has(z)) return null;

    const hasMultiple = ringBonds.some((bond) => bond && bond.targetOrder >= 2);
    const hasResonantGeometry = ringBonds.some((bond) => bond?.kind === 'resonant-candidate');
    const exocyclicNeighbors = adjacency[atomIndex].filter((neighbor) => neighbor !== previous && neighbor !== next);
    const donorGeometry = LONE_PAIR_DONORS.has(z) && !hasMultiple && (
      z === 8 || z === 16 || z === 34 || exocyclicNeighbors.length > 0
    );
    if (donorGeometry) return 2;
    if (hasMultiple || hasResonantGeometry) return 1;
    if (z === 5) return 0;
    return null;
  }

  function assignAromaticOrders(atoms, bonds, options) {
    const edgeMap = new Map(bonds.map((bond) => [edgeKey(bond.a, bond.b), bond]));
    const adjacency = Array.from({ length: atoms.length }, () => []);
    bonds.forEach((bond) => {
      adjacency[bond.a].push(bond.b);
      adjacency[bond.b].push(bond.a);
    });
    const conjugatableBonds = bonds.filter((bond) => (
      CONJUGATABLE.has(atomicNumber(atoms[bond.a])) && CONJUGATABLE.has(atomicNumber(atoms[bond.b]))
    ));
    const cycles = findCycles(atoms.length, conjugatableBonds, options);
    let aromaticRings = 0;
    cycles.forEach((cycle) => {
      if (!ringIsPlanar(cycle, atoms, options.planarityTolerance)) return;
      const contributions = cycle.map((atomIndex) => (
        aromaticContribution(atomIndex, cycle, atoms, adjacency, edgeMap)
      ));
      if (contributions.some((value) => value === null)) return;
      const piElectrons = contributions.reduce((sum, value) => sum + value, 0);
      if (piElectrons < 2 || (piElectrons - 2) % 4 !== 0) return;
      aromaticRings += 1;
      cycle.forEach((atomIndex, position) => {
        const next = cycle[(position + 1) % cycle.length];
        const bond = edgeMap.get(edgeKey(atomIndex, next));
        if (bond && bond.order < 3) {
          bond.order = 1.5;
          bond.kind = 'aromatic';
        }
      });
    });
    return aromaticRings;
  }

  class DisjointSet {
    constructor(size) {
      this.parent = Array.from({ length: size }, (_, index) => index);
      this.rank = new Array(size).fill(0);
    }

    find(value) {
      if (this.parent[value] !== value) this.parent[value] = this.find(this.parent[value]);
      return this.parent[value];
    }

    union(left, right) {
      let rootLeft = this.find(left);
      let rootRight = this.find(right);
      if (rootLeft === rootRight) return false;
      if (this.rank[rootLeft] < this.rank[rootRight]) [rootLeft, rootRight] = [rootRight, rootLeft];
      this.parent[rootRight] = rootLeft;
      if (this.rank[rootLeft] === this.rank[rootRight]) this.rank[rootLeft] += 1;
      return true;
    }
  }

  function addWeakBonds(atomCount, normalBonds, weakCandidates, options) {
    const components = new DisjointSet(atomCount);
    normalBonds.forEach((bond) => components.union(bond.a, bond.b));
    const weakDegree = new Array(atomCount).fill(0);
    const accepted = [];
    weakCandidates.forEach((candidate) => {
      if (components.find(candidate.a) === components.find(candidate.b)) return;
      if (
        weakDegree[candidate.a] >= options.maxWeakBondsPerAtom ||
        weakDegree[candidate.b] >= options.maxWeakBondsPerAtom
      ) return;
      accepted.push({ ...candidate, order: 0.5 });
      weakDegree[candidate.a] += 1;
      weakDegree[candidate.b] += 1;
      components.union(candidate.a, candidate.b);
    });
    return accepted;
  }

  function perceiveBondOrders(atoms, suppliedOptions = {}) {
    const options = { ...DEFAULTS, ...suppliedOptions };
    const bondingScale = Number(options.bondingScale);
    const weakScale = Number(options.weakScale);
    options.bondingScale = Number.isFinite(bondingScale)
      ? Math.max(0, bondingScale)
      : DEFAULTS.bondingScale;
    options.weakScale = Math.max(
      options.bondingScale,
      Number.isFinite(weakScale) ? weakScale : DEFAULTS.weakScale
    );
    const candidates = buildCandidates(atoms, options);
    if (options.bondingScale === 0) candidates.weak = [];
    const { accepted: normalBonds, degree } = chooseConnectivity(atoms, candidates.normal);
    assignMultipleOrders(atoms, normalBonds, degree);
    const aromaticRings = assignAromaticOrders(atoms, normalBonds, options);
    const weakBonds = addWeakBonds(atoms.length, normalBonds, candidates.weak, options);
    const bonds = [...normalBonds, ...weakBonds].sort((left, right) => left.a - right.a || left.b - right.b);
    return {
      bonds,
      stats: {
        total: bonds.length,
        single: bonds.filter((bond) => bond.order === 1).length,
        double: bonds.filter((bond) => bond.order === 2).length,
        triple: bonds.filter((bond) => bond.order === 3).length,
        aromatic: bonds.filter((bond) => bond.order === 1.5).length,
        weak: bonds.filter((bond) => bond.order === 0.5).length,
        aromaticRings
      },
      options
    };
  }

  function applyBondOrders(atoms, suppliedOptions = {}) {
    const result = perceiveBondOrders(atoms, suppliedOptions);
    atoms.forEach((atom) => {
      atom.bonds = [];
      atom.bondOrder = [];
    });
    result.bonds.forEach((bond) => {
      atoms[bond.a].bonds.push(bond.b);
      atoms[bond.a].bondOrder.push(bond.order);
      atoms[bond.b].bonds.push(bond.a);
      atoms[bond.b].bondOrder.push(bond.order);
    });
    return result;
  }

  function assignOrdersToExistingTopology(atoms, suppliedOptions = {}) {
    const options = { ...DEFAULTS, ...suppliedOptions };
    const bonds = [];
    const degree = new Array(atoms.length).fill(0);
    atoms.forEach((atom, atomIndex) => {
      (atom.bonds || []).forEach((neighborValue) => {
        const neighbor = Number(neighborValue);
        if (!Number.isInteger(neighbor) || atomIndex >= neighbor || !atoms[neighbor]) return;
        const z1 = atomicNumber(atom);
        const z2 = atomicNumber(atoms[neighbor]);
        const d = distance(atom, atoms[neighbor]);
        const radiusSum = (GAUSSVIEW_ORDER_RADII[z1] || 0) + (GAUSSVIEW_ORDER_RADII[z2] || 0);
        if (!radiusSum || !Number.isFinite(d)) return;
        const ratio = d / radiusSum;
        bonds.push({
          a: atomIndex,
          b: neighbor,
          distance: d,
          ratio,
          connectivityRatio: null,
          ...classifyCandidate(ratio, z1, z2, options),
          order: 1
        });
        degree[atomIndex] += 1;
        degree[neighbor] += 1;
      });
    });
    bonds.sort((left, right) => left.ratio - right.ratio || left.a - right.a || left.b - right.b);
    assignMultipleOrders(atoms, bonds, degree);
    const aromaticRings = assignAromaticOrders(atoms, bonds, options);
    const orderByEdge = new Map(bonds.map((bond) => [edgeKey(bond.a, bond.b), bond.order]));
    atoms.forEach((atom, atomIndex) => {
      atom.bondOrder = (atom.bonds || []).map((neighbor) => (
        orderByEdge.get(edgeKey(atomIndex, Number(neighbor))) || 1
      ));
    });
    return {
      bonds,
      stats: {
        total: bonds.length,
        single: bonds.filter((bond) => bond.order === 1).length,
        double: bonds.filter((bond) => bond.order === 2).length,
        triple: bonds.filter((bond) => bond.order === 3).length,
        aromatic: bonds.filter((bond) => bond.order === 1.5).length,
        weak: 0,
        aromaticRings
      },
      options
    };
  }

  function hasExplicitBondTopology(data, format) {
    const text = String(data || '');
    const normalized = String(format || '').toLowerCase().replace(/\.gz$/, '');
    if (normalized === 'sdf' || normalized === 'mol') {
      const lines = text.split(/\r?\n/);
      const v3000Counts = lines.find((line) => /^M\s+V30\s+COUNTS\s+/i.test(line));
      if (v3000Counts) {
        const fields = v3000Counts.trim().split(/\s+/);
        const bondCount = Number.parseInt(fields[4], 10);
        return Number.isFinite(bondCount) && bondCount > 0;
      }
      const countLine = lines[3] || '';
      const bondCount = Number.parseInt(countLine.slice(3, 6), 10);
      return Number.isFinite(bondCount) && bondCount > 0;
    }
    if (normalized === 'mol2') {
      const block = text.match(/@<TRIPOS>BOND\s*([\s\S]*?)(?:@<TRIPOS>|$)/i);
      return Boolean(block && block[1].split(/\r?\n/).some((line) => /^\s*\d+\s+\d+\s+\d+\s+\S+/.test(line)));
    }
    if (normalized === 'pdb' || normalized === 'pqr') return /^CONECT\s+/m.test(text);
    if (normalized === 'cif') return /_(?:geom|chem_comp)_bond_/i.test(text);
    return false;
  }

  function normalizeExplicitOrder(value) {
    const text = String(value || '').trim().toLowerCase();
    if (text === 'ar') return 1.5;
    const order = Number(text);
    if (!Number.isFinite(order) || order <= 0) return null;
    return order === 4 ? 1.5 : order;
  }

  function explicitOrdersFromMol2(text) {
    const atomBlock = text.match(/@<TRIPOS>ATOM\s*([\s\S]*?)(?:@<TRIPOS>|$)/i);
    const bondBlock = text.match(/@<TRIPOS>BOND\s*([\s\S]*?)(?:@<TRIPOS>|$)/i);
    if (!bondBlock) return [];
    const atomIds = new Map();
    (atomBlock?.[1] || '').split(/\r?\n/).forEach((line) => {
      const fields = line.trim().split(/\s+/);
      const id = Number.parseInt(fields[0], 10);
      if (Number.isInteger(id)) atomIds.set(id, atomIds.size);
    });
    return bondBlock[1].split(/\r?\n/).flatMap((line) => {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 4) return [];
      const firstId = Number.parseInt(fields[1], 10);
      const secondId = Number.parseInt(fields[2], 10);
      const order = normalizeExplicitOrder(fields[3]);
      const a = atomIds.has(firstId) ? atomIds.get(firstId) : firstId - 1;
      const b = atomIds.has(secondId) ? atomIds.get(secondId) : secondId - 1;
      return Number.isInteger(a) && Number.isInteger(b) && order ? [{ a, b, order }] : [];
    });
  }

  function explicitOrdersFromMol(text) {
    const lines = text.split(/\r?\n/);
    const atomCount = Number.parseInt((lines[3] || '').slice(0, 3), 10);
    const bondCount = Number.parseInt((lines[3] || '').slice(3, 6), 10);
    if (!Number.isInteger(atomCount) || !Number.isInteger(bondCount)) return [];
    return lines.slice(4 + atomCount, 4 + atomCount + bondCount).flatMap((line) => {
      const a = Number.parseInt(line.slice(0, 3), 10) - 1;
      const b = Number.parseInt(line.slice(3, 6), 10) - 1;
      const order = normalizeExplicitOrder(line.slice(6, 9));
      return Number.isInteger(a) && Number.isInteger(b) && order ? [{ a, b, order }] : [];
    });
  }

  function applyExplicitBondOrders(atoms, data, format) {
    const normalized = String(format || '').toLowerCase().replace(/\.gz$/, '');
    const text = String(data || '');
    const orders = normalized === 'mol2'
      ? explicitOrdersFromMol2(text)
      : ['sdf', 'mol'].includes(normalized) ? explicitOrdersFromMol(text) : [];
    let applied = 0;
    orders.forEach(({ a, b, order }) => {
      if (!atoms[a] || !atoms[b]) return;
      const aBond = (atoms[a].bonds || []).findIndex((neighbor) => Number(neighbor) === b);
      const bBond = (atoms[b].bonds || []).findIndex((neighbor) => Number(neighbor) === a);
      if (aBond < 0 || bBond < 0) return;
      if (!Array.isArray(atoms[a].bondOrder)) atoms[a].bondOrder = [];
      if (!Array.isArray(atoms[b].bondOrder)) atoms[b].bondOrder = [];
      atoms[a].bondOrder[aBond] = order;
      atoms[b].bondOrder[bBond] = order;
      applied += 1;
    });
    return applied;
  }

  function summarizeExistingBonds(atoms) {
    const orders = [];
    atoms.forEach((atom, atomIndex) => {
      (atom.bonds || []).forEach((neighbor, bondIndex) => {
        if (atomIndex >= Number(neighbor)) return;
        orders.push(Number(atom.bondOrder?.[bondIndex]) || 1);
      });
    });
    return {
      total: orders.length,
      single: orders.filter((order) => order === 1).length,
      double: orders.filter((order) => order === 2).length,
      triple: orders.filter((order) => order === 3).length,
      aromatic: orders.filter((order) => order === 1.5 || order === 4).length,
      weak: orders.filter((order) => order === 0.5).length,
      aromaticRings: 0
    };
  }

  return Object.freeze({
    DEFAULTS,
    COVALENT_RADII: GAUSSVIEW_ORDER_RADII,
    GAUSSVIEW_ORDER_RADII,
    MULTIWFN_CSD_RADII,
    atomicNumber,
    hasExplicitBondTopology,
    applyExplicitBondOrders,
    perceiveBondOrders,
    applyBondOrders,
    assignOrdersToExistingTopology,
    summarizeExistingBonds
  });
}));
