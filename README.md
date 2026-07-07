# Multiwfn Cross-Platform Build and GUI Experiments

This repository tracks the official Multiwfn source and adds engineering work
around reproducible builds, CI testing, release packaging, and a new
visualization frontend experiment.

Multiwfn itself is developed by Tian Lu. This repository preserves the upstream
source license in `LICENSE.txt`; redistributed source and release artifacts must
carry that license.

## What Is Here

- A CMake-based `Multiwfn_noGUI` build path for Linux, macOS, and Windows.
- GitHub Actions builds and functional tests for all three platforms.
- Release packaging that includes `LICENSE.txt` and `settings.ini`.
- Linux packaging built against a conservative glibc 2.28 baseline and tested
  in a clean container.
- Windows packaging that collects required MSYS2/UCRT runtime DLLs and tests
  the zip outside the MSYS2 development shell.
- A scheduled upstream-source tracking workflow that can check official
  Multiwfn source archives and maintain a dedicated tracking branch.
- A 3Dmol.js/Plotly GUI backend demo under `frontend/3dmol-viewer` and
  `noGUI/GUI_3dmol.f90`.
- An experimental Qt shell prototype under `frontend/qt-multiwfn-gui` that
  mirrors the legacy DISLIN control layout and can host the 3Dmol frontend when
  QtWebEngine is available.

## 3Dmol GUI Demo

The GUI work is currently a demo and design prototype. It can be compiled as a
replacement `module GUI` backend, but it is not a complete replacement for all
legacy DISLIN callbacks yet.

The intended direction is compatibility with Multiwfn's original `GUI.f90`
interaction model. The web frontend should become a 3Dmol/Plotly backend for
the existing GUI workflows, not merely a generic cube viewer. The planned
adapter keeps original entry points such as `drawmolgui`,
`drawisosurgui(iallowsetstyle)`, `drawplanegui(...)`, and `setboxGUI`, while
exporting structure, cube, plot, and overlay artifacts for the frontend. The
current `3dmol` backend writes a session manifest and starts a local HTTP
service through `tools/multiwfn_3dmol_server.py`.

Run the current demo locally:

```sh
cd frontend/3dmol-viewer
python3 -m http.server 8080
```

Then open `http://127.0.0.1:8080/`.

Current demo features include structure loading, multiple cube layers,
cube-by-cube coloring, periodic display controls, cube slices, simple 2D plots,
PNG export, and manifest export. The `Periodic ESP` sample is synthetic test
data for checking the UI; it is not a physical Multiwfn calculation.

Build the current GUI backend demo:

```sh
cmake -S . -B build-3dmol-gui -DCMAKE_BUILD_TYPE=Release -DMULTIWFN_GUI_BACKEND=3dmol
cmake --build build-3dmol-gui --parallel
```

Run `Multiwfn_3DmolGUI` from a checkout or release package. When a workflow
invokes a GUI entry point, Multiwfn writes `multiwfn_3dmol_session/`, launches a
local service, and opens the 3Dmol frontend with the generated manifest.

To try the native Qt shell instead of opening the browser service, set:

```sh
MULTIWFN_3DMOL_SHELL=qt
```

The Qt shell currently requires Python with PyQt6. Embedding the 3Dmol viewport
inside the Qt window additionally requires PyQt6-WebEngine; without it, the
shell still shows the DISLIN-like controls and session summary.

GUI demo prereleases are published separately from the official-style noGUI
packages. A tag named `gui-demo-preview-*` triggers the dedicated
`gui-demo-release` workflow and creates a GitHub prerelease containing Linux,
macOS, and Windows `Multiwfn_3DmolGUI` demo packages with the frontend, service
script, adapter notes, `settings.ini`, and `LICENSE.txt`.

See:

- `frontend/3dmol-viewer/README.md`
- `frontend/qt-multiwfn-gui/README.md`
- `docs/3dmol_gui_adapter.md`
- `docs/visualization.md`

## Builds

The CMake build currently targets `Multiwfn_noGUI`:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
```

The original upstream `Makefile` is kept for the traditional upstream build
path. The CMake path is intentionally narrow and CI-oriented.

Passing `-DMULTIWFN_GUI_BACKEND=3dmol` switches the CMake build from the legacy
DISLIN GUI module to the demo 3Dmol backend and produces `Multiwfn_3DmolGUI`.

See `docs/build.md` and `docs/release.md` for platform details.

## Contributing

Pull requests and issues are welcome.

Useful areas for contribution:

- Cross-platform build reliability and packaging.
- Functional tests with compact public fixtures.
- Performance benchmarks and reproducibility checks.
- 3Dmol/Plotly GUI work that mirrors the original Multiwfn GUI modes.
- Artifact/manifest design for connecting `GUI.f90` workflows to the new
  frontend.
- Documentation of platform-specific build and runtime behavior.

For GUI work, please keep the original Multiwfn interaction model in mind. New
controls should map back to existing GUI concepts where possible, so the future
adapter can replace the DISLIN GUI backend without rewriting computational
modules.

Please open an issue for design discussion before large refactors.
