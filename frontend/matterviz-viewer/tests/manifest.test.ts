import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cube_entries,
  display_range,
  manifest_url,
  resolve_entry_url,
  type ManifestEntry,
  type MultiwfnManifest,
} from '../src/manifest.ts'

const entry = (path: string, name: string): ManifestEntry => ({ path, name })

function withWindow<T>(href: string, callback: () => T): T {
  const previous = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { href } },
  })
  try {
    return callback()
  } finally {
    if (previous === undefined) {
      delete (globalThis as { window?: unknown }).window
    } else {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: previous })
    }
  }
}

test('resolves an explicit manifest query URL relative to the page', () => {
  const resolved = withWindow(
    'https://viewer.example/workbench/index.html?manifest=../session/manifest.json',
    () => manifest_url(),
  )
  assert.equal(resolved.href, 'https://viewer.example/session/manifest.json')
  assert.equal(resolved.pathname, '/session/manifest.json')
})

test('uses the session manifest fallback when query parameter is absent', () => {
  const resolved = withWindow(
    'https://viewer.example/workbench/index.html?mode=periodic',
    () => manifest_url(),
  )
  assert.equal(resolved.href, 'https://viewer.example/session/manifest.json')
})

test('resolves relative, root-relative, and absolute entry paths', () => {
  const base = new URL('https://viewer.example/session/')
  assert.equal(resolve_entry_url(entry('density.cube', 'density'), base).href,
    'https://viewer.example/session/density.cube')
  assert.equal(resolve_entry_url(entry('/shared/structure.xyz', 'structure'), base).href,
    'https://viewer.example/shared/structure.xyz')
  assert.equal(resolve_entry_url(entry('https://cdn.example/density.cube', 'remote'), base).href,
    'https://cdn.example/density.cube')
})

test('prefers cubes over legacy layers, including an explicitly empty cube list', () => {
  const cubes = [entry('a.cube', 'cube')]
  const layers = [entry('b.cube', 'layer')]
  assert.deepEqual(cube_entries({ cubes, layers }), cubes)
  assert.deepEqual(cube_entries({ cubes: [], layers }), [])
  assert.deepEqual(cube_entries({ layers }), layers)
  assert.deepEqual(cube_entries({}), [])
})

test('ignores malformed collection fields while preserving a valid fallback', () => {
  const layers = [entry('legacy.cube', 'layer')]
  const malformed = { cubes: { path: 'not-an-array' }, layers } as unknown as MultiwfnManifest
  assert.deepEqual(cube_entries(malformed), layers)
  assert.deepEqual(cube_entries(null as unknown as MultiwfnManifest), [])
})

test('returns no periodic display range unless periodic mode is explicitly enabled', () => {
  assert.equal(display_range({}), undefined)
  assert.equal(display_range({ periodic: { enabled: false } }), undefined)
  assert.equal(
    display_range({ periodic: { enabled: 'true' } } as unknown as MultiwfnManifest),
    undefined,
  )
})

test('normalizes missing periodic bounds and preserves non-integer ranges', () => {
  assert.deepEqual(display_range({ periodic: { enabled: true } }), [[0, 1], [0, 1], [0, 1]])
  assert.deepEqual(
    display_range({
      periodic: {
        enabled: true,
        ranges: {
          a: [0.25, 1.75],
          b: [-1.5, 2.25],
          c: [0.125, 0.875],
        },
      },
    }),
    [[0.25, 1.75], [-1.5, 2.25], [0.125, 0.875]],
  )
})

test('falls back per bound for malformed periodic range fields', () => {
  const malformed = {
    periodic: {
      enabled: true,
      ranges: {
        a: ['not-a-number', 0.75],
        b: [null, Number.POSITIVE_INFINITY],
        c: [0.5],
      },
    },
  } as unknown as MultiwfnManifest
  assert.deepEqual(display_range(malformed), [[0, 0.75], [0, 1], [0.5, 1]])
})

test('accepts optional Multiwfn GUI and bond-analysis capability fields', () => {
  const manifest: MultiwfnManifest = {
    multiwfnGui: {
      entry: 'drawisosurgui',
      guiMode: 3,
      allowSetStyle: 2,
      state: {
        orbitalCount: 12,
        homoIndex: 6,
        showMolecule: true,
        showBothSign: false,
        sur_value: 0.5,
        sur_value_orb: 0.02,
        planeBounds: [-1.5, 1.25, 0, 2.5, 0.125, 3.75],
      },
    },
    bondAnalysis: {
      periodicSupported: false,
      openShell: true,
      methods: {
        mayer: { available: true },
        fbo: { available: false, reason: 'GTF wavefunction information is unavailable' },
      },
    },
  }
  assert.equal(manifest.multiwfnGui?.state?.homoIndex, 6)
  assert.equal(manifest.bondAnalysis?.methods?.fbo?.available, false)
})

test('allows optional sections to be absent without changing helper defaults', () => {
  const manifest: MultiwfnManifest = { structure: null, multiwfnGui: {}, bondAnalysis: {} }
  assert.deepEqual(cube_entries(manifest), [])
  assert.equal(display_range(manifest), undefined)
})

test('accepts direct and future API-backed analysis dataset descriptors', () => {
  const manifest: MultiwfnManifest = {
    analysis: {
      capabilities: {
        dos: { available: true, format: 'multiwfn-orbitals', features: { tdos: true, pdos: true } },
        band: { available: false, reason: 'Not generated' },
      },
      primaryDos: { path: 'analysis_primary_dos.json', kind: 'dos', pdos: true },
      datasets: [{ dataset: 'external-1', kind: 'dos' }],
    },
  }
  assert.equal(manifest.analysis?.primaryDos?.path, 'analysis_primary_dos.json')
  assert.equal(manifest.analysis?.capabilities?.dos?.features?.pdos, true)
  assert.equal(manifest.analysis?.datasets?.[0]?.dataset, 'external-1')
})
