# Visualization Notes

The current visualization work keeps the Multiwfn Fortran calculation modules
unchanged. The active frontend is the MatterViz workbench under
`frontend/matterviz-viewer`, and the GUI/session adapter is
`noGUI/GUI_matterviz.f90`. The older 3Dmol.js prototype remains only as a
legacy reference; it is not staged or loaded by the MatterViz backend.

## Current Boundary

- Multiwfn remains responsible for wavefunction analysis and scalar-grid
  calculation.
- The optional `MULTIWFN_GUI_BACKEND=matterviz` CMake build compiles a replacement
  `module GUI` that preserves the original GUI entry point names.
- Periodic and nonperiodic sessions serialize one MatterViz-native structure
  object; explicit bonds are carried in root `properties.bonds`. Formal sessions
  send this object in memory and Rust serves it at `/session/structure.json`.
- The frontend reads a structured in-memory manifest and binary scalar volumes
  from stable Rust Host URLs. Normal sessions do not stage manifest, structure
  or Cube artifacts.
- HOMO, LUMO, density, ELF, ESP, and custom cube data are represented as
  independent layers in the viewer.
- Positive and negative isosurfaces are rendered by MatterViz from flat typed
  scalar grids, with Worker meshing and bounded resource ownership.
- Camera, lighting-style effects, colors, labels, axes, spin, PNG export, and
  scene state export are owned by the frontend.
- Periodic visualization is handled as frontend display metadata: unit-cell
  vectors, fractional display ranges, atom repetition, and optional cube-surface
  tiling.
- Scalar-grid slices are rendered by the frontend from the same binary volumes.

This keeps the code path non-invasive: no Fortran menu or analysis routine is
changed for visualization. The demo only swaps the GUI module boundary.

## Manual Review Focus

Manually inspect real Multiwfn output in the packaged viewer:

1. Load a structure file.
2. Add HOMO, LUMO, density, ELF, ESP, or other scalar-volume layers.
3. Compare signed/positive/negative display modes, phase coloring, opacity,
   isovalue behavior, and molecular alignment.
4. Test volume cross-coloring, for example density or IRI as the surface and
   ESP or sign(lambda2)rho as the color field.
5. Test slices and presentation-state export/restore.
6. Confirm Return resumes the terminal and a formal session leaves no writable
   session directory or dynamic Cube file.

## Integration Discipline

The bridge remains outside the Fortran calculation core. The GUI/session
adapter serializes current in-memory structure and volume data into versioned
pipe messages, then opens the MatterViz workbench. Rust preserves the frontend
URL contract while owning lifecycle, validation and bounded delivery. Explicit
diagnostic Cube/file mode must not become an automatic fallback.

Periodic cube support must continue to be validated with real Multiwfn outputs,
especially non-orthogonal cells and cross-boundary connectivity. Missing native
GUI/session data chains must be recorded as output-protocol gaps rather than
filled by external-output parsers or DOM scraping.
