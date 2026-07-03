# Cross-Platform Build Notes

This repository keeps the original `Makefile` unchanged for the upstream
Intel/Linux workflow and adds a minimal CMake path for reproducible noGUI
builds.

## Supported CMake Target

The CMake build currently targets `Multiwfn_noGUI` only. This avoids DISLIN,
Motif, X11, and OpenGL so CI can build on Linux, macOS, and Windows with GNU
Fortran.

The repository includes the upstream Multiwfn license terms in `LICENSE.txt`.
Release assets must carry this file alongside the binaries.

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
- `MULTIWFN_WINDOWS_STATIC_LINK=ON` is enabled by default on Windows. It asks
  CMake to prefer static BLAS/LAPACK libraries and links GNU Fortran runtime
  libraries statically so the release zip does not require MSYS2/OpenBLAS DLLs
  on the user's machine.
  In the MSYS2 UCRT64 CI build, this also forces BLAS/LAPACK to
  `$MINGW_PREFIX/lib/libopenblas.a`; relying only on automatic BLAS detection
  may select the OpenBLAS import library and leave DLL dependencies.
  OpenMP is disabled for this Windows redistribution build because the GNU
  OpenMP runtime can otherwise reintroduce dynamic `libgomp`/`libwinpthread`
  dependencies.

The default CI build leaves fractional-derivative support off.
BLAS and LAPACK are required because Multiwfn calls routines such as `DGEMM`,
`DSYEV`, and `DGEEV` directly.

On Windows, CI checks the executable import table with `objdump -p` and fails
if redistributable compiler or math DLLs such as `libopenblas`,
`libgfortran`, `libgcc_s`, `libquadmath`, `libgomp`, `libwinpthread`,
`liblapack`, or `libblas` still appear.

On Linux, the release candidate package is assembled before artifact upload.
The workflow copies non-glibc libraries reported by `ldd` into a package-local
`lib/` directory and sets the executable rpath to `$ORIGIN/lib` with
`patchelf`. The tarball is then extracted and tested inside a clean
`ubuntu:24.04` container, which catches missing BLAS/LAPACK or Fortran runtime
dependencies that would be hidden on the development runner.

## 2026.6.2 noGUI Port Notes

The CMake noGUI source list should stay close to the upstream `Makefile`.
In particular, noGUI still compiles the original `GUI.f90`; it only replaces
DISLIN and mouse rotation dependencies with the upstream empty noGUI stubs.
Replacing `GUI.f90` with a smaller local stub caused the build to diverge from
the original dependency graph.

GNU Fortran preprocessing has to be selective. `define.f90` contains `_WIN32`
preprocessor branches, so global preprocessing is still required. However,
`DFTxclib.F` contains fixed-form continuation lines beginning with `#`; if CMake
preprocesses that file, gfortran reports many `invalid preprocessing directive`
errors. The CMake build therefore leaves global Fortran preprocessing on and
sets `Fortran_PREPROCESS OFF` only for `DFTxclib.F`.

The macOS CMake build maintained by digital-chemistry-laboratory also links
BLAS/LAPACK explicitly and treats OpenMP as a build option. This CMake port uses
the same conservative approach: keep Multiwfn's existing OpenMP code and link it
through CMake's `OpenMP::OpenMP_Fortran` target when available, rather than
changing parallel regions in the Fortran sources.

The macOS build repository's `source_dist` branch is a full source snapshot, not
a small patch set against the Linux source. It differs from the 2026.6.2 Linux
source in many Fortran files, so it should not be copied wholesale when the goal
is a minimal, auditable port.

GNU Fortran Release builds should avoid CMake's default `-O3` for this codebase.
The upstream Makefile uses `-O2` for the general build and lowers `O1.f90` and
`libreta_hybrid/blockhrr_012345.f90` to `-O1`. The CMake build mirrors that
shape for GNU Fortran to reduce compile-time risk and stay closer to the
validated upstream build profile.

CI run history so far:

- Run 1 failed in build before detailed logs were available.
- Run 2 failed in build; local minimal reproduction identified the
  `DFTxclib.F` preprocessing issue above.
- Run 3 built and smoke-tested successfully on macOS and Windows. Ubuntu stayed
  in the build step much longer than the other platforms, consistent with GNU
  Fortran spending excessive time under the previous default `-O3` profile.
- Run 4 succeeded on Linux, macOS, and Windows after mirroring the upstream
  GNU Fortran optimization profile. All three jobs built `Multiwfn_noGUI`, ran
  the water XYZ smoke test, and uploaded artifacts.
- Run 5 succeeded on Linux, macOS, and Windows after replacing the simple quit
  smoke test with functional noGUI checks for geometry analysis and cube
  read/export workflows.
- Run 9 succeeded for tag `v2026.6.2-nogui.2`. It rebuilt all three platform
  binaries, reran the functional tests, and completed the release job.
