# 3Dmol GUI Adapter Plan

The 3Dmol GUI should follow Multiwfn's original GUI contract as closely as
possible. The frontend may be web-based, but the interaction model should be a
replacement backend for the existing `module GUI`, not an unrelated viewer.

## Compatibility Principle

The stable boundary is the public subroutine set already used throughout
Multiwfn:

| Original entry | `GUI_mode` | Current meaning | 3Dmol target |
| --- | ---: | --- | --- |
| `selfileGUI` | - | select input file | keep current console/noGUI behavior or open wrapper-owned file picker |
| `drawmolgui` | 1 | molecular structure and orbital isosurfaces | structure workbench with orbital selector, second isosurface, cell, labels, measurement, style controls |
| `drawplanegui(init1,end1,init2,end2,init3,end3,idrawtype)` | 2 | relief/shaded plane maps | Plotly 2D/2.5D map panel using original plane bounds and draw type |
| `drawisosurgui(iallowsetstyle)` | 3 | existing `cubmat`/`cubmattmp` isosurfaces | cube workbench initialized from current grid arrays, preserving `iallowsetstyle` |
| `drawmoltopogui` | 4 | topology CPs and paths | structure view with CP/path overlays from exported topology artifacts |
| `drawsurfanalysis` | 5 | surface minima/maxima | structure/surface view with extrema point overlays and labels |
| `drawbasinintgui` | 6 | attractors and basins | basin selector plus basin/grid overlays |
| `drawdomaingui` | 6 | integration domains | domain selector plus domain overlays |
| `setboxGUI` | 7 | grid box setup | box editor that writes `orgx/endx/gridv*` equivalent settings |
| `miniGUI` | 7 | minimal molecular viewer | light structure viewer using the same style/camera controls |

This means a future 3Dmol adapter may legitimately provide a replacement
`module GUI` with the same procedure names and be compiled instead of the
DISLIN implementation.

## Backend Shape

The preferred implementation is a new Fortran GUI adapter layer that keeps
calculation routines untouched. The current demo implements this shape in
`noGUI/GUI_3dmol.f90` and can be selected with
`-DMULTIWFN_GUI_BACKEND=3dmol`.

1. Keep the original public `module GUI` procedure signatures.
2. In each GUI entry, snapshot the same global state that the DISLIN GUI would
   draw or edit.
3. Write artifacts into a session directory:
   - structure: PDB preferred, XYZ acceptable;
   - scalar grids: Gaussian cube from `cubmat`, `cubmattmp`, `rhocub`, or
     selected orbital calculations;
   - 2D maps and curves: CSV/JSON generated from existing 1D/2D arrays;
   - overlays: JSON for CPs, paths, extrema, basins, domains, box ranges, and
     labels.
4. Write a manifest using original GUI mode names and state variables.
5. Launch or refresh the 3Dmol frontend with `?manifest=<path-or-url>`.

The first adapter can be file-based and one-shot. A later adapter can keep a
small local HTTP server or WebSocket channel for live callbacks.

## Important Original Behaviors To Preserve

### Molecular/Orbital GUI

`drawmolgui` is not just a molecule viewer. It exposes:

- orbital list and text orbital selector;
- first and second isosurface selection;
- `sur_value_orb`;
- isosurface style for each sign/layer;
- isosurface grid quality presets based on `nprevorbgrid`;
- view controls: rotate, zoom, focus point, perspective/orthographic;
- atom style: CPK, vdW, line, bond threshold, bond radius, atom scale;
- labels, axes, hydrogens, cell frame, data range, boundary atoms;
- measurement, fragment selection, coordinate export, and GUI settings.

The 3Dmol frontend should therefore keep an explicit "Molecular/Orbital" mode
instead of presenting only generic file layers.

### Existing Grid Isosurface GUI

`drawisosurgui(iallowsetstyle)` visualizes the current in-memory grid:

- `cubmat` is isosurface 1;
- `cubmattmp` is isosurface 2 when present;
- `sur_value` and `drawisosurgui_*` define the isovalue UI;
- `iallowsetstyle=1` means only isosurface 1 style is editable;
- `iallowsetstyle=2` means both isosurfaces share editable style options;
- original Multiwfn warns that non-orthogonal grids are not displayed normally.

The 3Dmol backend should export `cubmat` and `cubmattmp` directly and set the
frontend mode to "Grid Isosurface".

### Plane/Curve GUI

`drawplanegui` and the old plotting routines are part of the GUI replacement
surface. They should map to a 2D/2.5D Plotly panel, not to 3Dmol. The adapter
should preserve:

- original draw type: relief, shaded relief, shaded relief with projected
  filled map;
- plane bounds and axes;
- label/path/CP projection information where available;
- saved picture behavior.

### Box Setup GUI

`setboxGUI` mutates grid definition variables:

- `orgx/orgy/orgz`;
- `endx/endy/endz`;
- `gridv1/gridv2/gridv3`;
- `dx/dy/dz`;
- `nx/ny/nz`.

This is the main case where a pure artifact viewer is insufficient. The 3Dmol
replacement needs a return channel that writes updated numeric box settings
back to Multiwfn or emits a config that the wrapper feeds into the next
calculation.

## Manifest Direction

Add original GUI semantics to the manifest instead of only frontend semantics:

```json
{
  "format": "multiwfn-3dmol-workbench",
  "version": 2,
  "multiwfnGui": {
    "entry": "drawisosurgui",
    "guiMode": 3,
    "allowSetStyle": 2,
    "state": {
      "sur_value": 0.5,
      "showBothSign": true,
      "showMolecule": true,
      "showCell": true
    }
  },
  "structure": { "path": "structure.pdb", "format": "pdb" },
  "cubes": [
    { "name": "cubmat", "path": "cubmat.cube", "role": "grid", "mode": "signed" },
    { "name": "cubmattmp", "path": "cubmattmp.cube", "role": "grid", "mode": "signed" }
  ]
}
```

The frontend can still expose modern layout and 3Dmol/Plotly controls, but
the mode and default controls should be initialized from `multiwfnGui`.

## Implementation Order

1. Add frontend modes matching `GUI_mode` and initialize control groups from
   `multiwfnGui.entry`.
2. Extend the Fortran artifact exporter so it covers more original GUI state
   and overlays, beyond the current structure plus `cubmat`/`cubmattmp` demo.
3. Harden the optional build switch that compiles a `module GUI` replacement
   backed by this exporter.
4. Start with `drawisosurgui`, `drawmolgui`, `drawplanegui`, and `setboxGUI`;
   these cover the most important visual and grid workflows.
5. Add topology, surface extrema, basin, and domain overlays as structured JSON
   once their data structures are audited.
