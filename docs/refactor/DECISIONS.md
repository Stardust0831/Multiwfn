# Refactor Decisions

## 2026-06-12: VMD integration model

Decision: Use VMD as an external visualization backend, not as merged source code.

Rationale:

- The main VMD source code is governed by a restricted license that is not suitable
  for direct source fusion and redistribution without additional permission.
- The official VMD license allows separately distributed complimentary works that
  interoperate with VMD, which fits a generated-file and Tcl-scene bridge.
- Multiwfn already exports cube, PDB, XYZ, and VMD-related Tcl snippets in several
  places, so a file-and-script bridge is technically natural.
- Keeping VMD external avoids pulling its GUI/build dependency tree into Multiwfn.

Implementation implication:

- Add a small Fortran bridge module for scene script generation and optional VMD
  invocation.
- Keep low-level exporters such as `outcube` free of automatic side effects.
- Trigger VMD only from explicit menu options or command-line controlled flows.

## 2026-06-12: Build strategy

Decision: Improve the existing Makefile incrementally before adding a new build
system.

Rationale:

- The current build is tightly tuned for Intel Fortran and MKL.
- A low-risk first step is to make compiler/library selection configurable and keep
  the current behavior as the default.
- A separate CMake or fpm migration can follow after noGUI builds are reproducible.

## 2026-06-12: Cube bridge coverage boundary

Decision: Route ordinary single-dataset cube exports through the VMD bridge first
and leave multi-dataset cube files out until the bridge is dataset-aware.

Rationale:

- The current VMD scene helper assumes one scalar grid per cube and adds a simple
  positive/negative isosurface pair.
- Multi-dataset files such as `orbital.cub` need explicit dataset selection in
  VMD to avoid showing the wrong grid or generating ambiguous scenes.
- Keeping this boundary explicit preserves low-intrusion behavior while coverage
  is expanded across user-facing exports.

## 2026-06-12: Dataset-aware cube scenes

Decision: Support known multi-dataset cube files with an explicit dataset-aware
VMD scene helper instead of treating them as ordinary single-dataset cubes.

Rationale:

- VMD's `Isosurface` representation accepts a volumetric dataset index, so a
  single loaded cube can expose dataset indices `0..n-1`.
- Multiwfn's combined multiple-orbital export writes `orbital.cub` with one
  dataset per selected orbital. Loading it once and adding one representation per
  dataset keeps the bridge low-intrusion while avoiding a misleading default
  dataset-only scene.
- This keeps the earlier boundary intact for unknown multi-dataset formats:
  route them only when the exporter knows the dataset count.

## 2026-06-12: Local Makefile overrides

Decision: Add optional `Makefile.local` support for machine-local compiler and
library settings.

Rationale:

- The tracked Makefile should preserve the upstream Intel-oriented defaults.
- Local GNU, BLAS, DISLIN, or debugging paths vary by machine and should not be
  committed.
- A tracked `Makefile.local.example` gives users a discoverable starting point
  while the ignored `Makefile.local` keeps experiments inside the source folder.

## 2026-06-12: GNU noGUI as the first reproducible build path

Decision: Treat the local GNU noGUI build as the first reproducible engineering
gate, while preserving the upstream Intel-oriented defaults.

Rationale:

- The GUI build still depends on DISLIN, Motif, X11/OpenGL, and Intel-oriented
  flags; forcing that path first would slow down non-GUI bridge work.
- The noGUI target can exercise file parsing, wavefunction calculations, cube
  export, population analysis, and VMD scene generation without requiring a
  display stack.
- Keeping GNU object and module files under `.build-env/gnu-obj` and
  `.build-env/gnu-mod` avoids collisions with the original root-object Makefile
  behavior.
- A local `.build-env/gnu` prefix keeps compiler and OpenBLAS experiments inside
  this source tree instead of changing the system environment.

Implementation implication:

- `gnu-noGUI` and `gnu-noGUI-smoke` remain wrapper targets around the existing
  Makefile instead of replacing the build system.
- `tools/verify-refactor.sh full` is required before treating build/noGUI
  changes as stable.
- Smoke fixtures should cover real user-facing workflows, not only linker
  success.

## 2026-06-12: VMD scene source checks are part of the contract

Decision: Generated VMD Tcl scenes must be sourceable with stubbed VMD commands
and must resolve their `mol new` data paths from the scene location.

Rationale:

- Text grep checks catch expected lines, but they do not prove Tcl syntax or
  path resolution works when a saved scene is opened from another working
  directory.
- `vmdscenefile=auto` is most useful when the data file and scene can be moved
  together and reopened later.
- Running `tclsh` with stubbed `mol`, `display`, and `axes` commands gives a
  low-cost regression check without depending on a VMD installation.

Implementation implication:

- `tools/vmd-scene-source-check.sh` is reused by both the narrow bridge smoke
  test and the full noGUI smoke fixture.
- Narrow bridge smoke creates dummy data files and sources all generated
  structure, cube, multi-cube, and multi-dataset scenes.
- noGUI smoke sources scenes produced by the real `Multiwfn_noGUI` export paths.

## 2026-06-12: GNU tool overrides are explicit inputs

Decision: GNU wrappers and diagnostics honor `GNU_PREFIX`, `FC_GNU`, `CC_GNU`,
`MAKE_GNU`, and `LIB_noGUI_GNU` as explicit local override points.

Rationale:

- Different machines may need a different compiler, `make`, or BLAS path, but
  those choices should not require editing tracked files or shell startup files.
- The doctor should report the actual tools and link flags that the wrappers
  will use, not only the default conda-forge prefix.
- The VMD bridge smoke test should use the same Fortran compiler override as the
  noGUI build.

Implementation implication:

- Relative tool override paths are interpreted relative to the repository root
  by wrapper scripts.
- If `LIB_noGUI_GNU` is overridden, the doctor reports the override and skips
  the default OpenBLAS file check under `GNU_PREFIX/lib`.
- `Makefile.local.example` documents only real override variables.
