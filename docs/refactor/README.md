# Multiwfn Refactor Notes

This directory records the refactor plan, implementation decisions, build findings,
and VMD bridge work.

Scope constraints:

- Modify files only inside this source tree.
- Do not modify the system environment or install system packages.
- Keep VMD as an external visualization program. Do not merge VMD main source code
  into Multiwfn.
- Preserve the original Fortran numerical core unless a build or integration issue
  requires a targeted refactor.

Current direction:

1. Make the noGUI build a practical first-class target.
2. Add a low-intrusion VMD bridge that can generate VMD Tcl scene scripts from
   existing exported cube/structure data.
3. Prefer external invocation and script generation over source-level fusion with
   VMD.
4. Keep all major decisions and build results documented in Markdown.

Key documents:

- `BUILD.md`: noGUI build targets and wrapper commands.
- `BUILD_ENV.md`: local GNU toolchain setup under `.build-env`.
- `VMD_BRIDGE.md`: bridge settings, CLI flags, and current coverage.
- `LICENSE_BOUNDARY.md`: Multiwfn/VMD license boundary for integration choices.
- `VMD_CUBE_EXPORT_AUDIT.md`: remaining cube export audit and exclusions.
- `VMD_STRUCTURE_EXPORT_AUDIT.md`: structure export bridge audit and exclusions.
- `DECISIONS.md`: architecture and boundary decisions.
- `ROADMAP.md`: current checkpoints, next work, and completion evidence.
- `LOG.md`: chronological implementation notes.

Main local verification entry points:

```sh
tools/bootstrap-gnu-env.sh
tools/audit-helper-scripts.sh
tools/audit-nogui-build.sh
tools/audit-vmd-exports.sh
tools/audit-vmd-structure-exports.sh
tools/verify-refactor.sh env
tools/verify-refactor.sh quick
tools/verify-refactor.sh full
```
