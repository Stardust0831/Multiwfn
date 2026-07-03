# Visualization Notes

The current visualization work keeps the Multiwfn Fortran core unchanged. The
first usable frontend is a static 3Dmol.js viewer under
`frontend/3dmol-viewer`.

## Current Boundary

- Multiwfn remains responsible for wavefunction analysis and cube generation.
- The frontend reads structure files and Gaussian cube files from disk.
- HOMO and LUMO are represented as two separate cube slots in the viewer.
- Positive and negative isosurfaces are rendered by 3Dmol.js from `VolumeData`
  parsed as `cube`.

This keeps the code path non-invasive: no Fortran menu or analysis routine is
changed for visualization yet.

## Manual Review Focus

Before adding a bridge layer, manually inspect real Multiwfn output in the
viewer:

1. Load a structure file.
2. Load a HOMO cube into the HOMO slot.
3. Load a LUMO cube into the LUMO slot.
4. Compare phase coloring, opacity, isovalue behavior, and molecular alignment.

If alignment differs between separately loaded structures and atoms extracted
from cube files, prefer loading an explicit structure file while the cube unit
handling is investigated.

## Next Integration Step

The likely bridge should be outside the Fortran core at first. It can run a
scripted Multiwfn workflow, collect generated structure and cube files, then
open the frontend or pass the files to a desktop viewer. This approach preserves
the cross-platform noGUI build and avoids replacing Multiwfn's existing
analysis implementation.
