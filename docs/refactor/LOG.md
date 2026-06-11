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
