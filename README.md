# Multiwfn Cross-Platform Build and GUI Experiments

[中文说明](README.zh-CN.md)

This repository tracks the official Multiwfn source code and adds standardized
cross-platform builds, GitHub Actions CI, release packaging, performance and
result-consistency checks, and experimental visualization GUI work.

Multiwfn itself is developed by Tian Lu. This repository preserves the upstream
source license in `LICENSE.txt`; redistributed source and release artifacts must
carry that license.

## Goals

- Provide reproducible CMake/Ninja builds for Linux, macOS, and Windows.
- Run GitHub Actions builds and required checks for commits and pull requests.
- Package releases with required settings, license files, and runtime
  dependencies.
- Build Linux packages against a conservative glibc 2.28 baseline and test them
  in clean containers.
- Collect MSYS2/UCRT runtime DLLs for Windows packages and test them outside the
  development shell.
- Preserve official Multiwfn computational behavior and check output
  consistency through functional and performance tests.
- In current benchmark cases, the packaged builds show some performance
  improvement over the official release packages.
- Maintain optional upstream-source tracking for official Multiwfn source
  archive updates.
- Explore a cross-platform 3Dmol.js/Plotly/Qt visualization frontend that can
  replace the legacy DISLIN GUI.

## Development Principles

The project follows a frontend/backend separation model. The Multiwfn
computational core should stay as close as possible to the official source. GUI,
build, CI, packaging, tests, and documentation are maintained as independent
engineering layers around it.

Changes are normally expected in:

- `CMakeLists.txt`, CMake modules, and platform build scripts.
- CI, test, and release workflows under `.github/workflows/`.
- Engineering code under `frontend/`, `tools/`, `docs/`, and `tests/`.
- GUI adapter files such as `noGUI/GUI_3dmol.f90`.

Computational core changes should be avoided unless necessary. When they are
needed, please describe the reason, scope, test method, and numerical comparison
against an official Multiwfn build.

## GUI Experiments

The GUI work is still experimental. The goal is not a generic cube viewer; the
new frontend should mirror the original `GUI.f90` interaction model as much as
possible while leaving calculations in the Multiwfn backend.

Current pieces:

- `frontend/3dmol-viewer`: 3Dmol.js/Plotly visualization frontend.
- `frontend/qt-multiwfn-gui`: Qt shell prototype for an application window.
- `noGUI/GUI_3dmol.f90`: experimental GUI backend adapter.
- `tools/multiwfn_3dmol_server.py`: local session service.

Current demo features include structure display, multiple cube layers,
cube-by-cube coloring, periodic display controls, cube slices, simple 2D plots,
PNG export, and manifest export. The `Periodic ESP` sample is synthetic UI test
data, not a physical Multiwfn calculation.

Build the 3Dmol GUI backend:

```sh
cmake -S . -B build-3dmol-gui -DCMAKE_BUILD_TYPE=Release -DMULTIWFN_GUI_BACKEND=3dmol
cmake --build build-3dmol-gui --parallel
```

Build the Qt-shell variant:

```sh
cmake -S . -B build-qt-gui -DCMAKE_BUILD_TYPE=Release -DMULTIWFN_GUI_BACKEND=3dmol -DMULTIWFN_3DMOL_DEFAULT_SHELL=qt
cmake --build build-qt-gui --parallel
```

## Build

The default CMake build currently targets `Multiwfn_noGUI`:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
```

The original upstream `Makefile` is kept for the traditional upstream build
path. The CMake path is focused on CI, cross-platform packaging, and
reproducible builds.

See `docs/build.md` and `docs/release.md` for platform details.

## Contributing

External testing, issues, and pull requests are welcome. Useful areas include:

- Testing release packages on clean systems.
- Reporting cross-platform build, runtime, packaging, performance, or output
  consistency issues.
- Adding compact public fixtures and reproducible examples.
- Improving CMake, CI, release packaging, documentation, and GUI adapters.
- Making the new GUI closer to the original DISLIN GUI buttons and workflows.

Please read `CONTRIBUTING.md` for issue, PR, license, and contributor
recognition guidelines.
