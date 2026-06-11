# Multiwfn Refactor Branch

This repository snapshot is being refactored incrementally with two immediate
goals:

1. Make the Linux noGUI build easier to reproduce with a local GNU toolchain.
2. Keep VMD as an external visualization backend and generate VMD Tcl scenes from
   supported Multiwfn cube exports.

The original upstream compilation notes are still in
`COMPILATION_METHOD.txt`. Refactor-specific notes are under `docs/refactor/`.

## Quick Start

Prepare the local GNU build environment inside this source tree:

```sh
tools/bootstrap-gnu-env.sh
```

Build and smoke-test the noGUI binary:

```sh
tools/gnu-build.sh smoke
```

Run the refactor verification gate:

```sh
tools/verify-refactor.sh quick
tools/verify-refactor.sh full
```

All generated compiler packages, module files, test logs, and temporary build
artifacts stay under `.build-env/` or are ignored by Git.

## VMD Bridge

The VMD integration is a file-and-script bridge, not source fusion. Multiwfn
performs wavefunction and grid calculations, then optionally writes a VMD Tcl
scene for supported cube exports.

Useful runtime options:

```sh
./Multiwfn_noGUI input.fch -vmd
./Multiwfn_noGUI input.fch -vmdrun -vmdpath /path/to/vmd
./Multiwfn_noGUI input.fch -vmdscene scene.tcl -vmdmaterial Transparent
```

See `docs/refactor/VMD_BRIDGE.md` for supported export paths and current
limitations.

## Key Refactor Documents

- `docs/refactor/README.md`: refactor scope and document index.
- `docs/refactor/BUILD_ENV.md`: local GNU build environment.
- `docs/refactor/BUILD.md`: noGUI build and verification details.
- `docs/refactor/VMD_BRIDGE.md`: VMD bridge behavior and coverage.
- `docs/refactor/VMD_CUBE_EXPORT_AUDIT.md`: cube export coverage audit.
- `docs/refactor/DECISIONS.md`: architecture and build decisions.
- `docs/refactor/LOG.md`: chronological implementation log.
