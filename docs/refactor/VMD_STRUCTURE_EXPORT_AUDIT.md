# VMD Structure Export Audit

This audit tracks VMD bridge coverage for user-facing structure export paths.
The bridge is intentionally attached to interactive wrapper or direct menu
exports, not to low-level structure writers, so internal temporary files remain
side-effect free.

Regenerate the current count summary with:

```sh
tools/audit-vmd-structure-exports.sh
tools/audit-vmd-structure-exports.sh check
```

The `check` mode is part of `tools/verify-refactor.sh quick`; it fails if the
documented counts below drift from the current production source tree. Test
fixtures under `tools/` and noGUI stubs are intentionally excluded from the
counts.

Current counts:

- Structure wrapper definitions in production Fortran sources: 4
- Wrapper-level VMD structure bridge calls in production Fortran sources: 4
- Explicit non-wrapper VMD structure bridge calls in production Fortran sources: 6
- Total VMD structure bridge calls in production Fortran sources: 10

## Covered Structure Paths

The four interactive wrappers covered by the bridge are:

- `outpdb_wrapper`: writes PDB and then generates a PDB scene.
- `outpqr_wrapper`: writes PQR and then generates a PQR scene.
- `outxyz_wrapper`: writes XYZ and then generates an XYZ scene.
- `outgro_wrapper`: writes GRO and then generates a GRO scene.

The file export menu also has an explicit PBC PDB path that writes `mol.pdb` via
`outpdb_PBC`; this path is covered by a direct call to
`maybe_write_vmd_structure_scene("mol.pdb","pdb")` because it is a user-facing
export rather than an internal helper.

The ESP charge fitting workflow can export `ESPfitpt.pqr` and `ESPerr.pqr`,
where the PQR charge field carries the ESP value or fitting error. These two
user-selected point-cloud exports are routed through direct PQR scene calls so
VMD can load them and color by charge.

The atomic dispersion contribution workflow can export `atomdisp.pqr` and
`diffatomdisp.pqr`, where the PQR charge field carries the atomic dispersion
contribution or its difference between systems. These single-file, user-selected
exports are routed through direct PQR scene calls.

The EDA-FF atom contribution workflow can export the related `atmint_tot.pqr`,
`atmint_ele.pqr`, `atmint_rep.pqr`, `atmint_disp.pqr`, and `atmint_vdW.pqr`
files in one menu action. These are routed through a multi-structure PQR scene
call so one generated Tcl file loads all five charge-colored contribution
variants.

## Intentionally Excluded

Low-level writers such as `outpdb`, `outpqr`, `outxyz`, `outgro`, and
`outpdb_PBC` remain side-effect free. Direct calls that create temporary or
analysis-specific structure files should opt in to the VMD bridge only when the
call site is a user-facing visualization export.

Current examples of intentionally excluded direct writer calls include:

- `EDA.f90`: temporary XYZ files used by dispersion workflows remain excluded.
- `surfana.f90`: PDB output used by molecular surface analysis internals.
- `fileIO.f90`: CML/CIF exports are not routed through VMD in this bridge pass.
