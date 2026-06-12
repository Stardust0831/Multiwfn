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
- Explicit non-wrapper VMD structure bridge calls in production Fortran sources: 7
- Total VMD structure bridge calls in production Fortran sources: 11

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

The IGM/IBSIW atomic contribution workflow can export `atmdg.pdb`, whose Beta
and Occupancy fields carry atomic delta-g contribution measures. This user
selected PDB export is routed through a direct scene call using VMD's Beta color
method so the primary contribution field is visible immediately.

## Intentionally Excluded

Low-level writers such as `outpdb`, `outpqr`, `outxyz`, `outgro`, and
`outpdb_PBC` remain side-effect free. Direct calls that create temporary or
analysis-specific structure files should opt in to the VMD bridge only when the
call site is a user-facing visualization export.

Current examples of intentionally excluded direct writer calls include:

- `EDA.f90`: temporary XYZ files used by dispersion workflows remain excluded.
- `surfana.f90`: PDB output used by molecular surface analysis internals.
- `fileIO.f90`: CML/CIF exports are not routed through VMD in this bridge pass.

## Format Support Boundary

CML and CIF are user-facing structure exports in Multiwfn, but they are not
currently routed through the VMD bridge. The official VMD molfile plugin
documentation checked on 2026-06-12 lists structure readers for formats such as
PDB, PQR, GRO, Mol2, POSCAR, XSF, and XYZ, and lists Gaussian cube under
volumetric data readers. It does not list a dedicated CIF or CML structure
plugin in that official molfile table:

- https://www.ks.uiuc.edu/Research/vmd/plugins/molfile/

The bridge therefore avoids generating CIF/CML VMD scenes until support is
verified against a reliable VMD plugin source or an installed VMD build. If CIF
or CML support is added later, record the exact VMD `mol new ... type` token and
add a smoke scene that can be sourced by `tools/vmd-scene-source-check.sh`.

## Remaining Structure Candidates

- Mol2: VMD documents a Mol2 structure reader, but this source tree currently
  exposes Mol2 as an input/read path rather than a user-facing structure export
  path. There is no `outmol2` wrapper to route through the bridge.
- POSCAR: Multiwfn has a user-facing `outPOSCAR_wrapper`, and VMD documents VASP
  POSCAR/CONTCAR support. This is a plausible bridge candidate, but it is not
  wired yet because the exact VMD `mol new ... type` token has not been verified
  from an installed VMD build or plugin source. Do not guess the token in
  production scene generation.
