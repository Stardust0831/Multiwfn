# Cross-Platform Build Notes

This repository keeps the original `Makefile` unchanged for the upstream
Intel/Linux workflow and adds a minimal CMake path for reproducible noGUI
builds.

## Supported CMake Target

The CMake build currently targets `Multiwfn_noGUI` only. This avoids DISLIN,
Motif, X11, and OpenGL so CI can build on Linux, macOS, and Windows with GNU
Fortran.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
```

The GUI executable is intentionally not wired into CMake yet. Use the original
`Makefile` for the upstream GUI build until the GUI dependency boundary is
handled separately.

## Optional Features

- `MULTIWFN_WITH_OPENMP=ON` enables OpenMP when CMake can find compiler support.
- `MULTIWFN_WITH_FD=ON` enables fractional-derivative support and requires
  GMP, FLINT, and ARB where applicable.

The default CI build leaves fractional-derivative support off.
