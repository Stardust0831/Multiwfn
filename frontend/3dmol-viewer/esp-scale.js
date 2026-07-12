(function exposeEspScale(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MultiwfnEspScale = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const DEFAULT_LIMIT = 0.05;
  const MINIMUM_LIMIT = 0.005;
  const KCAL_PER_HARTREE = 627.509474;
  const TRANS_COLORS = Object.freeze({
    negative: '#f5a9b8',
    zero: '#ffffff',
    positive: '#5bcefa'
  });

  function hexChannels(hex) {
    const value = Number.parseInt(String(hex).replace('#', ''), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function interpolateHex(first, second, fraction) {
    const start = hexChannels(first);
    const end = hexChannels(second);
    const amount = Math.max(0, Math.min(1, Number(fraction) || 0));
    return start.reduce((value, channel, index) => (
      value * 256 + Math.round(channel + amount * (end[index] - channel))
    ), 0);
  }

  function transFlagColorHex(value, min, max) {
    const lower = Number(min);
    const upper = Number(max);
    const current = Number(value);
    if (![lower, upper, current].every(Number.isFinite) || lower === upper) return 0xffffff;
    const clipped = Math.max(Math.min(lower, upper), Math.min(Math.max(lower, upper), current));
    const midpoint = (lower + upper) / 2;
    if (clipped <= midpoint) {
      const width = midpoint - lower;
      return interpolateHex(TRANS_COLORS.negative, TRANS_COLORS.zero, width ? (clipped - lower) / width : 1);
    }
    const width = upper - midpoint;
    return interpolateHex(TRANS_COLORS.zero, TRANS_COLORS.positive, width ? (clipped - midpoint) / width : 1);
  }

  function volumeShape(volume) {
    const size = volume?.size || {};
    return [Number(size.x), Number(size.y), Number(size.z)];
  }

  function compatibleVolumes(density, esp) {
    const densityShape = volumeShape(density);
    const espShape = volumeShape(esp);
    const expected = densityShape.reduce((product, value) => product * value, 1);
    return densityShape.every((value, index) => (
      Number.isInteger(value) && value > 0 && value === espShape[index]
    )) && density?.data?.length >= expected && esp?.data?.length >= expected;
  }

  function estimateSymmetricRange(density, esp, isovalue, options = {}) {
    const fallback = Math.max(Number(options.fallback) || DEFAULT_LIMIT, MINIMUM_LIMIT);
    if (!compatibleVolumes(density, esp)) return fallback;
    const iso = Number(isovalue);
    if (!Number.isFinite(iso) || iso <= 0) return fallback;

    const [nx, ny, nz] = volumeShape(density);
    const densityData = density.data;
    const espData = esp.data;
    const samples = [];
    const index = (x, y, z) => x * ny * nz + y * nz + z;

    const sampleEdge = (firstIndex, secondIndex) => {
      const firstDensity = Number(densityData[firstIndex]);
      const secondDensity = Number(densityData[secondIndex]);
      if (!Number.isFinite(firstDensity) || !Number.isFinite(secondDensity)) return;
      const firstOffset = firstDensity - iso;
      const secondOffset = secondDensity - iso;
      if (firstOffset === secondOffset || firstOffset * secondOffset > 0) return;
      const firstEsp = Number(espData[firstIndex]);
      const secondEsp = Number(espData[secondIndex]);
      if (!Number.isFinite(firstEsp) || !Number.isFinite(secondEsp)) return;
      const fraction = Math.max(0, Math.min(1, -firstOffset / (secondOffset - firstOffset)));
      const value = firstEsp + fraction * (secondEsp - firstEsp);
      if (Number.isFinite(value)) samples.push(Math.abs(value));
    };

    for (let x = 0; x < nx; x += 1) {
      for (let y = 0; y < ny; y += 1) {
        for (let z = 0; z < nz; z += 1) {
          const current = index(x, y, z);
          if (x + 1 < nx) sampleEdge(current, index(x + 1, y, z));
          if (y + 1 < ny) sampleEdge(current, index(x, y + 1, z));
          if (z + 1 < nz) sampleEdge(current, index(x, y, z + 1));
        }
      }
    }

    if (!samples.length) return fallback;
    samples.sort((left, right) => left - right);
    const percentile = Math.max(0, Math.min(1, Number(options.percentile) || 0.95));
    const selected = samples[Math.floor(percentile * (samples.length - 1))];
    return Number.isFinite(selected) && selected > 0
      ? Math.max(selected, MINIMUM_LIMIT)
      : fallback;
  }

  function espLegendTicks(min, max, count = 5) {
    let lower = Number(min);
    let upper = Number(max);
    const tickCount = Math.max(2, Math.floor(Number(count) || 5));
    if (![lower, upper].every(Number.isFinite) || lower === upper) return [];
    if (lower > upper) [lower, upper] = [upper, lower];

    const values = Array.from({ length: tickCount }, (_, index) => {
      const fraction = index / (tickCount - 1);
      const atomicUnits = upper + fraction * (lower - upper);
      return {
        fraction,
        atomicUnits,
        kcalMolPerElectron: atomicUnits * KCAL_PER_HARTREE
      };
    });
    const largest = Math.max(...values.map((tick) => Math.abs(tick.kcalMolPerElectron)));
    const decimals = largest >= 10 ? 1 : largest >= 1 ? 2 : largest >= 0.1 ? 3 : 4;
    const zeroThreshold = 0.5 * (10 ** -decimals);

    return values.map((tick) => {
      const value = Math.abs(tick.kcalMolPerElectron) < zeroThreshold ? 0 : tick.kcalMolPerElectron;
      return {
        ...tick,
        kcalMolPerElectron: value,
        label: value === 0 ? '0' : `${value > 0 ? '+' : ''}${value.toFixed(decimals)}`
      };
    });
  }

  return Object.freeze({
    DEFAULT_LIMIT,
    MINIMUM_LIMIT,
    KCAL_PER_HARTREE,
    TRANS_COLORS,
    transFlagColorHex,
    estimateSymmetricRange,
    espLegendTicks
  });
}));
