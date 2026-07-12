(function initAnalysisWorker(root) {
  'use strict';

  const PI = Math.PI;

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function linspace(start, end, count) {
    const size = Math.max(2, Math.round(count));
    const step = (end - start) / (size - 1);
    return Array.from({ length: size }, (_, index) => start + index * step);
  }

  function broaden(x, centers, strengths, fwhm, mode = 'gaussian', areaScale = 1) {
    const width = Math.max(1e-9, finite(fwhm, 1));
    const result = new Array(x.length).fill(0);
    if (mode === 'lorentzian') {
      const half = width / 2;
      const factor = areaScale * half / PI;
      centers.forEach((center, index) => {
        const amplitude = finite(strengths[index], 0) * factor;
        for (let point = 0; point < x.length; point += 1) {
          const delta = x[point] - center;
          result[point] += amplitude / (delta * delta + half * half);
        }
      });
      return result;
    }
    const sigma = width / (2 * Math.sqrt(2 * Math.log(2)));
    const factor = areaScale / (sigma * Math.sqrt(2 * PI));
    const denominator = 2 * sigma * sigma;
    centers.forEach((center, index) => {
      const amplitude = finite(strengths[index], 0) * factor;
      for (let point = 0; point < x.length; point += 1) {
        const delta = x[point] - center;
        result[point] += amplitude * Math.exp(-(delta * delta) / denominator);
      }
    });
    return result;
  }

  function autoRange(values, padding) {
    const valid = values.map(Number).filter(Number.isFinite);
    if (!valid.length) return [-1, 1];
    const minimum = Math.min(...valid);
    const maximum = Math.max(...valid);
    const span = Math.max(maximum - minimum, Math.max(1, Math.abs(maximum)) * 0.05);
    return [minimum - span * padding, maximum + span * padding];
  }

  function lineTrace(name, x, y, color, extra = {}) {
    return {
      type: 'scatter', mode: 'lines', name, x, y,
      line: { color, width: 2.2 }, hovertemplate: `%{x:.4f}<br>${name}: %{y:.5g}<extra></extra>`,
      ...extra
    };
  }

  function stickTrace(name, centers, strengths, color, extra = {}) {
    const x = [];
    const y = [];
    centers.forEach((center, index) => {
      x.push(center, center, null);
      y.push(0, finite(strengths[index], 0), null);
    });
    return {
      type: 'scatter', mode: 'lines', name, x, y,
      line: { color, width: 1 }, hovertemplate: `%{x:.4f}<br>${name}: %{y:.5g}<extra></extra>`,
      ...extra
    };
  }

  const colors = ['#14796f', '#d95778', '#3978b8', '#b37622', '#7451a6', '#258b94', '#666666', '#a84731'];

  function processDos(data, settings = {}) {
    const sampled = Array.isArray(data.series?.sampled) ? data.series.sampled : [];
    const projections = Array.isArray(data.series?.projections) ? data.series.projections : [];
    if (sampled.length) {
      const traces = sampled.map((series, index) => lineTrace(series.label || series.id, series.energy, series.value, colors[index % colors.length]));
      const projectionMode = settings.projectionMode || 'none';
      if (projectionMode !== 'none' && projections.length) {
        const grouped = new Map();
        projections.forEach((series) => {
          const parts = [];
          if (projectionMode === 'element' || projectionMode === 'element-orbital') parts.push(series.element || 'Unknown');
          if (projectionMode === 'orbital' || projectionMode === 'element-orbital') parts.push(series.orbital || 'all');
          if (series.spin && series.spin !== 'total') parts.push(series.spin);
          const key = parts.join(' ') || series.label;
          if (!grouped.has(key)) grouped.set(key, new Array(series.value.length).fill(0));
          const values = grouped.get(key);
          series.value.forEach((value, index) => { values[index] += finite(value); });
        });
        [...grouped.entries()].forEach(([label, values], index) => {
          traces.push(lineTrace(label, projections[0].energy, values, colors[(index + sampled.length) % colors.length]));
        });
      }
      return {
        traces,
        xTitle: `${data.axes?.x?.label || 'Energy'} (${data.axes?.x?.unit || 'eV'})`,
        yTitle: `${data.axes?.y?.label || 'Density of states'} (${data.axes?.y?.unit || 'states/eV'})`,
        csv: traces.flatMap((trace) => trace.x.map((value, index) => [trace.name, value, trace.y[index]]))
      };
    }

    const levels = Array.isArray(data.series?.levels) ? data.series.levels : [];
    const energies = levels.map((level) => finite(level.energy));
    const fwhm = Math.max(0.001, finite(settings.fwhm, data.controls?.defaultFwhm || 0.35));
    const range = settings.range && settings.range.length === 2
      ? settings.range.map(Number)
      : autoRange(energies, 0.12);
    const x = linspace(Math.min(...range), Math.max(...range), finite(settings.points, 1600));
    const spinGroups = new Map();
    levels.forEach((level) => {
      const spin = level.spin || 'total';
      if (!spinGroups.has(spin)) spinGroups.set(spin, []);
      spinGroups.get(spin).push(level);
    });
    const traces = [];
    [...spinGroups.entries()].forEach(([spin, entries], index) => {
      const sign = spin === 'beta' ? -1 : 1;
      const centers = entries.map((entry) => finite(entry.energy));
      const weights = entries.map((entry) => sign * finite(entry.weight, 1));
      traces.push(lineTrace(spin === 'total' ? 'TDOS' : `TDOS ${spin}`, x,
        broaden(x, centers, weights, fwhm, settings.broadening || 'gaussian'), colors[index]));
      if (settings.showSticks !== false) traces.push(stickTrace(`${spin} levels`, centers, weights, colors[index], { visible: 'legendonly' }));
    });

    if ((settings.projectionMode || 'none') === 'element') {
      const elementGroups = new Map();
      levels.forEach((level) => {
        Object.entries(level.projections || {}).forEach(([element, weight]) => {
          const spin = level.spin || 'total';
          const key = `${element}${spin === 'total' ? '' : ` ${spin}`}`;
          if (!elementGroups.has(key)) elementGroups.set(key, { centers: [], weights: [] });
          const group = elementGroups.get(key);
          group.centers.push(finite(level.energy));
          group.weights.push(finite(weight) * (spin === 'beta' ? -1 : 1));
        });
      });
      [...elementGroups.entries()].forEach(([label, group], index) => {
        traces.push(lineTrace(label, x, broaden(x, group.centers, group.weights, fwhm,
          settings.broadening || 'gaussian'), colors[(index + 2) % colors.length]));
      });
    }
    return {
      traces,
      xTitle: `${data.axes?.x?.label || 'Energy'} (${data.axes?.x?.unit || 'eV'})`,
      yTitle: `${data.axes?.y?.label || 'Density of states'} (${data.axes?.y?.unit || 'states/eV'})`,
      csv: traces.filter((trace) => !trace.name.includes('levels')).flatMap((trace) => trace.x.map((value, index) => [trace.name, value, trace.y[index]]))
    };
  }

  function processIr(data, settings = {}) {
    const mode = settings.mode || data.controls?.defaultMode || 'harmonic';
    const allowed = new Set(settings.bandTypes || ['fundamental', 'overtone', 'combination']);
    const source = Array.isArray(data.series?.[mode]) ? data.series[mode] : [];
    const transitions = source.filter((row) => mode === 'harmonic' || allowed.has(row.bandType));
    const centers = transitions.map((row) => finite(row.frequency));
    const strengths = transitions.map((row) => finite(row.intensity));
    const fwhm = Math.max(0.001, finite(settings.fwhm, data.controls?.defaultFwhm || 8));
    const range = settings.range && settings.range.length === 2 ? settings.range.map(Number) : [0, 4000];
    const x = linspace(Math.min(...range), Math.max(...range), finite(settings.points, 3000));
    const y = broaden(x, centers, strengths, fwhm, settings.broadening || 'lorentzian', 100);
    const traces = [lineTrace(mode === 'anharmonic' ? 'Anharmonic IR' : 'Harmonic IR', x, y, '#14796f')];
    if (settings.showSticks !== false) traces.push(stickTrace('Transitions', centers, strengths, '#d95778'));
    return {
      traces,
      xTitle: 'Wavenumber (cm⁻¹)', yTitle: 'IR intensity (km/mol)', reversed: true,
      csv: transitions.map((row) => [mode, row.bandType, row.mode, row.frequency, row.intensity]),
      summary: { count: transitions.length }
    };
  }

  function processNmr(data, settings = {}) {
    const element = settings.element || 'all';
    const atoms = (data.series?.atoms || []).filter((atom) => element === 'all' || atom.element === element);
    const mode = settings.mode || 'shielding';
    const reference = finite(settings.reference, 0);
    const slope = Math.abs(finite(settings.slope, 1)) < 1e-12 ? 1 : finite(settings.slope, 1);
    const intercept = finite(settings.intercept, 0);
    const centers = atoms.map((atom) => {
      if (mode === 'shift') return reference - finite(atom.shielding);
      if (mode === 'scale') return (finite(atom.shielding) - intercept) / slope;
      return finite(atom.shielding);
    });
    const strengths = atoms.map(() => 1);
    const defaultFwhm = element === 'H' ? data.controls?.defaultFwhmHydrogen : data.controls?.defaultFwhmHeavy;
    const fwhm = Math.max(0.0001, finite(settings.fwhm, defaultFwhm || 0.2));
    const range = settings.range && settings.range.length === 2 ? settings.range.map(Number) : autoRange(centers, 0.1);
    const x = linspace(Math.min(...range), Math.max(...range), finite(settings.points, 2000));
    const y = broaden(x, centers, strengths, fwhm, 'lorentzian');
    const label = mode === 'shielding' ? 'NMR shielding' : 'NMR chemical shift';
    return {
      traces: [lineTrace(label, x, y, '#14796f'), stickTrace('Nuclei', centers, strengths, '#d95778')],
      xTitle: `${mode === 'shielding' ? 'Isotropic shielding' : 'Chemical shift'} (ppm)`,
      yTitle: 'Signal (a.u.)', reversed: mode !== 'shielding',
      csv: atoms.map((atom, index) => [atom.index, atom.element, atom.shielding, centers[index]]),
      summary: { count: atoms.length }
    };
  }

  function process(kind, data, settings) {
    if (kind === 'dos') return processDos(data, settings);
    if (kind === 'ir') return processIr(data, settings);
    if (kind === 'nmr') return processNmr(data, settings);
    throw new Error(`Unsupported worker analysis kind: ${kind}`);
  }

  const api = { broaden, processDos, processIr, processNmr, process };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.MultiwfnAnalysisWorker = api;
    if (typeof root.postMessage === 'function' && typeof root.document === 'undefined') {
      root.onmessage = (event) => {
        const { id, kind, data, settings } = event.data || {};
        try {
          root.postMessage({ id, ok: true, result: process(kind, data, settings || {}) });
        } catch (error) {
          root.postMessage({ id, ok: false, message: error?.message || String(error) });
        }
      };
    }
  }
})(typeof self !== 'undefined' ? self : globalThis);
