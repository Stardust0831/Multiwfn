# Performance Benchmarks

`tests/perf/benchmark_multiwfn.py` compares Linux and Windows binaries across:

- the official Multiwfn 2026.6.2 binary package from `sobereva.com`;
- `v2026.6.2-nogui.3`, the project build before the Linux glibc 2.28 baseline change;
- `v2026.6.2-nogui.4`, the current baseline build.

The benchmark is intentionally manual and is not part of ordinary push CI. It
downloads binary packages and official example inputs, runs identical menu
scripts, records elapsed wall time, and checks result consistency against the
official binary.

## Suites

- `smoke`: small grids for quick validation of the harness.
- `standard`: default practical comparison size.
- `full`: larger grids for less noisy timing on dedicated runners.

Covered workload categories:

- `blas-lapack`: Mayer bond order analysis on `phenanthrene.fch`, exercising
  matrix-heavy paths that call BLAS-backed multiplication.
- `parallel-grid`: density and ELF cube generation from `phenanthrene.fch`,
  run with one and multiple Multiwfn threads.
- `real-space-grid-io`: synthetic cube load, grid processing, and cube export.
- `geometry-baseline`: C60 structural analysis in `standard` and `full` suites.

The grid tests compare cube point count, min, max, sum, and absolute sum within
a numeric tolerance. Console numeric digests are also recorded, but differences
there are warnings when cube statistics match because banners, paths, and timing
lines differ between official and project builds.

## GitHub Actions

Run **Actions -> performance -> Run workflow**.

Defaults:

```text
suite=smoke
repeats=2
versions=official,project-prebaseline,project-current
```

Artifacts contain:

- `summary.md`
- `results.csv`
- `results.json`
- `comparisons.json`
- per-version/per-case stdout, stderr, and generated outputs

## Local Run

Linux:

```bash
python3 tests/perf/benchmark_multiwfn.py \
  --suite smoke \
  --repeats 1 \
  --versions official,project-prebaseline,project-current \
  --work-dir perf-work \
  --output-dir perf-results
```

Windows requires `python` and `7z` on `PATH`, because the official Windows
binary package is distributed as `Multiwfn_2026.6.2_bin_Win64.7z`.

## Interpreting Results

Use medians rather than individual repeat timings. GitHub-hosted runners are
noisy, so a regression should be confirmed with `standard` or `full` and more
repeats before changing compiler flags.

The benchmark is for comparing distribution choices, not for replacing
scientific regression tests. Result consistency failures should be investigated
before relying on timing differences.
