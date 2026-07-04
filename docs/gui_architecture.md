# GUI Replacement Architecture Notes

This note evaluates whether a new GUI, the existing 3Dmol.js prototype, or
another frontend can take over Multiwfn's original DISLIN GUI without changing
the computational core.

## Short Answer

Yes, for visualization workflows that can be expressed as files. A new frontend
can use `Multiwfn_noGUI` as the compute process, collect structure and grid
artifacts, and render them outside Fortran. This path does not need changes to
the numerical analysis routines.

No, not as a transparent, button-for-button replacement of the original GUI
purely from outside the process. The original GUI callbacks mutate shared
Fortran globals, call plotting routines directly, and sometimes help define
calculation state such as grid boxes. Replacing that level of interactivity
requires either driving the console menus with scripted input or adding a thin
adapter boundary in front of existing routines.

The practical target is therefore:

- keep Fortran computation and file I/O unchanged;
- keep the original public `module GUI` entry points as the compatibility
  contract;
- bypass DISLIN rendering in the noGUI/3Dmol build;
- expose results as standard artifacts such as XYZ, PDB, cube, text tables, and
  optional metadata manifests;
- let the frontend own camera, style, surface display, labels, measurement, and
  other presentation concerns.

The active frontend target is the independent 3Dmol.js workbench in
`frontend/3dmol-viewer`. VMD is not part of the current replacement path. The
compatibility-oriented adapter plan is in `docs/3dmol_gui_adapter.md`.

## Current Code Shape

`CMakeLists.txt` currently supports only `Multiwfn_noGUI`. Setting
`MULTIWFN_BUILD_GUI=ON` fails intentionally and directs users back to the
original Makefile for a GUI build. The noGUI CMake target still compiles the
original `GUI.f90`, but replaces DISLIN module/procedure dependencies and mouse
rotation with empty stubs from `noGUI/`.

The relevant stubs have two styles:

- `noGUI/dislin_mod_empty.f90` defines DISLIN constants used at compile time.
- `noGUI/dislin_d_empty.f90` provides empty DISLIN routines. In non-DEBUG
  builds, `doesnotexist` does nothing, so accidental DISLIN calls become no-ops.
- `noGUI/mouse_rotate_empty.f90` provides an empty `mouse_rotate` callback.
- `noGUI/GUI_empty.f90` defines no-op GUI entry points, but the current CMake
  noGUI source list does not use it. The build stays closer to upstream by
  compiling the real `GUI.f90` and stubbing DISLIN instead.
- `noGUI/plot_external_empty.f90` defines no-op plotting/export helper entry
  points such as `drawmol`, but the current CMake noGUI source list compiles the
  real `plot.f90` instead.

`Multiwfn.f90` imports `GUI` at program start. Important GUI touch points are:

- empty filename input calls `selfileGUI`;
- startup probes screen size through DISLIN calls such as `METAFL`, `disini`,
  and `GETSCR`;
- main menu option `0` calls `drawmolgui` or `drawisosurgui`;
- many analysis modules call GUI entry points after producing data, including
  `drawisosurgui`, `drawplanegui`, `drawmoltopogui`, `drawsurfanalysis`,
  `drawbasinintgui`, `drawdomaingui`, `setboxGUI`, and `miniGUI`.

`GUI.f90` is mostly a DISLIN widget and callback layer. It sets `GUI_mode`,
builds windows, connects callbacks with `SWGCBK`, and then calls rendering or
state mutation routines. The main modes are:

- `GUI_mode=1`: molecular structure and orbital isosurfaces;
- `GUI_mode=2`: relief or shaded plane maps;
- `GUI_mode=3`: isosurface of existing grid data;
- `GUI_mode=4`: topology visualization;
- `GUI_mode=5`: surface analysis extrema;
- `GUI_mode=6`: basin or domain visualization;
- `GUI_mode=7`: box setup and minimal molecular viewing.

`plot.f90` contains `drawmol`, the DISLIN 3D rendering backend. It reads global
state from `defvar`, `topo`, `surfvertex`, and `basinintmod`, then draws atoms,
bonds, grid isosurfaces, critical points, paths, basins, surfaces, labels, axes,
and saved images. It is not a clean computation/presentation boundary; it is a
presentation backend over shared analysis state.

## Existing Frontend

`frontend/3dmol-viewer` is already a frontend-only workbench. It does not
invoke Multiwfn. It can:

- load structures from XYZ, PDB, SDF/MOL, MOL2, and PQR text files;
- load Gaussian cube files;
- keep independent cube layers for HOMO, LUMO, density, ELF, ESP, and custom
  scalar fields;
- draw signed, positive-only, and negative-only isosurfaces with adjustable
  isovalue, opacity, colors, surface smoothness, ambient occlusion, and outline;
- handle camera, axes, labels, spin, PNG export, and lightweight manifest
  export;
- extract atom positions from a cube file when no separate structure is loaded.

That prototype matches the least invasive integration boundary: Multiwfn
produces structure and cube files, and the browser renders them. However, the
longer-term replacement should still mirror the original `GUI.f90` modes rather
than becoming an unrelated file viewer.

## Artifact Boundary

Multiwfn already has useful file outputs that can become the bridge:

- `outxyz_wrapper` and `outxyz` export current coordinates as XYZ.
- `outpdb_wrapper` and `outpdb` export current coordinates as PDB, including
  periodic cell information when present.
- `outcube_wrapper` and `outcube` export `cubmat` to Gaussian cube format.
- `savecubmat` calculates grid data into `cubmat` for density, orbital, ESP,
  and other real-space functions.
- `procgriddata` can export loaded or computed grid data to cube files.

For a new frontend, the stable exchange set should be:

- structure: XYZ or PDB;
- grid/scalar fields: Gaussian cube;
- optional tabular outputs: existing text exports;
- optional metadata: a small JSON manifest generated by the bridge, not by the
  computation routines at first.

Example manifest shape:

```json
{
  "source": "example.fch",
  "structure": "example.xyz",
  "cubes": [
    { "role": "homo", "path": "homo.cub", "orbital": 42, "isovalue": 0.03 },
    { "role": "lumo", "path": "lumo.cub", "orbital": 43, "isovalue": 0.03 }
  ],
  "units": {
    "structure": "angstrom",
    "cube": "bohr"
  }
}
```

The manifest can be produced by an external wrapper after it runs Multiwfn and
knows which files were generated.

## Minimal Interface Plan

### Phase 1: External CLI/File Bridge

Build and run `Multiwfn_noGUI`. A wrapper script feeds deterministic menu input
to Multiwfn, waits for generated files, and opens or refreshes the frontend.

Responsibilities:

- Multiwfn: load wavefunction, run analyses, generate cube/structure/text
  artifacts.
- Wrapper: choose output paths, script menu input, normalize filenames, produce
  a JSON manifest, and launch the static frontend.
- Frontend: render structures and cube isosurfaces, handle all camera/style/UI
  interactions.

This is the safest path because it avoids Fortran changes and uses the current
noGUI build exactly as intended.

The wrapper should remain a separate program or script. Its only contract with
the frontend is a directory of artifacts plus a manifest. This prevents UI
iteration from forcing rebuilds of Multiwfn itself.

This phase is useful for proving rendering behavior, but it is not the final
interaction model. The manifest should already include original GUI semantics
such as `entry=drawisosurgui`, `GUI_mode=3`, `sur_value`, and
`iallowsetstyle`, so the frontend state matches Multiwfn's old GUI concepts.

Limitations:

- menu scripting is brittle when prompts change;
- interactive GUI-only conveniences such as visual box dragging must be
  represented as explicit numeric inputs or separate frontend-generated config;
- long-running calculations need process monitoring and cancellation behavior
  in the wrapper.

### Phase 2: Thin Adapter Boundary

If menu scripting becomes too fragile, add a small adapter layer that is still
outside the computational core. The adapter should call existing routines and
write artifacts, rather than changing numerical implementations.

Possible commands:

- `load <input>`;
- `export-structure --format xyz|pdb --out <path>`;
- `compute-cube --function <id> --orbital <n> --grid <spec> --out <path>`;
- `export-current-cube --out <path>`;
- `summary --out <json>`.

The adapter can be a separate Fortran file, a batch mode in the main program, or
an external process wrapper if avoiding Fortran edits remains a hard rule.

For GUI replacement, the preferred thin adapter is a replacement backend for
`module GUI` that preserves the public procedure names:

- `drawmolgui`;
- `drawisosurgui(iallowsetstyle)`;
- `drawplanegui(init1,end1,init2,end2,init3,end3,idrawtype)`;
- `drawmoltopogui`;
- `drawsurfanalysis`;
- `drawbasinintgui`;
- `drawdomaingui`;
- `setboxGUI`;
- `miniGUI`.

This adapter can be compiled instead of the DISLIN `GUI.f90` in a future
`MULTIWFN_GUI_BACKEND=3dmol` build while leaving the computation modules'
existing calls unchanged.

### Phase 3: Module Boundary Cleanup

Longer term, GUI replacement becomes cleaner if display-neutral routines are
separated from DISLIN-specific routines:

- artifact generation routines that never call DISLIN;
- state query routines for atoms, bonds, cell vectors, grid metadata, orbitals,
  and analysis results;
- a rendering backend interface where DISLIN and file/JSON exporters are peers.

This is not needed for the first usable 3Dmol bridge, but it is the direction if
the fork wants a maintainable native GUI or web UI.

## What Can Be Replaced Without Core Changes

Good candidates:

- molecular structure viewing from XYZ/PDB/cube atoms;
- orbital and scalar-field isosurfaces from cube files;
- HOMO/LUMO comparison if the wrapper exports separate cubes;
- camera, style, opacity, colors, labels, simple atom highlighting, and
  measurement in the frontend;
- saved images from the browser instead of DISLIN.

Partial candidates:

- plane maps and line plots, if Multiwfn exports numeric grids/tables and the
  frontend renders them;
- topology, basin, domain, and surface-analysis views, if their computed
  points, paths, surfaces, or labels are exported in a structured form;
- grid box setup, if the frontend writes numeric grid extents and spacing that
  the wrapper feeds back to Multiwfn.

Poor candidates for a no-change replacement:

- callbacks that mutate live Fortran globals inside `GUI.f90`;
- direct replacement of `drawmol` while preserving every DISLIN-specific display
  option;
- any workflow where the only available result exists in memory and has no file
  export path.

## Risks

- Unit handling needs explicit validation. XYZ/PDB exports use Angstrom, while
  cube headers and atom coordinates written by `outcube` use the grid's native
  Bohr values. The frontend must not silently mix coordinate systems.
- 3Dmol.js supports orthogonal cube data well, but Multiwfn warns that
  non-orthogonal grids do not display normally in its own GUI. Non-orthogonal or
  periodic cases need targeted checks.
- Multiwfn menus are human-oriented. A wrapper that drives prompts can break
  after upstream text or option changes.
- The original GUI contains workflow logic, not only drawing. Some controls
  change global state used by later calculations.
- Large cube files can be expensive in a browser. The bridge may need default
  grid limits, downsampling, compression, or a desktop frontend for heavy cases.
- DISLIN no-op stubs make noGUI builds link, but they do not create semantic
  output. A caller that relies on a GUI callback to do non-display work must be
  audited before being bypassed.

## Recommendation

Proceed with the external CLI/file bridge first. It gives a real frontend path
without touching the calculation source and aligns with the current
`frontend/3dmol-viewer` prototype. Treat the original DISLIN GUI as legacy
interactive presentation. Only add a thin command or artifact adapter after
specific scripted workflows prove too fragile.

The first production-quality workflow should be narrow:

1. Load a wavefunction or structure file in `Multiwfn_noGUI`.
2. Export an XYZ or PDB structure.
3. Generate selected cube files, for example HOMO and LUMO.
4. Write a wrapper-owned JSON manifest.
5. Open the 3Dmol frontend with those artifacts.

This boundary keeps computation in Multiwfn and puts visualization in the new
frontend, which is the cleanest way to avoid invasive changes.
