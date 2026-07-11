(function exposeCubeCoordinates(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MultiwfnCubeCoordinates = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const BOHR_TO_ANGSTROM = 0.529177210903;

  function vectorScale(vector, scalar) {
    return vector.map((value) => value * scalar);
  }

  function vectorAdd(...vectors) {
    return vectors.reduce(
      (sum, vector) => sum.map((value, index) => value + vector[index]),
      [0, 0, 0]
    );
  }

  function parseCubeMetadata(cubeText) {
    const lines = String(cubeText).split(/\r?\n/);
    if (lines.length < 6) {
      return {
        atoms: 0,
        gridPoints: 0,
        dims: [],
        origin: [0, 0, 0],
        vectors: [],
        rawOrigin: [0, 0, 0],
        rawVectors: [],
        coordinateUnit: 'bohr',
        coordinateScale: BOHR_TO_ANGSTROM
      };
    }

    const atomParts = lines[2].trim().split(/\s+/);
    const atoms = Math.abs(parseInt(atomParts[0], 10));
    const rawOrigin = atomParts.slice(1, 4).map(Number);
    const gridParts = [3, 4, 5].map((lineIndex) => lines[lineIndex].trim().split(/\s+/));
    const signedDims = gridParts.map((parts) => parseInt(parts[0], 10));
    const dims = signedDims.map(Math.abs);
    const rawVectors = gridParts.map((parts) => parts.slice(1, 4).map(Number));
    const validDims = dims.every((value) => Number.isFinite(value) && value > 0);
    const validOrigin = rawOrigin.length === 3 && rawOrigin.every(Number.isFinite);
    const validVectors = rawVectors.every(
      (vector) => vector.length === 3 && vector.every(Number.isFinite)
    );
    const coordinateUnit = signedDims[0] < 0 ? 'angstrom' : 'bohr';
    const coordinateScale = coordinateUnit === 'bohr' ? BOHR_TO_ANGSTROM : 1;

    return {
      atoms: Number.isFinite(atoms) ? atoms : 0,
      gridPoints: validDims ? dims.reduce((acc, value) => acc * value, 1) : 0,
      dims: validDims ? dims : [],
      origin: validOrigin ? vectorScale(rawOrigin, coordinateScale) : [0, 0, 0],
      vectors: validVectors
        ? rawVectors.map((vector) => vectorScale(vector, coordinateScale))
        : [],
      rawOrigin: validOrigin ? rawOrigin : [0, 0, 0],
      rawVectors: validVectors ? rawVectors : [],
      coordinateUnit,
      coordinateScale
    };
  }

  function shiftCubeText(cubeText, offsetAngstrom) {
    const lines = String(cubeText).split(/\r?\n/);
    const meta = parseCubeMetadata(cubeText);
    if (lines.length < 6 || !Array.isArray(offsetAngstrom) || offsetAngstrom.length !== 3) {
      return cubeText;
    }
    if (offsetAngstrom.some((value) => !Number.isFinite(Number(value)))) return cubeText;

    const parts = lines[2].trim().split(/\s+/);
    if (parts.length < 4 || meta.rawOrigin.some((value) => !Number.isFinite(value))) return cubeText;
    const rawOffset = vectorScale(offsetAngstrom.map(Number), 1 / meta.coordinateScale);
    const shifted = vectorAdd(meta.rawOrigin, rawOffset);
    lines[2] = `${parts[0].padStart(5)} ${shifted.map((value) => value.toFixed(10).padStart(15)).join(' ')}`;
    return lines.join('\n');
  }

  function cubeAtomsToXYZ(cubeText, atomicSymbols = {}) {
    const lines = String(cubeText).split(/\r?\n/);
    const meta = parseCubeMetadata(cubeText);
    if (!meta.atoms || lines.length < 6 + meta.atoms) return '';

    const atoms = [];
    for (let index = 0; index < meta.atoms; index += 1) {
      const parts = lines[6 + index].trim().split(/\s+/);
      const atomicNumber = Math.abs(parseInt(parts[0], 10));
      const rawCoordinates = parts.slice(2, 5).map(Number);
      if (rawCoordinates.length !== 3 || rawCoordinates.some((value) => !Number.isFinite(value))) {
        return '';
      }
      const symbol = atomicSymbols[atomicNumber] || 'X';
      const coordinates = vectorScale(rawCoordinates, meta.coordinateScale);
      atoms.push(`${symbol} ${coordinates.map((value) => value.toFixed(10)).join(' ')}`);
    }

    return `${atoms.length}\nfrom cube (${meta.coordinateUnit})\n${atoms.join('\n')}\n`;
  }

  function rangeOffsets(range, mode) {
    const values = Array.isArray(range) && range.length === 2 ? range.map(Number) : [0, 1];
    const start = mode === 'integer' ? 0 : Math.floor(values[0]);
    const end = mode === 'integer' ? Math.max(1, Math.ceil(values[1])) : Math.ceil(values[1]);
    const offsets = [];
    for (let value = start; value < end; value += 1) offsets.push(value);
    return offsets.length ? offsets : [0];
  }

  function resolveLayerPeriodic(layerPeriodic, fallbackPeriodic) {
    if (!layerPeriodic || layerPeriodic.relationship !== 'independent') return fallbackPeriodic;
    const fallback = fallbackPeriodic || {};
    return {
      ...fallback,
      ...layerPeriodic,
      enabled: layerPeriodic.enabled !== false,
      tileCubes: layerPeriodic.tileCubes !== false,
      cell: {
        ...(fallback.cell || {}),
        ...(layerPeriodic.cell || {})
      },
      ranges: {
        ...(fallback.ranges || {}),
        ...(layerPeriodic.ranges || {})
      }
    };
  }

  function periodicOffsets(periodic) {
    if (!periodic?.enabled || !periodic.tileCubes) return [[0, 0, 0]];
    const cell = periodic.cell || {};
    const a = cell.a || [0, 0, 0];
    const b = cell.b || [0, 0, 0];
    const c = cell.c || [0, 0, 0];
    const ranges = periodic.ranges || {};
    const offsetsA = rangeOffsets(ranges.a, periodic.repeatMode);
    const offsetsB = rangeOffsets(ranges.b, periodic.repeatMode);
    const offsetsC = rangeOffsets(ranges.c, periodic.repeatMode);
    const cap = Math.max(1, Math.min(27, parseInt(periodic.cubeRepeatCap, 10) || 8));
    const offsets = [];

    offsetsA.forEach((ia) => {
      offsetsB.forEach((ib) => {
        offsetsC.forEach((ic) => {
          if (offsets.length < cap) {
            offsets.push(vectorAdd(
              vectorScale(a, ia),
              vectorScale(b, ib),
              vectorScale(c, ic)
            ));
          }
        });
      });
    });
    return offsets.length ? offsets : [[0, 0, 0]];
  }

  return {
    BOHR_TO_ANGSTROM,
    cubeAtomsToXYZ,
    parseCubeMetadata,
    periodicOffsets,
    rangeOffsets,
    resolveLayerPeriodic,
    shiftCubeText
  };
}));
