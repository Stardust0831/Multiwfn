# Refactor Log

## 2026-06-12

- Created a git worktree inside `Multiwfn_2026.6.2_src_Linux` because the parent
  directory contains a read-only placeholder `.git` directory and is not a usable
  repository.
- Added local-only git user configuration in this repository. No global git config
  or system environment was changed.
- Added initial refactor documentation and ignore rules for build/generated files.

