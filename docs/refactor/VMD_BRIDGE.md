# VMD Bridge

## First-pass design

The first VMD bridge is deliberately low-intrusion. Multiwfn still performs all
wavefunction and grid calculations. The bridge only acts after cube export:

1. A Multiwfn workflow generates `cubmat`.
2. The user exports cube data through a supported export path.
3. If VMD scene generation is enabled, Multiwfn writes a VMD Tcl scene script.
4. If VMD launching is enabled, Multiwfn calls VMD with the generated script.

This avoids source-level fusion with VMD and keeps low-level `outcube` and
structure writers free of automatic side effects.

## Configuration

Settings in `settings.ini`:

- `vmdpath`: VMD executable path. Default: `"vmd"`. Use `none`
  case-insensitively to skip launching VMD while still allowing scene generation.
- `vmdscenefile`: generated Tcl scene path. Default: `"multiwfn_scene.tcl"`.
  Set to `auto` to write `<exported-file>.vmd.tcl` beside each exported
  structure or cube file.
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

The configured VMD path can be checked without launching VMD:

```sh
tools/vmd-doctor.sh
tools/vmd-doctor.sh /path/to/vmd
```

The doctor is intentionally read-only. It resolves `vmdpath` from `settings.ini`
or from the optional command-line argument, checks whether the executable can be
found, and reports how to set `vmdpath` or `-vmdpath` when VMD is installed
elsewhere. It treats empty paths and `none`/`None`/`NONE` as an explicit
disabled VMD executable.

The doctor's own success and failure behavior is covered by:

```sh
tools/vmd-doctor-smoke.sh
```

This smoke test uses the local shell as a known executable and a generated
missing path as a negative case, so it does not require VMD to be installed.

An already generated scene can be opened through the repository-local helper:

```sh
tools/vmd-open-scene.sh exported.cub.vmd.tcl
tools/vmd-open-scene.sh --vmdpath /path/to/vmd exported.cub.vmd.tcl
tools/vmd-open-scene.sh --check --dry-run exported.cub.vmd.tcl
tools/vmd-open-scene.sh --check-only exported.cub.vmd.tcl
```

The helper reads `vmdpath` from `settings.ini` unless `--vmdpath` is supplied,
verifies that the scene file exists, resolves the VMD executable, and then runs
`vmd -e <scene>`. The dry-run mode reports the resolved executable and scene
without launching VMD. With `--check`, it first reuses
`tools/vmd-scene-source-check.sh` to source the scene with stubbed VMD commands
and verify that referenced data files resolve. Use `--check-only` to run that
scene validation without resolving or launching VMD, which is useful on systems
where VMD is not installed yet. Its smoke test uses a generated fake VMD
executable, so the quick verification gate still does not require VMD to be
installed.

## Supported export paths

Initial coverage:

- PDB, PQR, XYZ, GRO, and POSCAR structure exports through their interactive
  wrappers, plus the explicit PBC PDB export path in the file export menu.
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
- LSB information-theory grids for `ITA.cub` and `infogain.cub`.
- AdNDP saved/candidate orbital cube exports.
- Other functions part 1/2 exports for function-pair cubes, separated orbital
  cubes, multi-dataset `orbital.cub`, fitted orbital-combination grids, ICSS
  grids, and hyperpolarizability density grids.
- VASP grid exports such as `CHGCAR` through the file export menu, loaded with
  VMD's documented `CHGCAR` molfile type.

Future work:

- Add helper calls to any remaining specialized cube outputs not yet covered by
  the explicit export-point strategy.
- Generate richer VMD scenes for critical points, topology paths, molecular
  surfaces, arrows, and multi-cube overlays.

Coverage is being expanded at explicit user-facing export points instead of by
adding side effects to the low-level `outcube` writer. This avoids launching VMD
for temporary cube files used internally by calculations.

VASP grid exports use the generic volumetric-map scene helper rather than the
cube-specific helper. The VMD file type token for this path is `CHGCAR`, based
on the VMD molfile `vaspchgcarplugin` registration name. The generated scene
uses the same molecule, isosurface, material, path quoting, and scene-relative
data resolution behavior as cube scenes.

For workflows that export multiple cube files in one action, the bridge can now
write a single VMD scene that loads all exported cube files. This is used for
weak-interaction batch exports such as IGM delta-g grids and for selected basin
cube batches.

For workflows that export multiple scalar datasets into one cube file, the
bridge can write one VMD scene that loads the cube once and adds isosurface
representations for dataset indices `0..n-1`. This is used for `orbital.cub`
from the multiple-orbital exporter.

Generated Tcl scenes include comments identifying the source cube file and, for
multi-dataset cubes, the VMD volumetric dataset index used by each isosurface
representation. These comments are intended to make hand inspection and scene
debugging easier without changing VMD behavior.

Structure scenes are generated after the interactive PDB, PQR, XYZ, GRO, and
POSCAR export wrappers finish writing the structure file. The low-level
structure writers remain side-effect free, so internal or batch writers are not
forced through VMD. The file export menu's explicit PBC PDB path writes
`mol.pdb` and then uses the same structure-scene helper because it is a direct
user export.
The ESP charge fitting workflow's `ESPfitpt.pqr` and `ESPerr.pqr` point-cloud
exports are also routed through the structure-scene helper, as are the atomic
dispersion contribution exports `atomdisp.pqr` and `diffatomdisp.pqr`. The
EDA-FF atom contribution batch exports `atmint_tot.pqr`, `atmint_ele.pqr`,
`atmint_rep.pqr`, `atmint_disp.pqr`, and `atmint_vdW.pqr` through a
multi-structure PQR scene, so one Tcl script loads all related contribution
variants. The IGM/IBSIW `atmdg.pdb` export uses a colored PDB scene with VMD's
Beta color method, because the Beta field carries the atomic delta-g
contribution. Ordinary PDB, XYZ, and GRO structure scenes use element coloring;
PQR scenes use VMD's charge coloring so exported per-atom charges, ESP values,
fitting errors, or atomic dispersion/interaction contributions are visible
immediately.

CIF and CML structure exports are intentionally not routed through VMD in this
pass. The official VMD molfile plugin table checked on 2026-06-12 does not list
dedicated CIF or CML structure plugins, so the bridge only generates scenes for
formats whose VMD loading path is documented or covered by smoke tests. Future
CIF/CML support should first verify the exact VMD plugin and `mol new ... type`
token, then add a sourceable smoke scene.

POSCAR structure exports use VMD's `POSCAR` molfile type, based on the VMD
molfile `vaspposcarplugin` registration name. Mol2 is documented by VMD, but
this source tree currently has Mol2 reading support rather than a Mol2 export
wrapper to attach the bridge to.

Structure and cube paths in generated `mol new` commands and the header's manual
`source` hint are emitted as Tcl double-quoted strings with Tcl-sensitive
characters escaped. This keeps paths with spaces, backslashes, brackets, dollar
signs, and closing braces usable when a user exports structure or grid files into
normal project directories. The `mol new` commands pass data paths through a
small Tcl helper named `multiwfn_resolve_path`. Generated `mol material`
arguments are quoted the same way, so `-vmdmaterial` and `vmdmaterial` remain
single Tcl arguments even if a user accidentally includes whitespace or Tcl
sensitive characters.

After each `mol new`, generated scenes rename the VMD molecule to the exported
structure or cube path. This makes VMD's molecule list easier to inspect when a
workflow opens several cube files or a multi-dataset cube alongside a structure.

Scene file naming remains explicit by default: all supported exports use
`vmdscenefile`, whose default is `multiwfn_scene.tcl`. If `vmdscenefile` is set
to `auto`, each supported export writes `<exported-file>.vmd.tcl`; for example,
`dens.cub` writes `dens.cub.vmd.tcl` and `mol.pdb` writes `mol.pdb.vmd.tcl`.
This opt-in mode avoids scene overwrites during workflows that export both a
structure and several grid files.
When the generated scene and exported data file are in the same directory, the
scene writes the data file basename in `mol new` rather than the original
directory-qualified relative path. This keeps `vmdscenefile=auto` scenes
reopenable from a different current working directory because
`multiwfn_resolve_path` can find the data file beside the scene.

When `ivmdrun` launches VMD, the executable path and scene path are quoted for
the host command shell before calling `execute_command_line`. Linux/MacOS use
single-quote shell quoting with embedded single quotes escaped; Windows keeps
double-quoted command arguments. The bridge smoke test verifies the command
string construction without requiring VMD to be installed. The complete command
is not wrapped in an additional pair of quotes; only the executable path and
scene path arguments are quoted. This matters on Windows when `vmdpath` points
to a path such as `C:\Program Files\VMD\vmd.exe`.
If `vmdpath` is empty or set to `none` in any letter case, `ivmdrun` reports
that VMD was not launched and leaves the generated scene file in place.

Relative file paths in generated scenes are first resolved beside the scene
script itself. If the file is not found there, the helper returns the original
path so VMD falls back to its current working directory. This preserves the
normal `-vmdrun` behavior while making `vmdscenefile=auto` scenes easier to
reopen manually from another working directory when the exported data file sits
beside the scene file. Absolute paths are passed through unchanged.

If the configured scene file cannot be opened, the bridge reports the failing
path and Fortran `IOSTAT` value, then returns without launching VMD. The
underlying Multiwfn export remains the authoritative output and should not be
lost because VMD scene generation failed.

Scene files are opened with a dynamically assigned Fortran unit rather than a
fixed global unit number. This keeps the bridge isolated from analysis routines
that may already have their own files open.

Specialized exporters pass analysis-specific default isovalues where Multiwfn
already uses one for on-screen isosurfaces, for example hole/electron
distributions and transition densities in the excitation module.

## Smoke test

The bridge can be tested without launching VMD:

```sh
tools/gnu-build.sh vmd-smoke
tools/vmd-scene-source-check.sh path/to/scene.vmd.tcl
```

This compiles a minimal driver and verifies that generated Tcl scenes can load
PDB, PQR, XYZ, GRO, and POSCAR structure files, multiple PQR structure files, a
single cube file, multiple cube files, a multi-dataset cube file, or a CHGCAR
volumetric map file; add molecular and positive/negative isosurface
representations; and use the configured VMD material. It also checks custom
structure coloring such as Beta-colored PDB scenes. It also checks the
generated structure, cube/dataset comments, `auto` scene naming, relative data
path resolution helper, and Tcl quoting for cube and scene paths containing
spaces, backslashes, and Tcl-sensitive characters. It also checks Tcl quoting for
the configured VMD material. The smoke test covers the non-fatal error path for
an unwritable scene location and VMD launch-command quoting for Linux/MacOS and
Windows. Generated scenes also carry a header note describing relative file path
resolution. When `tclsh` is available, the smoke test also stubs VMD's `mol`,
`display`, and `axes` commands and sources every generated structure, cube,
multi-cube, and multi-dataset scene after creating matching dummy data files. It
also keeps a focused helper check for the scene-relative, fallback, and
absolute-path behavior of `multiwfn_resolve_path`.
Successful default runs clean their temporary `.build-env` smoke directory; use
`VMD_SMOKE_KEEP=1` or set `VMD_SMOKE_DIR` when inspecting the generated Tcl
files. Set `TCLSH=/path/to/tclsh` to choose a specific Tcl interpreter for the
source check.
`tools/verify-refactor.sh quick` runs the smoke test with those debugging
overrides unset and fails if a default `vmd-bridge-smoke.*` directory remains
afterward.

`tools/vmd-scene-source-check.sh` is a reusable Tcl syntax/source check for
already generated scene files. It stubs VMD's `mol`, `display`, and `axes`
commands, then sources the scene with `tclsh` and verifies that
`multiwfn_resolve_path` was defined and that the scene issued at least one
`mol new` data load command. The script sources the scene from a temporary
directory outside the repository's current working directory and checks that
every `mol new` data path resolves to an existing file; this catches
scene-relative path regressions in `vmdscenefile=auto` workflows and prevents an
empty placeholder scene from passing as a useful visualization scene. If
`tclsh` is not installed, the script prints a skip message and exits
successfully. When a scene fails, the diagnostic includes the scene path before
the Tcl error so batch checks identify the failing file. The narrow VMD bridge
smoke test uses it on all generated scene variants and includes a negative
fixture for a scene that defines the resolver but loads no data. The GNU noGUI
smoke target uses it on the VMD scenes generated by the real `Multiwfn_noGUI`
structure, loaded-cube, VASP grid, and wavefunction-grid export fixtures.

## Rationale

VMD is treated as an external executable. This respects VMD's main program
license boundary and avoids introducing its build system into Multiwfn.
