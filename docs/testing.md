# Functional Test Notes

The GitHub Actions build runs `tests/functional/run_nogui_tests.sh` against the
freshly built noGUI executable on Linux, macOS, and Windows. The workflow also
packages release candidates inside the platform build jobs and tests those
packages before uploading artifacts.

Linux package testing is intentionally done in a clean Rocky Linux 8 container
after extracting the release tarball. The Linux release candidate is also built
in Rocky Linux 8 so the executable and bundled non-glibc libraries target a
glibc 2.28 baseline. The container test does not install BLAS/LAPACK, so it
verifies that the Linux package carries the runtime math and Fortran libraries
it needs, rather than accidentally relying on the development runner.

The separate Linux optimized release candidate is built on Ubuntu 22.04 with
GCC/GFortran 16 and tested after extraction in a clean Ubuntu 22.04 container.
It keeps the same noGUI functional coverage as the compatibility package, but
its purpose is performance on newer systems rather than broad old-glibc
compatibility.

Windows package testing extracts the release zip in a normal PowerShell step
outside the MSYS2 shell and removes MSYS2 paths from `PATH` before running a
smoke test. The workflow reads the PE import table and copies required
non-system MSYS2 runtime DLLs beside the executable before zipping, so missing
runtime DLLs are caught by the package test rather than hidden by the
development shell.

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
