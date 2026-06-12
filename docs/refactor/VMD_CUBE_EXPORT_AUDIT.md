# VMD Cube Export Audit

This audit tracks why remaining `outcube` call sites do not always have a
one-to-one `maybe_write_vmd_cube_scene` call immediately after them.
It does not count non-cube volumetric exports. VASP grid exports such as
`CHGCAR` are covered by `maybe_write_vmd_volumetric_scene` and documented in
`docs/refactor/VMD_BRIDGE.md`.

Regenerate the current count summary with:

```sh
tools/audit-vmd-exports.sh
tools/audit-vmd-exports.sh check
```

The `check` mode is part of `tools/verify-refactor.sh quick`; it fails if the
documented counts below drift from the current production source tree. Test
fixtures under `tools/` and noGUI stubs are intentionally excluded from the
counts.

Current counts after the latest bridge coverage pass:

- `outcube` call sites in production Fortran sources: 70
- VMD bridge calls in production Fortran sources: 52

The difference is expected. Several menu actions write multiple cube files and
then call `maybe_write_vmd_cube_scene_list` once after the batch. Other call
sites produce internal template/cache files that should not automatically open
or generate a VMD scene.

## Covered By Batch Calls

These locations intentionally have fewer bridge calls than `outcube` calls:

- `excittrans.f90`: multi-branch exports for hole/electron variants, Cele/Chole,
  C+/C-, and magnetic transition dipole components are routed after the branch or
  as a multi-cube scene.
- `visweak.f90`: aNCI, IGM/mIGM/IGMH, aIGM/amIGM, TFI, and van der Waals
  workflows write multiple cubes in one menu action and then generate one scene.
- `basin.f90`: basin type/function pairs and selected per-basin cube batches are
  routed via `maybe_write_vmd_cube_scene_list`.
- `otherfunc.f90`: `func1.cub` and `func2.cub` are exported as a pair and loaded
  by one VMD scene.

## Intentionally Excluded

These cube outputs are not routed for now:

- `surfana.f90`: `template.cub` is a grid-alignment template for external
  cubegen-like workflows, not a user-facing visualization result.
- `otherfunc2.f90`: `rho_*.cub` files generated during orbital-fitting mode 2
  are cache/intermediate files used to construct the final fit. The final
  `fitted.cub` export is routed through VMD.

## Follow-Up

Dataset-aware cube scene generation is now available for known multi-dataset
exports such as `orbital.cub`. Future work should make the generated scenes
richer, for example by adding per-dataset labels and user-selectable colors.
