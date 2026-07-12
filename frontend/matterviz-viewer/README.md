# Multiwfn MatterViz frontend

This is an experimental frontend developed independently from the current 3Dmol implementation.
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

Serve `dist/` with the existing Multiwfn GUI service:

```bash
python3 tools/multiwfn_3dmol_server.py \
  --frontend frontend/matterviz-viewer/dist \
  --session multiwfn_3dmol_session \
  --manifest multiwfn_3dmol_session/manifest.json \
  --open
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

When a session exposes `analysis.primaryDos.path`, the workbench loads the versioned Multiwfn DOS
artifact and renders responsive TDOS/PDOS curves with bounded Gaussian broadening. ESP-colored
density surfaces receive a robust symmetric color range, a draggable kcal/mol/e legend, and an
on-demand bounded extrema table. The current MatterViz renderer does not expose a stable API for
arbitrary 3D extrema markers, so extrema coordinates are listed rather than drawn in the scene.
The Export command writes a versioned JSON snapshot of layer and periodic display state; camera
state is intentionally omitted until MatterViz exposes a supported camera serialization API.

For periodic sessions, manifest cell vectors are injected into structures that would otherwise be
plain molecules (for example XYZ files), so MatterViz can render the cell, boundary atoms, periodic
bonds, and atom supercells. Fractional surface ranges remain independent from the integer atom
supercell. The 2D Slice panel samples any loaded cube on XY/XZ/YZ or custom Miller-index planes and
renders the result on a resizable canvas with selectable color and value ranges.

The first native WebView shell lives in `../matterviz-desktop`; see
[`docs/matterviz-webview.md`](../../docs/matterviz-webview.md) for its runtime and packaging model.

Build a Multiwfn executable which selects this frontend with:

```bash
cmake -S ../.. -B ../../build-matterviz-gui -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DMULTIWFN_GUI_BACKEND=3dmol \
  -DMULTIWFN_WEB_FRONTEND=matterviz \
  -DMULTIWFN_3DMOL_DEFAULT_SHELL=webview
cmake --build ../../build-matterviz-gui --parallel 2
```

The `3dmol` backend name currently denotes the shared HTTP/session adapter; selecting MatterViz
does not load or use the 3Dmol frontend. This temporary name avoids touching Multiwfn calculation
modules while the generic web adapter is being separated.

MatterViz is distributed under the MIT license. Multiwfn remains under its original license.
