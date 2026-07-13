# Multiwfn MatterViz frontend

This is an experimental MatterViz frontend developed independently from the legacy 3Dmol.js
implementation.
It consumes the same Multiwfn session manifest and serialized backend API, so the Fortran
calculation modules remain unchanged.

The frontend consumes the prebuilt package in `vendor/`, generated from MatterViz commit
`c8ca120a8091d9003bfd1247819d204d54d09585` on `feature/rendering-quality`. Keeping the package
artifact in this repository makes clean installs reproducible and avoids rebuilding a Git-hosted
dependency inside pnpm's temporary store. The corresponding MatterViz source branch remains the
authoritative source for rendering changes.

## Build

Node.js 24.11 or newer and pnpm 11 are recommended.

```bash
pnpm install
pnpm check
pnpm build
```

Serve `dist/` with the native Rust MatterViz host:

```bash
frontend/matterviz-desktop/target/release/matterviz-desktop \
  --frontend frontend/matterviz-viewer/dist \
  --session multiwfn_matterviz_session \
  --manifest multiwfn_matterviz_session/manifest.json
```

## Desktop shell

The frontend is deliberately independent of its desktop window. It can run in a normal browser
or be wrapped by Tauri (WebView2 on Windows, WKWebView on macOS, and WebKitGTK on Linux) without
changing the manifest or backend API. Qt is therefore optional rather than part of the MatterViz
frontend architecture.

The workbench keeps frontend and backend operation messages in an in-app log panel. Routine GUI
use therefore does not depend on terminal output, while calculation failures remain available for
copying into bug reports.

The Multiwfn integration currently preserves independent volume layers when dynamic orbitals or
ESP data are calculated. The layer panel controls visibility, isovalue, opacity, deletion, and
strict-grid cross-coloring by another loaded volume. When the manifest exposes bond-analysis
capabilities, select two atoms with MatterViz's measurement tool and use the bond controls to run
the corresponding Multiwfn calculation.

ESP-colored density surfaces receive a robust symmetric color range, a draggable kcal/mol/e legend, and an
on-demand bounded extrema table. The current MatterViz renderer does not expose a stable API for
arbitrary 3D extrema markers, so extrema coordinates are listed rather than drawn in the scene.
The Export command writes a versioned JSON snapshot of layer, periodic, isosurface-material, and
camera state. The same snapshot can be restored with the Import command or a `state=` URL query;
the browser and WebView launchers also accept `--state <path>` and expose only that selected file
through a fixed session route.

For periodic sessions, manifest cell vectors are injected into structures that would otherwise be
plain molecules (for example XYZ files), so MatterViz can render the cell, boundary atoms, periodic
bonds, and atom supercells. Fractional surface ranges remain independent from the integer atom
supercell. The 2D Slice panel samples any loaded cube on XY/XZ/YZ or custom Miller-index planes and
renders the result on a resizable canvas with selectable color and value ranges.

The first native WebView shell lives in `../matterviz-desktop`; see
[`docs/matterviz-webview.md`](../../docs/matterviz-webview.md) for its runtime and packaging model.

Build a Multiwfn executable which selects this frontend with:

```bash
cd ../matterviz-desktop && cargo build --release --locked && cd ../matterviz-viewer
cmake -S ../.. -B ../../build-matterviz-gui -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DMULTIWFN_GUI_BACKEND=matterviz
cmake --build ../../build-matterviz-gui --parallel 2
```

The `matterviz` backend is first-class: it selects the MatterViz frontend and
produces `Multiwfn_MatterVizGUI`. MatterViz resources do not include the legacy
3Dmol frontend or Qt shell.

MatterViz is distributed under the MIT license. Multiwfn remains under its original license.
