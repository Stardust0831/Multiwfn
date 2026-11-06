# Isosurface sampling and PNG export

Cube files and native volumes use **Original grid** by default. A resource
budget admits or rejects the requested geometry; it never selects resolution.
The source values, units, origin, lattice and isovalue are unchanged.

The surface sampling bar offers **Preview (500k samples)** explicitly and shows
source → prepared dimensions. Preview caps each prepared grid at 500,000 samples
using the existing endpoint-aligned display sampler. It can lose small features.
It is not a new scientific calculation or an interpolation of higher accuracy.

PNG saving temporarily selects Original grid, refreshes resource admission and
waits for every requested surface, including both signs and all visible Reps.
It also waits for borrowed periodic meshes to update. Any extraction failure
aborts the export; increasing image size never substitutes for source geometry.
The previous display choice is restored after success or failure.

## Resource admission

The native and standalone workflow hosts expose an authenticated read-only
`GET /api/geometry-budget?source_bytes=N` endpoint. It reuses the existing
available-memory/cgroup reserve and
`MULTIWFN_MATTERVIZ_MAX_ACTIVE_VOLUME_BYTES` policy. Retained native datasets,
plots and frontend source buffers are deducted before geometry is admitted.

A browser without a native host uses a conservative display pool: one eighth of
reported device memory, capped at 512 MiB, or 128 MiB when that report is absent.
Where available, one quarter of remaining JavaScript heap further limits the
pool. Source buffers are deducted and shared views counted once. These are
admission estimates, not measurements of process peak memory or free GPU VRAM.
The fallback is independent of sampling quality and may refuse a grid that
would fit on a larger machine.

Reps divide the geometry pool between visible volume representations. Each
renderer accounts for its resident signed/layer meshes, prepared grids,
preflight scratch and ordinary-buffer Worker copies. Immutable input requests
keep the original array intact on rejection, cancellation or Worker failure.
The library's older destructive-transfer request remains available to owners of
disposable grids. Source grids shared by multiple Reps are never released when
one representation unmounts.

## Periodic and expanded views

Unit source grids go directly to the existing finite/periodic marching cubes.
Ordinary periodic Reps borrow that mesh and translate/clip it without resampling
the field. In the source editor, fractional ranges, tiling and halos use the
existing endpoint-aligned sampler at source voxel density. Their prepared point
counts include the finite window's endpoints and can exceed source dimensions.
The temporary allocation is checked before sampling; insufficient resources
produce an error rather than silently capping the expanded grid. Preview applies
its explicit cap to the same physical bounds.

## Validation

`pnpm test` covers both input formats, signed mesh parity, physical placement,
grids around 500k and at 4,096,000 points, thin axes, periodic ranges/halos,
temporary-memory rejection, source-buffer survival and multiple consumers.
`pnpm test:volume-quality` runs the production application in Chromium with
real Workers and WebGL, using equivalent Cube/binary fields above one million
samples. It checks preview transitions, signed geometry at two PNG sizes,
rejection/retry and duplicate Reps. PNGs and mesh summaries are CI artifacts.
Rust tests cover host admission, exhausted budgets and endpoint validation.

The vendor patch replays from the retained `r25.freq1` archive; the Python vendor
test compares every resulting package file. No computational Fortran, `ext/`,
`libreta_hybrid/`, ordinary noGUI build or runtime dependency changes are needed.
Native WebView/GPU validation remains a separate platform check; headless
Chromium does not establish native frame rate or peak-memory requirements.
