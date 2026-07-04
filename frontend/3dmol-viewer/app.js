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

const roleDefaults = {
  homo: { label: 'HOMO', positive: '#2869d8', negative: '#d6435f', isovalue: 0.015 },
  lumo: { label: 'LUMO', positive: '#0b8b6f', negative: '#d0822f', isovalue: 0.015 },
  density: { label: 'Density', positive: '#7c5ac9', negative: '#7c5ac9', isovalue: 0.02 },
  elf: { label: 'ELF', positive: '#d4a21b', negative: '#d4a21b', isovalue: 0.65 },
  esp: { label: 'ESP', positive: '#2b73c8', negative: '#cf3f55', isovalue: 0.02 },
  custom: { label: 'Custom', positive: '#2869d8', negative: '#d6435f', isovalue: 0.015 }
};

const backgrounds = {
  studio: { css: '#edf2f4', viewer: '#edf2f4' },
  paper: { css: '#f8f6ef', viewer: '#f8f6ef' },
  graphite: { css: '#20252b', viewer: '#20252b' },
  black: { css: '#050608', viewer: '#050608' }
};

const gradients = {
  rwb: { label: 'RWB', make: (min, max) => new $3Dmol.Gradient.RWB(min, max) },
  roygb: { label: 'ROYGB', make: (min, max) => new $3Dmol.Gradient.ROYGB(min, max) },
  sinebow: { label: 'Sinebow', make: (min, max) => new $3Dmol.Gradient.Sinebow(min, max) }
};

const state = {
  viewer: null,
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
  const bg = backgrounds[els.background.value] || backgrounds.studio;
  els.viewerWrap.style.backgroundColor = bg.css;
  state.viewer.setBackgroundColor(bg.viewer);

  if (typeof state.viewer.setViewStyle === 'function') {
    const outline = els.outline.checked
      ? {
          style: 'outline',
          width: toNumber(els.outlineWidth.value, 0.035),
          color: els.background.value === 'black' || els.background.value === 'graphite' ? '#0b0d10' : '#111820'
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
        fontSize: 10,
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

function addAxes() {
  if (!els.showAxes.checked || typeof state.viewer.addArrow !== 'function') return;

  const axes = [
    ['X', '#d33f49', { x: 1.65, y: 0, z: 0 }],
    ['Y', '#237a57', { x: 0, y: 1.65, z: 0 }],
    ['Z', '#2b62c4', { x: 0, y: 0, z: 1.65 }]
  ];

  axes.forEach(([label, color, end]) => {
    state.viewer.addArrow({
      start: { x: 0, y: 0, z: 0 },
      end,
      radius: 0.025,
      radiusRadio: 1.8,
      mid: 0.82,
      color
    });
    state.viewer.addLabel(label, {
      position: end,
      fontColor: color,
      backgroundOpacity: 0,
      fontSize: 13
    });
  });
}

function addCubeLayer(layer) {
  const isovalue = Math.abs(toNumber(layer.isovalue, roleDefaults.custom.isovalue));
  const opacity = clamp(toNumber(layer.opacity, 0.68), 0.05, 1);
  const smoothness = parseInt(els.surfaceQuality.value, 10) || 8;
  const colorLayer = layer.colorMode === 'cube' ? layerById(layer.colorLayerId) : null;
  const colorMin = toNumber(layer.colorMin, -0.05);
  const colorMax = toNumber(layer.colorMax, 0.05);

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

    if (layer.mode === 'signed' || layer.mode === 'positive') {
      state.viewer.addIsosurface(volume, {
        ...common,
        isoval: isovalue,
        color: colorVolume ? undefined : layer.positiveColor
      });
    }
    if (layer.mode === 'signed' || layer.mode === 'negative') {
      state.viewer.addIsosurface(volume, {
        ...common,
        isoval: -isovalue,
        color: colorVolume ? undefined : layer.negativeColor
      });
    }
  });
}

function renderScene(zoom = false) {
  if (!state.viewer) return;

  state.viewer.clear();
  applySceneStyle();
  addStructureToViewer();
  state.layers.filter((layer) => layer.visible).forEach(addCubeLayer);
  drawCellBox();
  addAxes();

  if (zoom || state.dirtyZoom) {
    state.viewer.zoomTo();
    state.dirtyZoom = false;
  }
  state.viewer.render();
  updateLabels();
  updateStats();
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
}

function loadStructure(text, name = 'structure.xyz', format = 'xyz') {
  const normalizedFormat = format === 'auto' ? detectFormat(name) : format;
  state.structure = {
    data: text,
    name,
    format: normalizedFormat,
    atoms: parseStructureAtomCount(text, normalizedFormat),
    baseData: text
  };
  state.dirtyZoom = true;
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
  return {
    id: state.nextLayerId,
    name: options.name || `${roleLabel(role)}.cube`,
    role,
    data: text,
    visible: options.visible !== false,
    mode: options.mode || els.surfaceMode.value || 'signed',
    isovalue: toNumber(options.isovalue, toNumber(els.isoValue.value, defaults.isovalue)),
    opacity: clamp(toNumber(options.opacity, toNumber(els.surfaceOpacity.value, 0.68)), 0.05, 1),
    positiveColor: options.positiveColor || options.color || els.positiveColor.value || defaults.positive,
    negativeColor: options.negativeColor || els.negativeColor.value || defaults.negative,
    colorMode: options.colorMode || 'solid',
    colorLayerId: options.colorLayerId || '',
    gradient: options.gradient || 'rwb',
    colorMin: toNumber(options.colorMin, -0.05),
    colorMax: toNumber(options.colorMax, 0.05),
    stats: parseCubeMetadata(text)
  };
}

function addLayer(text, options = {}) {
  const layer = layerFromCube(text, options);
  state.nextLayerId += 1;
  state.layers.push(layer);
  state.dirtyZoom = true;
  renderLayerList();
  updateLayerSelectors();
  setStatus('Cube loaded');
  renderScene(true);
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
  if (structureEntry) {
    const structureData = await loadTextFromManifestEntry(structureEntry, baseUrl);
    loadStructure(
      structureData,
      structureEntry.name || structureEntry.path || structureEntry.url || 'structure',
      structureEntry.format || detectFormat(structureEntry.name || structureEntry.path || structureEntry.url)
    );
  }

  const layerEntries = manifest.cubes || manifest.layers || [];
  if (manifest.replaceLayers !== false) {
    state.layers = [];
    state.nextLayerId = 1;
  }

  for (const entry of layerEntries) {
    const cubeData = await loadTextFromManifestEntry(entry, baseUrl);
    const role = entry.role || entry.kind || 'custom';
    addLayer(cubeData, {
      ...entry,
      role,
      name: entry.name || entry.path || entry.url || `${roleLabel(role)}.cube`
    });
  }

  renderLayerList();
  renderScene(true);
  setStatus('Manifest loaded');
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

function drawHeatmap(title, matrix, colorscale, zmin = null, zmax = null) {
  if (!window.Plotly) {
    setStatus('Plotly missing', false);
    return;
  }
  showPlotPanel(true);
  const trace = {
    type: 'heatmap',
    z: matrix,
    colorscale,
    colorbar: { thickness: 14 }
  };
  if (Number.isFinite(zmin)) trace.zmin = zmin;
  if (Number.isFinite(zmax)) trace.zmax = zmax;
  Plotly.react(els.plotView, [trace], plotLayout(title), { responsive: true, displaylogo: false });
}

function drawCurve(title, x, y) {
  if (!window.Plotly) {
    setStatus('Plotly missing', false);
    return;
  }
  showPlotPanel(true);
  Plotly.react(els.plotView, [{
    type: 'scatter',
    mode: 'lines',
    x,
    y,
    line: { color: '#14796f', width: 2.5 }
  }], plotLayout(title), { responsive: true, displaylogo: false });
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

function drawSelectedSlice() {
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
  drawHeatmap(
    `${layer.name} · ${label}`,
    matrix,
    els.sliceColormap.value,
    optionalNumber(els.sliceMin.value),
    optionalNumber(els.sliceMax.value)
  );
  setStatus('Slice drawn');
}

function parseCsv(text) {
  return text.trim().split(/\r?\n/).map((line) => line.split(/,|\s+/).filter(Boolean).map(Number));
}

function drawPlotText(text, name) {
  try {
    if (/\.json$/i.test(name)) {
      const data = JSON.parse(text);
      if (data.z) drawHeatmap(data.title || name, data.z, data.colorscale || els.plotColormap.value);
      else drawCurve(data.title || name, data.x || data.y.map((_, index) => index), data.y);
      setStatus('Plot loaded');
      return;
    }

    const rows = parseCsv(text).filter((row) => row.every(Number.isFinite));
    if (!rows.length) throw new Error('empty plot data');
    if (els.plotType.value === 'heatmap') {
      drawHeatmap(name, rows, els.plotColormap.value);
    } else {
      const x = rows.map((row, index) => row.length > 1 ? row[0] : index);
      const y = rows.map((row) => row.length > 1 ? row[1] : row[0]);
      drawCurve(name, x, y);
    }
    setStatus('Plot loaded');
  } catch (error) {
    console.error(error);
    setStatus('Plot error', false);
  }
}

function sampleCurve() {
  const x = [];
  const y = [];
  for (let i = 0; i <= 240; i += 1) {
    const value = -6 + i * 12 / 240;
    x.push(value);
    y.push(Math.sin(value) * Math.exp(-Math.abs(value) / 4) + 0.15 * Math.cos(3 * value));
  }
  drawCurve('Sample line profile', x, y);
  setStatus('Curve drawn');
}

function sampleMap() {
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
  drawHeatmap('Sample filled map', matrix, els.plotColormap.value);
  setStatus('Map drawn');
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
  if (action === 'role') layer.role = control.value;
  if (action === 'mode') layer.mode = control.value;
  if (action === 'isovalue') layer.isovalue = Math.abs(toNumber(control.value, layer.isovalue));
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

function applyMultiwfnGuiMode(gui) {
  const entry = String(gui.entry || '').toLowerCase();
  const guiMode = Number(gui.guiMode);
  if (entry.includes('drawplane') || guiMode === 2) activateTab('plots');
  else if (entry.includes('drawisosur') || guiMode === 3) activateTab('layers');
  else if (entry.includes('setbox') || entry.includes('mini') || guiMode === 7) activateTab('periodic');
  else if (entry.includes('drawmol') || guiMode === 1) activateTab('scene');
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
    els.showAxes,
    els.ambientOcclusion,
    els.outline,
    els.spin,
    els.background,
    els.surfaceQuality,
    els.aoStrength,
    els.outlineWidth
  ].forEach((el) => el.addEventListener('input', () => renderScene(false)));

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
    plotPanel: byId('plot-panel'),
    plotView: byId('plot-view'),
    status: byId('status'),
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
    await loadManifestText(await response.text(), resolved);
    return true;
  } catch (error) {
    console.error(error);
    setStatus('Manifest URL error', false);
    return false;
  }
}

async function init() {
  cacheElements();
  if (!window.$3Dmol) {
    setStatus('3Dmol missing', false);
    return;
  }

  state.viewer = $3Dmol.createViewer(els.viewer, {
    backgroundColor: backgrounds.studio.viewer,
    antialias: true
  });

  bindEvents();
  renderLayerList();
  const loadedFromQuery = await loadManifestFromQuery();
  if (!loadedFromQuery) loadSampleScene();
}

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('resize', () => {
  if (!state.viewer) return;
  state.viewer.resize();
  state.viewer.render();
});
