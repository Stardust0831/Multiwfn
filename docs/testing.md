# Functional Test Notes

The GitHub Actions build runs `tests/functional/run_nogui_tests.sh` against the
freshly built noGUI executable on Linux, macOS, and Windows.

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
