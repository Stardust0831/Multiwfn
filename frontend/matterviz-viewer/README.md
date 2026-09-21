# Multiwfn MatterViz frontend

This is an experimental MatterViz frontend developed independently from the legacy 3Dmol.js
implementation.
It consumes the Multiwfn session manifest and serialized backend API. Protected
core sources are unchanged relative to the main-branch baseline. Data capture and
user-confirmed metadata live entirely in the GUI adapters and frontend.

The frontend consumes `vendor/matterviz-0.4.2-multiwfn.d8719d12.r25.series1.tgz`.
Its reviewable patch extends the retained `r25.reps2` archive, preserving the
reviewed topology, measurement, material, parser, sampling and representation
fixes. On top it adds a `series_reference` structure prop to the structure
scene: when a trajectory, animation or any per-frame series drives the viewer,
the camera rotation target and structure sizing are derived from that stable
reference instead of the displayed frame, so the camera pose survives frame
swaps (wheel zoom and drag rotate otherwise fight a per-frame re-fit).
Reps render geometry in the host scene without adding cameras or lights. Their
atoms and
bonds share the standard matte/glossy/PBR/unlit material pool, with gradient bond
colors, opacity, rim shading and local clipping.
Editable color scales use shared sRGB control points for surface coloring and
the legend; color-only edits reuse the extracted geometry. The renderer reports
its actual surface-fitted color range so automatic legend ticks remain accurate.

See [the representation workbench](../../docs/representation-workbench.md) for
controls, migration, resource limits and browser acceptance coverage.

The topology extension exposes shared scene snippets, `topology_view` and
`surface_view` masks, and shares native scene/lattice control dictionaries with
the parent so camera snapshots cannot reset auto-rotation. Topology shows atoms
and hides ordinary bonds and scalar surfaces; quantitative-surface view hides
scalar surfaces while keeping chemical bonds. Rendering resources stay mounted,
but hidden bond hit targets and their HTML menu unmount. Atom/label right-clicks
cannot target hidden bonds, previous menus/hover clear when views change, and
atom picking remains available even when the ordinary view's atom toggle is off.
All topology and quantitative-surface analysis logic stays in the frontend and
GUI adapters; the vendor adds no scientific calculation or geometry extraction.

The material extension adds bounded rim shading and angle-dependent transparency
to lit finishes, using Three r185's unexpanded output include and preserving
zero/fully opaque alpha endpoints. Saved-camera restoration also reconciles
orientation after declarative pose setters, while identical live Arcball
feedback preserves the current quaternion. Worker buffer returns support
environments without SharedArrayBuffer.

Legacy Trans Flag coloring uses negative pink `#f5a9b8`, physical-zero white and
positive blue `#5bcefa`. Its vertex colors and colorbars share those semantics for
asymmetric, one-sided and zero-width ranges, with an odd-sized LUT preserving
exact white at zero. Saved ranges migrate to editable points with those colors
intact. The fresh pink/white/blue preset places its points at 0%, 50% and 100%;
subsequent range changes keep their percentage positions fixed. Explicit ESP
layers use this palette by default. Typed Worker geometry recomputes area-weighted normals from
its final Cartesian vertices, reusing the allocated normal buffer. This matches
the legacy path for rotated, anisotropic and nonorthogonal cells. Unlit and
wireframe surfaces bypass tone mapping so their colors agree with the legend;
lit finishes retain the renderer's tone mapping and transparency.

The retained lineage is r25 → workbench1 → workbench2 → upstream1 → reps1 → reps2.
Earlier reviewed archives and patches remain reproducible bases. The current
series1 archive SHA-256 is `901ef83785a11fe18142dcc5d2633573a02dc05b00c67170cb02abec36c156a9`;
`package.json` and `pnpm-lock.yaml` pin its path and integrity.
The retained lineage is r25 → workbench1 → workbench2 → upstream1 → reps1 →
reps2 → series1.

To reproduce the current package (Node.js 24 and npm):

```bash
workbench_tmpdir="$(mktemp -d)"
tar -xzf vendor/matterviz-0.4.2-multiwfn.d8719d12.r25.reps1.tgz -C "$workbench_tmpdir"
patch -d "$workbench_tmpdir/package" -p1 < vendor/patches/matterviz-0.4.2-multiwfn.d8719d12.r25.reps2.patch
npm pack --ignore-scripts --pack-destination vendor "$workbench_tmpdir/package"
sha256sum vendor/matterviz-0.4.2-multiwfn.d8719d12.r25.reps2.tgz
```

The checksum identifies the retained archive. To verify a repack across npm
versions, `tests/test_matterviz_topology_vendor.py` compares every extracted
package file against an independent patch replay, avoiding tar metadata
differences. It also checks that both reviewed vendor branches remain present.

`pnpm test:color-scale` checks editable preset/custom stops against real WebGL
surface buffers and pixels, legend ranges, independent copies, saved settings,
validation and bilingual/narrow-screen controls. Like the other representation
browser scripts, it uses the running local session preview and accepts
`PLAYWRIGHT_MODULE`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, `PREVIEW_URL` and `ARTIFACT_DIR`.

`pnpm test:topology-picking` runs the installed scene in Chromium with real Three.js
raycasting and Threlte event registration. It requires Playwright and its Chromium
browser. An external Playwright install can be selected with `PLAYWRIGHT_MODULE`
(the absolute path to its `index.mjs`); `PLAYWRIGHT_CHROMIUM_EXECUTABLE` optionally
selects an existing Chromium executable. `KEEP_BROWSER_FIXTURE=1` retains the
temporary fixture and JSON evidence. The test checks hidden-bond deletion and
context menus, atom/partial-occupancy/label interaction, and retained bond geometry.
A real typed-grid density surface also verifies both display masks, preserving
its mesh, geometry and material while atoms and chemical bonds follow their masks.

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
PNG uses the shared 3D scene. Local display controls never invoke marching cubes,
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

## Vibrational mode animation

`vibration.html` is a standalone entry document, separate from the workbench
payload schema. It renders the `multiwfn-matterviz-vibration` version 1 session
emitted by the Fortran adapter from the spectrum menu (main function 11, option
26 "Animate vibrational modes in MatterViz GUI", IR/Raman/VCD/ROA of a single
system); the desktop shell opens it instead of `index.html` for that manifest
format. Mode frequencies and optional IR/Raman intensities arrive inline in the
manifest; displacement vectors arrive as one flat MWFNP2D dataset in mode-major
`[mode][atom][xyz]` order, fetched from the authenticated `/api/plot-data/<id>`
route. The full contract is documented in
[`../../docs/matterviz-vibration-protocol.md`](../../docs/matterviz-vibration-protocol.md).

The animation model follows the upstream MatterViz phonon components
(`src/lib/spectral/phonon-modes.ts`): each mode is normalized to a 1 Angstrom
maximum per-atom excursion, then one phase cycle of frames is synthesized as
`xyz(t) = xyz0 + amplitude * u * cos(2 pi k / N)` and played with the vendored
`Trajectory` component (amplitude 0.3 Angstrom, 48 frames, 24 fps by default).
The instantaneous displacement rides the per-site `force` vector property, so
the arrow overlay stays in sync with the animation. Multiwfn vibrations are
molecular Gamma-point modes; no q-points, supercells or lattices are involved.
Imaginary (negative) frequencies are flagged in the mode list. The page issues
no backend commands beyond the generic `/api/ready` and `/api/return`
lifecycle endpoints.

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

### Studio lighting and language selection

Structure > Lighting preset offers **Standard lighting** and **Studio lighting**
(中文：标准布光 / 影棚布光). Studio lighting is a MatterViz lighting preset,
using hemisphere ambient light, a camera-following key, warm fill, and cool rim.
It disables tone mapping. Standard lighting uses neutral lights and AgX tone mapping.
Reset restores the four light intensities for the selected preset.
The historical `tmim` identifier remains in display snapshots for compatibility.

Structure > Finish preset offers Balanced, Goodsell, Edgy, Glass, Metallic, and
Matte. Balanced replaces the display name Current; its saved ID remains `current`.
An untouched renderer material shows Renderer default. Atom finish and lighting
are independent controls. These atom presets apply outline parameters that were
inactive in the historical source, so they are not exact recreations of that viewer.

The toolbar **中文 / EN** button switches Multiwfn-owned controls immediately,
without remounting the scene or changing its camera, scientific data, or materials.
Language is saved in browser localStorage (`multiwfn-ui-language`); the first visit
follows the browser language (Chinese for `zh`, English otherwise). If storage is
unavailable, switching still works for the current page. UI language is independent
of scientific/display exports. User labels, scientific identifiers, and raw backend
logs retain their original text. MatterViz's native embedded controls retain their
upstream language.

The Surfaces control keeps the four primary finishes above and provides the
legacy MaterialPanel combinations in a dropdown: Diffuse, Goodsell, Edgy,
EdgyShiny, AOShiny, AOChalky, Glass1, GlassBubble, EdgyGlass, BrushedMetal,
Metallic, and PBR. Matte and Unlit are reused from the primary controls. Legacy
names are visual material recipes; names containing AO do not add an ambient
occlusion pass. Transparency is implemented as surface alpha, not physical
refraction. All values are saved and restored with the workbench state, but
rendering is not guaranteed to be pixel-identical across browser or GPU
implementations.

Save > Save display settings writes a versioned JSON snapshot of layer, periodic, isosurface-material,
lighting, atom-style, and camera state. The same snapshot can be restored with Save > Restore display settings or a `state=` URL query;
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
Its **Transparent background** checkbox defaults to off: PNG files keep the
selected scene background color (white initially). Check it to retain alpha.
This affects only the exported image, leaving the scene and materials unchanged.

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

## Workbench UI preview

The Multiwfn toolbar and inspector now use local shadcn-svelte components:
Button, Popover, Select, Tabs, Slider and Tooltip. The structure renderer remains
MatterViz. Scene settings, original material presets, result selection and
analysis availability still use the existing callbacks and workbench state.
The UI source and local adaptations are documented in
`src/lib/components/ui/README.md`.

Use the normal `pnpm dev` command with a session manifest for local development.
Browser acceptance against a running preview containing the two density/ESP
fixture volumes is available as:

```bash
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium \
PREVIEW_URL=http://127.0.0.1:5197/ \
node tests/browser/workbench-ui.mjs
```

This checks keyboard navigation, popover dismissal and focus return, all four
lighting controls, material choices, display-setting download/restore, volume
visibility, backend-unavailability help, the single canvas lifecycle and a
600 px viewport. The supplied molecule preview has no calculation backend;
analysis controls retain their real unavailable state.


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

`pnpm test:representations` checks the molecule/density/ESP fixture in Chromium.
Set `PREVIEW_URL` to its manifest URL, `PLAYWRIGHT_MODULE` to an external Playwright
`index.mjs`, and optionally `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. `ARTIFACT_DIR` controls
where it saves screenshots, portable states and verification JSON. The fixture
expects two compatible grids named Density and ESP and at least 32 structure sites.
`workbench-ui.mjs` and `workbench-language.mjs` additionally cover the retained
advanced inspector.
`pnpm test:scene-export` checks downloaded PNG pixels for white, chosen-color and
transparent backgrounds, translucent materials, bilingual controls and unchanged
camera/scene state, using the same environment variables and surface fixture.
`pnpm test:rep-color` checks diffuse gain and saturation against actual WebGL
pixels for atoms, bonds, mapped surfaces and wireframes, including settings
round-trip and unchanged alpha/camera state.
