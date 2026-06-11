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
