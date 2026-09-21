# MatterViz vibration session protocol

Status: protocol v1. This document describes the vibrational normal-mode
animation session introduced for the MatterViz GUI backend (issue #65). It is a
standalone session kind with its own manifest format and its own frontend entry
document; the workbench manifest (`multiwfn-matterviz-workbench`, version 2) is
unchanged.

## Ownership and launch topology

The session reuses the formal native launch in
[`matterviz-control-protocol.md`](matterviz-control-protocol.md): the Fortran
adapter spawns the Rust host with inherited `MWFNCTL`/`MWFNVOL`/`MWFNP2D`
pipes, publishes the displacement dataset, sends one `session_init` control
frame and then waits for shutdown. No new control message types and no new
request commands are introduced; the vibration page issues no backend commands
beyond the generic `/api/ready` and `/api/return` lifecycle endpoints.

- Fortran owns frequency/normal-mode parsing (Gaussian, ORCA, CP2K and xTB
  output conventions, mirroring the spectrum module's PVS loaders), session
  and manifest serialization, and displacement publication. No calculation
  routine changes.
- Rust validates the vibration manifest fail-closed, serves
  `/session/manifest.json`, `/session/structure.json` and
  `/api/plot-data/<id>`, and opens `vibration.html` instead of `index.html`
  when the manifest format is `multiwfn-matterviz-vibration`.
- The frontend owns pattern normalization, frame synthesis and playback,
  following the upstream MatterViz phonon components
  (`src/lib/spectral/phonon-modes.ts`): the largest per-atom excursion of a
  mode is normalized to exactly 1 Angstrom and one phase cycle of frames is
  synthesized as `xyz(t) = xyz0 + amplitude * u * cos(2 pi k / N)` with the
  instantaneous displacement attached as the per-site `force` vector property.
  Animation defaults mirror upstream: amplitude 0.3 Angstrom, 48 frames per
  cycle, 24 fps.

The session requires the native in-memory host; the diagnostic Cube fallback
(`MULTIWFN_MATTERVIZ_ALLOW_CUBE_FALLBACK=1`) is rejected, as with topology.

## Menu entry and stdin-driven launcher

The GUI entry point is `drawvibgui` in `module GUI`
(`noGUI/GUI_matterviz.f90`), invoked from the spectrum menu (main function 11,
option 26 "Animate vibrational modes in MatterViz GUI") for IR/Raman/VCD/ROA
spectra of a single system. Non-MatterViz backends carry a stub that reports
the requirement.

`tools/multiwfn_vibration_viewer.py` is the standalone executable entry. It
starts `Multiwfn <output-file>` and feeds the numeric menu path over stdin —
`11`, the spectrum selector (`1` IR, `2` Raman, `5` VCD, `6` ROA), `26` — then
`-3` and `q` after the GUI session ends. For xTB output the companion g98.out
path is supplied with `--g98-out` and fed at the extra prompt. This follows
the external-orchestration model of issue #58: Multiwfn is driven entirely
from the outside and the computational core is untouched.

## Manifest

The `session_init` frame carries a manifest of format
`multiwfn-matterviz-vibration`, version 1:

```json
{
  "format": "multiwfn-matterviz-vibration",
  "version": 1,
  "generatedBy": "Multiwfn_MatterViz",
  "multiwfnGui": { "entry": "drawvibgui" },
  "structure": { "path": "structure.json", "format": "json" },
  "vibrations": {
    "sourceProgram": "gaussian",
    "spectrumKind": "ir",
    "atomCount": 3,
    "modeCount": 3,
    "coordinateUnit": "angstrom",
    "frequencyUnit": "cm^-1",
    "intensityUnit": "km/mol",
    "displacementConvention": "normalized Cartesian (not mass weighted), as printed by the source program",
    "modes": [
      { "index": 1, "frequency": 1650.0, "intensity": 61.5 },
      { "index": 2, "frequency": 3820.0, "intensity": 4.2 },
      { "index": 3, "frequency": 3935.5, "intensity": 0.9 }
    ],
    "displacements": {
      "datasetId": 1,
      "format": "mwfn-plot-data-v1",
      "role": "u",
      "layout": "mode-major-atom-xyz",
      "shape": [3, 3, 3]
    }
  }
}
```

- `sourceProgram` is `gaussian`, `orca`, `cp2k` or `xtb`.
- `spectrumKind` is `ir`, `raman`, `vcd` or `roa`. `intensityUnit` is
  `km/mol` for IR, `A^4/AMU` for Raman and null otherwise; `intensity` is null
  when no intensity is carried.
- `frequency` is signed: negative values denote imaginary modes and are
  flagged in the viewer.
- `displacementConvention` documents that vectors are the normalized
  Cartesian displacement patterns printed by the source program (Gaussian
  "Atom AN" tables, CP2K "ATOM EL" tables, the ORCA normal-mode matrix, and
  the xTB companion g98.out), i.e. not mass weighted. Absolute scale is
  irrelevant because the viewer normalizes each mode to a 1 Angstrom maximum
  excursion before applying the display amplitude.

## Displacement dataset

Displacement vectors ride the existing `MWFNP2D` v1 binary channel
([`matterviz-plot-protocol-v2.md`](matterviz-plot-protocol-v2.md)) as one
dataset with a single `u` (4) role array of `modeCount * atomCount * 3`
little-endian f64 values in mode-major `[mode][atom][xyz]` order. The dataset
ID is allocated from the same per-session serial as volumes and plot datasets
and is referenced from the manifest; the frontend fetches it from
`/api/plot-data/<id>` with the session capability. The dataset ID doubles as
the transport ACK identity, matching the plot-layer convention.

## Validation

- Rust bootstrap validation (`session_data.rs`) accepts exactly the workbench
  v2 and vibration v1 manifest formats, requires `atomCount`/`modeCount` to be
  positive (mode count capped), the declared units, `modeCount` mode entries
  with finite frequencies and finite-or-null intensities, a nonzero dataset ID
  and a shape of `[modeCount, atomCount, 3]`, with checked sample-count
  arithmetic.
- The frontend revalidates the same contract plus dataset length, structure
  site count, finite coordinates and element symbols before animating. An
  explicitly empty bond list is dropped so the renderer auto-detects bonds for
  output files that carry no connectivity.
