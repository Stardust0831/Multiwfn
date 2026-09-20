# Representation workbench

The workbench uses VMD's representation model: a list of independently visible
representations, with one editor for the selected representation. Each Rep owns
its data source, drawing method, material, and periodic display. Camera, lighting,
background, analysis actions and data loading belong to the scene/session.

## Acceptance requirements

- Create, duplicate, rename, reorder, hide and delete multiple structure/volume
  Reps. Render them together in one camera and one canvas. Editing a Rep must not
  alter another Rep or the source scientific data.
- Select source type, then source dataset, then drawing settings. Support the
  existing molecular styles, signed isosurfaces and coloring from another volume.
  Retain orbital calculation, ESP analysis/legend, slices, AIM, quantitative
  surfaces, measurement, editing, plots and export through clear tool entry points.
- Provide material presets and numeric opacity, diffuse reflection, highlight
  strength, highlight sharpness/roughness and metallic controls. Hide/disable
  controls that do not affect the chosen model. Diffuse reflection is an optical
  display coefficient, not a claim of physical subsurface scattering.
- Each Rep has independent fractional a/b/c ranges (including negative and
  noninteger bounds), periodic axes and editable a/b/c translation vectors in Å.
  Custom translation vectors move copies; they never deform source coordinates
  or resample scalar values. Reject singular cells and invalid ranges visibly.
- Bound replication and geometry allocation. Reuse mesh geometry for repeated
  volume copies. Preserve source atom identities for selections and measurements.
- Persist all Reps, stable source identities and selected Rep. Migrate old saved
  scenes into equivalent Reps, including cross-volume coloring and periodic state.
- Chinese/English labels, keyboard operation, narrow-screen layout and a usable
  local preview. Verify both domain behavior and real WebGL rendering/interactions.

## Controls and behavior

The left rail opens Reps. **Tools → Edit atoms and bonds…** opens the source
structure editor. The selected Rep has
three tabs: **Data & drawing**, **Appearance**, and **PBC**. Reps can be added,
duplicated, named, reordered, hidden and deleted. The Scene scope holds the shared
camera, fit-to-visible action, background, four lights and measurement mode.

- Structure selections accept `all`, `element C O`, or `index 1-6, 9` (1-based).
  Drawing presets are Ball+Stick, Spacefill, Stick and Wire. Radius and bond
  thickness fields show the actual renderer values. Element labels and atom
  indices stay available, including source indices for periodic copies.
- Volume Reps choose a dataset, isovalue, positive/negative colors, surface or
  wireframe, and an optional compatible color grid, palette and manual range.
  The ESP legend follows the selected visible mapping.
- Appearance uses opacity and diffuse reflection with matte, glossy, PBR and
  unlit models. Glossy exposes highlight strength/sharpness; PBR exposes
  roughness/metalness. Atoms, gradient-colored bonds and surfaces use the same
  models. Glass presets set opacity to 0.35; opaque presets set it to 1. Rim
  contrast, rim width and angle-dependent opacity are optional refinements.
  Diffuse reflection ranges from 0 to 3 (1 is the original response; values above
  1 amplify diffuse light). Saturation independently ranges from 0 (grayscale)
  through 1 (unchanged) to 3 (enhanced), including unlit and wireframe materials.
  Saturation operates after tone mapping, before output color conversion and
  transparency blending; source colors, scalar data and color-scale ranges are
  unchanged. Missing values default to 1 when loading older saved scenes; both
  controls reset to 1 when applying a material preset.
- PBC changes are staged until **Apply periodic display**. Each Rep has its own
  axes, fractional bounds and optional nonsingular translation matrix in Å.
  Structure boundaries can clip geometry, include whole boundary atoms, or
  exclude upper-boundary atoms. Volumes always clip to the requested domain.
  Custom vectors translate copies without deforming source atoms or grids.
- Atom/bond edits in the advanced editor modify the shared source. Its legacy
  display controls remain available in that view. Independent Rep appearance
  remains in each Rep's editor. AIM, quantitative surface analysis, ESP, orbitals,
  slices, numeric plots, exports and the updater retain their existing entries.
- **Save → Transparent background** controls 3D PNG exports. It is unchecked by
  default, preserving the chosen scene background color (initially white) as an
  opaque background. Checked exports retain PNG alpha, including translucent
  materials; neither choice changes the displayed scene or its saved settings.

Automatically created volume Reps follow backend/orbital changes until edited or
copied. User-owned Reps keep their datasets, including hidden color sources,
when the orbital cache is compacted. Stable file/slot identities distinguish
multiple grids from one file; missing data is reported instead of substituted.

## Rendering and compatibility

`RepLayer` mounts geometry-only MatterViz scenes in the existing `Structure`
scene snippet. The host keeps the single camera and lighting rig. Rep materials
and selections are isolated. Volume copies share one extracted geometry/material
set per Rep. Idle scenes do not run a permanent animation loop for these adapters.
Fractional clipping uses the inverse cell (including skew and reflected cells),
transformed to world coordinates for rendering and raycasting. Fit-to-visible
uses the clipped bounds and ignores hidden extraction meshes.

Resource limits are 32 Reps, 512 volume copies per Rep, 100,000 expanded atoms per
structure Rep, and fractional bounds between −20 and 20. Initial migration creates
at most 31 volume Reps alongside the structure; all loaded datasets remain
available in the source selector. Isosurface extraction also shares the session's
configured memory budget between visible volume Reps.

Saved version-1 workbench files gain an optional `representations` collection.
Old snapshots migrate their layers, materials, supercell dimensions, boundary
atom choice and cell visibility. New snapshots retain selection, order, source
identity, coloring, materials and custom PBC. Invalid cells, ranges and duplicate
Rep IDs are rejected. PBC display and Rep selection never mutate scientific data.

The `reps1` vendor patch replays onto `upstream1`; every installed package file
has been compared with the archive. Earlier topology, material, parsing and
sampling fixes are preserved. Reproduction commands are in the frontend README.

## Verification

- `tests/reps.test.ts`: independent copies, lattice transforms, reflected/skew
  clipping, bounded allocation, explicit bond orders, source immutability,
  source identities, migration, saved states, live material uniforms, clipped
  picking, and clipped fit bounds.
- `tests/browser/representations.mjs`: real molecule + density/ESP WebGL overlay,
  create/delete and source selection, PBR atoms and bonds, glass, independent
  volume/structure PBC, shared volume geometry, invalid cells, save/restore,
  source-index measurements, deselection, source-bond deletion/undo propagation,
  bilingual state preservation, keyboard
  actions and collapsible 600 px layout. No page or shader errors.
- `tests/browser/scene-export.mjs`: downloaded PNG pixels for opaque white,
  chosen-color and transparent backgrounds; translucent surface alpha; unchanged
  scene, materials and camera; bilingual export and source-editing controls.
- `tests/browser/rep-color.mjs`: actual grayscale, enhanced saturation and
  diffuse gain in all material models, bond gradients and mapped/wireframe
  surfaces, with unchanged alpha/camera and independent saved settings.
- Existing advanced UI and language browser regressions pass. The topology
  browser regression retains ordinary/analysis measurements, hidden-bond picking,
  editing, partial occupancies, labels and surface visibility masks.
- Final verification: frontend tests pass with one existing skip; Svelte
  reports zero errors/warnings; production build and all eight vendor replay
  tests pass. Screenshots and portable scene
  states are emitted by the browser acceptance test.

For local sessions, use `PREVIEW_PUBLIC_DIR=/path/to/preview/public pnpm preview:session`
from `frontend/matterviz-viewer`; the directory must contain `session/manifest.json`
and its existing data. Open `http://127.0.0.1:5297/`. An alternate manifest can be
selected with `?manifest=/session/surface-manifest.json`.
