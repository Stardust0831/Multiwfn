# Linux Optimization Experiments

The `perf/linux-optimization` branch is used for CI-only Linux compiler and
optimization experiments. It does not change the main release workflow.

The workflow builds several Linux variants in GitHub Actions, runs noGUI smoke
tests, records dynamic library and symbol information, and runs an ELF cube
benchmark against `phenanthrene.fch`.

Current experiment goals:

- compare Rocky Linux 8 GCC 8 baseline builds with selected hot-source `-O3`;
- test Rocky Linux 8 `gcc-toolset-12` while preserving a glibc 2.28 baseline;
- keep an Ubuntu 24.04 GCC 13 fast build as a non-compatible performance
  reference.

Results are committed back under `ci-results/linux-optimization/<run-id>/`.
After a 160^3 debug pass, promising variants are rerun with the full 300^3 ELF
grid to confirm the performance delta on the heavy workload.
