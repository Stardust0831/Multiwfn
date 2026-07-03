# Functional Test Notes

The GitHub Actions build runs `tests/functional/run_nogui_tests.sh` against the
freshly built noGUI executable on Linux, macOS, and Windows. The workflow also
packages release candidates inside the platform build jobs and tests those
packages before uploading artifacts.

Linux package testing is intentionally done in a clean `ubuntu:24.04` container
after extracting the release tarball. The container test does not install
BLAS/LAPACK, so it verifies that the Linux package carries the runtime math and
Fortran libraries it needs, rather than accidentally relying on the development
runner.

Windows package testing extracts the release zip in a normal PowerShell step
outside the MSYS2 shell and removes MSYS2 paths from `PATH` before running a
smoke test. The workflow also checks the PE import table and fails if compiler
or math DLLs such as `libgfortran-5.dll`, `libquadmath`, `libgcc_s`,
`libwinpthread`, or `libopenblas` remain as external dependencies.

The tests intentionally use tiny text fixtures generated at runtime:

- `water.xyz` verifies geometry-only input loading and the structure analysis
  path `26 -> 1`. Assertions cover formula parsing, molecular mass, geometry
  center, and min/max interatomic distances.
- `tiny.cub` verifies Gaussian cube loading, grid statistics, and cube export
  through the process-grid-data path `13 -> 0`.

These are regression/smoke tests rather than scientific validation. They are
chosen because they exercise common noGUI workflows without DISLIN, external
quantum-chemistry programs, large reference files, or platform-specific paths.
More demanding wavefunction tests should be added later with compact public test
fixtures and numeric tolerances.
