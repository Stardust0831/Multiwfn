# PR #72: partial review follow-up

Base: `108ac58342044d1a78a0aa603865e093c2d6604b` on
`yyywaa/Multiwfn:feat-matterviz-vibration`.

This is an incremental patch for the concrete parser, request-authentication,
filename and process-timeout findings in review 5279104533. It is **not** a
claim that PR #72 is ready to merge. No protected Fortran/core source is changed.

## Finding 1 follow-up: standalone GUI executable delivered

Finding 1 noted that the launcher existed only as a source-tree Python script,
which cannot satisfy the standalone-GUI-executable requirement after
installation (the formal MatterViz packages reject any Python runtime
artifact). The launcher is now delivered as a real packaged executable:

- **Native file selection and batch queue.** Started with no positional
  argument in a desktop session, the launcher collects its input queue through
  the native file dialog of the bundled shell (`matterviz-desktop
  --select-file --output`, the same contract the Fortran GUI uses): every pick
  is queued and the dialog reopens until Cancel, an empty collection prints
  the usage and exits 2, and an rc-2 dialog failure is reported explicitly.
  Right after an xTB spectrum is picked (and `--g98-out` is unset), one extra
  dialog round offers to pick the companion g98.out; `--no-pick` keeps
  headless/CI invocations well-defined.
- **Frozen entry.** The MatterViz workflow freezes the launcher per platform
  with PyInstaller (`--onefile --name multiwfn-vibration`), copies only the
  frozen binary into `package/<pkg>/resources/tools/` on Linux, macOS and
  Windows, and asserts its presence in "Verify package contents". The frozen
  name matches none of the no-Python gate patterns, and the build
  intermediates (`vibration-launcher-build/`, `vibration-launcher-dist/`,
  `multiwfn-vibration.spec`) never enter the package tree. Under PyInstaller
  (`sys.frozen`) the desktop shell and the frontend dist are resolved from
  the executable's own directory, because `__file__` then points into the
  unpack temporary directory.
- **macOS .app and CMake.** `tools/macos/package_macos_app.sh` accepts an
  optional `--vibration-launcher` that lands at
  `Contents/Resources/tools/multiwfn-vibration` (same optional pattern as the
  updater) and the workflow passes it to the .app assembly; CMake stages a
  local frozen build into `resources/tools/` when the optional
  `MULTIWFN_VIBRATION_LAUNCHER_EXECUTABLE` cache variable points at one
  (unset or missing = silently skipped for local development).
- **Static frontend delivery.** The loopback service now serves
  `vibration.html` and its assets from the resolved frontend dist (previously
  a 404), so the packaged `--url` session renders from the launcher's own
  origin. The entry document and assets are public package content guarded by
  the exact loopback `Host` header only; `/session/*` and `/api/*` keep the
  bearer capability, and the static branch is traversal-guarded like
  `/session/`.
- **Packaged smoke tests.** The workflow runs the packaged frozen executable
  on every platform: `--help` must exit 0 and a fixture `--no-launch
  --no-pick` session must build with a parseable `manifest.json`; on Linux an
  additional extracted-package HTTP smoke serves `vibration.html`, the
  manifest and the MWFNP2D dataset from the packaged launcher and stops it
  through `/api/return`.
- **Tests.** `tests/test_matterviz_vibration_packaging.py` covers the
  workflow/script/CMake/docs contracts statically and exercises the dialog
  queue functionally against a fake `matterviz-desktop` shell script (queue
  order until cancel, empty cancel, rc-2 error, `--no-pick`, positional
  bypass, xTB companion round, frozen resolution, static frontend delivery).
  The frozen binary itself was verified locally with a real PyInstaller
  freeze: `--help` exits 0 and a fixture `--no-launch --no-pick` session
  builds a parseable manifest.


## Finding 2 follow-up: `--compute` artifact contract

The earlier fallback captured the external engine's stdout and reparsed it as
a quantum-chemistry output. Review finding 2 correctly noted that this does
not close the displacement-data loop with stock Multiwfn: the default menu
ends at spectrum option `-2`, which exports `transinfo.txt` (frequencies and
intensities only), and no stock menu writes normal-mode vectors. The fallback
has been reworked around a declared-artifact contract:

- `MultiwfnTask` declares `artifacts` (paths/globs relative to the task's own
  working directory). `run_multiwfn_tasks()` runs each task in an isolated
  `task-NN-<stem>` directory, keeps stdout as a diagnostic log only, and
  collects the declared artifacts afterwards. A missing artifact raises
  `MissingArtifactError` naming the input file, the expected pattern and the
  actual directory contents; absolute paths and `..` escapes are rejected
  before the engine starts.
- `prepare_vibration_data()` no longer parses the stdout log. It requires
  `--compute-artifact`, parses each collected artifact (for an xTB input the
  artifact is first tried as the regenerated g98.out companion of the
  original spectrum) and accepts it only when at least one mode carries a
  nonzero displacement vector. Failure messages name the input file and the
  artifact path and explain the stock-Multiwfn boundary.
- `--compute` without `--compute-artifact` now fails before the engine is
  started, with an error stating that stock Multiwfn menus write no
  normal-mode vectors and pointing to the documented wrapper workflow (an
  xTB `--g98 --hess` wrapper example is in
  `docs/matterviz-vibration-protocol.md`). The default menu is retained only
  as stock navigation for wrappers that key off it; it is not advertised as
  producing vectors.

Tests in `tests/test_matterviz_vibration_viewer.py` use a fake engine that
writes a real artifact file into the task directory: success
(collect → verify → parse yields three modes), missing artifact (error lists
the input file, pattern and directory contents), vector-free artifact
(explicit rejection) and undeclared artifact (engine is never started). The
300-second task timeout behavior from the previous patch is unchanged.

## Implemented boundaries

### Session HTTP requests

Each handler instance creates a fresh 32-byte random, URL-safe bearer capability.
The launcher puts it in the viewer URL. Manifest, structure, dataset and export
requests carry it; the existing readiness/return callers already propagate it.
Frontend session URL construction rejects a different origin before forwarding
the capability.

The Python service requires one exact loopback Host (`127.0.0.1:<bound port>`)
and one matching capability. A supplied Origin must match that origin. POST
requires Origin; GET may omit it because same-origin browser GET requests need
not send it. Missing, duplicate and incorrect capabilities are forbidden. All
session and API routes go through the same check before reading or writing data.

POST bodies are limited to 64 MiB. Ambiguous, negative or chunked framing is
rejected; reads have a 10-second socket timeout and truncated payloads are not
written. Access-log messages do not record query-string bearer credentials.
These controls do not isolate the application from a process that already
possesses its capability or can manipulate its files/process memory.

### Repeated Gaussian and CP2K sections

A section includes all consecutive mode blocks. Restarted numbering or an
explicit new calculation/geometry header splits sections. Frequencies,
intensities and displacements are read from one selected section; coordinates
are taken from the corresponding preceding geometry, never a later geometry.
An independent concatenated job cannot borrow geometry across its program
banner.

The last complete section is selected. If its displacement/frequency table is
truncated, parsing tries the preceding section and emits a warning. Invalid
numeric data is an error rather than a silent fallback. Missing IR intensities
remain absent rather than being borrowed from another section.

Completeness now requires every atom row in each selected displacement block;
missing rows are **not** silently replaced with zero vectors. This intentionally
fails closed for sparse/fixed-atom CP2K tables until their explicit atom-selection
mapping is implemented and tested. The existing geometry/format conventions are
retained; no general CP2K-version compatibility is established by these tests.

### xTB spectrum/companion correspondence

Standalone `$vibrational spectrum` input is recognized without an xTB banner.
The parser searches the entire input, permits blank/comment lines and optional
symmetry/selection-rule fields, and requires the last spectrum section to end
with `$end`. Its mode numbers must be consecutive and start at 1. Unlike the
Gaussian/CP2K table fallback, an incomplete final spectrum is rejected.

All rows, including translation/rotation rows, participate in the companion
`g98.out` correspondence check. Mode counts must match and frequencies must
agree within an absolute 0.02 cm^-1 tolerance (chosen for decimal print rounding;
not a physical mode-matching algorithm). Geometry and vectors both come from
that companion. Coincident frequencies alone do not establish file provenance:
users must supply the companion from the same calculation.

Only after correspondence checking are columns with BOTH an exactly zero
vector and a frequency within 0.01 cm^-1 of zero omitted from the animation.
Original mode numbers are retained in the manifest. Modes with any nonzero displacement, including low-frequency or imaginary
modes, are not removed by that rule.

The added regression inputs are clearly constructed samples. Real xTB/CP2K
producer fixtures and native end-to-end acceptance are still required; these
changes do not establish unrestricted real-output support.

### ORCA, filenames and child processes

ORCA IR parsing finds `Int`/`Intensity` in the table header rather than taking
`eps` as integrated intensity. Legacy tables without that header retain column
2 fallback. Unavailable/non-finite intensities are not replaced with `eps`.

Both Python and TypeScript remove `:` from export names, preventing Windows
drive-prefix/alternate-stream names from passing through this sanitizer.

External engine calls have a 300-second timeout (`MULTIWFN_TASK_TIMEOUT`). The
immediate child is killed and reaped on expiry, and the error identifies the
input file. This is not a process-tree cancellation implementation; native
Windows and descendant-process behavior need platform coverage.

## Still blocking a complete delivery

1. **Native end-to-end acceptance of the standalone entry remains manual.**
   The frozen `multiwfn-vibration` executable, its file-dialog queue, the
   static frontend delivery and the workflow/macOS/CMake packaging hooks are
   in place with packaged CI smoke tests (see the finding 1 follow-up above).
   What CI cannot cover is the interactive path: the real native file dialog,
   the WebView animation page and renderer interaction on each platform still
   need manual validation against a preview/formal package.
2. **The `--compute` artifact contract is implemented but only exercised with a
   fake engine.** Collection, verification and parsing are covered by tests
   whose engine writes a real artifact file; no stock-Multiwfn or
   xTB-wrapper integration run has been performed in this environment. The
   stock-Multiwfn boundary (menus write no normal-mode vectors) is a hard,
   documented failure by design.
3. Real producer fixtures, complete frontend tests/type checks, renderer
   interaction and native packaging must be verified in the full repository.

## Tests

Python regression module:

```sh
python3 -m unittest discover -s tests -p 'test_matterviz_vibration_viewer.py' -v
```

The new frontend test file uses the repository's existing `tests/*.test.ts` glob:

```sh
cd frontend/matterviz-viewer
pnpm test
pnpm check
```

Use the repository-declared Node and pnpm versions. The local patch validation
was narrower: Python 3.13.5 ran 61 tests (60 passed, one native desktop test
skipped). Seven transport-only frontend tests ran under Node 22.16.0 in an
isolated import harness, with the unused binary decoder replaced by a throwing
sentinel. This is below the package's declared Node >=24.11.1 requirement and
is **not** a supported-platform build/type-check result. A live Python/Node HTTP
smoke check exercised session JSON/binary transport, readiness, save and return;
it did not exercise the renderer or native WebView.
