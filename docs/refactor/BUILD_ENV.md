# Local Build Environment

This repository keeps compiler experiments inside the source folder. Do not
install system packages or change global shell startup files for this refactor.

## Conda/Mamba Prefix

Create the GNU build environment with a local package cache and local prefix:

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

The smoke target generates a temporary XYZ file under `.build-env/smoke`, backs
up `settings.ini`, runs `Multiwfn_noGUI`, verifies that the file was loaded and
the main menu was reached, and restores `settings.ini` before exiting. GFortran
currently prints an IEEE floating-point exception flag note at program
termination; this should be tracked during broader numerical validation.
