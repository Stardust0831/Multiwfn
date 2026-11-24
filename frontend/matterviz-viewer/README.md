# Multiwfn MatterViz frontend

This is an experimental MatterViz frontend developed independently from the legacy 3Dmol.js
implementation.
It consumes the Multiwfn session manifest and serialized backend API. Protected
core sources are unchanged relative to the main-branch baseline. Data capture and
user-confirmed metadata live entirely in the GUI adapters and frontend.

The standalone BaneWfn GUI also offers **Vibrational modes** for molecular
frequency results exported as cclib CJSON. It uses MatterViz's native trajectory
renderer and starts paused. See [frequency viewing](../../docs/frequency-viewer.md)
for conversion, supported inputs and displacement conventions.

The viewer uses the unmodified `main` branch of [janosh/matterviz](https://github.com/janosh/matterviz). The pnpm lockfile records the exact commit for reproducible desktop builds. To take a later upstream revision, run `pnpm update matterviz` in this directory and commit the refreshed lockfile after testing.

Git dependency preparation must run outside a `node_modules` directory: Node's
TypeScript loader rejects scripts beneath that path. CI sets
`pnpm_config_store_dir` to the runner's temporary `pnpm-store` directory before
both cache setup and installation. Local builds with a pnpm installation inside
`node_modules` should likewise set `pnpm_config_store_dir` to an external writable
directory. This keeps the upstream preparation scripts enabled and unchanged.
The workspace also pins the unmodified `svelte-widgets` revision `55345ea3` used
by the previous lockfile. Its newer Git revision's development dependencies mix
Vitest 5.1.0 and 5.1.1, causing npm's Git preparation to reject their peer graph.
Update that pin only after a clean preparation and the viewer checks pass.

Open **Structure controls** and select an isosurface finish. The native WebGPU viewer provides Satin, Translucent shell, Chalk and Unlit. Satin uses shell shading on translucent single-color layers. Set an orbital layer's opacity to 1 to see its opaque satin finish. The structure viewer also owns the isosurface layers, atom editing, measurements, camera and volume slices. Old Reps display snapshots and custom material settings belonged to the retired workbench. Native JSON with a ghost species such as `Bq` follows upstream's unsupported-species diagnostics.

Multiwfn loads Cube files and binary fields into the native volume list. Density surfaces refer to their coloring field by ID. A declared custom gradient uses the closest native named palette, preserving its direction and physical range. ESP potential values declared in kcal/mol are converted to atomic units before mapping.

## AIM topology workbench

Tools groups AIM, ESP and bond-order analyses. Capability flags come from parsed
backend arrays, not file extensions; disabled actions retain a focusable reason
button. AIM requires nonperiodic atoms, valid GTFs, coefficients and occupations.
Ordinary structures/cubes, old manifests and periodic inputs cannot start AIM;
already generated topology remains viewable independently of this capability.

Editing atom coordinates, elements, occupancies, site count, cell vectors,
periodicity or charge invalidates wavefunction-dependent AIM/surface results.
Late manifest responses cannot reactivate a result after such an edit. Display
labels and visual settings do not invalidate the scientific input identity.
CP/path labels share a limit of 256, including periodic images, and reuse their
resources during size/selection changes. Inspect still lists every CP/path.
Invalid numerical AIM input retains the last valid value and disables Run until
corrected, rather than silently changing the requested scientific parameter.

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

The analysis view renders critical points and paths in their Cartesian coordinates. Periodic paths retain their original CP IDs. CSV and JSON contain the raw data, and PNG captures the displayed analysis. Changing the underlying geometry invalidates cached and in-flight analysis results.

Regression commands from the repository root:

```bash
python3 -m unittest tests/test_matterviz_topology.py
MULTIWFN_TOPOLOGY_FIXTURE=/path/to/input.fchk python3 -m unittest tests/test_matterviz_topology.py
```

## Quantitative molecular surface results

Run original main function **12**, configure and finish the analysis, then choose
post-processing **0**. The native workbench displays the original improved
marching-tetrahedra surface, rather than
re-extracting a cube or substituting the approximate ESP preview. Tools includes
**Quantitative surface results...**, disabled with a reason when no original result
has been published. This is a results viewer, not a new noninteractive surface
calculation API. Post-processing -3 retains its original grid-isosurface behavior.

The first view is geometry-only: the original zero-argument `drawsurfanalysis`
entry does not expose the surface type, mapped function or mapping-completion
flag. Confirm **Result types** in the panel, including whether mapping was
actually calculated. Only that explicit confirmation reads the existing mapped
values and retained extrema. Selecting **None (geometry only)** never reads
uninitialized mapped values or stale extrema. The adapter cannot independently
verify a user's claim that mapping was calculated; confirm the actual CLI options.
No calculation, terminal-input interception or generated core-source patch is used.

The result panel provides opacity, wireframe, surface/extrema visibility, fit,
extreme selection, and statistics. Values use the original facet-area weights and
Multiwfn conversion constants. Total variance follows the original sum of positive
and negative regional variances, not a pooled variance. Undefined one-sign/constant
statistics display N/A. ESP includes charge balance, separation, MPI and the
original 10 kcal/mol polar/nonpolar threshold. Unmapped analyses expose only
geometry and area. Unknown/custom mapped functions retain
native units; the adapter does not guess an energy unit from numeric values.

Volume and mass density initially display N/A, not zero or a mesh-derived
substitute. **Import statistics log** accepts a user-selected original Multiwfn
text log (up to 8 MiB). It imports the last surface summary's printed volume in
Bohr^3 and mass density in g/cm^3, after checking the printed area against the
current mesh. An area match is a consistency check, not proof of dataset identity;
the user must choose the corresponding run. JSON records the filename and printed
precision. Missing statistics remain null; imported values can be cleared. Log
imports never replace the mesh, mapped data, extrema or facet-weighted statistics.
The log and its association are page-local and must be reimported after refresh.

Manifest version 2 adds optional `surfaceAnalysis` version 1 with three independent
binary dataset IDs, nullable function/surface types, nullable volume (Bohr^3) and
mass density, original isovalue and unit conversions. `metadataSource` distinguishes
unconfirmed types from user confirmation; older fully specified results still load.
Authenticated `GET /api/surface?surfaceType=1&mappedFunction=1` confirms ESP, while
`mappedFunction=none` confirms geometry-only. This sends a bounded read-only
`surface` command over the existing serialized channel, never into the scientific
core. It is available only while the original surface session is live. Successful
replacement retires the previous surface datasets; failures discard partial new
datasets without deleting other plots/topology. The refreshed manifest retains the
confirmed types and dataset IDs. Arrays use the existing authenticated MWFNP2D channel:

- Vertices: x = interleaved xyz (Bohr), y = mapped values, z = original vertex IDs.
- Facets: x = interleaved zero-based compact vertex indices, y = original areas
  (Bohr^2), z = original facet values, u = original facet IDs.
- Extrema: x = compact vertex index, y = -1/+1 minimum/maximum, z = original local
  extreme number. Dataset ID 0 means no extrema; discarded extrema stay discarded.

Snapshots validate references, finite values and a 256 MiB budget, never modify
the original arrays, and release their temporary buffers after publication. The
renderer orients a copy of triangle winding for consistent normals; original
connectivity, coordinates and scalar values remain intact in CSV/JSON exports.
PNG captures the analysis view. Local display controls never invoke marching cubes,
an extrema Worker or another backend calculation. Changing structures clears the
result; orbitals/ESP temporarily replace its view, and Tools reopens it from memory.
Atom/fragment decompositions, surface basins and fingerprint analysis are not
included in this first results viewer.

## Scope of spectrum integration

Main function 0 does not offer spectrum output import, UV-Vis/IR/Raman/NMR
analysis buttons, front-end spectrum parsing or broadening, or spectrum-specific
type and settings controls. These additions are deferred to a follow-up PR at
the original program's spectrum-drawing entry points, rather than a parallel
analysis workflow inside the molecular viewer.

Original main function 11 and the existing generic 2D capture, display, and
export pipeline remain unchanged. Open plot still accepts computed numeric
curves and self-contained plot documents; it does not parse quantum-chemistry
output files or broaden their transitions. Results without declared semantic
types remain generic 2D plots, retaining their original data, axes, and units.
The quantitative-surface type confirmation is separate and remains available.

An independent pure-GUI analysis application, including automated CLI input,
batch plots, multiple views, and shared camera management, is also outside the
scope of this change.

## Build

Node.js 24.11 or newer and pnpm 11 are recommended.

```bash
pnpm install --frozen-lockfile
pnpm test
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

The orbital panel selects cached orbitals or requests a new grid from Multiwfn. **Tools** exposes ESP, AIM and bond-order calculations when supported by the session. For bond order, select two atoms in the native measurement tool, then choose the method in **Tools**. A visible density surface explicitly colored by its ESP field also enables the approximate-extrema table.

## Unified result workbench

Interactive 2D plots and the 3D scene share the result selector, operation log, Save menu and Return action. Switching to a plot keeps the structure viewport mounted. The orbital list includes HOMO/LUMO shortcuts for closed-shell sessions.

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
Its **Transparent background** checkbox defaults to off: PNG files keep the
selected scene background color (white initially). Check it to retain alpha.
This affects only the exported image, leaving the scene and materials unchanged.

In the packaged desktop viewer, Save opens the native file dialog. Cancelling
leaves existing files intact; replacing an existing file requires confirmation.
The status reports success only after the host finishes writing the file.
Browser sessions continue to use the browser's download handling.

Native binary plot arrays stay typed in transport/cache. At the ScatterPlot boundary,
immutable coordinate and fill arrays are converted once with a weak cache, because
MatterViz's point construction uses `Array.map` to produce objects. Passing a typed
array there silently loses curves. Plot paths do not tween through artificial data
positions, and the application explicitly supplies its light control-panel theme.

This unifies results **already emitted** by the MatterViz adapters, including the
AIM critical-point/path and quantitative-surface representations described above.
Other basin/domain objects and interactive plane/box picking still need dedicated
backend-to-viewer representations. A structure/cube-only session from an original
analysis entry point does not by itself provide those objects. Protected Fortran
scientific calculations remain unchanged; the GUI adapters carry the additional
analysis metadata through the existing manifest/HTTP transport.

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

## Local session preview

Provide an existing session's data under `session/` in a separate public directory.
The frontend does not invent calculation results or contact a calculation backend
for this preview. The manifest can expose structures, cubes and existing analysis
artifacts; unavailable calculation actions keep their disabled explanations.

```bash
PREVIEW_PUBLIC_DIR=/path/to/preview/public pnpm preview:session
# http://127.0.0.1:5297/ (reads /session/manifest.json)
# Add ?manifest=/session/surface-manifest.json for another manifest.
```

After building, run `pnpm exec playwright install chromium`, `pnpm test:scene-export` and `pnpm test:frequency`. The finish test opens an orbital and a mapped ESP surface, selects each native finish, downloads the PNGs, and checks their pixels. The frequency test exercises playback and the camera on Gaussian and ORCA fixtures. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an existing Chromium executable.

Both tests use full Chromium and upstream MatterViz's software WebGPU settings:
SwiftShader is selected directly for WebGPU and ANGLE, with Vulkan surfaces
disabled so the same tests can render on CI runners without a GPU.
Linux CI runs each test with `xvfb-run -a` and `PLAYWRIGHT_HEADED=1`, matching
upstream's workaround for transparent WebGPU canvases in Linux headless mode.

The finish test retains all eight downloaded PNGs and a JSON record of image
dimensions, SHA-256 hashes and input URLs in `/tmp/multiwfn-scene-export-browser`
(override with `ARTIFACT_DIR`). `ORBITAL_PREVIEW_URL` and `ESP_PREVIEW_URL` can
point to existing sessions with a `manifest` query parameter to check real
calculation data. Without those URLs the test uses its small synthetic grids.
CI retains both the finish and frequency artifacts on successful and failed runs.
