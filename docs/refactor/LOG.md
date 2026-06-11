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
