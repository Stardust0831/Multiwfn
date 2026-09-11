# Multiwfn MatterViz frontend

This is an experimental MatterViz frontend developed independently from the legacy 3Dmol.js
implementation.
It consumes the same Multiwfn session manifest and serialized backend API, so the Fortran
calculation modules remain unchanged.

The frontend consumes the reproducible prebuilt package
`matterviz-0.4.2-multiwfn.d8719d12.r25.material1.tgz` in `vendor/`. Its
reviewable patch applies directly to main's r25 archive. The package retains
ordered measurements, angle/dihedral and bond context menus, Arcball camera
controls, flat grids, Worker meshing and immediate resource release.

The material update adds bounded rim shading and angle-dependent transparency
to the existing lit materials, fixes the shader hook against Three r185's
unexpanded output include, and preserves zero/fully opaque alpha endpoints.
Restoring a saved camera also reconciles its orientation after declarative pose
setters, while identical live Arcball feedback preserves the current quaternion.
The Trans Flag palette shares physical-zero semantics between vertex colors
and colorbars, including asymmetric and one-sided ranges; its odd-sized LUT
preserves exact white at zero. Worker buffer returns also support environments
without SharedArrayBuffer.

The retained lineage is r24 → r25 → r25.material1. PR #54's r26 archive was based
on r24 and cannot replace main's r25 without losing measurement controls. The
older r25 material build from PR #54 reused that version name; it is not this
repository's r25 patch base. Use the retained archive and the lockfile integrity.

To reproduce the material package (Node.js 24 and npm):

```bash
material_tmpdir="$(mktemp -d)"
tar -xzf vendor/matterviz-0.4.2-multiwfn.d8719d12.r25.tgz -C "$material_tmpdir"
patch -d "$material_tmpdir/package" -p1 < vendor/patches/matterviz-0.4.2-multiwfn.d8719d12.r25.material1.patch
npm pack --ignore-scripts --pack-destination vendor "$material_tmpdir/package"
```

## Build

Node.js 24.11 or newer and pnpm 11 are recommended.

```bash
pnpm install
pnpm check
pnpm build
```

In normal use Multiwfn launches the native Rust Host with inherited control and
volume pipes. The Host serves the stable session URLs from memory; direct
file-backed Host invocation is a diagnostic compatibility mode, not the formal
runtime.

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
capabilities, select two bonded atoms with MatterViz's measurement tool and right-click either
atom or their visible bond to choose a bond-order calculation. The toolbar remains available for
any valid two-atom calculation, including pairs without a rendered bond. Ordered measurement mode
uses two sites for distance, three for bond angle, and four for signed dihedral angle.

ESP-colored density surfaces receive a robust symmetric color range, a draggable kcal/mol/e legend, and an
on-demand bounded extrema table. The current MatterViz renderer does not expose a stable API for
arbitrary 3D extrema markers, so extrema coordinates are listed rather than drawn in the scene.
Explicit ESP layers default to pink/white/blue with white at zero. The legend follows
the selected layer palette and manual range, including asymmetric limits.
Surfaces offers Matte, Soft gloss, Satin and Unlit color finishes, with bounded
rim, opacity and shading refinements. Finishes preserve scientific isovalues and
layer colors; periodic boundary padding is under Cell. These settings are saved
with the workbench state.
Save > Save display settings writes a versioned JSON snapshot of layer, periodic, isosurface-material, and
camera state. The same snapshot can be restored with Save > Restore display settings or a `state=` URL query;
the browser and WebView launchers also accept `--state <path>` and expose only that selected file
through a fixed session route.

For periodic sessions, manifest cell vectors are injected into structures that would otherwise be
plain molecules (for example XYZ files), so MatterViz can render the cell, boundary atoms, periodic
bonds, and atom supercells. Fractional surface ranges remain independent from the integer atom
supercell. The 2D Slice panel samples any loaded cube on XY/XZ/YZ or custom Miller-index planes and
renders the result on a resizable canvas with selectable color and value ranges.

## Unified result workbench

Interactive native 2D plots and the 3D scene now share the result selector, operation log,
Save menu, and Return action. View holds camera steps, axes, inspector, orbitals, layers,
and volume slices; Tools holds backend calculations. Missing ESP capability disables its
calculation button. Sidebars collapse on narrow screens instead of compressing the canvas.
Switching results retains the mounted 3D renderer, camera, selected atoms, and surfaces;
spin pauses while another result is active and resumes on return.

Backend calculations have their own status row and do not set the renderer's
structure-loading flag or unmount its canvas. Geometry measurements and bond-order
results occupy a scrollable strip outside the 3D viewport; measurement lines and
selection markers remain in the scene. Distances (including PBC/direct values),
ordered angles, and signed dihedrals use the same MatterViz geometry helpers as the
scene. Each bond-order result can be dismissed independently.
The orbital rail includes declared closed-shell HOMO/LUMO shortcuts and centers
its list on the initial frontier pair, or the current orbital when reopened.
This positioning does not scroll the page or request new orbital data.

Open plot accepts rectangular numeric `.txt`/`.dat`/`.csv` tables (first column X,
remaining columns Y), native v1 plot JSON, and self-contained plot documents. Fortran
`D` exponents and a single column-header row are supported. Units and analysis kind
are not inferred from filenames. Inconsistent rows, multiple disjoint blocks, binary
data, and unresolved v2 dataset references are rejected without changing the current
result. Limits are 32 MiB per imported file and eight open plots. This is a result
reader, not a parser for arbitrary Gaussian/ORCA logs; those still go through Multiwfn.

Save exports the active plot as PNG, SVG or vector PDF, or its original numerical
arrays as CSV or a self-contained JSON document. CSV is a lossless long table
(`panel,layer,type,role,index,value`), including field and error-band roles; it does
not invent XY pairs for multidimensional grids. Plot documents embed datasets for
offline reopening; they preserve source metadata, not transient native chart-control
edits. Image exports reflect current chart controls and exclude workbench buttons.
Native command-line image export still uses the authenticated host path and returns
to Multiwfn after saving. The 3D PNG command uses the existing MatterViz renderer.

Native binary plot arrays stay typed in transport/cache. At the ScatterPlot boundary,
immutable coordinate and fill arrays are converted once with a weak cache, because
MatterViz's point construction uses `Array.map` to produce objects. Passing a typed
array there silently loses curves. Plot paths do not tween through artificial data
positions, and the application explicitly supplies its light control-panel theme.

This unifies results **already emitted** by the MatterViz adapters. It does not claim
full original GUI parity: topology critical points/paths, basin/domain geometry,
surface-analysis-specific objects, and interactive plane/box picking still need
dedicated backend-to-viewer representations. A structure/cube-only session from one
of those original entry points is not a complete rendering of its analysis result.
Fortran scientific calculations and the existing manifest/HTTP protocols are unchanged.

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
