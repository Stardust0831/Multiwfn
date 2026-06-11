# VMD Bridge

## First-pass design

The first VMD bridge is deliberately low-intrusion. Multiwfn still performs all
wavefunction and grid calculations. The bridge only acts after cube export:

1. A Multiwfn workflow generates `cubmat`.
2. The user exports cube data through a supported export path.
3. If VMD scene generation is enabled, Multiwfn writes a VMD Tcl scene script.
4. If VMD launching is enabled, Multiwfn calls VMD with the generated script.

This avoids source-level fusion with VMD and keeps low-level `outcube` free of
automatic side effects.

## Configuration

Settings in `settings.ini`:

- `vmdpath`: VMD executable path. Default: `"vmd"`.
- `vmdscenefile`: generated Tcl scene path. Default: `"multiwfn_scene.tcl"`.
- `vmdmaterial`: material for generated isosurface representations. Default:
  `Transparent`.
- `ivmdscene`: if `1`, generate a VMD scene after supported cube exports.
- `ivmdrun`: if `1`, launch VMD after scene generation.

Command-line overrides:

- `-vmd`: enable scene generation.
- `-vmdrun`: enable scene generation and launch VMD.
- `-vmdpath PATH`: override the VMD executable path.
- `-vmdscene PATH`: override the generated Tcl scene path.
- `-vmdmaterial MATERIAL`: override the VMD isosurface material.

## Supported export paths

Initial coverage:

- Generic cube export through `outcube_wrapper`.
- Main 3D grid post-processing cube export in `study3dim`.
- CDFT cube exports for Fukui functions, dual descriptors, orbital-weighted
  Fukui functions, and Fukui potential / dual descriptor potential.
- Weak-interaction cube exports for aNCI averaged RDG/sign(lambda2)rho/density
  and TFI, IGM/mIGM/IGMH delta-g grids, aIGM/amIGM averaged grids and TFI, and
  van der Waals potential grids.
- Basin analysis cube exports for basin index grids, selected basin functions,
  basin-type helper grids, per-basin cube batches, and `basinana.cub` state
  exports.
- Electron excitation exports for hole/electron distributions, transition
  density, transition dipole density, charge-density difference, Cele/Chole
  functions, C+/C- charge-transfer functions, density polarization, and external
  potential grids.
- ETS-NOCV exports for NOCV orbitals, NOCV pair density, Pauli deformation
  density, orbital deformation density, and total deformation density.
- EDA atomic dispersion contribution cube exports.
- Molecular surface analysis exports for `surf.cub` and `mapfunc.cub`.
- Other functions part 3 exports for free-region grids and STM LDOS grids.

Future work:

- Add helper calls to any remaining specialized cube outputs not yet covered by
  the explicit export-point strategy.
- Generate richer VMD scenes for critical points, topology paths, molecular
  surfaces, arrows, and multi-cube overlays.

Coverage is being expanded at explicit user-facing export points instead of by
adding side effects to the low-level `outcube` writer. This avoids launching VMD
for temporary cube files used internally by calculations.

For workflows that export multiple cube files in one action, the bridge can now
write a single VMD scene that loads all exported cube files. This is used for
weak-interaction batch exports such as IGM delta-g grids and for selected basin
cube batches.

Specialized exporters pass analysis-specific default isovalues where Multiwfn
already uses one for on-screen isosurfaces, for example hole/electron
distributions and transition densities in the excitation module.

## Smoke test

The bridge can be tested without launching VMD:

```sh
tools/gnu-build.sh vmd-smoke
```

This compiles a minimal driver and verifies that generated Tcl scenes can load a
single cube file or multiple cube files, add molecular and positive/negative
isosurface representations, and use the configured VMD material.

## Rationale

VMD is treated as an external executable. This respects VMD's main program
license boundary and avoids introducing its build system into Multiwfn.
