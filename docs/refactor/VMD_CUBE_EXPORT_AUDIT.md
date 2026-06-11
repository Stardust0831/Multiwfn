# VMD Cube Export Audit

This audit tracks why remaining `outcube` call sites do not always have a
one-to-one `maybe_write_vmd_cube_scene` call immediately after them.

Current counts after the latest bridge coverage pass:

- `outcube` call sites in Fortran sources: 70
- VMD bridge calls in Fortran sources: 55

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
- `otherfunc2.f90`: `orbital.cub` can contain multiple orbital datasets in one
  cube file. The current bridge assumes a single scalar dataset, so this should
  wait for dataset-aware VMD scene generation.

## Follow-Up

The next visualization-focused improvement should be dataset-aware cube scene
generation. That would make it reasonable to support `orbital.cub` and any other
multi-dataset cube files without showing the wrong grid by default.
