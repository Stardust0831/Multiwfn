# Local Build Environment

This repository keeps compiler experiments inside the source folder. Do not
install system packages or change global shell startup files for this refactor.

## Conda/Mamba Prefix

Create the GNU build environment with a local package cache and local prefix:

```sh
tools/bootstrap-gnu-env.sh
```

The script uses `mamba`, `micromamba`, or `conda` from `PATH`, stores packages
under `.build-env/pkgs`, and creates the compiler prefix under `.build-env/gnu`.
If the prefix already exists, it verifies that the expected compiler and `make`
executables are present.

Inspect the local prefix without compiling anything:

```sh
tools/gnu-build.sh doctor
tools/gnu-env-doctor.sh
```

The doctor command is read-only. It reports the resolved `GNU_PREFIX`, package
cache path, `LIB_noGUI_GNU`, compiler and `make` versions, OpenBLAS
availability, and whether `mamba`, `micromamba`, or `conda` are currently on
`PATH`.

Set `GNU_PREFIX` to use another prefix inside this source tree. Relative
`GNU_PREFIX` values are interpreted relative to the repository root by the
bootstrap and wrapper scripts:

```sh
GNU_PREFIX=.build-env/gnu-alt tools/bootstrap-gnu-env.sh
GNU_PREFIX=.build-env/gnu-alt tools/gnu-build.sh smoke
GNU_PREFIX=.build-env/gnu-alt tools/gnu-build.sh vmd-smoke
```

The GNU wrappers also honor the same local override variables used by the
Makefile's `gnu-noGUI` target:

```sh
FC_GNU=.build-env/gnu/bin/x86_64-conda-linux-gnu-gfortran \
CC_GNU=.build-env/gnu/bin/x86_64-conda-linux-gnu-gcc \
MAKE_GNU=.build-env/gnu/bin/make \
LIB_noGUI_GNU="-L$PWD/.build-env/gnu/lib -lopenblas" \
tools/gnu-build.sh doctor
```

Relative `FC_GNU`, `CC_GNU`, and `MAKE_GNU` paths are interpreted relative to
the repository root by the wrapper scripts. If `LIB_noGUI_GNU` is overridden,
the doctor reports the value and skips the default OpenBLAS file check under
`GNU_PREFIX/lib`, because the library may intentionally live elsewhere.

The equivalent manual command is:

```sh
mkdir -p .build-env/pkgs
CONDA_PKGS_DIRS="$PWD/.build-env/pkgs" \
  mamba env create -p "$PWD/.build-env/gnu" -f docs/refactor/gnu-build-env.yml
```

Use tools from the local prefix without activating globally:

```sh
.build-env/gnu/bin/x86_64-conda-linux-gnu-gfortran --version
.build-env/gnu/bin/x86_64-conda-linux-gnu-gcc --version
.build-env/gnu/bin/make --version
```

The `.build-env/` directory is intentionally ignored by Git.

Machine-local Makefile overrides should also stay in the source folder. Copy the
tracked example and edit the ignored local file:

```sh
cp Makefile.local.example Makefile.local
```

Use `Makefile.local` for local compiler paths, BLAS/DISLIN library paths, or
alternate `.build-env` prefixes instead of editing the tracked Makefile for one
machine.

## Current Local Result

On WSL2 x86_64, the environment was created successfully in:

```sh
.build-env/gnu
```

Verified tools:

```sh
.build-env/gnu/bin/x86_64-conda-linux-gnu-gfortran --version
.build-env/gnu/bin/x86_64-conda-linux-gnu-gcc --version
.build-env/gnu/bin/make --version
```

The local compiler versions are GCC/GFortran 15.2.0 from conda-forge and GNU Make
4.4.1.

GNU module files are written to:

```sh
.build-env/gnu-mod
```

GNU object files are written to:

```sh
.build-env/gnu-obj
```

The `gnu-noGUI` target removes and recreates both directories and runs
`make clean` before compiling. This prevents noGUI stub modules such as
`dislin.mod` and `gui.mod` from being left in the source root and keeps GNU
object files out of the source root during normal noGUI builds. Set
`GNU_OBJ_DIR` to another ignored local directory if a debugging run needs a
different object location.

During environment creation, `mamba` attempted to update
`/home/stardust/.conda/environments.txt`, but that path was read-only in this
environment. The package transaction still completed and the usable prefix was
created under `.build-env/gnu`.

There were also warnings while linking Linux kernel headers because this working
tree is on a Windows-mounted filesystem where some paths are effectively
case-insensitive. The current noGUI build still succeeds, but object-directory or
environment placement should be revisited if case-colliding headers become a
problem for future C/C++ dependencies.

## GNU noGUI Build

Build the noGUI binary using only the local prefix:

```sh
.build-env/gnu/bin/make clean
.build-env/gnu/bin/make gnu-noGUI
```

The resulting binary is:

```sh
./Multiwfn_noGUI
```

For smoke testing from this source folder:

```sh
.build-env/gnu/bin/make gnu-noGUI-smoke
```

Or use the convenience wrapper:

```sh
tools/gnu-build.sh smoke
tools/gnu-build.sh vmd-smoke
tools/gnu-build.sh noGUI
tools/gnu-build.sh noGUI-incremental
tools/gnu-build.sh clean
tools/gnu-build.sh doctor
tools/verify-refactor.sh env
```

The wrapper forwards `GNU_PREFIX` and honors `FC_GNU`, `CC_GNU`, `MAKE_GNU`, and
`LIB_noGUI_GNU`, so alternate local prefixes or local compiler experiments can
use the same compiler, `make`, OpenBLAS library path, and runtime library path
consistently without editing the tracked Makefile.
The `noGUI-incremental` wrapper target uses the same GNU object and module
directories but does not run `gnu-clean`; it is intended for quick local
compile checks between full clean verification runs.

The smoke target rebuilds `Multiwfn_noGUI`, then runs
`tools/gnu-nogui-smoke.sh`. The script generates temporary XYZ and cube files
under `.build-env/smoke`, uses the tracked
`tools/fixtures/he_minimal.mwfn` wavefunction fixture, backs up `settings.ini`,
runs `Multiwfn_noGUI` for all nine fixtures, verifies that the structure and cube
files reach the main menu, verifies that a real main-program `xyz` export writes
both an XYZ file and a VMD Tcl scene while `vmdpath=none` prevents launching
VMD, verifies that a real grid-data processing menu export writes both a cube
file and a VMD Tcl scene with positive and negative isosurfaces, verifies that a
real file-export menu VASP grid export writes both a `CHGCAR` file and a VMD Tcl
scene using VMD's `CHGCAR` molfile type, verifies that a real file-export menu
POSCAR structure export writes both a `POSCAR` file and a VMD Tcl scene using
VMD's `POSCAR` molfile type, verifies that
the `.mwfn` fixture can calculate electron density on a small grid, write
`density.cub`, and generate `density.cub.vmd.tcl`, sources those generated VMD
scenes through
`tools/vmd-scene-source-check.sh` from a temporary working directory when
`tclsh` is available, verifies that their `mol new` data paths resolve to the
exported files, verifies that the `.mwfn` point-property fixture prints
representative real-space results, verifies that the `.mwfn` Mulliken fixture
prints basis and atomic populations, and restores `settings.ini` before exiting.
GFortran currently prints an IEEE floating-point exception flag note at program
termination; this should be tracked during broader numerical validation. The
stderr check allows only that exact note and fails on any other stderr line.
`GNU_PREFIX`, `EXE_noGUI`, and all documented `SMOKE_*` paths can still be
overridden through the Makefile target or by invoking the script directly from
the source root.

After a successful `gnu-noGUI-smoke`, the expected local build residue is:

- `Multiwfn_noGUI` in the source root.
- GNU `.mod` files under `.build-env/gnu-mod`.
- GNU object files under `.build-env/gnu-obj`.
- Generated smoke-test inputs and logs under `.build-env/smoke`.
- Wavefunction-derived density cube and VMD scene files under
  `.build-env/smoke/wfn-grid-export`, plus VMD export fixtures under
  `.build-env/smoke/vmd-*`.
- No root `*.o`, root `*.mod`, or `noGUI/*.o` files.
- No known root-level smoke export files such as `he_minimal.chg` or
  `atmpopdcp.txt`, and no root-level wavefunction-grid outputs such as
  `density.cub` or `density.cub.vmd.tcl`. `tools/audit-smoke-residue.sh full`
  checks this together with root object/module residue.

Use `tools/gnu-build.sh clean` to remove the noGUI binary, transient object and
module files, `.build-env/gnu-mod`, `.build-env/gnu-obj`, `.build-env/smoke`,
temporary noGUI build audit directories, temporary VMD bridge smoke directories,
and temporary VMD doctor smoke directories. This cleanup keeps `.build-env/gnu`
and `.build-env/pkgs` so the local compiler prefix and package cache remain
available for the next build.

The `vmd-smoke` wrapper compiles only `define.f90`, `vmd_bridge.f90`, and a
small test driver under `tools/` into `.build-env/vmd-bridge-smoke.<pid>` by
default. It verifies that the bridge can generate a VMD Tcl scene for a cube file
without linking the full Multiwfn binary or launching VMD. Successful default
runs remove their temporary directory automatically. Set `VMD_SMOKE_KEEP=1` or
set `VMD_SMOKE_DIR` to a fixed smoke-test directory when debugging generated
files.
