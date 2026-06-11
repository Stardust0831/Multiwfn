# Build Notes

## Current build state

The upstream Makefile still defaults to Intel Fortran:

```sh
FC=ifort
OPT=-O2 -qopenmp ... -mkl -static-intel ...
```

The first VMD bridge change adds `vmd_bridge.o` to the existing Makefile. A
dry-run confirms the new module is compiled after `define.o` and `util.o`, and
before modules that use it.

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
```

The current `make -n noGUI` output no longer contains compile steps for
`GUI.f90`, `mouse_rotate.f90`, `ext/xlib.f90`, or the real `dislin_d.f90`.

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
```

The GNU noGUI build links successfully with local conda-forge GFortran 15.2.0
and OpenBLAS. A smoke test loads a three-atom water XYZ file and exits from the
main menu with status 0. The smoke target restores `settings.ini` after the run
because Multiwfn updates `lastfile` during normal startup. The smoke test reports
an IEEE floating-point exception flag note at shutdown; this is a runtime
validation item, not a build blocker.

The GNU noGUI path now writes `.mod` files to `.build-env/gnu-mod` and removes
root/`noGUI` object files after linking by default. After `gnu-noGUI-smoke`, the
source root should contain `Multiwfn_noGUI` but no root `*.o`, root `*.mod`, or
`noGUI/*.o` files. Full object-directory isolation remains a future Makefile
refactor because the upstream rules are still object-name based.

Not verified locally:

```sh
make GUI
```

Reason: the GUI path still depends on DISLIN/Motif/X11/OpenGL and the original
Intel-oriented flags.

## Next build refactor targets

1. Keep the current Intel build as the reference path.
2. Add real object-directory separation so GUI and noGUI builds never create
   transient `.o` files in the source root. The GNU path currently cleans them
   after linking.
3. Make compiler and BLAS/OpenMP choices easier to override without editing the
   Makefile.
4. Avoid requiring DISLIN/Motif for workflows that use VMD as the visualization
   backend.
5. Add broader non-interactive fixtures for representative wavefunction and grid
   workflows.
