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

Root-level Fortran sources and the `ext/` and `libreta_hybrid/` directories are
treated as the official Multiwfn computational core. Pull requests that change
these paths are blocked by the core-source guard until a maintainer has reviewed
the reason and applied the `core-change-approved` label. This explicit approval
also applies to official-source synchronization pull requests.

For GUI work, prefer an adapter-style design. The long-term goal is frontend and
backend separation: replace the legacy DISLIN GUI backend without rewriting
computational modules. GUI changes should normally live in `frontend/`, `tools/`,
documentation, or dedicated GUI adapter files such as `noGUI/GUI_3dmol.f90`.

## GUI Integration Principles

GUI integrations and experiments are welcome, including alternative desktop or
web frontends, plotting tools, workflow automation, and batch processing. These
features should normally treat Multiwfn as the scientific engine and orchestrate
it from outside, rather than embedding a second scientific implementation into
Multiwfn or modifying official source files to serve one frontend.

Please follow these principles:

- Keep scientific ownership in Multiwfn. File parsing, scientific parameter
  handling, broadening, interpolation, curve generation, and numerical analysis
  should use the existing Multiwfn implementation. Do not reproduce these
  algorithms in Python, JavaScript, GUI workers, or frontend-specific adapters.
- Prefer external orchestration. Batch tools should invoke Multiwfn in an
  isolated working directory, drive a documented menu workflow through standard
  input, and collect output explicitly produced by Multiwfn. Batch dataset
  management, job queues, and multi-file coordination should remain outside the
  interactive Multiwfn process.
- Keep frontends presentation-focused. A plotting frontend may display final
  curves produced by Multiwfn and provide visual controls such as axis limits,
  zoom, trace visibility, styling, and export. Changes to scientific parameters
  should be sent back through an existing Multiwfn workflow so Multiwfn
  regenerates the result.
- Prefer small, generic interfaces. If existing text or graphics output is not
  sufficient, propose a stable, analysis-independent export or adapter interface
  before adding format-specific hooks. Avoid separate backend APIs and parsers
  for each analysis type when the original program already implements them.
- Do not modify official source merely to expose progress or GUI state when the
  same information can be obtained from existing output, a launcher, an adapter,
  or a generated build artifact. Any unavoidable core change must be minimal,
  useful beyond one frontend, covered by comparison tests, and designed so that
  future official-source updates can be synchronized without manual rewrites.
- Keep dependencies proportional and optional. A GUI experiment must not make
  Python, Qt, a web server, a browser runtime, or packaging tools mandatory for
  ordinary CMake or noGUI builds. New runtime dependencies and their effect on
  release size and supported platforms must be documented in the PR.
- Separate independent concerns. Progress reporting, resource installation,
  plotting, scientific export, and batch automation should normally be proposed
  as focused changes that can be reviewed and tested independently.

For a substantial GUI integration, open an issue before implementation and
describe the process boundary, data flow, dependencies, affected official
sources, upstream synchronization strategy, and behavior when the optional GUI
runtime is unavailable.

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
