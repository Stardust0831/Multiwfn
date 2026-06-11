# Refactor Roadmap

This roadmap turns the current refactor direction into explicit checkpoints. It
is not a replacement for `LOG.md`; it records what should remain true as the
branch grows and what work is still worth doing next.

## Current Stable Checkpoints

- The refactor stays inside this source tree. Local packages, compiler prefixes,
  smoke fixtures, module files, and logs live under `.build-env/` or ignored
  local files.
- The original Intel-oriented Makefile defaults remain available. GNU support is
  added through local wrapper targets and overridable variables rather than a
  wholesale build-system replacement.
- The Linux noGUI build can be reproduced with the local conda-forge GNU prefix
  and OpenBLAS.
- The noGUI target uses noGUI stub sources instead of real GUI, X11, OpenGL, or
  DISLIN objects. This is guarded by `tools/audit-nogui-build.sh`.
- VMD remains an external executable. Multiwfn writes structure/cube files and
  optional VMD Tcl scenes; it does not merge or redistribute VMD source code.
- VMD bridge coverage is added at explicit user-facing export points, not inside
  low-level writers such as `outcube`.
- `tools/verify-refactor.sh quick` is the minimum pre-commit gate. `full` adds a
  GNU noGUI build/smoke test, `settings.ini` restoration check, and object
  residue check.

## Next Useful Work

1. Add representative non-interactive fixtures for real wavefunction/grid
   workflows beyond the current XYZ load smoke test.
2. Continue auditing specialized structure, cube, and non-cube visualization
   exports and route user-facing exports through VMD where the output maps
   cleanly to VMD.
3. Move more transient GNU build output into explicit object directories instead
   of cleaning root `*.o` files after linking.
4. Keep compiler and BLAS/OpenMP selection easier to override without weakening
   the original Intel build path.
5. Investigate the GFortran `IEEE_INVALID_FLAG` shutdown note with a narrow
   runtime fixture before treating it as a numerical bug.
6. Add richer VMD scene generation for labels, topology paths, arrows, critical
   points, surfaces, and per-dataset styling where Multiwfn exports enough
   semantic information.

## Boundaries

- Do not fuse VMD source into this repository without a separate license review
  and explicit permission.
- Do not move compiler setup into global shell startup files or system package
  managers for this branch.
- Do not add automatic VMD side effects to low-level writers that are also used
  for temporary/cache files.
- Do not rewrite the Fortran numerical core into another language until there
  are targeted fixtures proving the replacement preserves behavior and improves
  build, maintainability, or runtime characteristics.

## Completion Evidence To Maintain

- `tools/verify-refactor.sh quick` passes before routine commits.
- `tools/verify-refactor.sh full` passes before build-system or noGUI changes are
  considered stable.
- VMD cube and structure audit documents match their scripts in `check` mode.
- `docs/refactor/LOG.md` records meaningful implementation steps and surprises.
- `docs/refactor/DECISIONS.md` records durable architecture choices, especially
  when changing the VMD boundary, compiler strategy, or language boundary.
