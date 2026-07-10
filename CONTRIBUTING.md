# Contributing

Contributions are welcome. This repository tracks official Multiwfn source code
and adds cross-platform build, packaging, testing, documentation, and GUI
experiments around it.

The main design rule is to keep the computational core close to the official
Multiwfn source. In normal contributions, prefer changes to CMake, CI,
packaging, documentation, tests, GUI code, and adapter code. Avoid changing
computational modules unless there is a clear bug, a narrowly scoped fix, and a
comparison against official Multiwfn output.

## Good Ways To Help

- Test release packages on clean Linux, macOS, and Windows systems.
- Report build, packaging, runtime, or numerical reproducibility issues.
- Add compact public test fixtures for functional and performance checks.
- Improve CI, CMake, release packaging, and dependency handling.
- Improve the 3Dmol/Qt GUI prototype while keeping it compatible with the
  original Multiwfn GUI workflows.
- Document platform-specific build and runtime behavior.

## Issues

Please include:

- Operating system and version.
- The package or commit you tested.
- Exact command or menu workflow.
- Input file type and a small public reproducer when possible.
- Error output, screenshots, or timing/result comparisons when relevant.

For GUI design changes or large refactors, please open an issue first so the
scope can be discussed before implementation.

## Pull Requests

Please keep pull requests focused. A small PR that fixes one build, test,
packaging, GUI, or documentation issue is easier to review and merge.

Before opening a PR, run the relevant local checks when possible. If a check
cannot be run locally, mention that in the PR description.

For changes touching Multiwfn behavior, please describe:

- Which original workflow is affected.
- Whether numerical output should change.
- What official Multiwfn output or release package was used for comparison.

For GUI work, prefer an adapter-style design. The long-term goal is frontend and
backend separation: replace the legacy DISLIN GUI backend without rewriting
computational modules. GUI changes should normally live in `frontend/`, `tools/`,
documentation, or dedicated GUI adapter files such as `noGUI/GUI_3dmol.f90`.

## Licenses And Attribution

The official Multiwfn source license is preserved in `LICENSE.txt`. Do not
remove it from source distributions or release packages.

If Multiwfn is used in academic work, follow the citation requirements in
`LICENSE.txt`.

## Contributor Recognition

GitHub automatically lists contributors based on merged commits and commit
authors. If a PR is merged with the author's commit history preserved, the PR
author normally appears as a contributor. If a PR is squash-merged or a change is
committed on behalf of someone else, include an appropriate `Co-authored-by:`
trailer in the commit message when credit should be recorded.
