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

Verified locally:

```sh
git diff --check
make -n noGUI
```

Not verified locally:

```sh
make noGUI
```

Reason: this environment has no `ifort`, `ifx`, or `gfortran` command available.

## Next build refactor targets

1. Keep the current Intel build as the reference path.
2. Add clearer Makefile switches for noGUI-first builds.
3. Make compiler and BLAS/OpenMP choices easier to override without editing the
   Makefile.
4. Avoid requiring DISLIN/Motif for workflows that use VMD as the visualization
   backend.

