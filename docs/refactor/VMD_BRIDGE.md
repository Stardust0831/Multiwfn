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

## Supported export paths

Initial coverage:

- Generic cube export through `outcube_wrapper`.
- Main 3D grid post-processing cube export in `study3dim`.

Future work:

- Add helper calls to specialized cube outputs in modules such as excitation,
  weak interaction, basin, CDFT, and ETS-NOCV analysis.
- Generate richer VMD scenes for critical points, topology paths, molecular
  surfaces, arrows, and multi-cube overlays.

## Rationale

VMD is treated as an external executable. This respects VMD's main program
license boundary and avoids introducing its build system into Multiwfn.
