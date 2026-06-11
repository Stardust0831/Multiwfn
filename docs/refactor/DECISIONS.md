# Refactor Decisions

## 2026-06-12: VMD integration model

Decision: Use VMD as an external visualization backend, not as merged source code.

Rationale:

- The main VMD source code is governed by a restricted license that is not suitable
  for direct source fusion and redistribution without additional permission.
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

