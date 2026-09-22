# MatterViz vibration session protocol

Status: protocol v1. This document describes the vibrational normal-mode
animation session for the MatterViz GUI (issue #65) and its standalone launch
topology (issue #58 external orchestration). The session has its own manifest
format and its own frontend entry document; the workbench manifest
(`multiwfn-matterviz-workbench`, version 2) is unchanged.

## Ownership and launch topology

The vibration session is produced entirely outside Multiwfn. The standalone
launcher `tools/multiwfn_vibration_viewer.py` (Python 3.9+, standard library
only) is the orchestrator:

1. **Parse.** The launcher reads the vibrational data directly from a
   Gaussian, ORCA, CP2K or xTB output file, mirroring the format conventions
   and ordering of the Multiwfn spectrum module's PVS normal-coordinate
   analysis. Frequencies, optional IR intensities, per-atom normal-mode
   displacement vectors and the final molecular geometry all come from the
   output file(s); no Multiwfn process and no modified Multiwfn source is
   involved.
2. **Session construction.** The launcher writes `manifest.json` (format
   `multiwfn-matterviz-vibration`, version 1) and `structure.json`
   (pymatgen-style sites) into a temporary directory (or `--session-dir`),
   and encodes the displacement vectors as one MWFNP2D v1 binary dataset.
3. **Local HTTP service.** A loopback-only (`127.0.0.1`, OS-assigned port
   unless `--port` is given) threading HTTP server serves:
   - `GET /session/manifest.json`, `GET /session/structure.json` and
     `GET /session/<file>` (path-traversal guarded),
   - `GET /api/plot-data/<id>` — the displacement dataset frame with
     content type exactly `application/vnd.multiwfn.matterviz-plot-data-v1`,
   - `POST /api/ready` → `{"ok":true}`,
   - `GET`/`POST /api/return` → writes `gui_stop.flag` and shuts the
     service down,
   - `POST /api/save-file?name=<sanitized>` — writes the request body into
     the export directory (`--export-dir`, default: current working
     directory) after sanitizing the file name.
4. **GUI launch.** The launcher locates the matterviz-desktop shell
   (`MULTIWFN_MATTERVIZ_WEBVIEW` override, then `tools/matterviz-desktop`,
   `frontend/matterviz-desktop/target/release/matterviz-desktop`, then
   `build-matterviz-gui/resources/tools/matterviz-desktop`) and starts it
   with `--url http://127.0.0.1:<port>/vibration.html?manifest=/session/manifest.json`.
   The startup status/token handshake and the stop-file environment contract
   are the same as `tools/multiwfn_matterviz_webview.py`. When the shell
   exits or the session's `gui_stop.flag` appears, the HTTP service shuts
   down.
5. **Initial paused display.** `vibration.html` loads the session with the
   animation paused (`VIBRATION_AUTO_PLAY = false` in
   `frontend/matterviz-viewer/src/vibration.ts`); the user picks a mode and
   starts playback explicitly.

Responsibilities in this topology:

- The Python launcher owns output parsing, session and manifest
  serialization, MWFNP2D encoding, the HTTP service and process lifecycle.
- The frontend owns manifest/structure/dataset validation, pattern
  normalization, frame synthesis and playback, following the upstream
  MatterViz phonon components (`src/lib/spectral/phonon-modes.ts`): the
  largest per-atom excursion of a mode is normalized to exactly 1 Angstrom
  and one phase cycle of frames is synthesized as
  `xyz(t) = xyz0 + amplitude * u * cos(2 pi k / N)` with the instantaneous
  displacement attached as the per-site `force` vector property. Animation
  defaults mirror upstream: amplitude 0.3 Angstrom, 48 frames per cycle,
  24 fps. Imaginary (negative) frequencies are flagged in the mode list.
- The desktop shell only renders the URL it is given; the vibration page
  issues no backend commands beyond the generic `/api/ready` and
  `/api/return` lifecycle endpoints and the `/api/save-file` export route.

## Command line

```
python3 tools/multiwfn_vibration_viewer.py OUTPUT [OUTPUT ...]
    [--g98-out PATH] [--multiwfn EXE] [--compute] [--compute-artifact PATH]
    [--compute-menu LINES] [--spectrum ir|raman] [--no-launch]
    [--session-dir DIR] [--export-dir DIR] [--port N]
```

- Multiple `OUTPUT` files are queued and shown one session at a time, in
  order.
- `--no-launch` only builds the session(s) and prints the manifest/URL
  paths (used by tests and smoke checks).
- `--g98-out` supplies the xTB companion g98.out; see below.
- `--compute`/`--compute-artifact` engage the external batch engine; see
  the next section for the artifact contract and the stock-Multiwfn
  boundary.

## Supported output formats

Detection mirrors `outputprog` (util.f90): the first 500 lines are scanned
for `Gaussian, Inc`/`Entering Gaussian System` (Gaussian), `O   R   C   A`
(ORCA), `CP2K|` (CP2K) or `x T B` (xTB); anything else is rejected.

- **Gaussian.** Frequencies from the `Frequencies -- ` rows, IR intensities
  from `IR Inten    --` rows, displacement vectors from the per-atom
  `Atom  AN` tables (three modes per block; fixed atoms keep zero vectors).
  The mode count follows the spectrum module: the index row above the last
  `Frequencies -- ` block decides how many transitions are loaded, so
  repeated frequency sections behave like the Fortran loader. Geometry is
  the last `Standard orientation:` block, falling back to the last
  `Input orientation:` block; the table rows use the same atom order.
- **ORCA.** Frequencies and IR intensities from the last `IR SPECTRUM`
  table (falling back to the `cm**-1` list of the last
  `VIBRATIONAL FREQUENCIES` section when no IR table exists). Displacement
  vectors come from the full normal-mode matrix after the last
  `Thus, these vectors are normalized but` marker (f11.6 fields, six
  columns per frame, row labels skipped); translations/rotations are
  dropped via the `The first frequency considered to be a vibration is`
  count. Like the spectrum module, a restarted or repeated frequency run
  rewrites the modes and the LAST section is used. Geometry is the last
  `CARTESIAN COORDINATES (ANGSTROEM)` block.
- **CP2K.** Frequencies from the `VIB|Frequency (cm^-1)` block rows
  (three modes per block, mode indices on the preceding `VIB|` row), IR
  intensities from the row that follows each frequency row, displacement
  vectors from the `ATOM  EL` per-atom tables. Geometry is read from the
  last `&COORD` block, falling back to the last `MODULE QUICKSTEP` atomic
  coordinates section.
- **xTB.** Frequencies and IR intensities from the `$vibrational spectrum`
  section of the xTB output. The normal-mode vectors live only in the
  companion g98.out (`xtb --g98`); pass it with `--g98-out`. Both the
  geometry (last orientation block) and the displacements (`Atom AN`
  tables) are read from g98.out, so the structure and the vectors always
  share one atom order. The launcher asks for g98.out before any geometry
  handling — the xTB flow never requires an in-memory geometry first.

Validation is fail-closed, mirroring the Fortran adapter: non-finite
frequencies, intensities, coordinates or table values are rejected, and a
mode whose displacement vector is identically zero aborts the session with
a clear error. Unsupported inputs (e.g. plain text) are rejected before any
parsing.

## External batch engine (`--compute`)

When an output file parses for frequencies but carries no displacement data
(the normal-mode tables/matrix were never printed), `--compute` engages the
external batch engine instead of failing. The engine is contractually an
artifact producer: a task only passes data back through declared files, never
through stdout.

1. **Tasks declare artifacts.** A `MultiwfnTask` carries the input file, the
   stdin menu lines and an `artifacts` list of paths/globs relative to the
   task's own working directory (e.g. `["g98.out"]` for a wrapper that reruns
   xTB, or `["transinfo.txt"]` for a stock menu run). The CLI declares one
   artifact with `--compute-artifact PATH`.
2. **Sequential, isolated runs.** `run_multiwfn_tasks(exe, tasks, work_root=…)`
   runs each task in its own `task-NN-<stem>` directory:
   `<exe> <input_file>` is started with `subprocess.Popen`, the numeric menu
   lines are fed over stdin (default template `11,{spectrum},-2,0,q`;
   `--compute-menu` overrides it, `{spectrum}` expands to the `--spectrum`
   selector), and the combined stdout/stderr is captured to
   `<work>/compute/<name>.compute.log` as a diagnostic log only. Each task has
   a 300-second timeout; on expiry the child is killed and reaped.
3. **Collection.** After the run the declared artifacts are collected from the
   task directory. A missing artifact aborts with an error naming the input
   file, the expected pattern and the actual directory contents. Absolute
   paths and `..` escapes in artifact patterns are rejected before the engine
   is started.
4. **Verification before parsing.** The launcher parses each collected
   artifact with the same format auto-detection as direct inputs (for an xTB
   input, the artifact is first tried as the regenerated g98.out companion of
   the original spectrum). An artifact is accepted only if it parses and at
   least one mode carries a nonzero displacement vector. Otherwise the error
   names the input file and the artifact path, lists the per-artifact parse
   failures, and explains the stock-Multiwfn boundary below. The captured
   stdout log is never parsed.

**Stock Multiwfn boundary.** No stock Multiwfn menu writes normal-mode
displacement vectors to a file: the spectrum menu's `-2` export produces
`transinfo.txt` with frequencies and intensities only. The default
`--compute-menu` is therefore *not* a way to close the displacement loop, and
the launcher refuses to pretend otherwise: `--compute` without
`--compute-artifact` fails before the engine is started, with an error that
explains the boundary and points here. A working setup points `--multiwfn` at
a wrapper that reruns the quantum-chemistry program with normal-mode printing
enabled. Example xTB wrapper (`xtb-vibration-wrapper.sh`):

```sh
#!/bin/sh
# Invoked as: <wrapper> <input-file>, in the task's own working directory.
# Reruns the xTB frequency job and leaves g98.out as the declared artifact.
xtb --g98 --hess "$1" > xtb.out
test -f g98.out
```

```sh
python3 tools/multiwfn_vibration_viewer.py xtb_freq.out \
    --compute --multiwfn ./xtb-vibration-wrapper.sh --compute-artifact g98.out
```

Only missing displacement data triggers the fallback; unrecognized or
malformed inputs remain hard errors. The queue/stdin/artifact plumbing is
covered by `tests/test_matterviz_vibration_viewer.py` with a fake executable
shell script that writes a real artifact file (success path), omits it
(collection error) or writes a vector-free file (verification error).

## Manifest

The session manifest has format `multiwfn-matterviz-vibration`, version 1,
and is served at `/session/manifest.json`:

```json
{
  "format": "multiwfn-matterviz-vibration",
  "version": 1,
  "generatedBy": "multiwfn_vibration_viewer.py",
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
- `spectrumKind` is `ir` when IR intensities were parsed, otherwise null.
  `intensityUnit` is `km/mol` for IR and null otherwise; per-mode
  `intensity` is null when no intensity is carried.
- `frequency` is signed: negative values denote imaginary modes and are
  flagged in the viewer.
- `displacementConvention` documents that vectors are the normalized
  Cartesian displacement patterns printed by the source program (Gaussian
  "Atom AN" tables, CP2K "ATOM EL" tables, the ORCA normal-mode matrix,
  and the xTB companion g98.out), i.e. not mass weighted. Absolute scale
  is irrelevant because the viewer normalizes each mode to a 1 Angstrom
  maximum excursion before applying the display amplitude.
- `structure.path` points at the pymatgen-style structure document
  (`sites[{species:[{element,occu,oxidation_state}],abc,xyz,label,
  properties}]`, `charge`, `properties.bonds`). Output files carry no
  connectivity, so `bonds` is empty and the viewer drops it to let the
  renderer auto-detect bonds.

## Displacement dataset

Displacement vectors ride the existing `MWFNP2D` v1 binary framing
([`matterviz-plot-protocol-v2.md`](matterviz-plot-protocol-v2.md)) as one
dataset with a single `u` (4) role array of `modeCount * atomCount * 3`
little-endian f64 values in mode-major `[mode][atom][xyz]` order:

- 80-byte little-endian header: magic `MWFNP2D\0`, major 1, minor 0,
  type 1, flags 1, headerBytes 80, datasetId (u64), arrayCount 1 (u32),
  directory entry size 32 (u32), directory byte count, body byte count,
  total element count, header CRC32C, body CRC32C, reserved 0, total frame
  byte count (u64).
- One 32-byte directory entry: role byte `u` (4), element count (u64),
  body-relative offset 0 (u64), byte count (u64).
- The f64 body.

CRC32C is the Castagnoli variant (reflected polynomial 0x82F63B78, initial
value 0xffffffff, final complement); the header CRC is computed over the
final header with its own 4-byte field zeroed. The launcher implements the
framing in pure Python; the reference JavaScript layout lives in
`frontend/matterviz-viewer/tests/vibration.test.ts`. The dataset ID is a
positive integer starting from 1 for the standalone session and is fetched
from `/api/plot-data/<id>`; the viewer checks the response content type,
both CRCs, the directory contiguity and the declared shape before
animating.

## Validation

- The launcher validates before serving: program detection, presence of
  frequencies/geometry/displacements, finite values everywhere, matching
  table/geometry atom counts and nonzero displacement vectors.
- The frontend revalidates the manifest contract (format/version, positive
  `atomCount`/`modeCount`, declared units, `modeCount` mode entries with
  finite frequencies and finite-or-null intensities, a positive dataset ID
  and a shape of `[modeCount, atomCount, 3]`), the dataset length, the
  structure site count, finite coordinates and element symbols. An
  explicitly empty bond list is dropped so the renderer auto-detects bonds.
- The HTTP service never leaves the loopback interface, guards
  `/session/<file>` against path traversal and sanitizes
  `/api/save-file` names (path separators stripped, control characters
  removed, `.`/`..`/empty collapse to `export.bin`).
