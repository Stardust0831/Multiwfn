# Multiwfn MatterViz frontend

This is an experimental MatterViz frontend developed independently from the legacy 3Dmol.js
implementation.
It consumes the same Multiwfn session manifest and serialized backend API, so the Fortran
calculation modules remain unchanged.

The frontend consumes the reproducible prebuilt package
`matterviz-0.4.2-multiwfn.d8719d12.r25.topology2.tgz` in `vendor/`. The r25 baseline applies the
reviewable `vendor/patches/matterviz-0.4.2-multiwfn.d8719d12.r25.patch` to the
r24 archive, preserving the reviewed Multiwfn rendering, flat-grid, Worker,
resource-release and Arcball changes while adding ordered measurement,
angle/dihedral, hover-tooltip and selected-bond context-menu controls. The r25
archive remains unchanged. The additional `r25.topology1.patch` adds only a shared
scene snippet and a topology display mask (atoms on, ordinary bonds and scalar surfaces
hidden but still mounted), including the corresponding declarations. All topology
business logic lives in this frontend. The additional `r25.topology2.patch` shares
the native control dictionaries with the parent, preventing camera snapshots from
resetting auto-rotation, and adds the Trans Flag colormap (negative pink `#f5a9b8`,
zero white, positive blue `#5bcefa`). Its odd-sized color lookup preserves exact
white at zero. ESP uses this map by default; other volume defaults are unchanged.
Earlier archives remain as reproducible bases. The current archive SHA-256 is
`05ca32f4f7b3708422baf251d21cb759f653f03fde6505233341e1beec12c186`;
`package.json` and `pnpm-lock.yaml` pin its path and integrity.

To reproduce the topology package from r25:

```bash
tmpdir="$(mktemp -d)"
tar -xzf vendor/matterviz-0.4.2-multiwfn.d8719d12.r25.tgz -C "$tmpdir"
patch -d "$tmpdir/package" -p1 < vendor/patches/matterviz-0.4.2-multiwfn.d8719d12.r25.topology1.patch
patch -d "$tmpdir/package" -p1 < vendor/patches/matterviz-0.4.2-multiwfn.d8719d12.r25.topology2.patch
npm pack --ignore-scripts --pack-destination vendor "$tmpdir/package"
```

## AIM topology workbench

Tools groups AIM, ESP and bond-order analyses. Capability flags come from parsed
backend arrays, not file extensions; disabled actions retain a focusable reason
button. AIM requires nonperiodic atoms, valid GTFs, coefficients and occupations.
Ordinary structures/cubes, old manifests and periodic inputs cannot start AIM;
already generated topology remains viewable independently of this capability.

`GET /api/topology` uses the existing session capability and shared computation
lock. Options are `seeds` (bitmask 1/2/4/8), `distance`, `gradient`, `displacement`,
`cycles`, `step` (Bohr), and `pathPoints`. Defaults are 15, 1.5, 1e-6, 1e-7,
120, 0.03 and 451. The closed command is `topology aim ...`, with a 3600-second
control deadline. The GUI adapter calls the original `findcp`, `findpath`, CP/path
sorting and endpoint identification functions without entering `topo_main`,
removing virtual orbitals, or changing the protected calculation sources.

The adapter preserves valid CP/path prefixes and affected search parameters.
Publication failures roll back; successful publication and response commit the
new CLI-visible topology and clear obsolete interbasin surfaces. Wavefunctions,
orbital occupations/counts and cube arrays are untouched. Search batches reserve
CP capacity before entering parallel code; paths reserve two slots per CP, path
points are bounded below the original fixed capacity, and the temporary atom
distance table is limited to 512 MiB. Unconnected directions and the N-B+R-C
count are reported without claiming the search is complete.

Manifest `version: 2` gains optional `topologyAnalysis` and `topology`. Topology
metadata retains original CP/path IDs, function ID, types, density/Laplacian and
path endpoints. Coordinates use the existing `MWFNP2D` scientific-data channel:
Float64 x/y/z arrays in Bohr, CPs first followed by complete path polylines.
Dataset lifetime is independent of 2D plots; replacement releases only old
topology arrays. Refreshing the page restores the latest result without computing.

The scene extension renders instanced CP spheres and batched thick path segments
in the molecule's scene coordinate system. Periodic integration steps are
unwrapped, with endpoint CP images retaining the original IDs. The topology mask
hides scalar surfaces and ordinary bonds without unmounting or extracting them.
Display controls and object details are outside the canvas; CSV/JSON export keeps
all raw coordinates, while PNG uses the shared scene. Display settings are saved
separately in the existing workbench state. Changing the underlying geometry
invalidates cached topology and in-flight results.

Regression commands from the repository root:

```bash
python3 -m unittest tests/test_matterviz_topology.py tests/test_matterviz_topology_vendor.py
MULTIWFN_TOPOLOGY_FIXTURE=/path/to/input.fchk python3 -m unittest tests/test_matterviz_topology.py
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
