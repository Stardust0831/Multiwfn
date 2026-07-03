const sampleXYZ = `3
water
O 0 0 0
H 0 0 0.96
H 0.92 0 -0.24
`;

const sampleHomoCube = `Sample HOMO cube
Generated for Multiwfn viewer
    1    0.000000    0.000000    0.000000
    3    0.450000    0.000000    0.000000
    3    0.000000    0.450000    0.000000
    3    0.000000    0.000000    0.450000
    8    0.000000    0.000000    0.000000    0.000000
  0.00000E+00  5.00000E-03  0.00000E+00  5.00000E-03  1.80000E-02  5.00000E-03
  0.00000E+00  5.00000E-03  0.00000E+00 -4.00000E-03 -1.80000E-02 -4.00000E-03
  6.00000E-03  3.00000E-02  6.00000E-03 -4.00000E-03 -1.80000E-02 -4.00000E-03
  0.00000E+00  5.00000E-03  0.00000E+00  5.00000E-03  1.80000E-02  5.00000E-03
  0.00000E+00  5.00000E-03  0.00000E+00
`;

const sampleLumoCube = `Sample LUMO cube
Generated for Multiwfn viewer
    1    0.000000    0.000000    0.000000
    3    0.450000    0.000000    0.000000
    3    0.000000    0.450000    0.000000
    3    0.000000    0.000000    0.450000
    8    0.000000    0.000000    0.000000    0.000000
  0.00000E+00 -4.00000E-03  0.00000E+00 -4.00000E-03 -1.60000E-02 -4.00000E-03
  0.00000E+00 -4.00000E-03  0.00000E+00  6.00000E-03  1.60000E-02  6.00000E-03
 -4.00000E-03 -2.60000E-02 -4.00000E-03  6.00000E-03  1.60000E-02  6.00000E-03
  0.00000E+00 -4.00000E-03  0.00000E+00 -4.00000E-03 -1.60000E-02 -4.00000E-03
  0.00000E+00 -4.00000E-03  0.00000E+00
`;

const atomicSymbols = {
  1: 'H', 2: 'He', 3: 'Li', 4: 'Be', 5: 'B', 6: 'C', 7: 'N', 8: 'O',
  9: 'F', 10: 'Ne', 11: 'Na', 12: 'Mg', 13: 'Al', 14: 'Si', 15: 'P',
  16: 'S', 17: 'Cl', 18: 'Ar', 35: 'Br', 53: 'I'
};

const orbitalStyles = {
  homo: { label: 'HOMO', positive: '#2457d6', negative: '#c8324f' },
  lumo: { label: 'LUMO', positive: '#0f8f62', negative: '#d88422' }
};

const state = {
  viewer: null,
  modelData: '',
  modelFormat: 'xyz',
  modelName: '',
  activeOrbital: 'homo',
  orbitals: {
    homo: { data: '', name: '' },
    lumo: { data: '', name: '' }
  }
};

const els = {
  viewer: document.getElementById('viewer'),
  status: document.getElementById('status'),
  modelLabel: document.getElementById('model-label'),
  cubeLabel: document.getElementById('cube-label'),
  structureFile: document.getElementById('structure-file'),
  structureFormat: document.getElementById('structure-format'),
  modelStyle: document.getElementById('model-style'),
  orbitalSlot: document.getElementById('orbital-slot'),
  cubeFile: document.getElementById('cube-file'),
  isoValue: document.getElementById('iso-value'),
  opacity: document.getElementById('surface-opacity'),
  showPositive: document.getElementById('show-positive'),
  showNegative: document.getElementById('show-negative'),
  ambientOcclusion: document.getElementById('ambient-occlusion'),
  outline: document.getElementById('outline'),
  spin: document.getElementById('spin')
};

function setStatus(text, ok = true) {
  els.status.textContent = text;
  els.status.style.color = ok ? 'var(--accent)' : 'var(--accent-2)';
}

function detectFormat(fileName, fallback) {
  const ext = fileName.split('.').pop().toLowerCase();
  if (ext === 'mol') return 'sdf';
  if (['xyz', 'pdb', 'sdf', 'mol2', 'pqr'].includes(ext)) return ext;
  return fallback || 'xyz';
}

function styleFor(value) {
  if (value === 'sphere') return { sphere: { scale: 0.32, colorscheme: 'Jmol' } };
  if (value === 'line') return { line: { colorscheme: 'Jmol', linewidth: 2 } };
  if (value === 'ballstick') {
    return {
      stick: { radius: 0.13, colorscheme: 'Jmol' },
      sphere: { scale: 0.22, colorscheme: 'Jmol' }
    };
  }
  return { stick: { radius: 0.18, colorscheme: 'Jmol' } };
}

function applyViewStyle() {
  if (typeof state.viewer.setViewStyle === 'function') {
    state.viewer.setViewStyle(els.outline.checked ? { style: 'outline', width: 0.035, color: 'black' } : {});
  }
  if (typeof state.viewer.setAmbientOcclusion === 'function') {
    state.viewer.setAmbientOcclusion({
      enabled: els.ambientOcclusion.checked,
      strength: 0.65,
      radius: 6
    });
  }
  state.viewer.spin(els.spin.checked);
}

function renderScene(zoom = false) {
  state.viewer.clear();
  applyViewStyle();

  if (state.modelData) {
    state.viewer.addModel(state.modelData, state.modelFormat);
    state.viewer.setStyle({}, styleFor(els.modelStyle.value));
  }

  const loadedOrbitals = Object.values(state.orbitals).filter((orbital) => orbital.data);
  if (loadedOrbitals.length) {
    if (!state.modelData) {
      const xyz = xyzFromCube(loadedOrbitals[0].data);
      if (xyz) {
        state.viewer.addModel(xyz, 'xyz');
        state.viewer.setStyle({}, styleFor(els.modelStyle.value));
      }
    }
    Object.entries(state.orbitals).forEach(([slot, orbital]) => {
      if (orbital.data) drawSurfaces(slot, orbital.data);
    });
  }

  if (zoom) state.viewer.zoomTo();
  state.viewer.render();
}

function drawSurfaces(slot, cubeData) {
  const iso = Math.abs(Number(els.isoValue.value) || 0.015);
  const opacity = Number(els.opacity.value) || 0.68;
  const colors = orbitalStyles[slot] || orbitalStyles.homo;
  let vol;
  try {
    vol = new $3Dmol.VolumeData(cubeData, 'cube');
  } catch (error) {
    setStatus('Cube error', false);
    return;
  }
  if (els.showPositive.checked) {
    state.viewer.addIsosurface(vol, {
      isoval: iso,
      color: colors.positive,
      opacity,
      smoothness: 8
    });
  }
  if (els.showNegative.checked) {
    state.viewer.addIsosurface(vol, {
      isoval: -iso,
      color: colors.negative,
      opacity,
      smoothness: 8
    });
  }
}

function updateOrbitalLabel() {
  const loaded = Object.entries(state.orbitals)
    .map(([slot, orbital]) => `${orbitalStyles[slot].label}: ${orbital.name || 'No cube'}`);
  els.cubeLabel.textContent = loaded.join(' · ');
}

function xyzFromCube(cubeText) {
  const lines = cubeText.split(/\r?\n/).filter(Boolean);
  if (lines.length < 7) return '';
  const atomLine = lines[2].trim().split(/\s+/);
  const atomCount = Math.abs(parseInt(atomLine[0], 10));
  const atomStart = 6;
  if (!Number.isFinite(atomCount) || lines.length < atomStart + atomCount) return '';
  const atoms = [];
  for (let i = 0; i < atomCount; i += 1) {
    const parts = lines[atomStart + i].trim().split(/\s+/);
    const atomicNumber = Math.abs(parseInt(parts[0], 10));
    const symbol = atomicSymbols[atomicNumber] || 'X';
    atoms.push(`${symbol} ${parts[2]} ${parts[3]} ${parts[4]}`);
  }
  return `${atoms.length}\nfrom cube\n${atoms.join('\n')}\n`;
}

function loadStructure(text, name, format) {
  state.modelData = text;
  state.modelName = name || 'Structure';
  state.modelFormat = format;
  els.modelLabel.textContent = `${state.modelName} · ${format.toUpperCase()}`;
  renderScene(true);
  setStatus('Loaded');
}

function loadCube(text, name, slot = state.activeOrbital) {
  const orbital = state.orbitals[slot];
  if (!orbital) return;
  orbital.data = text;
  orbital.name = name || `${orbitalStyles[slot].label}.cube`;
  updateOrbitalLabel();
  renderScene(true);
  setStatus('Loaded');
}

function clearCube(slot = state.activeOrbital) {
  const orbital = state.orbitals[slot];
  if (!orbital) return;
  orbital.data = '';
  orbital.name = '';
  updateOrbitalLabel();
  renderScene(false);
  setStatus('Ready');
}

function clearAllCubes() {
  Object.keys(state.orbitals).forEach((slot) => {
    state.orbitals[slot].data = '';
    state.orbitals[slot].name = '';
  });
  updateOrbitalLabel();
  renderScene(false);
  setStatus('Ready');
}

function readFile(file, callback) {
  const reader = new FileReader();
  reader.onload = () => callback(String(reader.result || ''), file.name);
  reader.onerror = () => setStatus('Read error', false);
  reader.readAsText(file);
}

function bindEvents() {
  els.structureFile.addEventListener('change', () => {
    const file = els.structureFile.files[0];
    if (!file) return;
    readFile(file, (text, name) => {
      const selected = els.structureFormat.value;
      loadStructure(text, name, selected === 'auto' ? detectFormat(name, 'xyz') : selected);
    });
  });

  els.cubeFile.addEventListener('change', () => {
    const file = els.cubeFile.files[0];
    if (!file) return;
    readFile(file, loadCube);
  });

  els.orbitalSlot.addEventListener('change', () => {
    state.activeOrbital = els.orbitalSlot.value;
  });

  document.getElementById('sample-xyz').addEventListener('click', () => {
    loadStructure(sampleXYZ, 'water.xyz', 'xyz');
  });

  document.getElementById('sample-homo').addEventListener('click', () => {
    state.activeOrbital = 'homo';
    els.orbitalSlot.value = 'homo';
    loadCube(sampleHomoCube, 'sample-homo.cube', 'homo');
  });

  document.getElementById('sample-lumo').addEventListener('click', () => {
    state.activeOrbital = 'lumo';
    els.orbitalSlot.value = 'lumo';
    loadCube(sampleLumoCube, 'sample-lumo.cube', 'lumo');
  });

  document.getElementById('clear-cube').addEventListener('click', () => {
    clearCube();
  });

  document.getElementById('clear-all-cubes').addEventListener('click', () => {
    clearAllCubes();
  });

  document.getElementById('reset-view').addEventListener('click', () => {
    state.viewer.zoomTo();
    state.viewer.render();
  });

  [
    els.modelStyle,
    els.isoValue,
    els.opacity,
    els.showPositive,
    els.showNegative,
    els.ambientOcclusion,
    els.outline,
    els.spin
  ].forEach((el) => el.addEventListener('input', () => renderScene(false)));
}

function init() {
  if (!window.$3Dmol) {
    setStatus('3Dmol missing', false);
    return;
  }
  state.viewer = $3Dmol.createViewer(els.viewer, {
    backgroundColor: '#edf2f4',
    antialias: true
  });
  bindEvents();
  updateOrbitalLabel();
  loadStructure(sampleXYZ, 'water.xyz', 'xyz');
}

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('resize', () => {
  if (state.viewer) {
    state.viewer.resize();
    state.viewer.render();
  }
});
