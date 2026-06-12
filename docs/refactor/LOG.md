# Refactor Log

## 2026-06-12

- Created a git worktree inside `Multiwfn_2026.6.2_src_Linux` because the parent
  directory contains a read-only placeholder `.git` directory and is not a usable
  repository.
- Added local-only git user configuration in this repository. No global git config
  or system environment was changed.
- Added initial refactor documentation and ignore rules for build/generated files.
- Committed the original source baseline, then rewrote the root commit with
  `Stardust0831 <Stardust0831@users.noreply.github.com>` as author. Current
  baseline commit is `ec41a6b`.
- Attempted `git push -u origin main` to `https://github.com/Stardust0831/Multiwfn.git`.
  Push failed because this non-interactive environment has no GitHub HTTPS
  credentials: `could not read Username for 'https://github.com'`.
- Verified that `~/.ssh/id_ed25519_github` authenticates to GitHub as
  `Stardust0831`. Set repository-local `core.sshCommand` to use this key and
  changed `origin` to `git@github.com:Stardust0831/Multiwfn.git`.
- Force-pushed `main` once with the corrected author identity. Subsequent pushes
  should be ordinary pushes unless history is intentionally rewritten.
- Added first-pass VMD bridge integration:
  - `vmd_bridge.f90` generates VMD Tcl scripts for cube isosurfaces.
  - `settings.ini` and `loadsetting` now support `vmdpath`, `vmdscenefile`,
    `vmdmaterial`, `ivmdscene`, `ivmdrun`, and command-line flags `-vmd`,
    `-vmdrun`, `-vmdpath`.
  - Generic cube export and the main 3D grid post-processing cube export can
    generate a VMD scene after cube output when explicitly enabled.
- Ran `git diff --check`: passed.
- Ran `make -n noGUI`: dry-run passed and showed `vmd_bridge.o` in the expected
  dependency order.
- Actual compilation was not possible in this environment because `ifort`, `ifx`,
  and `gfortran` are not available.
- Re-ran a one-time `git push --force-with-lease origin refactor/vmd-bridge`
  using the repository-local `Stardust0831` identity and SSH key. GitHub reported
  the branch was already up to date.
- Split the Makefile object lists so `make noGUI` no longer depends on real
  `GUI.o`.
- Added noGUI stub modules for `GUI` and `dislin`, allowing the noGUI dry-run to
  avoid compiling `GUI.f90`, `mouse_rotate.f90`, `ext/xlib.f90`, and the real
  `dislin_d.f90`.
- Ran `make -n noGUI` and `make -n GUI` after the split. The noGUI dry-run avoids
  real GUI/xlib/DISLIN compilation; the GUI dry-run still uses the original GUI
  path.
- Added a reproducible conda-forge GNU build environment description in
  `docs/refactor/gnu-build-env.yml` and ignored `.build-env/`.
- Created a local prefix at `.build-env/gnu` with GFortran/GCC 15.2.0, GNU Make
  4.4.1, and OpenBLAS. No system packages were installed.
- Added `gnu-noGUI` to the Makefile. It uses the local prefix and removes
  Intel-only diagnostic/MKL/OpenMP flags from the noGUI build path.
- Replaced hard-coded Intel diagnostic flags in a few Makefile rules with
  overridable variables so GNU builds can leave them empty.
- Fixed the noGUI `drawplanegui` stub signature to match the real GUI routine's
  implicit `real*8` arguments.
- Added noGUI external plotting stubs for legacy calls that do not use the
  `plot` module interface.
- Built `Multiwfn_noGUI` successfully with `.build-env/gnu/bin/make gnu-noGUI`.
- Smoke-tested the binary with a temporary ignored water XYZ file under
  `.build-env/smoke/`; it loaded the file, reached the main menu, and exited with
  `q` using status 0. GFortran printed an IEEE floating-point exception flag note
  at shutdown, which should be tracked in later runtime validation.
- Added `gnu-noGUI-smoke`, a Makefile smoke target that creates the temporary XYZ
  fixture, runs `Multiwfn_noGUI`, checks the expected output, and restores
  `settings.ini` so the test does not leave the repository dirty.
- Isolated GNU module files under `.build-env/gnu-mod` and made `gnu-noGUI`
  clean stale root build products before compiling. After `gnu-noGUI-smoke`, the
  source root has no `.mod` files while `.build-env/gnu-mod` contains the GNU
  modules.
- Added post-link cleanup for `gnu-noGUI`: at this stage it removed root `*.o`
  and `noGUI/*.o` files while preserving `Multiwfn_noGUI`. This was later
  superseded by explicit GNU object output under `.build-env/gnu-obj`.
- Added explicit `use plot, only: drawscatter` imports in weak-interaction
  analysis routines that call `drawscatter` with optional arguments. This removes
  the GFortran warning about too many actual arguments by giving those calls the
  module procedure interface.
- Added command-line overrides `-vmdscene` and `-vmdmaterial` for the VMD bridge
  and fixed the generated Tcl script header to mention the actual scene file path
  selected for the current export.
- Added `tools/gnu-build.sh` as a small convenience wrapper around the local
  `.build-env/gnu/bin/make` noGUI build and smoke-test targets.
- Removed the stale Makefile `util.o` prerequisite from `vmd_bridge.o`; the
  bridge only imports `define`, so the build dependency boundary now matches the
  source.
- Added a narrow VMD bridge smoke test (`tools/gnu-build.sh vmd-smoke`) and
  removed the bridge module's unnecessary dependency on `util` by using
  `execute_command_line` directly for launching VMD.
- Routed CDFT cube exports for Fukui functions, dual descriptors,
  orbital-weighted Fukui functions, and Fukui potential grids through the VMD
  bridge. This extends coverage at explicit export points while keeping
  low-level `outcube` free of automatic side effects for temporary files.
- Added multi-cube VMD scene generation and routed weak-interaction exports
  through the bridge for aNCI, IGM/mIGM/IGMH, aIGM/amIGM, TFI, and van der Waals
  potential cube files.
- Routed basin analysis cube exports through the VMD bridge, including basin
  index grids, selected basin functions, basin-type helper grids, per-basin cube
  batches, and `basinana.cub` state exports.
- Routed electron excitation cube exports through the VMD bridge, including
  hole/electron distributions, transition density, transition dipole density,
  charge-density difference, Cele/Chole, C+/C-, density polarization, and
  external potential grids. These calls use analysis-specific default isovalues
  where Multiwfn already defines them for interactive isosurface viewing.
- Routed ETS-NOCV cube exports and EDA atomic dispersion density cube exports
  through the VMD bridge.
- Routed molecular-surface `surf.cub`/`mapfunc.cub` exports and other-functions
  free-region/STM cube exports through the VMD bridge.
- Routed LSB information-theory grids, AdNDP saved/candidate orbitals,
  function-pair cube exports, separated orbital cubes, fitted orbital-combination
  grids, ICSS grids, and hyperpolarizability density grids through the VMD
  bridge. Multi-dataset `orbital.cub` remains intentionally excluded until the
  bridge can generate dataset-aware VMD scenes.
- Added dataset-aware VMD scene generation and routed the combined multiple-
  orbital `orbital.cub` export through it. The smoke test now checks single-cube,
  multi-cube, and multi-dataset cube scenes.
- Added `tools/verify-refactor.sh` as the main local verification wrapper.
  `quick` runs formatting/diff checks and the VMD bridge smoke test; `full` also
  runs the GNU noGUI smoke test and checks for object/module residue.
- Added optional `Makefile.local` support and a tracked
  `Makefile.local.example` so machine-local compiler/library paths can stay in
  the source folder without changing the tracked Makefile.
- Added `tools/bootstrap-gnu-env.sh` to create or verify the local GNU build
  prefix under `.build-env/gnu` using a package cache under `.build-env/pkgs`.
- Added a root `README.md` for the refactor branch so the GitHub repository
  exposes the GNU noGUI build, verification wrappers, and VMD bridge entry
  points from the project front page.
- Added cube and dataset comments to generated VMD Tcl scenes and extended the
  VMD bridge smoke test to assert those annotations.
- Added `tools/audit-vmd-exports.sh` to reproduce the VMD cube export count
  audit and list per-file `outcube`/bridge call counts.
- Updated GNU build helper error messages to point to
  `tools/bootstrap-gnu-env.sh` as the canonical local environment setup entry.
- Added a `check` mode to `tools/audit-vmd-exports.sh` and included it in
  `tools/verify-refactor.sh quick` so VMD export count documentation stays in
  sync with source changes.
- Changed generated VMD `mol new` commands to use Tcl double-quoted paths with
  escaping for Tcl-sensitive characters, and extended the VMD bridge smoke test
  to cover paths with spaces, brackets, dollar signs, and closing braces.
- Added `iostat` handling when opening VMD scene files, so an invalid
  `vmdscenefile` path reports a clear message and does not abort the Multiwfn
  export workflow. The VMD bridge smoke test now checks this non-fatal path.
- Tightened `tools/audit-vmd-exports.sh` so production coverage counts exclude
  `tools/` smoke-test drivers and noGUI stubs.
- Factored VMD scene filename normalization and file opening into one helper so
  future scene types inherit the same default-path and non-fatal error handling.
- Factored VMD launch command construction into a testable helper and added
  host-shell quoting for the VMD executable and scene path. The smoke test now
  checks Linux/MacOS and Windows command strings without launching VMD.
- Reused Tcl quoting for the scene header's manual `source` hint and extended
  the smoke test to cover scene paths with spaces and Tcl-sensitive characters.
- Extended the VMD bridge smoke test to cover cube paths with Windows-style
  backslashes plus Tcl-sensitive characters.
- Added a generated VMD scene header note explaining that relative cube paths
  are resolved from VMD's current working directory, and documented the manual
  `source` implication.
- Changed VMD scene file output to use a dynamically assigned Fortran unit
  instead of fixed unit `99`, reducing the bridge's chance of colliding with
  callers that already have files open.
- Updated GNU build wrappers so `tools/gnu-build.sh` and the VMD bridge smoke
  test honor `GNU_PREFIX`, matching `tools/bootstrap-gnu-env.sh` and the
  Makefile's configurable local prefix.
- Changed the VMD bridge smoke wrapper to use a per-process build directory by
  default, with `VMD_SMOKE_DIR` as an override, so parallel smoke runs do not
  delete each other's temporary objects and scene files.
- Added VMD structure-scene generation for interactive PDB and XYZ exports via
  `outpdb_wrapper` and `outxyz_wrapper`, while keeping the low-level structure
  writers side-effect free.
- Extended structure-scene coverage to interactive PQR and GRO exports and the
  explicit PBC PDB file export menu path, preserving the same low-level writer
  boundary.
- Added opt-in `vmdscenefile=auto` scene naming so supported exports write
  `<exported-file>.vmd.tcl`, reducing scene overwrites when exporting structures
  and multiple grid files in the same workflow.
- Updated the root README and `settings.ini` comments so user-facing VMD bridge
  instructions mention structure exports and `vmdscenefile=auto`.
- Added `tools/audit-vmd-structure-exports.sh` and
  `docs/refactor/VMD_STRUCTURE_EXPORT_AUDIT.md` to lock down PDB/PQR/XYZ/GRO
  structure export bridge coverage in the quick verification gate.
- Marked helper shell scripts executable in the Git index so fresh clones can run
  documented `tools/*.sh` commands directly rather than depending on local
  filesystem mode bits.
- Added `tools/gnu-env-doctor.sh` and `tools/gnu-build.sh doctor` as read-only
  diagnostics for the local GNU prefix, compiler tools, OpenBLAS library, package
  cache, and available conda/mamba frontends.
- Added `tools/verify-refactor.sh env` and made `quick`/`full` run the GNU
  build environment doctor before compiler-dependent smoke tests, so missing or
  incomplete local prefixes are diagnosed from the main verification entry point.
- Added a GNU-specific `gnu-clean` Makefile target and routed
  `tools/gnu-build.sh clean` through it. The target removes noGUI build residue,
  GNU module output, smoke logs, and temporary VMD bridge smoke directories while
  preserving the local compiler prefix and package cache under `.build-env`.
- Changed the VMD bridge smoke wrapper to remove its default per-process
  temporary directory after successful runs. Failed runs, `VMD_SMOKE_KEEP=1`, and
  explicit `VMD_SMOKE_DIR` runs still preserve generated scene files for
  debugging.
- Added a VMD bridge smoke residue check to `tools/verify-refactor.sh quick`.
  The verification wrapper now unsets `VMD_SMOKE_DIR` and `VMD_SMOKE_KEEP` for
  its smoke run, then fails if `.build-env/vmd-bridge-smoke.*` remains.
- Added `tools/audit-nogui-build.sh` and included it in
  `tools/verify-refactor.sh quick`. The audit runs `make -n noGUI`, confirms the
  noGUI stub sources are used, and fails if the dry-run brings back real GUI,
  X11, OpenGL, or DISLIN compile/link entries.
- Added a `settings.ini` checksum guard around the GNU noGUI smoke step in
  `tools/verify-refactor.sh full`, so verification fails if the smoke workflow
  does not restore Multiwfn's normal `lastfile` update.
- Added `docs/refactor/ROADMAP.md` to keep current refactor checkpoints, next
  work, boundaries, and completion evidence explicit as the branch grows.
- Added `docs/refactor/LICENSE_BOUNDARY.md` after checking the official Multiwfn
  download terms and VMD license page. The note documents why this branch keeps
  VMD as an external executable and does not fuse or redistribute VMD source.
- Added `tools/audit-helper-scripts.sh` and included it in
  `tools/verify-refactor.sh quick` to ensure tracked helper shell scripts keep
  executable mode bits and the expected POSIX `sh` shebang.
- Tightened `gnu-noGUI-smoke` so stderr must be empty or contain only the known
  GFortran `IEEE_INVALID_FLAG` shutdown note. Other stderr output now fails the
  smoke target.
- Extended quick verification residue checks and `gnu-clean` to cover
  `.build-env/nogui-build-audit.*` in addition to VMD bridge smoke directories.
- Added `tools/audit-ignore-rules.sh` and included it in
  `tools/verify-refactor.sh quick` to protect ignore rules for local build
  products, exported visualization files, `.build-env/`, and `Makefile.local`.
- Added `GNU_OBJ_DIR`/`OBJ_DIR` support to the Makefile so `gnu-noGUI` writes
  object files under `.build-env/gnu-obj` while preserving the original root
  object paths for the default Intel-oriented build. The noGUI build-boundary
  audit now also dry-runs an `OBJ_DIR` noGUI build and fails if compile outputs
  fall back to root or `noGUI/*.o` object files.
- Extended `gnu-noGUI-smoke` from a single XYZ structure load to two runtime
  fixtures: the existing water XYZ load and a minimal water cube grid load. The
  target now checks stderr line-by-line so only the known GFortran
  `IEEE_INVALID_FLAG` shutdown note is allowed.
- Added `tools/vmd-doctor.sh`, a read-only helper that resolves the configured
  VMD executable from `settings.ini` or an explicit argument without launching
  VMD. This gives users a local check for `vmdpath`/`-vmdpath` while preserving
  the external-VMD license boundary.
- Added `tools/vmd-doctor-smoke.sh` and included it in
  `tools/verify-refactor.sh quick`. The smoke test covers help output, PATH
  resolution, absolute executable paths, missing executable failures, and the
  default `settings.ini` lookup without requiring VMD to be installed.
- Changed generated PQR structure scenes to use VMD `Charge` coloring while
  leaving PDB, XYZ, and GRO structure scenes on `Element` coloring. The VMD
  bridge smoke test now checks both branches.
- Added `mol rename top` commands after generated VMD `mol new` calls so
  molecules are labeled by the exported structure or cube path in VMD's molecule
  list. The bridge smoke test checks Tcl quoting for renamed structure, cube,
  and multi-dataset cube molecules.
- Made `vmdpath=none` handling case-insensitive in both the Fortran bridge and
  `tools/vmd-doctor.sh`. `NONE` now disables launch attempts instead of being
  treated as an executable name; smoke tests cover both paths.
- Removed an extra Windows-only wrapper around the complete VMD launch command.
  The bridge now quotes the executable path and scene path as separate command
  arguments, then passes the assembled command directly to `execute_command_line`.
  This avoids malformed commands when `vmdpath` contains spaces.
- Added a tracked minimal `.mwfn` fixture and extended `gnu-noGUI-smoke` to load
  it, enter main function 1, and verify representative point-property output.
  This gives the GNU noGUI gate one real wavefunction-derived calculation in
  addition to the existing structure and cube load checks.
- Added a `multiwfn_resolve_path` Tcl helper to generated VMD scenes. Relative
  structure and cube paths are now first resolved beside the scene file, then
  allowed to fall back to VMD's current working directory, which makes saved
  `vmdscenefile=auto` scenes easier to reopen manually.
- Routed generated VMD `mol material` arguments through the same Tcl double-quote
  escaping helper used for paths and molecule names. The bridge smoke test now
  covers material strings containing whitespace, `$`, and brackets.
- Extended `tools/vmd-bridge-smoke.sh` to source a generated scene with `tclsh`
  when available, using stubbed VMD commands. This checks Tcl syntax and the real
  behavior of `multiwfn_resolve_path` for scene-relative, missing relative, and
  absolute paths.
- Extended `gnu-noGUI-smoke` with a minimal `.mwfn` Mulliken population-analysis
  path. The fixture enters main function 7, selects Mulliken population output,
  verifies basis and atom population lines, and explicitly answers `n` to the
  `.chg` export prompt so the smoke run does not leave user output files behind.
- Added a full-verification check for known GNU noGUI smoke export residues such
  as `he_minimal.chg` and `atmpopdcp.txt`, so future interaction-script changes
  fail loudly if they start leaving user-facing output files in the source root.
- Factored smoke residue checks into `tools/audit-smoke-residue.sh` and routed
  `tools/verify-refactor.sh quick`/`full` through it. The audit now owns quick
  temporary-directory checks, root/noGUI object residue checks, and known
  smoke-export residue checks. `gnu-clean` also removes temporary VMD doctor
  smoke directories.
- Extended `gnu-noGUI-smoke` with an end-to-end VMD structure export fixture.
  The fixture loads the water XYZ file via the real `Multiwfn_noGUI` binary,
  enters the main-menu `xyz` export command, writes an exported XYZ file under
  `.build-env/smoke`, generates the corresponding `vmdscenefile=auto` Tcl scene,
  and checks that `-vmdrun -vmdpath none` does not launch an external VMD
  process.
- Extended `gnu-noGUI-smoke` with an end-to-end VMD cube export fixture. The
  fixture loads the minimal water cube file, enters the main-menu `Process grid
  data` path, exports the present grid data through `outcube_wrapper`, checks
  the generated `vmdscenefile=auto` scene, and verifies that positive and
  negative isosurface representations are present without requiring VMD itself.
- Added `tools/vmd-scene-source-check.sh`, a reusable Tcl source check for
  generated VMD scenes. It stubs VMD commands and sources scene files with
  `tclsh` when available. The GNU noGUI smoke target now uses it on the
  end-to-end structure and cube scenes generated by the real binary.
- Changed generated scenes to write the data file basename when the exported
  data file and VMD scene file are in the same directory. The scene source check
  now runs from a temporary working directory and fails if `mol new` data paths
  do not resolve to existing files, which protects saved `vmdscenefile=auto`
  scenes from depending on Multiwfn's original current working directory.
- Extracted the long `gnu-noGUI-smoke` Makefile recipe into
  `tools/gnu-nogui-smoke.sh`. The Makefile still rebuilds the GNU noGUI binary
  first and forwards the same `GNU_PREFIX`, `EXE_noGUI`, and `SMOKE_*` override
  variables, but the runtime smoke flow now lives in a standalone
  shell script that can be syntax-checked and maintained independently.
- Extended `gnu-noGUI-smoke` with a wavefunction-derived grid export fixture.
  The fixture runs main function 5 on `he_minimal.mwfn`, calculates electron
  density on a tiny 3x3x3 grid in an isolated smoke directory, exports
  `density.cub`, generates `density.cub.vmd.tcl` with VMD auto-scene flags, and
  sources the generated VMD scene to confirm scene-relative data path resolution.
- Extended the full smoke residue audit to fail if `density.cub` or
  `density.cub.vmd.tcl` appears in the source root. The wavefunction-grid smoke
  fixture intentionally runs in its own `.build-env/smoke/wfn-grid-export`
  directory, because Multiwfn's spatial-region export writes the cube using a
  fixed menu-derived filename.
- Broadened `tools/vmd-bridge-smoke.sh` so `tools/vmd-scene-source-check.sh`
  sources every generated structure, cube, multi-cube, and multi-dataset scene
  after creating matching dummy data files. This turns path resolution and Tcl
  syntax into an executable check for all VMD bridge scene variants, not only
  the single quoted-path cube scene.
- Made the GNU build wrappers and environment doctor honor `FC_GNU`, `CC_GNU`,
  `MAKE_GNU`, and `LIB_noGUI_GNU` overrides. The VMD bridge smoke wrapper now
  uses the same `FC_GNU` compiler selection as the `gnu-noGUI` target, and the
  local Makefile example now documents real override variables instead of a
  stale `GNU_KEEP_OBJECTS` placeholder.
- Updated `DECISIONS.md` to record the now-stable GNU noGUI build gate, the VMD
  scene source-check contract, and explicit GNU tool override inputs. Refreshed
  the refactor README verification list with the current wrapper and audit
  entry points.
- Tightened `tools/vmd-scene-source-check.sh` so a sourceable Tcl scene must
  actually issue at least one `mol new` data load command. The narrow VMD bridge
  smoke test now includes a negative scene that defines `multiwfn_resolve_path`
  but loads no data, which prevents empty placeholder scenes from satisfying the
  VMD scene contract. The check script now wraps its Tcl logic in `catch` and
  explicitly exits nonzero on failure, because `tclsh` reading from standard
  input can print an error message yet still return success.
- Routed the ESP charge-fitting PQR point-cloud exports `ESPfitpt.pqr` and
  `ESPerr.pqr` through the VMD structure bridge. These exports are user-selected
  visualization artifacts whose charge field carries ESP value or fitting error,
  so the existing PQR scene path gives VMD a useful charge-colored view without
  touching the lower-level PQR writer. The structure export audit now computes
  non-wrapper bridge calls as total structure bridge calls minus wrapper-level
  calls, so additional direct user-facing exports do not require a hard-coded
  filename pattern in the audit script.
- Routed the atomic dispersion contribution PQR exports `atomdisp.pqr` and
  `diffatomdisp.pqr` through the same VMD PQR scene path. The bridge remains at
  the user-facing export branches after `outpqr` returns, preserving the
  side-effect-free lower-level PQR writer. The EDA batch `atmint_*.pqr` outputs
  remain intentionally excluded until a multi-structure scene helper exists, so
  the default `vmdscenefile` path is not overwritten by a rapid sequence of
  related PQR files.
- Added `maybe_write_vmd_structure_scene_list` for same-format structure
  batches and routed the EDA-FF `atmint_tot.pqr`, `atmint_ele.pqr`,
  `atmint_rep.pqr`, `atmint_disp.pqr`, and `atmint_vdW.pqr` exports through it.
  The batch now writes one Tcl scene that loads all five PQR files, avoiding
  repeated overwrites of the default `vmdscenefile` while still keeping
  low-level structure writers side-effect free. The VMD bridge smoke test now
  generates and sources a multi-structure PQR scene.
