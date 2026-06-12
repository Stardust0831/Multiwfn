# Build Notes

## Current build state

The upstream Makefile still defaults to Intel Fortran:

```sh
FC=ifort
OPT=-O2 -qopenmp ... -mkl -static-intel ...
```

Machine-local overrides can be placed in `Makefile.local`. This file is loaded
by the Makefile if present, is ignored by Git, and is intended for compiler,
BLAS, DISLIN, or local GNU-prefix paths that should not be committed. Start from:

```sh
cp Makefile.local.example Makefile.local
```

The first VMD bridge change adds `vmd_bridge.o` to the existing Makefile. A
dry-run confirms the new module is compiled after `define.o` and before modules
that use it. It intentionally does not depend on `util.o`, keeping the bridge's
Fortran boundary limited to global settings from `define`.

The noGUI target now has a separate object entry point:

- `objects_common` contains the numerical and text-mode sources shared by both
  variants.
- `GUI` still links the real `GUI.o`, `mouse_rotate.o`, `xlib.o`, and DISLIN
  library path.
- `noGUI` links `noGUI/GUI_empty.o`, `noGUI/dislin_mod_empty.o`,
  `noGUI/dislin_d_empty.o`, and `noGUI/mouse_rotate_empty.o` instead of the real
  GUI/xlib/DISLIN module implementation.

Verified locally:

```sh
git diff --check
make -n noGUI
make -n GUI
tools/audit-nogui-build.sh
```

The current `make -n noGUI` output no longer contains compile steps for
`GUI.f90`, `mouse_rotate.f90`, `ext/xlib.f90`, or the real `dislin_d.f90`.
`tools/audit-nogui-build.sh` keeps this boundary under automation by checking
that the noGUI dry-run uses the noGUI stub sources and does not link GUI, X11,
OpenGL, or DISLIN objects/libraries.

Verified locally after preparing `.build-env/gnu`:

```sh
.build-env/gnu/bin/make clean
.build-env/gnu/bin/make gnu-noGUI
.build-env/gnu/bin/make gnu-noGUI-smoke
```

The same noGUI build and smoke test can be run via:

```sh
tools/gnu-build.sh noGUI
tools/gnu-build.sh smoke
tools/gnu-build.sh vmd-smoke
tools/gnu-build.sh doctor
```

The wrapper defaults to the local conda-forge prefix, but honors `GNU_PREFIX`,
`FC_GNU`, `CC_GNU`, `MAKE_GNU`, and `LIB_noGUI_GNU`. Relative tool paths are
resolved from the repository root, matching the rest of the local build
environment. This keeps compiler and BLAS experiments inside the source tree
without editing global shell startup files.

For refactor work, use the wrapper below before committing:

```sh
tools/verify-refactor.sh env
tools/verify-refactor.sh quick
tools/verify-refactor.sh full
```

`env` runs the read-only GNU build environment doctor. `quick` runs
`git diff --check`, the environment doctor, ignore-rule audit, helper-script
mode/shebang audit, the noGUI build-boundary audit, VMD export audits, the narrow
VMD path-doctor smoke test, the VMD bridge smoke test under default smoke
settings, and `tools/audit-smoke-residue.sh quick` to check that no default
`.build-env/nogui-build-audit.*`, `.build-env/vmd-doctor-smoke.*`, or
`.build-env/vmd-bridge-smoke.*` directory was left behind. `full` also runs the
GNU noGUI smoke test and then uses `tools/audit-smoke-residue.sh full` to check
that root `*.o`, root `*.mod`, `noGUI/*.o`, and known smoke-driven export files
such as `he_minimal.chg` and `atmpopdcp.txt` were not left behind. The full
wrapper also checks that `settings.ini` has the same checksum before and after
the smoke test. This prevents the smoke target from silently leaving Multiwfn's
`lastfile` update or user-facing analysis outputs in the working tree.

The GNU noGUI build links successfully with local conda-forge GFortran 15.2.0
and OpenBLAS. The `gnu-noGUI-smoke` Makefile target delegates the runtime checks
to `tools/gnu-nogui-smoke.sh` after rebuilding the binary, while preserving the
same `SMOKE_*`, `GNU_PREFIX`, and `EXE_noGUI` override points for local
debugging. The smoke script runs seven non-interactive fixtures: a three-atom
water XYZ structure load, a real XYZ structure export that generates a VMD scene
through the main program's `xyz` command, a minimal water cube grid load, a real
cube export through the grid-data processing menu that generates a VMD scene, a
minimal `.mwfn` wavefunction point-property calculation, and a minimal `.mwfn`
Mulliken population analysis, and a `.mwfn` electron-density grid calculation
that exports `density.cub` and its VMD scene from the spatial-region menu. The
structure and cube load
fixtures must reach the main menu with status 0; the VMD structure-export
fixture must write the exported XYZ file, write `<exported.xyz>.vmd.tcl`, and
honor `-vmdrun -vmdpath none` without trying to launch VMD; the VMD cube-export
fixture must enter `Process grid data`, write the exported cube file, write
`<exported.cub>.vmd.tcl`, and generate positive and negative isosurface
representations. The wavefunction grid-export fixture must calculate electron
density on a small 3x3x3 grid, write `density.cub`, generate
`density.cub.vmd.tcl`, and keep `vmdpath=none` non-launching. When `tclsh` is
available, those end-to-end generated VMD scenes are also sourced with stubbed
VMD commands by
`tools/vmd-scene-source-check.sh` from a temporary working directory, and their
`mol new` data paths must resolve to existing exported files. The point-property
fixture must print representative electron-density, kinetic-energy, and
orbital-value lines; the Mulliken fixture must print basis-function population,
atom population, and zero net charge for the helium fixture. The smoke target
restores `settings.ini` after the run because Multiwfn updates `lastfile` during
normal startup. The full verification wrapper checks that restoration worked by
comparing `settings.ini` before and after the smoke test. The smoke test reports
an IEEE floating-point exception flag note at shutdown; this known note is
allowed by the smoke target, while any other stderr output causes the smoke test
to fail.

All generated compiler packages, module files, smoke logs, temporary build
artifacts, exported visualization files, and machine-local Makefile overrides
should stay ignored by Git. `tools/audit-ignore-rules.sh` keeps the key ignore
patterns under the quick verification gate.

The GNU noGUI path now writes `.mod` files to `.build-env/gnu-mod` and object
files to `.build-env/gnu-obj`. After `gnu-noGUI-smoke`, the source root should
contain `Multiwfn_noGUI` but no root `*.o`, root `*.mod`, `noGUI/*.o`, or known
smoke-driven export files such as `he_minimal.chg`, `atmpopdcp.txt`,
`density.cub`, or `density.cub.vmd.tcl`. The normal Intel-oriented object names
remain the default when `OBJ_DIR` is not set; `gnu-noGUI` passes
`OBJ_DIR=$(GNU_OBJ_DIR)` only to its noGUI sub-build.

`tools/gnu-build.sh clean` runs the GNU-specific `gnu-clean` Makefile target. It
removes normal Multiwfn build outputs, `.build-env/gnu-mod`,
`.build-env/gnu-obj`, `.build-env/smoke`, and temporary
`.build-env/nogui-build-audit.*` and
`.build-env/vmd-bridge-smoke.*`, and `.build-env/vmd-doctor-smoke.*`
directories. It intentionally keeps
`.build-env/gnu` and `.build-env/pkgs` so cleaning build residue does not remove
the local compiler environment or package cache.

The VMD bridge has a narrower smoke test that compiles just `define.f90`,
`vmd_bridge.f90`, and `tools/vmd_bridge_smoke.f90`. This caught and removed an
unnecessary dependency from `vmd_bridge` to the large `util` module.

Not verified locally:

```sh
make GUI
```

Reason: the GUI path still depends on DISLIN/Motif/X11/OpenGL and the original
Intel-oriented flags.

## Next build refactor targets

1. Keep the current Intel build as the reference path.
2. Continue separating build outputs by variant so future GUI/GNU combinations
   can use independent object and module directories without colliding.
3. Make compiler and BLAS/OpenMP choices easier to override without editing the
   Makefile.
4. Avoid requiring DISLIN/Motif for workflows that use VMD as the visualization
   backend.
5. Add broader non-interactive fixtures for representative wavefunction-derived
   analyses beyond the current minimal point, population, and density-grid
   smoke tests.
