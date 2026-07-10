const startupMetrics = {
  scriptStartedAt: performance.now(),
  ready: false
};

function startupSnapshot() {
  const snapshot = { ...startupMetrics };
  if (Array.isArray(startupMetrics.resources)) {
    snapshot.resources = startupMetrics.resources.map((resource) => Object.freeze({ ...resource }));
    Object.freeze(snapshot.resources);
  }
  return Object.freeze(snapshot);
}

Object.defineProperty(window, '__multiwfnStartup', {
  configurable: false,
  get: startupSnapshot
});

function markStartup(name, details = {}) {
  startupMetrics[name] = performance.now();
  Object.assign(startupMetrics, details);
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

const sampleXYZ = `3
water
O 0.000000 0.000000 0.000000
H 0.000000 0.757000 0.586000
H 0.000000 -0.757000 0.586000
`;

function gaussian(x, y, z, cx, cy, cz, width = 1.15) {
  const dx = x - cx;
  const dy = y - cy;
  const dz = z - cz;
  return Math.exp(-(dx * dx + dy * dy + dz * dz) / width);
}

function formatCubeValue(value) {
  return value.toExponential(5).replace('e', 'E').padStart(12, ' ');
}

function makeSampleCube(title, valueAt) {
  const count = 9;
  const origin = -3.2;
  const step = 0.8;
  const lines = [
    title,
    'Generated for Multiwfn 3Dmol workbench',
    `    3 ${origin.toFixed(6).padStart(11)} ${origin.toFixed(6).padStart(11)} ${origin.toFixed(6).padStart(11)}`,
    `    ${count} ${step.toFixed(6).padStart(11)}    0.000000    0.000000`,
    `    ${count}    0.000000 ${step.toFixed(6).padStart(11)}    0.000000`,
    `    ${count}    0.000000    0.000000 ${step.toFixed(6).padStart(11)}`,
    '    8    0.000000    0.000000    0.000000    0.000000',
    '    1    0.000000    0.000000    0.757000    0.586000',
    '    1    0.000000    0.000000   -0.757000    0.586000'
  ];
  const values = [];

  for (let ix = 0; ix < count; ix += 1) {
    const x = origin + ix * step;
    for (let iy = 0; iy < count; iy += 1) {
      const y = origin + iy * step;
      for (let iz = 0; iz < count; iz += 1) {
        const z = origin + iz * step;
        values.push(formatCubeValue(valueAt(x, y, z)));
      }
    }
  }

  for (let i = 0; i < values.length; i += 6) {
    lines.push(values.slice(i, i + 6).join(' '));
  }
  return `${lines.join('\n')}\n`;
}

const sampleHomoCube = makeSampleCube('Sample HOMO cube', (x, y, z) => (
  0.095 * (
    gaussian(x, y, z, -1.15, 0.0, 0.15) -
    gaussian(x, y, z, 1.15, 0.0, 0.15)
  )
));

const sampleLumoCube = makeSampleCube('Sample LUMO cube', (x, y, z) => (
  0.085 * (
    gaussian(x, y, z, 0.0, 1.15, 0.10) -
    gaussian(x, y, z, 0.0, -1.15, 0.10)
  ) + 0.018 * z * gaussian(x, y, z, 0.0, 0.0, 0.10, 1.6)
));

const samplePeriodicXYZ = `6
synthetic periodic oxide slab
Si -1.75 -1.75 0.00
Si  1.75  1.75 0.00
O  -1.75  1.75 0.72
O   1.75 -1.75 0.72
H  -1.75  1.75 1.55
H   1.75 -1.75 1.55
`;

const periodicAtoms = [
  { atomicNumber: 14, x: -1.75, y: -1.75, z: 0.00, charge: 0.75 },
  { atomicNumber: 14, x: 1.75, y: 1.75, z: 0.00, charge: 0.75 },
  { atomicNumber: 8, x: -1.75, y: 1.75, z: 0.72, charge: -0.82 },
  { atomicNumber: 8, x: 1.75, y: -1.75, z: 0.72, charge: -0.82 },
  { atomicNumber: 1, x: -1.75, y: 1.75, z: 1.55, charge: 0.32 },
  { atomicNumber: 1, x: 1.75, y: -1.75, z: 1.55, charge: 0.32 }
];

function makePeriodicCube(title, valueAt) {
  const dims = [10, 10, 8];
  const origin = [-3.5, -3.5, -2.2];
  const vectors = [
    [0.7, 0.0, 0.0],
    [0.0, 0.7, 0.0],
    [0.0, 0.0, 0.65]
  ];
  const lines = [
    title,
    'Synthetic periodic ESP sample for Multiwfn 3Dmol workbench',
    `${String(periodicAtoms.length).padStart(5)} ${origin.map((value) => value.toFixed(6).padStart(11)).join(' ')}`,
    `${String(dims[0]).padStart(5)} ${vectors[0].map((value) => value.toFixed(6).padStart(11)).join(' ')}`,
    `${String(dims[1]).padStart(5)} ${vectors[1].map((value) => value.toFixed(6).padStart(11)).join(' ')}`,
    `${String(dims[2]).padStart(5)} ${vectors[2].map((value) => value.toFixed(6).padStart(11)).join(' ')}`,
    ...periodicAtoms.map((atom) => (
      `${String(atom.atomicNumber).padStart(5)}    0.000000 ${atom.x.toFixed(6).padStart(11)} ${atom.y.toFixed(6).padStart(11)} ${atom.z.toFixed(6).padStart(11)}`
    ))
  ];
  const values = [];

  for (let ix = 0; ix < dims[0]; ix += 1) {
    const x = origin[0] + ix * vectors[0][0];
    for (let iy = 0; iy < dims[1]; iy += 1) {
      const y = origin[1] + iy * vectors[1][1];
      for (let iz = 0; iz < dims[2]; iz += 1) {
        const z = origin[2] + iz * vectors[2][2];
        values.push(formatCubeValue(valueAt(x, y, z)));
      }
    }
  }

  for (let i = 0; i < values.length; i += 6) {
    lines.push(values.slice(i, i + 6).join(' '));
  }
  return `${lines.join('\n')}\n`;
}

function periodicDistance2(x, y, z, atom) {
  let dx = x - atom.x;
  let dy = y - atom.y;
  const dz = z - atom.z;
  dx -= Math.round(dx / 7.0) * 7.0;
  dy -= Math.round(dy / 7.0) * 7.0;
  return dx * dx + dy * dy + dz * dz;
}

const samplePeriodicDensityCube = makePeriodicCube('Synthetic slab density cube', (x, y, z) => {
  const atomDensity = periodicAtoms.reduce((sum, atom) => (
    sum + 0.038 * Math.exp(-periodicDistance2(x, y, z, atom) / 0.62)
  ), 0);
  const surfaceTail = 0.018 * Math.exp(-((z - 1.05) * (z - 1.05)) / 0.9) *
    (1 + 0.18 * Math.cos(1.8 * x) * Math.cos(1.8 * y));
  return atomDensity + surfaceTail;
});

const samplePeriodicEspCube = makePeriodicCube('Synthetic slab ESP cube', (x, y, z) => {
  const pointCharge = periodicAtoms.reduce((sum, atom) => {
    const r2 = periodicDistance2(x, y, z, atom) + 0.35;
    return sum + atom.charge / Math.sqrt(r2);
  }, 0);
  const dipoleLayer = 0.34 * Math.tanh((z - 0.65) / 1.1);
  const lateralPatch = 0.42 * Math.cos(Math.PI * x / 3.5) * Math.cos(Math.PI * y / 3.5) *
    Math.exp(-((z - 0.95) * (z - 0.95)) / 1.2);
  return 0.035 * pointCharge + dipoleLayer + lateralPatch;
});

const atomicSymbols = {
  1: 'H', 2: 'He', 3: 'Li', 4: 'Be', 5: 'B', 6: 'C', 7: 'N', 8: 'O',
  9: 'F', 10: 'Ne', 11: 'Na', 12: 'Mg', 13: 'Al', 14: 'Si', 15: 'P',
  16: 'S', 17: 'Cl', 18: 'Ar', 19: 'K', 20: 'Ca', 26: 'Fe', 29: 'Cu',
  30: 'Zn', 35: 'Br', 53: 'I'
};

const orbitalPhaseColors = {
  positive: '#f5a9b8',
  negative: '#5bcefa'
};

const roleDefaults = {
  homo: { label: 'HOMO', ...orbitalPhaseColors, isovalue: 0.015 },
  lumo: { label: 'LUMO', ...orbitalPhaseColors, isovalue: 0.015 },
  density: { label: 'Density', positive: '#7c5ac9', negative: '#7c5ac9', isovalue: 0.02 },
  elf: { label: 'ELF', positive: '#d4a21b', negative: '#d4a21b', isovalue: 0.65 },
  esp: { label: 'ESP', positive: '#2b73c8', negative: '#cf3f55', isovalue: 0.02 },
  custom: { label: 'Custom', ...orbitalPhaseColors, isovalue: 0.015 }
};

const orbitalOpacityStops = [
  0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50,
  0.55, 0.60, 0.65, 0.68, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 1
];

const backgrounds = {
  white: { css: '#ffffff', viewer: '#ffffff' },
  studio: { css: '#edf2f4', viewer: '#edf2f4' },
  paper: { css: '#f8f6ef', viewer: '#f8f6ef' },
  graphite: { css: '#20252b', viewer: '#20252b' },
  black: { css: '#000000', viewer: '#000000' }
};

const gradients = {
  rwb: { label: 'RWB', make: (min, max) => new $3Dmol.Gradient.RWB(min, max) },
  roygb: { label: 'ROYGB', make: (min, max) => new $3Dmol.Gradient.ROYGB(min, max) },
  sinebow: { label: 'Sinebow', make: (min, max) => new $3Dmol.Gradient.Sinebow(min, max) }
};

const state = {
  viewer: null,
  orientationViewer: null,
  orientationBaseView: null,
  structure: { data: '', name: '', format: 'xyz', atoms: 0, baseData: '' },
  layers: [],
  periodic: {
    enabled: false,
    showUnitCell: true,
    tileCubes: false,
    cell: {
      a: [6, 0, 0],
      b: [0, 6, 0],
      c: [0, 0, 6]
    },
    ranges: {
      a: [0, 1],
      b: [0, 1],
      c: [0, 1]
    },
    repeatMode: 'range',
    cubeRepeatCap: 8
  },
  multiwfnGui: {
    entry: 'standalone',
    guiMode: null,
    state: {}
  },
  orbitals: {
    count: 0,
    homoIndex: 0,
    items: []
  },
  gui: {
    mode: 'molecule',
    activeLayerId: '',
    labelSize: 38,
    orbitalRequestBusy: false,
    orbitalOpacity: 0.68,
    orbitalIsovalue: 0.015,
    pendingOrbitalIndex: 0,
    manifestOrbitalLoads: new Map()
  },
  orbitalShapes: new Map(),
  activePlot: null,
  selectedCubeFile: null,
  selectedPlotFile: null,
  dirtyZoom: true,
  nextLayerId: 1
};

const els = {};

function byId(id) {
  return document.getElementById(id);
}

function setStatus(text, ok = true) {
  els.status.textContent = text;
  els.status.title = text;
  els.status.dataset.state = ok ? 'ok' : 'error';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function detectFormat(fileName, fallback = 'xyz') {
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  if (ext === 'mol') return 'sdf';
  if (['xyz', 'pdb', 'sdf', 'mol2', 'pqr', 'cif'].includes(ext)) return ext;
  return fallback;
}

function roleLabel(role) {
  return (roleDefaults[role] || roleDefaults.custom).label;
}

function parseCubeMetadata(cubeText) {
  const lines = cubeText.split(/\r?\n/).filter((line) => line.trim().length);
  if (lines.length < 6) return { atoms: 0, gridPoints: 0, dims: [] };

  const atomParts = lines[2].trim().split(/\s+/);
  const atoms = Math.abs(parseInt(atomParts[0], 10));
  const origin = atomParts.slice(1, 4).map(Number);
  const dims = [3, 4, 5].map((lineIndex) => {
    const parts = lines[lineIndex].trim().split(/\s+/);
    return Math.abs(parseInt(parts[0], 10));
  });
  const vectors = [3, 4, 5].map((lineIndex) => {
    const parts = lines[lineIndex].trim().split(/\s+/);
    return parts.slice(1, 4).map(Number);
  });
  const validDims = dims.every((value) => Number.isFinite(value) && value > 0);

  return {
    atoms: Number.isFinite(atoms) ? atoms : 0,
    gridPoints: validDims ? dims.reduce((acc, value) => acc * value, 1) : 0,
    dims: validDims ? dims : [],
    origin: origin.every(Number.isFinite) ? origin : [0, 0, 0],
    vectors: vectors.every((vector) => vector.every(Number.isFinite)) ? vectors : []
  };
}

function parseCubeGrid(cubeText) {
  const lines = cubeText.split(/\r?\n/).filter((line) => line.trim().length);
  const meta = parseCubeMetadata(cubeText);
  if (!meta.dims.length) return null;

  const atomCount = Math.abs(parseInt(lines[2].trim().split(/\s+/)[0], 10));
  const values = lines.slice(6 + atomCount).join(' ').trim().split(/\s+/).map(Number);
  if (values.length < meta.gridPoints || values.some((value) => !Number.isFinite(value))) return null;

  return {
    ...meta,
    values: values.slice(0, meta.gridPoints)
  };
}

function vectorScale(vector, scalar) {
  return vector.map((value) => value * scalar);
}

function vectorAdd(...vectors) {
  return vectors.reduce((sum, vector) => sum.map((value, index) => value + vector[index]), [0, 0, 0]);
}

function parseVector(text, fallback) {
  const values = String(text).split(/[,\s]+/).filter(Boolean).map(Number);
  return values.length === 3 && values.every(Number.isFinite) ? values : fallback;
}

function parseRange(text, fallback) {
  const values = String(text).split(/[,\s]+/).filter(Boolean).map(Number);
  if (values.length !== 2 || values.some((value) => !Number.isFinite(value))) return fallback;
  return values[0] <= values[1] ? values : [values[1], values[0]];
}

function rangeOffsets(range, mode) {
  const start = mode === 'integer' ? 0 : Math.floor(range[0]);
  const end = mode === 'integer' ? Math.max(1, Math.ceil(range[1])) : Math.ceil(range[1]);
  const offsets = [];
  for (let value = start; value < end; value += 1) offsets.push(value);
  return offsets.length ? offsets : [0];
}

function getCellVectors() {
  return state.periodic.cell;
}

function syncPeriodicFromControls() {
  state.periodic.enabled = els.periodicEnabled.checked;
  state.periodic.showUnitCell = els.showUnitCell.checked;
  state.periodic.tileCubes = els.tileCubes.checked;
  state.periodic.cell = {
    a: parseVector(els.cellA.value, state.periodic.cell.a),
    b: parseVector(els.cellB.value, state.periodic.cell.b),
    c: parseVector(els.cellC.value, state.periodic.cell.c)
  };
  state.periodic.ranges = {
    a: parseRange(els.rangeA.value, state.periodic.ranges.a),
    b: parseRange(els.rangeB.value, state.periodic.ranges.b),
    c: parseRange(els.rangeC.value, state.periodic.ranges.c)
  };
  state.periodic.repeatMode = els.structureRepeatMode.value;
  state.periodic.cubeRepeatCap = clamp(parseInt(els.cubeRepeatCap.value, 10) || 8, 1, 27);
}

function parseStructureAtomCount(data, format) {
  const lines = data.split(/\r?\n/);
  if (format === 'xyz') {
    const count = parseInt(lines[0], 10);
    return Number.isFinite(count) ? count : 0;
  }
  if (format === 'pdb' || format === 'pqr') {
    return lines.filter((line) => /^(ATOM  |HETATM)/.test(line)).length;
  }
  if (format === 'mol2') {
    return lines.filter((line, index) => {
      const beforeAtomBlock = lines.slice(0, index).lastIndexOf('@<TRIPOS>ATOM') >= 0;
      const beforeNextBlock = lines.slice(0, index).lastIndexOf('@<TRIPOS>BOND') < 0;
      return beforeAtomBlock && beforeNextBlock && line.trim();
    }).length;
  }
  if (format === 'sdf') {
    const count = parseInt((lines[3] || '').slice(0, 3), 10);
    return Number.isFinite(count) ? count : 0;
  }
  return 0;
}

function xyzFromCube(cubeText) {
  const lines = cubeText.split(/\r?\n/).filter((line) => line.trim().length);
  if (lines.length < 7) return '';

  const atomCount = Math.abs(parseInt(lines[2].trim().split(/\s+/)[0], 10));
  if (!Number.isFinite(atomCount) || atomCount <= 0 || lines.length < 6 + atomCount) return '';

  const atoms = [];
  for (let i = 0; i < atomCount; i += 1) {
    const parts = lines[6 + i].trim().split(/\s+/);
    const atomicNumber = Math.abs(parseInt(parts[0], 10));
    const symbol = atomicSymbols[atomicNumber] || 'X';
    atoms.push(`${symbol} ${parts[2]} ${parts[3]} ${parts[4]}`);
  }

  return `${atoms.length}\nfrom cube\n${atoms.join('\n')}\n`;
}

function parseXYZAtoms(xyzText) {
  const lines = xyzText.split(/\r?\n/).filter((line) => line.trim().length);
  const atomCount = parseInt(lines[0], 10);
  if (!Number.isFinite(atomCount) || lines.length < atomCount + 2) return null;
  const atoms = [];
  for (let i = 0; i < atomCount; i += 1) {
    const parts = lines[i + 2].trim().split(/\s+/);
    const coords = parts.slice(1, 4).map(Number);
    if (parts.length < 4 || coords.some((value) => !Number.isFinite(value))) return null;
    atoms.push({ symbol: parts[0], coords });
  }
  return atoms;
}

function expandXYZ(xyzText) {
  if (!state.periodic.enabled) return xyzText;
  const atoms = parseXYZAtoms(xyzText);
  if (!atoms) return xyzText;

  const { a, b, c } = getCellVectors();
  const offsetsA = rangeOffsets(state.periodic.ranges.a, state.periodic.repeatMode);
  const offsetsB = rangeOffsets(state.periodic.ranges.b, state.periodic.repeatMode);
  const offsetsC = rangeOffsets(state.periodic.ranges.c, state.periodic.repeatMode);
  const expanded = [];

  offsetsA.forEach((ia) => {
    offsetsB.forEach((ib) => {
      offsetsC.forEach((ic) => {
        const offset = vectorAdd(vectorScale(a, ia), vectorScale(b, ib), vectorScale(c, ic));
        atoms.forEach((atom) => {
          expanded.push({
            symbol: atom.symbol,
            coords: vectorAdd(atom.coords, offset)
          });
        });
      });
    });
  });

  return [
    String(expanded.length),
    `expanded ${state.periodic.ranges.a.join(':')} ${state.periodic.ranges.b.join(':')} ${state.periodic.ranges.c.join(':')}`,
    ...expanded.map((atom) => `${atom.symbol} ${atom.coords.map((value) => value.toFixed(8)).join(' ')}`)
  ].join('\n');
}

function getDisplayStructureData(data, format) {
  if (!state.periodic.enabled) return { data, format };
  if (format === 'xyz') return { data: expandXYZ(data), format: 'xyz' };
  return { data, format };
}

function drawCellBox() {
  if (!state.periodic.enabled || !state.periodic.showUnitCell || typeof state.viewer.addLine !== 'function') return;

  const { a, b, c } = getCellVectors();
  const corners = [
    [0, 0, 0],
    a,
    b,
    c,
    vectorAdd(a, b),
    vectorAdd(a, c),
    vectorAdd(b, c),
    vectorAdd(a, b, c)
  ];
  const edges = [
    [0, 1], [0, 2], [0, 3],
    [1, 4], [1, 5],
    [2, 4], [2, 6],
    [3, 5], [3, 6],
    [4, 7], [5, 7], [6, 7]
  ];
  edges.forEach(([start, end]) => {
    state.viewer.addLine({
      start: { x: corners[start][0], y: corners[start][1], z: corners[start][2] },
      end: { x: corners[end][0], y: corners[end][1], z: corners[end][2] },
      color: '#31424d',
      linewidth: 1.5
    });
  });
}

function shiftCubeText(cubeText, offset) {
  const lines = cubeText.split(/\r?\n/);
  if (lines.length < 6) return cubeText;
  const parts = lines[2].trim().split(/\s+/);
  if (parts.length < 4) return cubeText;
  const atomCount = parts[0];
  const origin = parts.slice(1, 4).map(Number);
  if (origin.some((value) => !Number.isFinite(value))) return cubeText;
  const shifted = vectorAdd(origin, offset);
  lines[2] = `${atomCount.padStart(5)} ${shifted.map((value) => value.toFixed(6).padStart(11)).join(' ')}`;
  return lines.join('\n');
}

function cubeOffsets() {
  if (!state.periodic.enabled || !state.periodic.tileCubes) return [[0, 0, 0]];

  const { a, b, c } = getCellVectors();
  const offsets = [];
  const offsetsA = rangeOffsets(state.periodic.ranges.a, state.periodic.repeatMode);
  const offsetsB = rangeOffsets(state.periodic.ranges.b, state.periodic.repeatMode);
  const offsetsC = rangeOffsets(state.periodic.ranges.c, state.periodic.repeatMode);
  offsetsA.forEach((ia) => {
    offsetsB.forEach((ib) => {
      offsetsC.forEach((ic) => {
        if (offsets.length < state.periodic.cubeRepeatCap) {
          offsets.push(vectorAdd(vectorScale(a, ia), vectorScale(b, ib), vectorScale(c, ic)));
        }
      });
    });
  });
  return offsets.length ? offsets : [[0, 0, 0]];
}

function makeGradient(name, min, max) {
  const fallback = gradients.rwb;
  const selected = gradients[name] || fallback;
  try {
    return selected.make(min, max);
  } catch (error) {
    return fallback.make(min, max);
  }
}

function layerById(layerId) {
  return state.layers.find((layer) => String(layer.id) === String(layerId));
}

function isOrbitalLayer(layer) {
  if (!layer) return false;
  return ['orbital', 'homo', 'lumo'].includes(layer.role) || Number(layer.orbitalIndex) > 0;
}

function registerOrbitalShape(layer, shape) {
  if (!isOrbitalLayer(layer) || !shape) return shape;
  const layerId = String(layer.id);
  const shapes = state.orbitalShapes.get(layerId) || [];
  shapes.push(shape);
  state.orbitalShapes.set(layerId, shapes);
  return shape;
}

function modelStyle() {
  const atomScale = toNumber(els.atomScale.value, 0.24);
  const bondRadius = toNumber(els.bondRadius.value, 0.14);
  const colorscheme = 'Jmol';

  if (els.modelStyle.value === 'sphere') {
    return { sphere: { scale: atomScale * 1.85, colorscheme } };
  }
  if (els.modelStyle.value === 'line') {
    return { line: { linewidth: 2, colorscheme } };
  }
  if (els.modelStyle.value === 'cartoon') {
    return {
      cartoon: { color: 'spectrum' },
      stick: { radius: bondRadius * 0.72, colorscheme }
    };
  }
  if (els.modelStyle.value === 'ballstick') {
    return {
      stick: { radius: bondRadius, colorscheme },
      sphere: { scale: atomScale, colorscheme }
    };
  }
  return { stick: { radius: bondRadius * 1.18, colorscheme } };
}

function applySceneStyle() {
  const bg = backgrounds[els.background.value] || backgrounds.white;
  els.viewerWrap.style.backgroundColor = bg.css;
  state.viewer.setBackgroundColor(bg.viewer);
  if (els.orientationWidget) els.orientationWidget.style.backgroundColor = bg.css;
  if (state.orientationViewer) state.orientationViewer.setBackgroundColor(bg.viewer);

  if (typeof state.viewer.setViewStyle === 'function') {
    const outline = els.outline.checked
      ? {
          style: 'outline',
          width: toNumber(els.outlineWidth.value, 0.035),
          color: els.background.value === 'black' ? '#f4f6f8' : '#111820'
        }
      : {};
    state.viewer.setViewStyle(outline);
  }

  if (typeof state.viewer.setAmbientOcclusion === 'function') {
    state.viewer.setAmbientOcclusion({
      enabled: els.ambientOcclusion.checked,
      strength: toNumber(els.aoStrength.value, 0.72),
      radius: 6
    });
  }

  state.viewer.spin(els.spin.checked);
}

function addStructureToViewer() {
  let data = state.structure.data;
  let format = state.structure.format;
  if (!data && state.layers.length) {
    data = xyzFromCube(state.layers[0].data);
    format = 'xyz';
  }
  if (!data || !els.showStructure.checked) return null;

  try {
    const display = getDisplayStructureData(data, format);
    const model = state.viewer.addModel(display.data, display.format);
    state.viewer.setStyle({}, modelStyle());
    if (els.showLabels.checked) addAtomLabels(model);
    return model;
  } catch (error) {
    setStatus('Structure error', false);
    return null;
  }
}

function addAtomLabels(model) {
  if (!model || typeof model.selectedAtoms !== 'function') return;
  try {
    model.selectedAtoms({}).slice(0, 500).forEach((atom, index) => {
      const label = `${atom.elem || atom.atom || 'X'}${index + 1}`;
      state.viewer.addLabel(label, {
        position: { x: atom.x, y: atom.y, z: atom.z },
        fontSize: clamp(Math.round(state.gui.labelSize / 3), 8, 24),
        fontColor: '#111820',
        backgroundColor: 'rgba(255,255,255,0.78)',
        backgroundOpacity: 0.72,
        borderThickness: 0.4,
        borderColor: '#d8e0e6'
      });
    });
  } catch (error) {
    setStatus('Label skipped', false);
  }
}

function initializeOrientationViewer() {
  if (state.orientationViewer || !els.orientationWidget) return;
  const background = backgrounds[els.background.value] || backgrounds.white;
  state.orientationViewer = $3Dmol.createViewer(els.orientationWidget, {
    backgroundColor: background.viewer,
    antialias: true,
    orthographic: true
  });
  if (!state.orientationViewer || typeof state.orientationViewer.addArrow !== 'function') return;
  const axes = [
    ['X', '#e23d4f', { x: 1.35, y: 0, z: 0 }],
    ['Y', '#2b9a66', { x: 0, y: 1.35, z: 0 }],
    ['Z', '#3a72dc', { x: 0, y: 0, z: 1.35 }]
  ];

  axes.forEach(([label, color, end]) => {
    state.orientationViewer.addArrow({
      start: { x: 0, y: 0, z: 0 },
      end,
      radius: 0.045,
      radiusRadio: 1.8,
      mid: 0.78,
      color
    });
    state.orientationViewer.addLabel(label, {
      position: end,
      fontColor: color,
      backgroundOpacity: 0,
      fontSize: 14,
      inFront: true
    });
  });
  if (typeof state.orientationViewer.setProjection === 'function') {
    state.orientationViewer.setProjection('orthographic');
  }
  state.orientationViewer.zoomTo();
  const view = state.orientationViewer.getView();
  state.orientationBaseView = [...view.slice(0, 3), 144];
  state.orientationViewer.setView([...state.orientationBaseView, 0, 0, 0, 1]);
  state.orientationViewer.render();
}

function syncOrientationView() {
  if (
    !state.viewer ||
    !state.orientationViewer ||
    els.orientationWidget.hidden ||
    typeof state.viewer.getView !== 'function' ||
    typeof state.orientationViewer.setView !== 'function'
  ) return;
  const mainView = state.viewer.getView();
  if (!Array.isArray(mainView) || mainView.length < 8) return;
  const baseView = state.orientationBaseView || state.orientationViewer.getView().slice(0, 4);
  state.orientationViewer.setView([...baseView, ...mainView.slice(4, 8)]);
  state.orientationViewer.render();
}

function syncAxesControls() {
  const visible = Boolean(els.showAxes?.checked);
  if (els.guiShowAxis) els.guiShowAxis.checked = visible;
  if (els.guiStyleAxes) els.guiStyleAxes.setAttribute('aria-checked', String(visible));
}

function updateOrientationVisibility() {
  if (!els.orientationWidget) return;
  const plotVisible = els.plotPanel && !els.plotPanel.classList.contains('is-hidden');
  els.orientationWidget.hidden = !els.showAxes.checked || plotVisible;
  syncAxesControls();
  if (!els.orientationWidget.hidden && state.orientationViewer) {
    state.orientationViewer.resize();
    syncOrientationView();
  }
}

function setAxesVisible(visible, options = {}) {
  els.showAxes.checked = Boolean(visible);
  updateOrientationVisibility();
  if (options.announce) setStatus(els.showAxes.checked ? 'Axes shown' : 'Axes hidden');
}

function addCubeLayer(layer) {
  const isovalue = Math.abs(toNumber(layer.isovalue, roleDefaults.custom.isovalue));
  const orbitalLayer = isOrbitalLayer(layer);
  const opacity = orbitalLayer
    ? clamp(toNumber(state.gui.orbitalOpacity, 0.68), 0.05, 1)
    : clamp(toNumber(layer.opacity, 0.68), 0.05, 1);
  if (orbitalLayer) layer.opacity = opacity;
  const smoothness = parseInt(els.surfaceQuality.value, 10) || 8;
  const colorLayer = layer.colorMode === 'cube' ? layerById(layer.colorLayerId) : null;
  const colorMin = toNumber(layer.colorMin, -0.05);
  const colorMax = toNumber(layer.colorMax, 0.05);
  const surfaceStyle = layer.surfaceStyle || 'transparent';

  cubeOffsets().forEach((offset) => {
    let volume;
    let colorVolume = null;
    try {
      volume = new $3Dmol.VolumeData(shiftCubeText(layer.data, offset), 'cube');
      if (colorLayer) colorVolume = new $3Dmol.VolumeData(shiftCubeText(colorLayer.data, offset), 'cube');
    } catch (error) {
      setStatus(`${layer.name}: cube error`, false);
      return;
    }

    const common = {
      opacity,
      smoothness,
      clickable: false
    };
    if (colorVolume) {
      common.voldata = colorVolume;
      common.volscheme = makeGradient(layer.gradient, colorMin, colorMax);
    }

    const addSurface = (signedIsovalue, solidColor) => {
      const baseSpec = {
        ...common,
        isoval: signedIsovalue,
        color: colorVolume ? undefined : solidColor
      };
      const addIsosurface = (spec) => {
        if (!startupMetrics.ready) {
          startupMetrics.initialIsosurfaceCalls = (startupMetrics.initialIsosurfaceCalls || 0) + 1;
        }
        return registerOrbitalShape(layer, state.viewer.addIsosurface(volume, spec));
      };
      if (surfaceStyle === 'mesh' || surfaceStyle === 'points') {
        addIsosurface({
          ...baseSpec,
          opacity: orbitalLayer ? opacity : Math.max(opacity, 0.72),
          wireframe: true
        });
        return;
      }
      if (surfaceStyle === 'solidmesh') {
        addIsosurface({ ...baseSpec, opacity: orbitalLayer ? opacity : Math.max(opacity, 0.62) });
        addIsosurface({ ...baseSpec, opacity: orbitalLayer ? opacity : 0.92, wireframe: true });
        return;
      }
      if (surfaceStyle === 'solid') {
        addIsosurface({ ...baseSpec, opacity: orbitalLayer ? opacity : 1 });
        return;
      }
      addIsosurface(baseSpec);
    };

    if (layer.mode === 'signed' || layer.mode === 'positive') {
      addSurface(isovalue, layer.positiveColor);
    }
    if (layer.mode === 'signed' || layer.mode === 'negative') {
      addSurface(-isovalue, layer.negativeColor);
    }
  });
}

function renderScene(zoom = false) {
  if (!state.viewer) return;
  if (!startupMetrics.ready) startupMetrics.initialSceneRenders = (startupMetrics.initialSceneRenders || 0) + 1;

  state.orbitalShapes.clear();
  state.viewer.clear();
  applySceneStyle();
  addStructureToViewer();
  state.layers.filter((layer) => layer.visible).forEach(addCubeLayer);
  drawCellBox();

  if (zoom || state.dirtyZoom) {
    state.viewer.zoomTo();
    state.dirtyZoom = false;
  }
  state.viewer.render();
  syncOrientationView();
  updateLabels();
  updateStats();
  syncMultiwfnGuiControls();
}

function updateLabels() {
  const structureText = state.structure.name
    ? `${state.structure.name} · ${state.structure.format.toUpperCase()}`
    : state.layers.length ? 'Structure from first cube' : 'No structure';
  const visibleLayers = state.layers.filter((layer) => layer.visible);
  const cubeText = state.layers.length
    ? `${visibleLayers.length}/${state.layers.length} visible cube layers`
    : 'No cube layers';
  els.modelLabel.textContent = structureText;
  els.cubeLabel.textContent = cubeText;
}

function updateStats() {
  const cubeAtoms = state.layers[0]?.stats?.atoms || 0;
  const atoms = state.structure.atoms || cubeAtoms || 0;
  const gridPoints = state.layers.reduce((sum, layer) => sum + (layer.stats.gridPoints || 0), 0);

  els.statStructure.textContent = state.structure.name || (state.layers.length ? 'From cube' : 'None');
  els.statAtoms.textContent = String(atoms);
  els.statCubes.textContent = String(state.layers.length);
  els.statGrid.textContent = gridPoints ? gridPoints.toLocaleString() : '0';
}

function renderLayerList() {
  els.layerList.replaceChildren();
  if (!state.layers.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No cube layers loaded.';
    els.layerList.append(empty);
    updateLayerSelectors();
    return;
  }

  state.layers.forEach((layer) => {
    const colorLayerOptions = [
      '<option value="">None</option>',
      ...state.layers
        .filter((item) => item.id !== layer.id)
        .map((item) => `<option value="${item.id}" ${String(item.id) === String(layer.colorLayerId) ? 'selected' : ''}>${escapeHtml(item.name)}</option>`)
    ].join('');
    const row = document.createElement('article');
    row.className = 'layer-row';
    row.dataset.layerId = layer.id;
    row.innerHTML = `
      <div class="layer-title">
        <label class="inline-check">
          <input type="checkbox" data-action="visible" ${layer.visible ? 'checked' : ''}>
          <span>${escapeHtml(layer.name)}</span>
        </label>
        <button type="button" data-action="remove" aria-label="Remove ${escapeHtml(layer.name)}">Remove</button>
      </div>
      <div class="layer-fields">
        <label>
          <span>Role</span>
          <select data-action="role">
            ${Object.keys(roleDefaults).map((role) => `<option value="${role}" ${role === layer.role ? 'selected' : ''}>${roleLabel(role)}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>Mode</span>
          <select data-action="mode">
            <option value="signed" ${layer.mode === 'signed' ? 'selected' : ''}>Signed</option>
            <option value="positive" ${layer.mode === 'positive' ? 'selected' : ''}>Positive</option>
            <option value="negative" ${layer.mode === 'negative' ? 'selected' : ''}>Negative</option>
          </select>
        </label>
        <label>
          <span>Isovalue</span>
          <input data-action="isovalue" type="number" min="0.000001" step="0.005" value="${layer.isovalue}">
        </label>
        <label>
          <span>Opacity</span>
          <input data-action="opacity" type="range" min="0.05" max="1" step="0.05" value="${layer.opacity}">
        </label>
        <label>
          <span>Coloring</span>
          <select data-action="colorMode">
            <option value="solid" ${layer.colorMode === 'solid' ? 'selected' : ''}>Solid phase</option>
            <option value="cube" ${layer.colorMode === 'cube' ? 'selected' : ''}>By cube</option>
          </select>
        </label>
        <label>
          <span>Color cube</span>
          <select data-action="colorLayerId">
            ${colorLayerOptions}
          </select>
        </label>
        <label>
          <span>Gradient</span>
          <select data-action="gradient">
            ${Object.entries(gradients).map(([value, gradient]) => `<option value="${value}" ${value === layer.gradient ? 'selected' : ''}>${gradient.label}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>Color min</span>
          <input data-action="colorMin" type="number" step="0.001" value="${layer.colorMin}">
        </label>
        <label>
          <span>Color max</span>
          <input data-action="colorMax" type="number" step="0.001" value="${layer.colorMax}">
        </label>
        <label>
          <span>+</span>
          <input data-action="positiveColor" type="color" value="${layer.positiveColor}">
        </label>
        <label>
          <span>-</span>
          <input data-action="negativeColor" type="color" value="${layer.negativeColor}">
        </label>
      </div>
    `;
    els.layerList.append(row);
  });
  updateLayerSelectors();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function updateLayerSelectors() {
  if (!els.sliceLayer) return;
  const current = els.sliceLayer.value;
  els.sliceLayer.replaceChildren();
  state.layers.forEach((layer) => {
    const option = document.createElement('option');
    option.value = String(layer.id);
    option.textContent = layer.name;
    els.sliceLayer.append(option);
  });
  if ([...els.sliceLayer.options].some((option) => option.value === current)) {
    els.sliceLayer.value = current;
  }
  updateMultiwfnGuiLayerSelectors();
}

function appendLayerOption(select, layer, index, selectedId) {
  const option = document.createElement('option');
  option.value = String(layer.id);
  option.textContent = `${String(index + 1).padStart(5, ' ')}  ${layer.name}`;
  option.selected = String(layer.id) === String(selectedId);
  select.append(option);
}

function orbitalLabel(orbital) {
  const index = Number(orbital.index) || 0;
  const rel = state.orbitals.homoIndex ? index - state.orbitals.homoIndex : 0;
  let tag = '';
  if (state.orbitals.homoIndex) {
    if (rel === 0) tag = ' HOMO';
    else if (rel === 1) tag = ' LUMO';
    else if (rel < 0 && rel >= -10) tag = ` H${rel}`;
    else if (rel > 1 && rel <= 11) tag = ` L+${rel - 1}`;
  }
  const occ = Number.isFinite(Number(orbital.occupation)) ? ` occ=${Number(orbital.occupation).toFixed(3)}` : '';
  const ene = Number.isFinite(Number(orbital.energy)) ? ` ene=${Number(orbital.energy).toFixed(5)}` : '';
  return `${String(index).padStart(5, ' ')}${tag}${occ}${ene}`;
}

function orbitalIndexLabel(orbital) {
  const index = Number(orbital.index) || 0;
  return String(index).padStart(5, ' ');
}

function orbitalShortTag(orbital) {
  const index = Number(orbital.index) || 0;
  const rel = state.orbitals.homoIndex ? index - state.orbitals.homoIndex : 0;
  if (!state.orbitals.homoIndex) return '';
  if (rel === 0) return 'HOMO';
  if (rel === 1) return 'LUMO';
  if (rel < 0 && rel >= -10) return `H${rel}`;
  if (rel > 1 && rel <= 11) return `L+${rel - 1}`;
  return '';
}

function orbitalButtonLabel(orbital, layer = null) {
  const tag = orbitalShortTag(orbital);
  return `${orbitalIndexLabel(orbital)}${tag ? `  ${tag}` : ''}${layer ? ' *' : ''}`;
}

function layerForOrbital(index) {
  return state.layers.find((layer) => Number(layer.orbitalIndex) === Number(index));
}

function ensureOrbitalItemsFromCount() {
  if (state.orbitals.items.length || !state.orbitals.count) return;
  state.orbitals.items = Array.from({ length: state.orbitals.count }, (_, index) => ({
    index: index + 1
  }));
}

function refreshOrbitalControls() {
  ensureOrbitalItemsFromCount();
  updateMultiwfnGuiLayerSelectors();
  renderGuiOrbitalList();
}

function currentOrbitalIsovalue() {
  const value = Math.abs(toNumber(
    els.guiOrbitalIsovalueNumber?.value || els.guiOrbitalIsovalue?.value,
    state.gui.orbitalIsovalue
  ));
  return clamp(value, 0, 0.3);
}

function syncOrbitalIsovalueControls(value, options = {}) {
  const next = clamp(Math.abs(toNumber(value, state.gui.orbitalIsovalue)), 0, 0.3);
  state.gui.orbitalIsovalue = next;
  const text = next.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') || '0';
  if (els.guiOrbitalIsovalue && els.guiOrbitalIsovalue.value !== text) {
    els.guiOrbitalIsovalue.value = text;
  }
  if (els.guiOrbitalIsovalueNumber && els.guiOrbitalIsovalueNumber.value !== text) {
    els.guiOrbitalIsovalueNumber.value = text;
  }
  if (options.layer) {
    options.layer.isovalue = next;
    if (els.guiIsosurfaceValue) els.guiIsosurfaceValue.value = text;
  }
}

function clearGuiOrbitalSelection() {
  state.gui.activeLayerId = '';
  state.gui.pendingOrbitalIndex = 0;
  state.layers.forEach((layer) => { layer.visible = false; });
  if (els.guiOrbitalSelect) els.guiOrbitalSelect.value = '0';
  if (els.guiOrbitalInput) els.guiOrbitalInput.value = '0';
  if (els.guiOrbitalStatus) els.guiOrbitalStatus.textContent = 'No orbital selected';
  syncOrbitalIsovalueControls(state.gui.orbitalIsovalue);
  renderLayerList();
  renderScene(false);
}

function setOrbitalStatus(text, ok = true) {
  if (!els.guiOrbitalStatus) return;
  els.guiOrbitalStatus.textContent = text;
  els.guiOrbitalStatus.dataset.state = ok ? 'ok' : 'error';
}

function renderGuiOrbitalList() {
  if (!els.guiOrbitalList) return;
  ensureOrbitalItemsFromCount();
  els.guiOrbitalList.replaceChildren();

  const activeLayer = activeGuiLayer();
  const activeOrbital = Number(activeLayer?.orbitalIndex || state.gui.pendingOrbitalIndex || 0);
  const makeRow = (label, value, selected, title = label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'orbital-row';
    button.dataset.value = value;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(Boolean(selected)));
    button.textContent = label;
    button.title = title;
    button.addEventListener('click', () => setActiveGuiLayer(value, { orbitalSelection: true }));
    els.guiOrbitalList.append(button);
  };

  makeRow('    0  None', '0', !activeOrbital);
  state.orbitals.items.forEach((orbital) => {
    const layer = layerForOrbital(orbital.index);
    const index = Number(orbital.index) || 0;
    makeRow(
      orbitalButtonLabel(orbital, layer),
      `orbital:${index}`,
      activeOrbital === index,
      orbitalLabel(orbital)
    );
  });
}

function updateMultiwfnGuiLayerSelectors() {
  if (!els.guiOrbitalSelect) return;
  ensureOrbitalItemsFromCount();
  const selectedId = state.layers.some((layer) => String(layer.id) === String(state.gui.activeLayerId))
    ? String(state.gui.activeLayerId)
    : '';
  if (selectedId) state.gui.activeLayerId = selectedId;

  [
    els.guiOrbitalSelect,
    els.guiIsosurfaceLayer,
    els.guiSliceLayer
  ].forEach((select) => {
    if (!select) return;
    select.replaceChildren();
    if (select === els.guiOrbitalSelect) {
      const none = document.createElement('option');
      none.value = '0';
      none.textContent = '    0  None';
      select.append(none);
      if (state.orbitals.items.length) {
        state.orbitals.items.forEach((orbital) => {
          const option = document.createElement('option');
          const layer = layerForOrbital(orbital.index);
          option.value = `orbital:${orbital.index}`;
          option.textContent = orbitalButtonLabel(orbital, layer);
          option.title = orbitalLabel(orbital);
          select.append(option);
        });
        const activeLayer = activeGuiLayer();
        select.value = activeLayer?.orbitalIndex ? `orbital:${activeLayer.orbitalIndex}` : '0';
        return;
      }
    }
    state.layers.forEach((layer, index) => appendLayerOption(select, layer, index, selectedId));
    select.value = selectedId || (select === els.guiOrbitalSelect ? '0' : '');
  });

  if (els.guiColoringLayer) {
    const current = els.guiColoringLayer.value;
    els.guiColoringLayer.replaceChildren();
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'None';
    els.guiColoringLayer.append(none);
    state.layers.forEach((layer, index) => appendLayerOption(els.guiColoringLayer, layer, index, current));
    els.guiColoringLayer.value = [...els.guiColoringLayer.options].some((option) => option.value === current)
      ? current
      : '';
  }

  renderGuiOrbitalList();
  syncMultiwfnGuiControls();
}

function activeGuiLayer() {
  return state.gui.activeLayerId ? layerById(state.gui.activeLayerId) || null : null;
}

function currentGuiQuality() {
  return Math.max(1, parseInt(els.guiMenuQuality?.value || '120000', 10) || 120000);
}

function formatGridQuality(quality) {
  return `${Math.round(Math.max(1, Number(quality) || 1) / 1000)}k`;
}

function orbitalOpacityPercent(opacity = state.gui.orbitalOpacity) {
  return Math.round(clamp(toNumber(opacity, 0.68), 0.05, 1) * 100);
}

function orbitalOpacityStopIndex(opacity = state.gui.orbitalOpacity) {
  const target = clamp(toNumber(opacity, 0.68), 0.05, 1);
  return orbitalOpacityStops.reduce((bestIndex, stop, index) => (
    Math.abs(stop - target) < Math.abs(orbitalOpacityStops[bestIndex] - target) ? index : bestIndex
  ), 0);
}

function syncOrbitalOpacityControls() {
  const opacity = clamp(toNumber(state.gui.orbitalOpacity, 0.68), 0.05, 1);
  const percent = orbitalOpacityPercent(opacity);
  if (els.guiOrbitalOpacity) {
    els.guiOrbitalOpacity.value = String(orbitalOpacityStopIndex(opacity));
    els.guiOrbitalOpacity.setAttribute('aria-valuetext', `${percent}%`);
  }
  if (els.guiOrbitalOpacityValue) els.guiOrbitalOpacityValue.textContent = `${percent}%`;

  const activeLayer = activeGuiLayer();
  if (isOrbitalLayer(activeLayer) && els.guiIsosurfaceOpacity) {
    els.guiIsosurfaceOpacity.step = '0.01';
    els.guiIsosurfaceOpacity.value = String(opacity);
  } else if (els.guiIsosurfaceOpacity) {
    els.guiIsosurfaceOpacity.step = '0.05';
  }
  document.querySelectorAll('.layer-row').forEach((row) => {
    const layer = layerById(row.dataset.layerId);
    if (!isOrbitalLayer(layer)) return;
    const control = row.querySelector('[data-action="opacity"]');
    if (control) {
      control.step = '0.01';
      control.value = String(opacity);
    }
  });
}

function updateOrbitalShapeOpacity(opacity) {
  if (!state.viewer) return;
  const shapes = [...state.orbitalShapes.values()].flat();
  let needsRebuild = false;
  shapes.forEach((shape) => {
    if (needsRebuild) return;
    if (!shape || typeof shape.updateStyle !== 'function') {
      needsRebuild = true;
      return;
    }
    try {
      shape.updateStyle({ opacity });
    } catch (error) {
      console.error(error);
      needsRebuild = true;
    }
  });
  if (needsRebuild) renderScene(false);
  else state.viewer.render();
}

function setGlobalOrbitalOpacity(value, options = {}) {
  const opacity = clamp(toNumber(value, state.gui.orbitalOpacity), 0.05, 1);
  state.gui.orbitalOpacity = opacity;
  state.layers.filter(isOrbitalLayer).forEach((layer) => { layer.opacity = opacity; });
  syncOrbitalOpacityControls();
  if (options.updateShapes !== false) updateOrbitalShapeOpacity(opacity);
  if (options.announce) setStatus(`Orbital opacity: ${orbitalOpacityPercent(opacity)}%`);
}

function syncBackgroundStyleControls() {
  const background = els.background?.value || 'white';
  if (els.guiBackgroundWhite) els.guiBackgroundWhite.setAttribute('aria-checked', String(background === 'white'));
  if (els.guiBackgroundBlack) els.guiBackgroundBlack.setAttribute('aria-checked', String(background === 'black'));
}

function setViewerBackground(value, options = {}) {
  const background = backgrounds[value] ? value : 'white';
  els.background.value = background;
  syncBackgroundStyleControls();
  if (state.viewer) {
    applySceneStyle();
    state.viewer.render();
    if (state.orientationViewer) state.orientationViewer.render();
  }
  if (options.announce) setStatus(`Background: ${background[0].toUpperCase()}${background.slice(1)}`);
}

function styleSubmenuEntries() {
  return [
    {
      name: 'transparency',
      trigger: els.guiStyleTransparency,
      menu: els.guiTransparencyMenu,
      focusTarget: els.guiOrbitalOpacity
    },
    {
      name: 'background',
      trigger: els.guiStyleBackground,
      menu: els.guiBackgroundMenu,
      focusTarget: els.background.value === 'black' ? els.guiBackgroundBlack : els.guiBackgroundWhite
    }
  ];
}

function positionStyleSubmenu(trigger, menu) {
  if (!trigger || !menu || menu.hidden) return;
  const margin = 8;
  const gap = 2;
  const triggerRect = trigger.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const maxLeft = Math.max(margin, window.innerWidth - menuRect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - menuRect.height - margin);
  const right = triggerRect.right + gap;
  const left = triggerRect.left - menuRect.width - gap;
  const menuLeft = right + menuRect.width <= window.innerWidth - margin
    ? right
    : left >= margin ? left : clamp(right, margin, maxLeft);
  menu.style.left = `${Math.round(menuLeft)}px`;
  menu.style.top = `${Math.round(clamp(triggerRect.top, margin, maxTop))}px`;
}

function closeStyleSubmenus(options = {}) {
  const active = styleSubmenuEntries().find((entry) => entry.menu && !entry.menu.hidden);
  styleSubmenuEntries().forEach((entry) => {
    if (entry.menu) entry.menu.hidden = true;
    if (entry.trigger) entry.trigger.setAttribute('aria-expanded', 'false');
  });
  if (options.focus && active?.trigger) active.trigger.focus();
}

function setStyleSubmenuOpen(name, open, options = {}) {
  const entry = styleSubmenuEntries().find((item) => item.name === name);
  if (!entry) return;
  closeStyleSubmenus();
  if (!open) return;
  entry.menu.hidden = false;
  entry.trigger.setAttribute('aria-expanded', 'true');
  positionStyleSubmenu(entry.trigger, entry.menu);
  if (options.focus && entry.focusTarget) requestAnimationFrame(() => entry.focusTarget.focus());
}

function repositionOpenStyleSubmenu() {
  const active = styleSubmenuEntries().find((entry) => entry.menu && !entry.menu.hidden);
  if (active) positionStyleSubmenu(active.trigger, active.menu);
}

function setStyleMenuOpen(open, options = {}) {
  const isOpen = Boolean(open);
  closeStyleSubmenus();
  els.guiIsosur1Menu.hidden = !isOpen;
  els.guiMenuIsosur1.setAttribute('aria-expanded', String(isOpen));
  if (isOpen && options.focus) {
    requestAnimationFrame(() => els.guiStyleTransparency.focus());
  }
}

function setGuiOrbitalRequestBusy(busy) {
  state.gui.orbitalRequestBusy = Boolean(busy);
  [
    els.guiOrbitalSelect,
    els.guiOrbitalInput,
    els.guiOrbitalIsovalue,
    els.guiOrbitalIsovalueNumber,
    els.guiOrbPrev,
    els.guiOrbNext,
    els.guiMenuQuality
  ].forEach((control) => {
    if (control) control.disabled = state.gui.orbitalRequestBusy;
  });
}

async function requestGuiOrbital(index, options = {}) {
  if (state.gui.orbitalRequestBusy) return;
  const orbitalIndex = Number(index) || 0;
  els.guiOrbitalInput.value = String(orbitalIndex);
  if (orbitalIndex <= 0) {
    clearGuiOrbitalSelection();
    return;
  }

  if (!options.forceRecompute) {
    const existing = layerForOrbital(orbitalIndex);
    if (existing) {
      state.gui.pendingOrbitalIndex = 0;
      setActiveGuiLayer(String(existing.id), { orbitalSelection: true });
      setOrbitalStatus(`Orbital ${orbitalIndex} loaded`);
      setStatus(`Orbital ${orbitalIndex} loaded`);
      renderGuiOrbitalList();
      return;
    }

    const manifestSpec = state.gui.manifestOrbitalLoads.get(orbitalIndex);
    if (manifestSpec) {
      state.gui.pendingOrbitalIndex = orbitalIndex;
      setGuiOrbitalRequestBusy(true);
      setOrbitalStatus(`Loading pre-generated orbital ${orbitalIndex}...`);
      setStatus(`Loading pre-generated orbital ${orbitalIndex}...`);
      renderGuiOrbitalList();
      try {
        const layer = await ensureManifestLayerLoaded(manifestSpec);
        state.gui.pendingOrbitalIndex = 0;
        setActiveGuiLayer(String(layer.id), { orbitalSelection: true });
        setOrbitalStatus(`Orbital ${orbitalIndex} loaded`);
        setStatus(`Orbital ${orbitalIndex} loaded`);
      } catch (error) {
        console.error(error);
        setOrbitalStatus(`Orbital ${orbitalIndex} could not be loaded`, false);
        setStatus(`Orbital ${orbitalIndex} could not be loaded`, false);
      } finally {
        setGuiOrbitalRequestBusy(false);
        renderGuiOrbitalList();
      }
      return;
    }
  }

  state.gui.pendingOrbitalIndex = orbitalIndex;
  setOrbitalStatus(`Calculating orbital ${orbitalIndex}...`);
  renderGuiOrbitalList();

  const isovalue = currentOrbitalIsovalue();
  syncOrbitalIsovalueControls(isovalue);
  const quality = currentGuiQuality();
  const params = new URLSearchParams({
    index: String(orbitalIndex),
    quality: String(quality),
    isovalue: String(isovalue)
  });
  const apiUrl = new URL(`/api/orbital?${params.toString()}`, window.location.href).toString();
  setGuiOrbitalRequestBusy(true);
  setStatus(`Calculating orbital ${orbitalIndex} at ${formatGridQuality(quality)}...`);
  try {
    const response = await fetch(apiUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Orbital API returned HTTP ${response.status}`);
    }
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error('Orbital API returned invalid JSON');
    }
    if (!payload.ok) {
      setStatus(payload.message || 'Orbital calculation failed', false);
      setOrbitalStatus(payload.message || 'Orbital calculation failed', false);
      return;
    }
    if (payload.clear) {
      setActiveGuiLayer('0', { orbitalSelection: true });
      return;
    }
    const layerSpec = payload.layer;
    if (!layerSpec || (!layerSpec.path && !layerSpec.url && !layerSpec.data)) {
      throw new Error('Orbital API response did not include a cube layer');
    }
    const cubeText = await loadTextFromManifestEntry(layerSpec, new URL('/session/', window.location.href).toString());
    upsertOrbitalLayer(cubeText, {
      ...layerSpec,
      name: layerSpec.name || `Orbital ${orbitalIndex}`,
      orbitalIndex,
      isovalue: payload.isovalue || isovalue
    });
    state.gui.pendingOrbitalIndex = 0;
    setOrbitalStatus(`Orbital ${orbitalIndex} loaded`);
    setStatus(`Orbital ${orbitalIndex} loaded at ${formatGridQuality(payload.quality || quality)}`);
  } catch (error) {
    console.error(error);
    const message = error?.message || 'Orbital API unavailable';
    setStatus(message, false);
    setOrbitalStatus(message, false);
  } finally {
    setGuiOrbitalRequestBusy(false);
    renderGuiOrbitalList();
  }
}

window.multiwfnGui = {
  requestOrbital(index, options = {}) {
    if (Number.isFinite(Number(options.isovalue)) && Number(options.isovalue) > 0) {
      setOrbitalIsovalue(options.isovalue);
    }
    return requestGuiOrbital(index);
  },
  setActiveLayer(id) {
    return setActiveGuiLayer(String(id), { orbitalSelection: true });
  }
};

function initializeMultiwfnOrbitalSelection() {
  const isDrawMolGui = String(state.multiwfnGui?.entry || '').toLowerCase().includes('drawmol');
  ensureOrbitalItemsFromCount();
  if (!isDrawMolGui || !state.layers.length) return;

  const homoLayer = state.orbitals.homoIndex ? layerForOrbital(state.orbitals.homoIndex) : null;
  const firstOrbitalLayer = state.layers.find((layer) => layer.role === 'orbital') || state.layers[0];
  const selectedLayer = homoLayer || firstOrbitalLayer;
  state.gui.activeLayerId = selectedLayer ? String(selectedLayer.id) : '';
  state.layers.forEach((layer) => {
    layer.visible = selectedLayer ? String(layer.id) === String(selectedLayer.id) : false;
  });
}

function setStructureData(text, name = 'structure.xyz', format = 'xyz') {
  const normalizedFormat = format === 'auto' ? detectFormat(name) : format;
  state.structure = {
    data: text,
    name,
    format: normalizedFormat,
    atoms: parseStructureAtomCount(text, normalizedFormat),
    baseData: text
  };
  state.dirtyZoom = true;
}

function loadStructure(text, name = 'structure.xyz', format = 'xyz') {
  setStructureData(text, name, format);
  setStatus('Structure loaded');
  renderScene(true);
}

function clearStructure() {
  state.structure = { data: '', name: '', format: 'xyz', atoms: 0, baseData: '' };
  state.dirtyZoom = true;
  setStatus('Structure cleared');
  renderScene(true);
}

function layerFromCube(text, options = {}) {
  const role = options.role || els.cubeRole.value || 'custom';
  const defaults = roleDefaults[role] || roleDefaults.custom;
  const orbitalIndex = Number.isFinite(Number(options.orbitalIndex)) ? Number(options.orbitalIndex) : 0;
  const opacity = isOrbitalLayer({ role, orbitalIndex })
    ? state.gui.orbitalOpacity
    : toNumber(options.opacity, toNumber(els.surfaceOpacity.value, 0.68));
  return {
    id: state.nextLayerId,
    name: options.name || `${roleLabel(role)}.cube`,
    role,
    orbitalIndex,
    data: text,
    visible: options.visible !== false,
    mode: options.mode || els.surfaceMode.value || 'signed',
    isovalue: toNumber(options.isovalue, toNumber(els.isoValue.value, defaults.isovalue)),
    opacity: clamp(toNumber(opacity, 0.68), 0.05, 1),
    positiveColor: options.positiveColor || options.color || els.positiveColor.value || defaults.positive,
    negativeColor: options.negativeColor || els.negativeColor.value || defaults.negative,
    colorMode: options.colorMode || 'solid',
    colorLayerId: options.colorLayerId || '',
    gradient: options.gradient || 'rwb',
    surfaceStyle: options.surfaceStyle || 'transparent',
    colorMin: toNumber(options.colorMin, -0.05),
    colorMax: toNumber(options.colorMax, 0.05),
    stats: parseCubeMetadata(text)
  };
}

function appendLayer(text, options = {}, assignedId = null) {
  const layer = layerFromCube(text, options);
  if (assignedId !== null) layer.id = assignedId;
  state.nextLayerId = Math.max(state.nextLayerId, Number(layer.id) + 1);
  state.layers.push(layer);
  state.layers.sort((left, right) => Number(left.id) - Number(right.id));
  state.dirtyZoom = true;
  return layer;
}

function addLayer(text, options = {}) {
  const layer = appendLayer(text, options);
  renderLayerList();
  updateLayerSelectors();
  setStatus('Cube loaded');
  renderScene(true);
}

function upsertOrbitalLayer(text, options = {}) {
  const orbitalIndex = Number(options.orbitalIndex || 0);
  const existing = orbitalIndex ? layerForOrbital(orbitalIndex) : null;
  const layer = layerFromCube(text, { ...options, role: 'orbital', visible: true });
  if (existing) {
    const id = existing.id;
    Object.assign(existing, layer, { id });
    state.gui.activeLayerId = String(id);
  } else {
    layer.id = state.nextLayerId;
    state.nextLayerId += 1;
    state.layers.push(layer);
    state.gui.activeLayerId = String(layer.id);
  }
  const activeId = state.gui.activeLayerId;
  const keepSecond = els.guiShowSecond?.checked;
  state.layers.forEach((item) => {
    if (String(item.id) === String(activeId)) item.visible = true;
    else if (!keepSecond) item.visible = false;
  });
  renderLayerList();
  updateLayerSelectors();
  renderScene(false);
}

function clearCubes() {
  state.layers = [];
  state.dirtyZoom = true;
  renderLayerList();
  updateLayerSelectors();
  setStatus('Cubes cleared');
  renderScene(true);
}

function readFile(file, callback) {
  const reader = new FileReader();
  reader.onload = () => callback(String(reader.result || ''), file.name);
  reader.onerror = () => setStatus('Read error', false);
  reader.readAsText(file);
}

function downloadBlob(name, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadTextFromManifestEntry(entry, baseUrl) {
  if (entry.data) return entry.data;
  if (!entry.path && !entry.url) throw new Error('Manifest entry has no data or path');
  const rawPath = entry.url || entry.path;
  const url = baseUrl ? new URL(rawPath, baseUrl).toString() : rawPath;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.text();
}

function manifestLayerOptions(entry, visible = entry.visible !== false) {
  const role = entry.role || entry.kind || 'custom';
  return {
    ...entry,
    role,
    visible,
    name: entry.name || entry.path || entry.url || `${roleLabel(role)}.cube`
  };
}

function registerManifestLayerSpecs(entries, baseUrl) {
  const firstId = state.nextLayerId;
  const specs = entries.map((entry, index) => ({
    entry,
    baseUrl,
    id: firstId + index,
    index,
    visible: entry.visible !== false,
    dataPromise: null,
    promise: null,
    layer: null
  }));
  state.nextLayerId += specs.length;
  state.gui.manifestOrbitalLoads.clear();
  specs.forEach((spec) => {
    const orbitalIndex = Number(spec.entry.orbitalIndex || 0);
    if (orbitalIndex > 0 && !state.gui.manifestOrbitalLoads.has(orbitalIndex)) {
      state.gui.manifestOrbitalLoads.set(orbitalIndex, spec);
    }
  });
  return specs;
}

function startManifestLayerFetch(spec) {
  if (!spec.dataPromise) spec.dataPromise = loadTextFromManifestEntry(spec.entry, spec.baseUrl);
  return spec.dataPromise;
}

async function ensureManifestLayerLoaded(spec, visible = undefined) {
  if (visible !== undefined) spec.visible = Boolean(visible);
  if (spec.layer) {
    if (visible !== undefined) spec.layer.visible = spec.visible;
    return spec.layer;
  }
  if (!spec.promise) {
    spec.promise = startManifestLayerFetch(spec)
      .then((cubeData) => {
        spec.layer = appendLayer(cubeData, manifestLayerOptions(spec.entry, spec.visible), spec.id);
        return spec.layer;
      })
      .catch((error) => {
        spec.promise = null;
        throw error;
      });
  }
  return spec.promise;
}

function initialManifestLayerSpec(specs) {
  const homoIndex = Number(state.orbitals.homoIndex || 0);
  return specs.find((spec) => Number(spec.entry.orbitalIndex || 0) === homoIndex)
    || specs.find((spec) => (spec.entry.role || spec.entry.kind) === 'orbital')
    || specs[0]
    || null;
}

async function setManifestStructure(structureEntry, baseUrl) {
  if (!structureEntry) return false;
  const structureData = await loadTextFromManifestEntry(structureEntry, baseUrl);
  const name = structureEntry.name || structureEntry.path || structureEntry.url || 'structure';
  setStructureData(structureData, name, structureEntry.format || detectFormat(name));
  return true;
}

function finishStartup() {
  const resources = performance.getEntriesByType('resource')
    .filter((entry) => /3Dmol|plotly|app\.js|manifest|\.cube/.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      duration: entry.duration,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize
    }));
  markStartup('readyAt', { ready: true, resources });
}

async function preloadManifestLayers(specs) {
  const results = await Promise.allSettled(specs.map((spec) => ensureManifestLayerLoaded(spec, false)));
  results.forEach((result) => {
    if (result.status === 'rejected') console.error(result.reason);
  });
  renderLayerList();
  updateLayerSelectors();
  updateLabels();
  updateStats();
  markStartup('backgroundLayersReadyAt', {
    backgroundLayerCount: results.filter((result) => result.status === 'fulfilled').length
  });
}

async function loadDrawMolManifest(structureEntry, specs, baseUrl) {
  const activeSpec = initialManifestLayerSpec(specs);
  const activeDataPromise = activeSpec ? startManifestLayerFetch(activeSpec) : null;

  setStatus('Loading structure...');
  if (await setManifestStructure(structureEntry, baseUrl)) {
    refreshOrbitalControls();
    renderScene(true);
    markStartup('structureRenderedAt');
    await nextPaint();
  }

  if (activeSpec) {
    setStatus(`Loading orbital ${activeSpec.entry.orbitalIndex || activeSpec.index + 1}...`);
    await activeDataPromise;
    const activeLayer = await ensureManifestLayerLoaded(activeSpec, true);
    state.gui.activeLayerId = String(activeLayer.id);
    state.layers.forEach((layer) => { layer.visible = layer.id === activeLayer.id; });
    renderLayerList();
    updateLayerSelectors();
    renderScene(true);
    markStartup('activeOrbitalRenderedAt', { activeOrbitalIndex: Number(activeLayer.orbitalIndex || 0) });
  } else if (!structureEntry) {
    renderScene(true);
    markStartup('structureRenderedAt');
  }

  setStatus('Manifest loaded');
  finishStartup();
  const backgroundSpecs = specs.filter((spec) => spec !== activeSpec);
  if (backgroundSpecs.length) void preloadManifestLayers(backgroundSpecs);
  else markStartup('backgroundLayersReadyAt', { backgroundLayerCount: 0 });
}

async function loadBatchManifest(structureEntry, specs, baseUrl) {
  await setManifestStructure(structureEntry, baseUrl);
  for (const spec of specs) await ensureManifestLayerLoaded(spec);
  initializeMultiwfnOrbitalSelection();
  renderLayerList();
  updateLayerSelectors();
  renderScene(true);
  markStartup('structureRenderedAt');
  if (state.layers.some(isOrbitalLayer)) markStartup('activeOrbitalRenderedAt');
  markStartup('backgroundLayersReadyAt', { backgroundLayerCount: specs.length });
  setStatus('Manifest loaded');
  finishStartup();
}

async function loadManifestObject(manifest, baseUrl = '') {
  if (manifest.multiwfnGui) {
    state.multiwfnGui = {
      entry: manifest.multiwfnGui.entry || 'standalone',
      guiMode: manifest.multiwfnGui.guiMode ?? null,
      state: manifest.multiwfnGui.state || {},
      allowSetStyle: manifest.multiwfnGui.allowSetStyle
    };
    applyMultiwfnGuiMode(state.multiwfnGui);
  }

  if (manifest.orbitals) {
    state.orbitals = {
      count: Number(manifest.orbitals.count || 0),
      homoIndex: Number(manifest.orbitals.homoIndex || 0),
      items: Array.isArray(manifest.orbitals.items) ? manifest.orbitals.items : []
    };
  } else if (manifest.multiwfnGui?.state?.orbitalCount) {
    state.orbitals = {
      count: Number(manifest.multiwfnGui.state.orbitalCount || 0),
      homoIndex: Number(manifest.multiwfnGui.state.homoIndex || 0),
      items: []
    };
  }
  refreshOrbitalControls();

  if (manifest.periodic) {
    state.periodic = {
      ...state.periodic,
      ...manifest.periodic,
      cell: {
        ...state.periodic.cell,
        ...(manifest.periodic.cell || {})
      },
      ranges: {
        ...state.periodic.ranges,
        ...(manifest.periodic.ranges || {})
      }
    };
    els.periodicEnabled.checked = Boolean(state.periodic.enabled);
    els.showUnitCell.checked = state.periodic.showUnitCell !== false;
    els.tileCubes.checked = Boolean(state.periodic.tileCubes);
    els.cellA.value = state.periodic.cell.a.join(', ');
    els.cellB.value = state.periodic.cell.b.join(', ');
    els.cellC.value = state.periodic.cell.c.join(', ');
    els.rangeA.value = state.periodic.ranges.a.join(', ');
    els.rangeB.value = state.periodic.ranges.b.join(', ');
    els.rangeC.value = state.periodic.ranges.c.join(', ');
    els.structureRepeatMode.value = state.periodic.repeatMode || 'range';
    els.cubeRepeatCap.value = state.periodic.cubeRepeatCap || 8;
  }

  const structureEntry = manifest.structure;
  const layerEntries = manifest.cubes || manifest.layers || [];
  if (manifest.replaceLayers !== false) {
    state.layers = [];
    state.nextLayerId = 1;
  }
  const specs = registerManifestLayerSpecs(layerEntries, baseUrl);
  const drawMolGui = String(state.multiwfnGui.entry || '').toLowerCase().includes('drawmol')
    && manifest.replaceLayers !== false;
  if (drawMolGui) await loadDrawMolManifest(structureEntry, specs, baseUrl);
  else await loadBatchManifest(structureEntry, specs, baseUrl);
}

async function loadManifestText(text, baseUrl = '') {
  try {
    await loadManifestObject(JSON.parse(text), baseUrl);
  } catch (error) {
    console.error(error);
    setStatus('Manifest error', false);
  }
}

function saveManifest() {
  const manifest = {
    format: 'multiwfn-3dmol-workbench',
    version: 1,
    multiwfnGui: state.multiwfnGui,
    structure: state.structure.name
      ? {
          name: state.structure.name,
          format: state.structure.format,
          atoms: state.structure.atoms
        }
      : null,
    layers: state.layers.map((layer) => ({
      name: layer.name,
      role: layer.role,
      mode: layer.mode,
      isovalue: layer.isovalue,
      opacity: layer.opacity,
      positiveColor: layer.positiveColor,
      negativeColor: layer.negativeColor,
      colorMode: layer.colorMode,
      colorLayerId: layer.colorLayerId,
      gradient: layer.gradient,
      surfaceStyle: layer.surfaceStyle,
      colorMin: layer.colorMin,
      colorMax: layer.colorMax,
      visible: layer.visible,
      gridPoints: layer.stats.gridPoints
    })),
    periodic: state.periodic,
    display: {
      structure: els.showStructure.checked,
      labels: els.showLabels.checked,
      axes: els.showAxes.checked,
      ambientOcclusion: els.ambientOcclusion.checked,
      outline: els.outline.checked,
      background: els.background.value,
      smoothing: els.surfaceQuality.value
    }
  };
  downloadBlob('multiwfn-3dmol-manifest.json', 'application/json', `${JSON.stringify(manifest, null, 2)}\n`);
}

function savePng() {
  try {
    const dataUri = typeof state.viewer.pngURI === 'function'
      ? state.viewer.pngURI()
      : els.viewer.querySelector('canvas').toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUri;
    link.download = 'multiwfn-3dmol-view.png';
    document.body.append(link);
    link.click();
    link.remove();
    setStatus('PNG saved');
  } catch (error) {
    console.error(error);
    setStatus('PNG error', false);
  }
}

function showPlotPanel(show = true) {
  els.plotPanel.classList.toggle('is-hidden', !show);
  updateOrientationVisibility();
}

function plotLayout(title) {
  return {
    title: { text: title, font: { size: 14 } },
    margin: { l: 52, r: 22, t: 46, b: 46 },
    paper_bgcolor: 'rgba(255,255,255,0)',
    plot_bgcolor: 'rgba(255,255,255,0.88)',
    font: { family: 'system-ui, -apple-system, Segoe UI, sans-serif', size: 12, color: '#162127' }
  };
}

let plotlyLoadPromise = null;

function ensurePlotly() {
  if (window.Plotly) return Promise.resolve(window.Plotly);
  if (plotlyLoadPromise) return plotlyLoadPromise;
  setStatus('Loading 2D renderer...');
  markStartup('plotlyLoadStartedAt');
  plotlyLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/plotly-3.0.1.min.js';
    script.async = true;
    script.addEventListener('load', () => {
      if (!window.Plotly) {
        script.remove();
        plotlyLoadPromise = null;
        reject(new Error('Plotly loaded without exposing its API'));
        return;
      }
      markStartup('plotlyLoadedAt');
      resolve(window.Plotly);
    }, { once: true });
    script.addEventListener('error', () => {
      script.remove();
      plotlyLoadPromise = null;
      reject(new Error('Plotly could not be loaded'));
    }, { once: true });
    document.head.append(script);
  });
  return plotlyLoadPromise;
}

async function drawHeatmap(title, matrix, colorscale, zmin = null, zmax = null) {
  try {
    const plotly = await ensurePlotly();
    showPlotPanel(true);
    const trace = {
      type: 'heatmap',
      z: matrix,
      colorscale,
      colorbar: { thickness: 14 }
    };
    if (Number.isFinite(zmin)) trace.zmin = zmin;
    if (Number.isFinite(zmax)) trace.zmax = zmax;
    await plotly.react(els.plotView, [trace], plotLayout(title), { responsive: true, displaylogo: false });
    return true;
  } catch (error) {
    console.error(error);
    setStatus('2D renderer failed; try again', false);
    return false;
  }
}

async function drawCurve(title, x, y) {
  try {
    const plotly = await ensurePlotly();
    showPlotPanel(true);
    await plotly.react(els.plotView, [{
      type: 'scatter',
      mode: 'lines',
      x,
      y,
      line: { color: '#14796f', width: 2.5 }
    }], plotLayout(title), { responsive: true, displaylogo: false });
    return true;
  } catch (error) {
    console.error(error);
    setStatus('2D renderer failed; try again', false);
    return false;
  }
}

function cubeSliceMatrix(grid, axis, fraction) {
  const [nx, ny, nz] = grid.dims;
  const position = clamp(fraction, 0, 1);
  const index = (ix, iy, iz) => grid.values[ix * ny * nz + iy * nz + iz];
  const matrix = [];

  if (axis === 'z') {
    const iz = Math.round(position * (nz - 1));
    for (let iy = 0; iy < ny; iy += 1) {
      const row = [];
      for (let ix = 0; ix < nx; ix += 1) row.push(index(ix, iy, iz));
      matrix.push(row);
    }
    return { matrix, label: `XY slice z=${iz}/${nz - 1}` };
  }
  if (axis === 'y') {
    const iy = Math.round(position * (ny - 1));
    for (let iz = 0; iz < nz; iz += 1) {
      const row = [];
      for (let ix = 0; ix < nx; ix += 1) row.push(index(ix, iy, iz));
      matrix.push(row);
    }
    return { matrix, label: `XZ slice y=${iy}/${ny - 1}` };
  }

  const ix = Math.round(position * (nx - 1));
  for (let iz = 0; iz < nz; iz += 1) {
    const row = [];
    for (let iy = 0; iy < ny; iy += 1) row.push(index(ix, iy, iz));
    matrix.push(row);
  }
  return { matrix, label: `YZ slice x=${ix}/${nx - 1}` };
}

async function drawSelectedSlice() {
  const layer = layerById(els.sliceLayer.value) || state.layers[0];
  if (!layer) {
    setStatus('No cube layer', false);
    return;
  }
  const grid = parseCubeGrid(layer.data);
  if (!grid) {
    setStatus('Slice parse error', false);
    return;
  }
  const { matrix, label } = cubeSliceMatrix(grid, els.sliceAxis.value, toNumber(els.slicePosition.value, 0.5));
  const drawn = await drawHeatmap(
    `${layer.name} · ${label}`,
    matrix,
    els.sliceColormap.value,
    optionalNumber(els.sliceMin.value),
    optionalNumber(els.sliceMax.value)
  );
  if (drawn) setStatus('Slice drawn');
}

function parseCsv(text) {
  return text.trim().split(/\r?\n/).map((line) => line.split(/,|\s+/).filter(Boolean).map(Number));
}

async function drawPlotText(text, name) {
  try {
    if (/\.json$/i.test(name)) {
      const data = JSON.parse(text);
      const drawn = data.z
        ? await drawHeatmap(data.title || name, data.z, data.colorscale || els.plotColormap.value)
        : await drawCurve(data.title || name, data.x || data.y.map((_, index) => index), data.y);
      if (drawn) setStatus('Plot loaded');
      return;
    }

    const rows = parseCsv(text).filter((row) => row.every(Number.isFinite));
    if (!rows.length) throw new Error('empty plot data');
    let drawn;
    if (els.plotType.value === 'heatmap') {
      drawn = await drawHeatmap(name, rows, els.plotColormap.value);
    } else {
      const x = rows.map((row, index) => row.length > 1 ? row[0] : index);
      const y = rows.map((row) => row.length > 1 ? row[1] : row[0]);
      drawn = await drawCurve(name, x, y);
    }
    if (drawn) setStatus('Plot loaded');
  } catch (error) {
    console.error(error);
    setStatus('Plot error', false);
  }
}

async function sampleCurve() {
  const x = [];
  const y = [];
  for (let i = 0; i <= 240; i += 1) {
    const value = -6 + i * 12 / 240;
    x.push(value);
    y.push(Math.sin(value) * Math.exp(-Math.abs(value) / 4) + 0.15 * Math.cos(3 * value));
  }
  if (await drawCurve('Sample line profile', x, y)) setStatus('Curve drawn');
}

async function sampleMap() {
  const matrix = [];
  for (let iy = 0; iy < 80; iy += 1) {
    const y = -2.8 + iy * 5.6 / 79;
    const row = [];
    for (let ix = 0; ix < 96; ix += 1) {
      const x = -3.2 + ix * 6.4 / 95;
      row.push(Math.sin(2.2 * x) * Math.cos(1.6 * y) * Math.exp(-(x * x + y * y) / 10));
    }
    matrix.push(row);
  }
  if (await drawHeatmap('Sample filled map', matrix, els.plotColormap.value)) setStatus('Map drawn');
}

function cellFromFirstCube() {
  const layer = state.layers[0];
  if (!layer) {
    setStatus('No cube layer', false);
    return;
  }
  const meta = parseCubeMetadata(layer.data);
  if (!meta.dims.length || meta.vectors.length !== 3) {
    setStatus('No cube cell', false);
    return;
  }
  const cell = {
    a: vectorScale(meta.vectors[0], meta.dims[0]),
    b: vectorScale(meta.vectors[1], meta.dims[1]),
    c: vectorScale(meta.vectors[2], meta.dims[2])
  };
  state.periodic.cell = cell;
  els.cellA.value = cell.a.map((value) => value.toFixed(6)).join(', ');
  els.cellB.value = cell.b.map((value) => value.toFixed(6)).join(', ');
  els.cellC.value = cell.c.map((value) => value.toFixed(6)).join(', ');
  els.periodicEnabled.checked = true;
  syncPeriodicFromControls();
  renderScene(true);
  setStatus('Cell loaded');
}

function loadSampleScene() {
  state.layers = [];
  state.nextLayerId = 1;
  state.periodic.enabled = false;
  if (els.periodicEnabled) els.periodicEnabled.checked = false;
  loadStructure(sampleXYZ, 'water.xyz', 'xyz');
  addLayer(sampleHomoCube, {
    role: 'homo',
    name: 'sample-homo.cube',
    isovalue: 0.006,
    opacity: 0.58,
    mode: 'signed'
  });
  addLayer(sampleLumoCube, {
    role: 'lumo',
    name: 'sample-lumo.cube',
    isovalue: 0.006,
    opacity: 0.48,
    mode: 'signed',
    visible: true
  });
  setStatus('Sample loaded');
}

function loadPeriodicEspSample() {
  state.layers = [];
  state.nextLayerId = 1;
  state.periodic = {
    enabled: true,
    showUnitCell: true,
    tileCubes: true,
    cell: {
      a: [7.0, 0.0, 0.0],
      b: [0.0, 7.0, 0.0],
      c: [0.0, 0.0, 5.2]
    },
    ranges: {
      a: [-0.5, 1.5],
      b: [-0.5, 1.5],
      c: [0.0, 1.0]
    },
    repeatMode: 'range',
    cubeRepeatCap: 4
  };

  els.periodicEnabled.checked = true;
  els.showUnitCell.checked = true;
  els.tileCubes.checked = true;
  els.cellA.value = '7.0, 0.0, 0.0';
  els.cellB.value = '0.0, 7.0, 0.0';
  els.cellC.value = '0.0, 0.0, 5.2';
  els.rangeA.value = '-0.5, 1.5';
  els.rangeB.value = '-0.5, 1.5';
  els.rangeC.value = '0.0, 1.0';
  els.structureRepeatMode.value = 'range';
  els.cubeRepeatCap.value = '4';

  loadStructure(samplePeriodicXYZ, 'synthetic-periodic-slab.xyz', 'xyz');
  addLayer(samplePeriodicDensityCube, {
    role: 'density',
    name: 'surface-density.cube',
    mode: 'positive',
    isovalue: 0.016,
    opacity: 0.82,
    colorMode: 'solid',
    positiveColor: '#d8dde5',
    negativeColor: '#d8dde5'
  });
  addLayer(samplePeriodicEspCube, {
    role: 'esp',
    name: 'esp-color-field.cube',
    mode: 'positive',
    isovalue: 0.20,
    opacity: 0.15,
    visible: false,
    positiveColor: '#2b73c8',
    negativeColor: '#cf3f55'
  });

  const surface = state.layers[0];
  const esp = state.layers[1];
  surface.colorMode = 'cube';
  surface.colorLayerId = String(esp.id);
  surface.gradient = 'rwb';
  surface.colorMin = -0.16;
  surface.colorMax = 0.16;
  renderLayerList();
  updateLayerSelectors();
  state.dirtyZoom = true;
  renderScene(true);
  setStatus('Periodic ESP');
}

function updateLayerFromControl(control) {
  const row = control.closest('.layer-row');
  if (!row) return;
  const layer = state.layers.find((item) => item.id === Number(row.dataset.layerId));
  if (!layer) return;
  const action = control.dataset.action;

  if (action === 'remove') {
    state.layers = state.layers.filter((item) => item.id !== layer.id);
    renderLayerList();
    renderScene(false);
    return;
  }

  if (action === 'visible') layer.visible = control.checked;
  if (action === 'role') {
    layer.role = control.value;
    if (isOrbitalLayer(layer)) layer.opacity = state.gui.orbitalOpacity;
  }
  if (action === 'mode') layer.mode = control.value;
  if (action === 'isovalue') layer.isovalue = Math.abs(toNumber(control.value, layer.isovalue));
  if (action === 'opacity' && isOrbitalLayer(layer)) {
    setGlobalOrbitalOpacity(control.value, { announce: true });
    return;
  }
  if (action === 'opacity') layer.opacity = clamp(toNumber(control.value, layer.opacity), 0.05, 1);
  if (action === 'colorMode') layer.colorMode = control.value;
  if (action === 'colorLayerId') layer.colorLayerId = control.value;
  if (action === 'gradient') layer.gradient = control.value;
  if (action === 'colorMin') layer.colorMin = toNumber(control.value, layer.colorMin);
  if (action === 'colorMax') layer.colorMax = toNumber(control.value, layer.colorMax);
  if (action === 'positiveColor') layer.positiveColor = control.value;
  if (action === 'negativeColor') layer.negativeColor = control.value;

  setStatus('Updated');
  renderScene(false);
}

function activateTab(tabName) {
  document.querySelectorAll('.tab').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.id === `tab-${tabName}`);
  });
}

function activateGuiMode(mode) {
  state.gui.mode = mode;
  document.querySelectorAll('.gui-mode').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.guiMode === mode);
  });
  document.querySelectorAll('.gui-section').forEach((section) => {
    section.classList.toggle('is-active', section.dataset.guiSection === mode);
  });

  if (mode === 'molecule') activateTab('scene');
  else if (mode === 'isosurface') activateTab('layers');
  else if (mode === 'plane') activateTab('slices');
  else if (mode === 'periodic') activateTab('periodic');
}

function setActiveGuiLayer(layerId, options = {}) {
  const id = String(layerId || '');
  if (id === '0') {
    clearGuiOrbitalSelection();
    return;
  }

  if (id.startsWith('orbital:')) {
    const orbitalIndex = parseInt(id.slice(8), 10);
    if (Number.isFinite(orbitalIndex)) requestGuiOrbital(orbitalIndex);
    return;
  }

  const layer = layerById(id);
  if (!layer) return;
  state.gui.activeLayerId = String(layer.id);
  if (options.orbitalSelection) {
    const keepSecond = els.guiShowSecond?.checked;
    state.layers.forEach((item) => {
      if (String(item.id) === String(layer.id)) item.visible = true;
      else if (!keepSecond) item.visible = false;
    });
  }
  syncMultiwfnGuiControls();
  renderLayerList();
  renderScene(false);
}

function syncMultiwfnGuiControls() {
  if (!els.guiShowLabels) return;

  syncOrbitalOpacityControls();
  syncAxesControls();

  els.guiShowStructure.checked = els.showStructure.checked;
  els.guiShowLabels.checked = els.showLabels.checked;
  els.guiPeriodicEnabled.checked = els.periodicEnabled.checked;
  els.guiShowCell.checked = els.showUnitCell.checked;
  els.guiTileCubes.checked = els.tileCubes.checked;
  els.guiCellA.value = els.cellA.value;
  els.guiCellB.value = els.cellB.value;
  els.guiCellC.value = els.cellC.value;
  els.guiRangeA.value = els.rangeA.value;
  els.guiRangeB.value = els.rangeB.value;
  els.guiRangeC.value = els.rangeC.value;

  const atomRatio = clamp(toNumber(els.atomScale.value, 0.24) / 0.24, 0, 5);
  els.guiAtomSize.value = atomRatio.toFixed(2);
  els.guiBondRadius.value = clamp(toNumber(els.bondRadius.value, 0.14) / 0.7, 0, 1).toFixed(2);
  els.guiLabelSize.value = String(state.gui.labelSize);

  const layer = activeGuiLayer();
  const selectedId = layer ? String(layer.id) : '';
  if (selectedId) state.gui.activeLayerId = selectedId;
  [els.guiOrbitalSelect, els.guiIsosurfaceLayer, els.guiSliceLayer].forEach((select) => {
    if (!select) return;
    if (select === els.guiOrbitalSelect && layer?.orbitalIndex) {
      const orbitalValue = `orbital:${layer.orbitalIndex}`;
      if ([...select.options].some((option) => option.value === orbitalValue)) select.value = orbitalValue;
      return;
    }
    if ([...select.options].some((option) => option.value === selectedId)) select.value = selectedId;
  });

  if (!layer) {
    els.guiOrbitalInput.value = '0';
    syncOrbitalIsovalueControls(state.gui.orbitalIsovalue);
    return;
  }

  const layerIndex = state.layers.findIndex((item) => item.id === layer.id);
  els.guiOrbitalInput.value = String(layer.orbitalIndex || layerIndex + 1);
  syncOrbitalIsovalueControls(layer.isovalue, { layer });
  els.guiIsosurfaceMode.value = layer.mode;
  els.guiIsosurfaceValue.value = String(layer.isovalue);
  els.guiIsosurfaceOpacity.value = String(layer.opacity);
  els.guiSurfaceStyle.value = layer.surfaceStyle || 'transparent';
  els.guiColoringMode.value = layer.colorMode;
  els.guiGradient.value = layer.gradient;
  els.guiColorMin.value = String(layer.colorMin);
  els.guiColorMax.value = String(layer.colorMax);
  els.guiPositiveColor.value = layer.positiveColor;
  els.guiNegativeColor.value = layer.negativeColor;
  if ([...els.guiColoringLayer.options].some((option) => option.value === String(layer.colorLayerId))) {
    els.guiColoringLayer.value = String(layer.colorLayerId || '');
  }
}

function updateActiveLayerFromGui(event) {
  const layer = activeGuiLayer();
  if (!layer) {
    setStatus('No cube layer', false);
    return;
  }
  if (event?.target === els.guiIsosurfaceOpacity && isOrbitalLayer(layer)) {
    setGlobalOrbitalOpacity(els.guiIsosurfaceOpacity.value, { announce: true });
    return;
  }
  layer.mode = els.guiIsosurfaceMode.value;
  layer.isovalue = Math.abs(toNumber(els.guiIsosurfaceValue.value, layer.isovalue));
  layer.opacity = clamp(toNumber(els.guiIsosurfaceOpacity.value, layer.opacity), 0.05, 1);
  layer.colorMode = els.guiColoringMode.value;
  layer.colorLayerId = els.guiColoringLayer.value;
  layer.gradient = els.guiGradient.value;
  layer.surfaceStyle = els.guiSurfaceStyle.value;
  layer.colorMin = toNumber(els.guiColorMin.value, layer.colorMin);
  layer.colorMax = toNumber(els.guiColorMax.value, layer.colorMax);
  layer.positiveColor = els.guiPositiveColor.value;
  layer.negativeColor = els.guiNegativeColor.value;

  if (isOrbitalLayer(layer)) layer.opacity = state.gui.orbitalOpacity;
  else if (els.guiSurfaceStyle.value === 'solid') layer.opacity = 1;
  els.guiIsosurfaceOpacity.value = String(layer.opacity);
  els.surfaceQuality.value = els.guiSurfaceQuality.value;
  renderLayerList();
  renderScene(false);
}

function rotateGuiView(direction) {
  if (!state.viewer || typeof state.viewer.rotate !== 'function') {
    setStatus('Rotation unavailable', false);
    return;
  }
  const angle = 10;
  if (direction === 'up') state.viewer.rotate(angle, 'x');
  if (direction === 'down') state.viewer.rotate(-angle, 'x');
  if (direction === 'left') state.viewer.rotate(-angle, 'y');
  if (direction === 'right') state.viewer.rotate(angle, 'y');
  state.viewer.render();
  syncOrientationView();
}

function resetGuiView() {
  if (
    !state.viewer ||
    typeof state.viewer.zoomTo !== 'function' ||
    typeof state.viewer.getView !== 'function' ||
    typeof state.viewer.setView !== 'function'
  ) {
    setStatus('View reset unavailable', false);
    return;
  }

  els.spin.checked = false;
  if (typeof state.viewer.spin === 'function') state.viewer.spin(false);
  state.viewer.zoomTo();

  const view = state.viewer.getView();
  if (!Array.isArray(view) || view.length < 8) {
    setStatus('View reset unavailable', false);
    return;
  }
  const resetView = [...view];
  resetView[4] = 0;
  resetView[5] = 0;
  resetView[6] = 0;
  resetView[7] = 1;
  state.viewer.setView(resetView);
  state.dirtyZoom = false;
  state.viewer.render();
  syncOrientationView();
  setStatus('View reset');
}

function selectGuiOrbitalOffset(offset) {
  const current = Number(activeGuiLayer()?.orbitalIndex || els.guiOrbitalInput.value || 0);
  if (state.orbitals.items.length) {
    const rows = state.orbitals.items.map((orbital) => Number(orbital.index)).filter(Number.isFinite);
    const pos = Math.max(0, rows.indexOf(current));
    const next = rows[clamp(pos + offset, 0, rows.length - 1)];
    requestGuiOrbital(next);
    return;
  }
  if (!state.layers.length) {
    setStatus('No cube layer', false);
    return;
  }
  const currentIndex = Math.max(0, state.layers.findIndex((layer) => String(layer.id) === String(state.gui.activeLayerId)));
  const nextLayer = state.layers[clamp(currentIndex + offset, 0, state.layers.length - 1)];
  requestGuiOrbital(nextLayer.orbitalIndex || current + offset);
}

function applyGuiPeriodicControls() {
  els.periodicEnabled.checked = els.guiPeriodicEnabled.checked;
  els.showUnitCell.checked = els.guiShowCell.checked;
  els.tileCubes.checked = els.guiTileCubes.checked;
  els.cellA.value = els.guiCellA.value;
  els.cellB.value = els.guiCellB.value;
  els.cellC.value = els.guiCellC.value;
  els.rangeA.value = els.guiRangeA.value;
  els.rangeB.value = els.guiRangeB.value;
  els.rangeC.value = els.guiRangeC.value;
  syncPeriodicFromControls();
  renderScene(true);
  setStatus('Periodic updated');
}

function applyMultiwfnGuiMode(gui) {
  const entry = String(gui.entry || '').toLowerCase();
  const guiMode = Number(gui.guiMode);
  els.guiEntryLabel.textContent = gui.entry ? `3Dmol GUI · ${gui.entry}` : '3Dmol GUI';
  if (entry.includes('drawplane') || guiMode === 2) activateGuiMode('plane');
  else if (entry.includes('drawisosur') || guiMode === 3) activateGuiMode('isosurface');
  else if (entry.includes('setbox') || entry.includes('mini') || guiMode === 7) activateGuiMode('periodic');
  else if (entry.includes('drawmol') || guiMode === 1) activateGuiMode('molecule');
}

function bindTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      activateTab(tab.dataset.tab);
    });
  });
}

function bindEvents() {
  bindTabs();

  document.querySelectorAll('.gui-mode').forEach((button) => {
    button.addEventListener('click', () => activateGuiMode(button.dataset.guiMode));
  });

  els.guiReturn.addEventListener('click', async () => {
    try {
      await fetch('/api/return', { cache: 'no-store' });
      setStatus('Return requested');
    } catch (error) {
      console.error(error);
      setStatus('Return requested; close this window if it remains open', false);
    }
    try {
      window.close();
    } catch (error) {
      console.error(error);
    }
  });
  els.guiReset.addEventListener('click', resetGuiView);
  els.guiSavePicture.addEventListener('click', savePng);
  els.guiRotUp.addEventListener('click', () => rotateGuiView('up'));
  els.guiRotDown.addEventListener('click', () => rotateGuiView('down'));
  els.guiRotLeft.addEventListener('click', () => rotateGuiView('left'));
  els.guiRotRight.addEventListener('click', () => rotateGuiView('right'));
  els.guiMenuIsosur1.addEventListener('click', () => {
    setStyleMenuOpen(els.guiIsosur1Menu.hidden, { focus: true });
  });
  els.guiStyleTransparency.addEventListener('click', () => {
    setStyleSubmenuOpen('transparency', els.guiTransparencyMenu.hidden, { focus: true });
  });
  els.guiStyleBackground.addEventListener('click', () => {
    syncBackgroundStyleControls();
    setStyleSubmenuOpen('background', els.guiBackgroundMenu.hidden, { focus: true });
  });
  els.guiStyleAxes.addEventListener('click', () => {
    closeStyleSubmenus();
    setAxesVisible(!els.showAxes.checked, { announce: true });
  });
  els.guiOrbitalOpacity.addEventListener('input', () => {
    const opacity = orbitalOpacityStops[parseInt(els.guiOrbitalOpacity.value, 10)] ?? 0.68;
    setGlobalOrbitalOpacity(opacity, { announce: true });
  });
  [
    [els.guiBackgroundWhite, 'white'],
    [els.guiBackgroundBlack, 'black']
  ].forEach(([button, background]) => button.addEventListener('click', () => {
    setViewerBackground(background, { announce: true });
    setStyleMenuOpen(false);
    els.guiMenuIsosur1.focus();
  }));
  document.addEventListener('click', (event) => {
    const styleMenuOpen = !els.guiIsosur1Menu.hidden || styleSubmenuEntries().some((entry) => !entry.menu.hidden);
    if (styleMenuOpen && !els.guiIsosur1MenuControl.contains(event.target)) {
      setStyleMenuOpen(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (styleSubmenuEntries().some((entry) => !entry.menu.hidden)) {
      closeStyleSubmenus({ focus: true });
      event.preventDefault();
      return;
    }
    if (els.guiIsosur1Menu.hidden) return;
    setStyleMenuOpen(false);
    els.guiMenuIsosur1.focus();
    event.preventDefault();
  });

  els.guiShowStructure.addEventListener('input', () => {
    els.showStructure.checked = els.guiShowStructure.checked;
    renderScene(false);
  });
  els.guiShowLabels.addEventListener('input', () => {
    els.showLabels.checked = els.guiShowLabels.checked;
    renderScene(false);
  });
  els.guiShowAxis.addEventListener('input', () => {
    setAxesVisible(els.guiShowAxis.checked, { announce: true });
  });
  els.guiShowSecond.addEventListener('input', () => {
    if (!els.guiShowSecond.checked && state.gui.activeLayerId) {
      state.layers.forEach((layer) => { layer.visible = String(layer.id) === String(state.gui.activeLayerId); });
      renderLayerList();
      renderScene(false);
    }
  });
  els.guiAtomSize.addEventListener('input', () => {
    els.atomScale.value = String(clamp(toNumber(els.guiAtomSize.value, 1) * 0.24, 0.12, 0.75));
    renderScene(false);
  });
  els.guiBondRadius.addEventListener('input', () => {
    els.bondRadius.value = String(clamp(toNumber(els.guiBondRadius.value, 0.2) * 0.7, 0.04, 0.32));
    renderScene(false);
  });
  els.guiLabelSize.addEventListener('input', () => {
    state.gui.labelSize = clamp(parseInt(els.guiLabelSize.value, 10) || 38, 0, 100);
    renderScene(false);
  });
  els.guiBondThreshold.addEventListener('input', () => setStatus('Bonding threshold is stored for Multiwfn GUI parity'));

  els.guiOrbitalSelect.addEventListener('change', () => setActiveGuiLayer(els.guiOrbitalSelect.value, { orbitalSelection: true }));
  els.guiOrbitalInput.addEventListener('change', () => {
    const index = parseInt(els.guiOrbitalInput.value, 10);
    if (!Number.isFinite(index) || index <= 0) {
      clearGuiOrbitalSelection();
      return;
    }
    requestGuiOrbital(index);
  });
  els.guiOrbPrev.addEventListener('click', () => selectGuiOrbitalOffset(-1));
  els.guiOrbNext.addEventListener('click', () => selectGuiOrbitalOffset(1));
  els.guiOrbInfo.addEventListener('click', () => activateTab('layers'));
  const updateOrbitalIsovalue = (event) => {
    const layer = activeGuiLayer();
    const value = event?.target === els.guiOrbitalIsovalueNumber
      ? els.guiOrbitalIsovalueNumber.value
      : els.guiOrbitalIsovalue.value;
    syncOrbitalIsovalueControls(value, layer ? { layer } : {});
    if (layer) {
      renderLayerList();
      renderScene(false);
    }
  };
  const reloadOrbitalAtIsovalue = () => {
    const index = Number(activeGuiLayer()?.orbitalIndex || els.guiOrbitalInput.value || 0);
    if (index > 0) requestGuiOrbital(index, { forceRecompute: true });
  };
  els.guiOrbitalIsovalue.addEventListener('input', updateOrbitalIsovalue);
  els.guiOrbitalIsovalueNumber.addEventListener('input', updateOrbitalIsovalue);
  els.guiOrbitalIsovalue.addEventListener('change', reloadOrbitalAtIsovalue);
  els.guiOrbitalIsovalueNumber.addEventListener('change', reloadOrbitalAtIsovalue);

  els.guiIsosurfaceLayer.addEventListener('change', () => setActiveGuiLayer(els.guiIsosurfaceLayer.value));
  [
    els.guiIsosurfaceMode,
    els.guiIsosurfaceValue,
    els.guiIsosurfaceOpacity,
    els.guiSurfaceStyle,
    els.guiSurfaceQuality,
    els.guiColoringMode,
    els.guiColoringLayer,
    els.guiGradient,
    els.guiColorMin,
    els.guiColorMax,
    els.guiPositiveColor,
    els.guiNegativeColor
  ].forEach((el) => el.addEventListener('input', updateActiveLayerFromGui));

  els.guiSliceLayer.addEventListener('change', () => {
    els.sliceLayer.value = els.guiSliceLayer.value;
    setActiveGuiLayer(els.guiSliceLayer.value);
  });
  els.guiSliceAxis.addEventListener('input', () => { els.sliceAxis.value = els.guiSliceAxis.value; });
  els.guiSlicePosition.addEventListener('input', () => { els.slicePosition.value = els.guiSlicePosition.value; });
  els.guiPlotColormap.addEventListener('input', () => {
    els.sliceColormap.value = els.guiPlotColormap.value;
    els.plotColormap.value = els.guiPlotColormap.value;
  });
  els.guiDrawSlice.addEventListener('click', () => {
    els.sliceLayer.value = els.guiSliceLayer.value;
    els.sliceAxis.value = els.guiSliceAxis.value;
    els.slicePosition.value = els.guiSlicePosition.value;
    els.sliceColormap.value = els.guiPlotColormap.value;
    drawSelectedSlice();
  });
  els.guiSampleCurve.addEventListener('click', sampleCurve);
  els.guiSampleMap.addEventListener('click', sampleMap);
  els.guiHidePlot.addEventListener('click', () => showPlotPanel(false));

  [
    els.guiPeriodicEnabled,
    els.guiShowCell,
    els.guiTileCubes,
    els.guiCellA,
    els.guiCellB,
    els.guiCellC,
    els.guiRangeA,
    els.guiRangeB,
    els.guiRangeC
  ].forEach((el) => el.addEventListener('change', applyGuiPeriodicControls));
  els.guiApplyPeriodic.addEventListener('click', applyGuiPeriodicControls);
  els.guiCellFromCube.addEventListener('click', () => {
    cellFromFirstCube();
    syncMultiwfnGuiControls();
  });
  els.guiPeriodicEsp.addEventListener('click', () => {
    loadPeriodicEspSample();
    activateGuiMode('periodic');
  });

  [
    els.guiMenuOrbitalInfo,
    els.guiMenuIsosur2,
    els.guiMenuView,
    els.guiMenuSettings,
    els.guiMenuTools
  ].forEach((el) => el.addEventListener('click', () => {
    document.querySelector('.advanced-panels').open = true;
    activateTab(el === els.guiMenuOrbitalInfo || el === els.guiMenuIsosur1 || el === els.guiMenuIsosur2 || el === els.guiMenuQuality ? 'layers' : 'style');
  }));
  els.guiMenuQuality.addEventListener('change', () => {
    const index = Number(activeGuiLayer()?.orbitalIndex || els.guiOrbitalInput.value || 0);
    if (index > 0) requestGuiOrbital(index, { forceRecompute: true });
    else setStatus('Select an orbital before changing grid quality', false);
  });

  els.structureFile.addEventListener('change', () => {
    const file = els.structureFile.files[0];
    if (!file) return;
    readFile(file, (text, name) => {
      const selected = els.structureFormat.value;
      loadStructure(text, name, selected === 'auto' ? detectFormat(name) : selected);
    });
  });

  els.cubeFile.addEventListener('change', () => {
    state.selectedCubeFile = els.cubeFile.files[0] || null;
  });

  els.plotFile.addEventListener('change', () => {
    state.selectedPlotFile = els.plotFile.files[0] || null;
  });

  els.addCubeLayer.addEventListener('click', () => {
    if (!state.selectedCubeFile) {
      setStatus('Choose cube', false);
      return;
    }
    readFile(state.selectedCubeFile, (text, name) => {
      addLayer(text, { name, role: els.cubeRole.value });
    });
  });

  els.manifestFile.addEventListener('change', () => {
    const file = els.manifestFile.files[0];
    if (!file) return;
    readFile(file, (text) => loadManifestText(text));
  });

  els.loadQueryManifest.addEventListener('click', async () => {
    const current = new URL(window.location.href);
    const defaultUrl = current.searchParams.get('manifest') || '';
    const manifestUrl = window.prompt('Manifest URL', defaultUrl);
    if (!manifestUrl) return;
    try {
      const resolved = new URL(manifestUrl, window.location.href);
      const response = await fetch(resolved);
      if (!response.ok) throw new Error(`${response.status}`);
      await loadManifestText(await response.text(), resolved);
    } catch (error) {
      console.error(error);
      setStatus('URL load error', false);
    }
  });

  byId('sample-xyz').addEventListener('click', () => loadStructure(sampleXYZ, 'water.xyz', 'xyz'));
  byId('sample-homo').addEventListener('click', () => addLayer(sampleHomoCube, { role: 'homo', name: 'sample-homo.cube' }));
  byId('sample-lumo').addEventListener('click', () => addLayer(sampleLumoCube, { role: 'lumo', name: 'sample-lumo.cube' }));
  byId('sample-scene').addEventListener('click', loadSampleScene);
  byId('sample-periodic-esp').addEventListener('click', loadPeriodicEspSample);
  byId('clear-structure').addEventListener('click', clearStructure);
  byId('clear-cubes').addEventListener('click', clearCubes);
  byId('reset-view').addEventListener('click', () => renderScene(true));
  byId('fit-scene').addEventListener('click', () => renderScene(true));
  byId('save-state').addEventListener('click', saveManifest);
  byId('save-png').addEventListener('click', savePng);
  byId('cell-from-cube').addEventListener('click', cellFromFirstCube);
  byId('apply-periodic').addEventListener('click', () => {
    syncPeriodicFromControls();
    state.dirtyZoom = true;
    renderScene(true);
    setStatus('Periodic updated');
  });
  byId('draw-slice').addEventListener('click', drawSelectedSlice);
  byId('sample-slice').addEventListener('click', () => {
    if (!state.layers.length) loadSampleScene();
    drawSelectedSlice();
  });
  byId('load-plot-file').addEventListener('click', () => {
    if (!state.selectedPlotFile) {
      setStatus('Choose plot', false);
      return;
    }
    readFile(state.selectedPlotFile, drawPlotText);
  });
  byId('sample-curve').addEventListener('click', sampleCurve);
  byId('sample-map').addEventListener('click', sampleMap);

  els.layerList.addEventListener('input', (event) => updateLayerFromControl(event.target));
  els.layerList.addEventListener('change', (event) => updateLayerFromControl(event.target));
  els.layerList.addEventListener('click', (event) => {
    if (event.target.matches('button[data-action="remove"]')) updateLayerFromControl(event.target);
  });

  [
    els.modelStyle,
    els.atomScale,
    els.bondRadius,
    els.showStructure,
    els.showLabels,
    els.ambientOcclusion,
    els.outline,
    els.spin,
    els.surfaceQuality,
    els.aoStrength,
    els.outlineWidth
  ].forEach((el) => el.addEventListener('input', () => renderScene(false)));
  els.showAxes.addEventListener('input', () => {
    setAxesVisible(els.showAxes.checked, { announce: true });
  });
  els.background.addEventListener('input', () => {
    setViewerBackground(els.background.value, { announce: true });
  });

  [
    els.periodicEnabled,
    els.showUnitCell,
    els.tileCubes,
    els.structureRepeatMode,
    els.cubeRepeatCap
  ].forEach((el) => el.addEventListener('input', () => {
    syncPeriodicFromControls();
    renderScene(false);
  }));

  [
    els.cellA,
    els.cellB,
    els.cellC,
    els.rangeA,
    els.rangeB,
    els.rangeC
  ].forEach((el) => el.addEventListener('change', () => {
    syncPeriodicFromControls();
    renderScene(false);
  }));
}

function cacheElements() {
  Object.assign(els, {
    viewer: byId('viewer'),
    viewerWrap: document.querySelector('.viewport-wrap'),
    orientationWidget: byId('orientation-widget'),
    plotPanel: byId('plot-panel'),
    plotView: byId('plot-view'),
    status: byId('status'),
    guiEntryLabel: byId('gui-entry-label'),
    guiReturn: byId('gui-return'),
    guiReset: byId('gui-reset'),
    guiSavePicture: byId('gui-save-picture'),
    guiRotUp: byId('gui-rot-up'),
    guiRotDown: byId('gui-rot-down'),
    guiRotLeft: byId('gui-rot-left'),
    guiRotRight: byId('gui-rot-right'),
    guiShowStructure: byId('gui-show-structure'),
    guiShowLabels: byId('gui-show-labels'),
    guiShowAxis: byId('gui-show-axis'),
    guiShowSecond: byId('gui-show-second'),
    guiBondThreshold: byId('gui-bond-threshold'),
    guiAtomSize: byId('gui-atom-size'),
    guiBondRadius: byId('gui-bond-radius'),
    guiLabelSize: byId('gui-label-size'),
    guiOrbitalSelect: byId('gui-orbital-select'),
    guiOrbitalList: byId('gui-orbital-list'),
    guiOrbitalStatus: byId('gui-orbital-status'),
    guiOrbitalInput: byId('gui-orbital-input'),
    guiOrbitalIsovalue: byId('gui-orbital-isovalue'),
    guiOrbitalIsovalueNumber: byId('gui-orbital-isovalue-number'),
    guiOrbPrev: byId('gui-orb-prev'),
    guiOrbNext: byId('gui-orb-next'),
    guiOrbInfo: byId('gui-orb-info'),
    guiIsosurfaceLayer: byId('gui-isosurface-layer'),
    guiIsosurfaceMode: byId('gui-isosurface-mode'),
    guiIsosurfaceValue: byId('gui-isosurface-value'),
    guiIsosurfaceOpacity: byId('gui-isosurface-opacity'),
    guiSurfaceStyle: byId('gui-surface-style'),
    guiSurfaceQuality: byId('gui-surface-quality'),
    guiColoringMode: byId('gui-coloring-mode'),
    guiColoringLayer: byId('gui-coloring-layer'),
    guiGradient: byId('gui-gradient'),
    guiColorMin: byId('gui-color-min'),
    guiColorMax: byId('gui-color-max'),
    guiPositiveColor: byId('gui-positive-color'),
    guiNegativeColor: byId('gui-negative-color'),
    guiSliceLayer: byId('gui-slice-layer'),
    guiSliceAxis: byId('gui-slice-axis'),
    guiSlicePosition: byId('gui-slice-position'),
    guiPlotColormap: byId('gui-plot-colormap'),
    guiDrawSlice: byId('gui-draw-slice'),
    guiSampleCurve: byId('gui-sample-curve'),
    guiSampleMap: byId('gui-sample-map'),
    guiHidePlot: byId('gui-hide-plot'),
    guiPeriodicEnabled: byId('gui-periodic-enabled'),
    guiShowCell: byId('gui-show-cell'),
    guiTileCubes: byId('gui-tile-cubes'),
    guiCellA: byId('gui-cell-a'),
    guiCellB: byId('gui-cell-b'),
    guiCellC: byId('gui-cell-c'),
    guiRangeA: byId('gui-range-a'),
    guiRangeB: byId('gui-range-b'),
    guiRangeC: byId('gui-range-c'),
    guiCellFromCube: byId('gui-cell-from-cube'),
    guiApplyPeriodic: byId('gui-apply-periodic'),
    guiPeriodicEsp: byId('gui-periodic-esp'),
    guiMenuOrbitalInfo: byId('gui-menu-orbital-info'),
    guiMenuIsosur1: byId('gui-menu-isosur1'),
    guiIsosur1MenuControl: byId('gui-isosur1-menu-control'),
    guiIsosur1Menu: byId('gui-isosur1-menu'),
    guiStyleTransparency: byId('gui-style-transparency'),
    guiStyleBackground: byId('gui-style-background'),
    guiStyleAxes: byId('gui-style-axes'),
    guiTransparencyMenu: byId('gui-transparency-menu'),
    guiBackgroundMenu: byId('gui-background-menu'),
    guiBackgroundWhite: byId('gui-background-white'),
    guiBackgroundBlack: byId('gui-background-black'),
    guiOrbitalOpacity: byId('gui-orbital-opacity'),
    guiOrbitalOpacityValue: byId('gui-orbital-opacity-value'),
    guiMenuIsosur2: byId('gui-menu-isosur2'),
    guiMenuQuality: byId('gui-menu-quality'),
    guiMenuView: byId('gui-menu-view'),
    guiMenuSettings: byId('gui-menu-settings'),
    guiMenuTools: byId('gui-menu-tools'),
    modelLabel: byId('model-label'),
    cubeLabel: byId('cube-label'),
    structureFile: byId('structure-file'),
    structureFormat: byId('structure-format'),
    modelStyle: byId('model-style'),
    atomScale: byId('atom-scale'),
    bondRadius: byId('bond-radius'),
    manifestFile: byId('manifest-file'),
    loadQueryManifest: byId('load-query-manifest'),
    cubeFile: byId('cube-file'),
    cubeRole: byId('cube-role'),
    surfaceMode: byId('surface-mode'),
    isoValue: byId('iso-value'),
    surfaceOpacity: byId('surface-opacity'),
    positiveColor: byId('positive-color'),
    negativeColor: byId('negative-color'),
    addCubeLayer: byId('add-cube-layer'),
    layerList: byId('layer-list'),
    periodicEnabled: byId('periodic-enabled'),
    showUnitCell: byId('show-unit-cell'),
    tileCubes: byId('tile-cubes'),
    cellA: byId('cell-a'),
    cellB: byId('cell-b'),
    cellC: byId('cell-c'),
    rangeA: byId('range-a'),
    rangeB: byId('range-b'),
    rangeC: byId('range-c'),
    structureRepeatMode: byId('structure-repeat-mode'),
    cubeRepeatCap: byId('cube-repeat-cap'),
    sliceLayer: byId('slice-layer'),
    sliceAxis: byId('slice-axis'),
    slicePosition: byId('slice-position'),
    sliceColormap: byId('slice-colormap'),
    sliceMin: byId('slice-min'),
    sliceMax: byId('slice-max'),
    plotFile: byId('plot-file'),
    plotType: byId('plot-type'),
    plotColormap: byId('plot-colormap'),
    showStructure: byId('show-structure'),
    showLabels: byId('show-labels'),
    showAxes: byId('show-axes'),
    ambientOcclusion: byId('ambient-occlusion'),
    outline: byId('outline'),
    spin: byId('spin'),
    background: byId('background'),
    surfaceQuality: byId('surface-quality'),
    aoStrength: byId('ao-strength'),
    outlineWidth: byId('outline-width'),
    statStructure: byId('stat-structure'),
    statAtoms: byId('stat-atoms'),
    statCubes: byId('stat-cubes'),
    statGrid: byId('stat-grid')
  });
}

async function loadManifestFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const manifestUrl = params.get('manifest');
  if (!manifestUrl) return false;

  try {
    const resolved = new URL(manifestUrl, window.location.href);
    const response = await fetch(resolved);
    if (!response.ok) throw new Error(`${response.status}`);
    const manifestText = await response.text();
    markStartup('manifestFetchedAt');
    await loadManifestText(manifestText, resolved);
    return true;
  } catch (error) {
    console.error(error);
    setStatus('Manifest URL error', false);
    return false;
  }
}

async function init() {
  markStartup('initStartedAt');
  cacheElements();
  if (!window.$3Dmol) {
    setStatus('3Dmol missing', false);
    markStartup('failedAt', { error: '3Dmol missing' });
    return;
  }

  setStatus('Starting 3D renderer...');
  els.background.value = 'white';
  els.showAxes.checked = true;
  els.positiveColor.value = orbitalPhaseColors.positive;
  els.negativeColor.value = orbitalPhaseColors.negative;
  els.guiPositiveColor.value = orbitalPhaseColors.positive;
  els.guiNegativeColor.value = orbitalPhaseColors.negative;
  state.viewer = $3Dmol.createViewer(els.viewer, {
    backgroundColor: backgrounds.white.viewer,
    antialias: true
  });
  initializeOrientationViewer();
  markStartup('viewerCreatedAt');
  if (typeof state.viewer.setViewChangeCallback === 'function') {
    state.viewer.setViewChangeCallback(syncOrientationView);
  }

  bindEvents();
  syncBackgroundStyleControls();
  updateOrientationVisibility();
  renderLayerList();
  const loadedFromQuery = await loadManifestFromQuery();
  if (!loadedFromQuery) {
    loadSampleScene();
    markStartup('structureRenderedAt');
    markStartup('activeOrbitalRenderedAt');
    markStartup('backgroundLayersReadyAt', { backgroundLayerCount: Math.max(0, state.layers.length - 1) });
    finishStartup();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  markStartup('domContentLoadedAt');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    markStartup('shellPaintedAt');
    init().catch((error) => {
      console.error(error);
      setStatus('Viewer startup error', false);
      markStartup('failedAt', { error: String(error) });
    });
  }));
});
window.addEventListener('resize', () => {
  if (!state.viewer) return;
  state.viewer.resize();
  state.viewer.render();
  updateOrientationVisibility();
  repositionOpenStyleSubmenu();
});
