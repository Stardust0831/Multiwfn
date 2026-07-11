# Cross-Platform Build Notes

This repository keeps the original `Makefile` unchanged for the upstream
Intel/Linux workflow and adds a minimal CMake path for reproducible noGUI
builds.

## Supported CMake Targets

The default CMake build targets `Multiwfn_noGUI`. This avoids DISLIN, Motif,
X11, and OpenGL so CI can build on Linux, macOS, and Windows with GNU Fortran.

The repository includes the upstream Multiwfn license terms in `LICENSE.txt`.
Release assets must carry this file alongside the binaries.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
```

The artifact-based 3Dmol GUI backend is also available through CMake. To build
the native Qt shell by default:

```sh
cmake -S . -B build-qt-gui \
  -DCMAKE_BUILD_TYPE=Release \
  -DMULTIWFN_GUI_BACKEND=3dmol \
  -DMULTIWFN_3DMOL_DEFAULT_SHELL=qt
cmake --build build-qt-gui --parallel
```

This produces `Multiwfn_QtGUI`, copies `settings.ini` beside the executable,
and stages its Python launchers plus web frontend under
`build-qt-gui/resources/`. This is a development build layout, not a
self-contained release package. The executable can be run directly from the
build directory when its development runtime dependencies are available.

Both 3Dmol shells require Python 3. The browser shell uses only the Python
standard library plus the system's default browser. The Qt shell additionally
requires PyQt6, and its embedded 3D viewer requires PyQt6-WebEngine. CMake
checks these imports with the Python interpreter found at configure time and
prints a warning when the selected shell's dependencies are unavailable. At
runtime, set `MULTIWFN_3DMOL_PYTHON` to use a Python interpreter other than
`python3` from `PATH`.

A browser-default build uses `MULTIWFN_3DMOL_DEFAULT_SHELL=browser` and
produces `Multiwfn_3DmolGUI` with the same staged configuration and resources.
Formal release packages use a separately tested, self-contained runtime and
must not rely on this development staging layout.

The original DISLIN/Motif GUI remains outside the CMake build; use the upstream
`Makefile` when that legacy backend is required.

## Optional Features

- `MULTIWFN_WITH_OPENMP=ON` enables OpenMP when CMake can find compiler support.
- `MULTIWFN_WITH_FD=ON` enables fractional-derivative support and requires
  GMP, FLINT, and ARB where applicable.
- `MULTIWFN_WINDOWS_STATIC_LINK=ON` is enabled by default on Windows. It asks
  CMake to prefer static BLAS/LAPACK libraries and links GNU Fortran runtime
  libraries statically where practical.
  In the MSYS2 UCRT64 CI build, this also forces BLAS/LAPACK to
  `$MINGW_PREFIX/lib/libopenblas.a`; relying only on automatic BLAS detection
  may select the OpenBLAS import library and leave DLL dependencies.
  Static OpenBLAS may still reference GNU/OpenMP runtime symbols, so the
  Windows link line also adds available static `libgomp.a`,
  `libwinpthread.a`, `libquadmath.a`, and `libgfortran.a` by full path.

The default CI build leaves fractional-derivative support off.
BLAS and LAPACK are required because Multiwfn calls routines such as `DGEMM`,
`DSYEV`, and `DGEEV` directly.

On Windows, CI reads the executable import table with `objdump -p` and copies
non-system runtime DLLs from the MSYS2 UCRT64 toolchain into the release
candidate directory beside `Multiwfn_noGUI.exe`. This preserves OpenMP instead
of disabling it merely to avoid DLLs. The release zip is then extracted and
tested outside the MSYS2 shell with MSYS2 paths removed from `PATH`.

On Linux, the release candidate package is built inside a Rocky Linux 8
container to keep the glibc baseline at 2.28. The workflow copies non-glibc
libraries reported by `ldd` into a package-local `lib/` directory and builds the
executable with an `$ORIGIN/lib` rpath. It rejects Linux release candidates that
reference GLIBC symbols newer than 2.28, then extracts and tests the tarball in
a clean Rocky Linux 8 container without installing BLAS/LAPACK. The container
enables the Rocky PowerTools repository when present plus EPEL and uses
Rocky-provided `cmake`. Rocky 8's packaged Ninja is too old for CMake's
Fortran support, so the workflow installs a pinned upstream Ninja release as a
build-time tool. The final executable is still built by the Rocky 8 compiler
and libraries, keeping the older runtime baseline without dropping the intended
CMake/Ninja build path.

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

GNU Fortran compatibility flags are probed before use. Newer gfortran versions
need options such as `-fallow-argument-mismatch` and `-fallow-invalid-boz` for
legacy Fortran sources, while Rocky Linux 8's GCC 8 does not recognize those
options and does not need them for the same diagnostics. The CMake build keeps
one source tree by adding only the flags supported by the active compiler.

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

Linux release builds additionally pass `MULTIWFN_GNU_HOT_OPT_LEVEL=O3` for a
small set of grid-heavy sources: `function.f90`, `grid.f90`, `util.f90`, and
`libreta_hybrid/libreta.f90`. This keeps the global GNU profile at `O2` while
recovering performance on heavy real-space grid workloads. The setting was
validated on the `perf/linux-optimization` branch with the 300^3 ELF benchmark:
the Rocky Linux 8/glibc 2.28 build kept identical cube hashes and improved the
internal grid time from 155 s to 130 s in GitHub Actions.

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
