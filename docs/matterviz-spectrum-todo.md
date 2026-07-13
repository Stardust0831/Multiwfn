# MatterViz origin/main parity TODO

Updated: 2026-07-14

## 2026-07-14 Rust host migration

- [x] Stop extending the Python launcher workaround and define the native architecture: Fortran remains the Multiwfn calculation/session adapter; Rust owns the loopback HTTP service, WebView, lifecycle and native file dialog.
- [x] Inventory the existing Python URL, validation, file IPC, timeout, cleanup, path-security, port-isolation and shutdown contracts before porting them.
- [x] Change the MatterViz Fortran launch boundary to invoke `matterviz-desktop` directly; retain the Windows `CreateProcessW` adapter so the native calculation request loop starts while the window is open.
- [x] Remove Python discovery and Python adapter staging from the MatterViz CMake resource target; require and stage the prebuilt Rust host with the frontend.
- [x] Implement `/api/orbital`, `/api/bond`, `/api/esp`, `/api/return`, frontend/session serving and port fallback in Rust with the current URLs and file request protocol unchanged; core Rust integration tests pass locally, while full Tauri checks await platform dependencies/CI.
- [x] Implement the current `--select-file --output` contract in Rust so reload/file selection does not retain a hidden Python runtime dependency.
- [x] Update Linux, macOS and Windows package workflows and extracted-package smoke tests to launch the Rust host directly; assert that MatterViz archives contain no runtime Python scripts or Python requirement.
- [ ] Prove a packaged Windows uncached orbital request is consumed while the WebView remains open, then verify Return/window-close lifecycle and concurrent-session port isolation.
- [ ] Run Rust tests/check/clippy, frontend test/check/build, CMake/source guards and locked Linux/macOS/Windows package jobs before publishing another preview.
- [x] Diagnose the first Rust-host CI failure: Linux `rfd` enabled `xdg-portal` without an async runtime, leaving `zbus` runtime dependencies unresolved; explicitly select the `async-std` backend and refresh the lockfile.
- [ ] Require the corrected Linux Rust test/release build plus Linux, macOS and Windows package jobs to pass; the earlier macOS shell build succeeded, but that incomplete run is not release evidence.
- [x] Draft a versioned binary volume protocol with explicit dimensions, lattice/origin, scalar type, byte order, units and integrity/size bounds in `docs/matterviz-volume-protocol.md`; production traffic remains on Cube until codecs and transport tests pass.
- [ ] Replace dynamic orbital/ESP Cube staging with a bounded shared-memory or pipe transport on Windows, Linux and macOS, retaining a deliberate compatibility/debug fallback until native transport is proven.
- [ ] Add throughput, lifecycle, cancellation/cleanup and malformed/oversized-volume tests for the native transport before removing the file fallback.

## 2026-07-14 Windows asynchronous launch blocker

- [x] Reproduce Preview 5 with the packaged Windows executable and prove that MinGW `execute_command_line(wait=.false.)` remains blocked until the Python/WebView launcher exits, so `run_matterviz_gui_loop` cannot consume orbital requests while the window is open.
- [x] Verify the diagnosis independently by wrapping the same Preview 5 launcher with Windows `start /b`: Multiwfn consumed `orbital 13 25000 0.05` and generated a valid cube/JSON response while the launcher remained alive.
- [x] Replace the Windows shell/Fortran async assumption with a GUI-adapter-only `CreateProcessW` C ABI; this remains the direct Rust-host spawn boundary and does not modify calculation modules.
- [x] Add a packaged-Windows regression that keeps the bundled Rust host alive and requires Multiwfn to consume `gui_request.txt` and publish the matching response before HTTP Return. The earlier Python-fixture form proved that Preview 5 failed for the expected unconsumed-request reason; the migrated test now targets the new runtime.
- [ ] Require the new Windows build to pass the async request-loop regression, existing session-isolation tests and all package checks before publishing another preview.
- [ ] Audit Windows non-ASCII executable/session paths separately after the asynchronous lifecycle blocker is closed; the Rust migration removes interpreter-path handling, but UTF-8 Fortran command and native file-dialog paths still need packaged verification.

## 2026-07-13 frontend parity work pending release

- [x] Complete code/test review of the current frontend parity changes before treating them as a release candidate; no preview containing this work has been released.
- [x] Add a right-side orbital selection panel with manifest orbital metadata, None and closed-shell HOMO/LUMO context, previous/next navigation, independent orbital isovalue control, and the full original-GUI grid precision choices: 25k, 50k, 120k, 300k, 500k, 1000k and 1500k points.
- [x] Preserve the structure canvas and cached orbital layers when the backend becomes stale; disable uncached orbital requests and report that reopening Multiwfn menu 0 is required for new calculations.
- [x] Persist slice controls (plane/Miller indices, position, resolution, colormap and auto/manual range) and ESP legend visibility/position/range through workbench state.
- [x] Add a periodic cross-boundary artifact and parser coverage preserving MatterViz-compatible bond `cell_shift` metadata, and verify shifted/unshifted rendering at desktop and 800px without page errors; validation with a real Multiwfn-generated cross-boundary workflow remains open.
- [x] Verify the right orbital panel and stale-backend fallback at 1440x900 and 800x700: all seven grid levels present, no viewer/panel overlap, uncached orbitals disabled, structure canvas retained and no page errors.
- [x] Record the live request check `orbital 42 300000 0.031`, browser audit and current `npm test`/`npm run check`/`npm run build` results as work-in-progress evidence only, not release completion.
- [x] Commit and push this parity increment to PR #26.
- [x] Require green PR #26 CI before producing another preview; all six runs for `3fb9a70` and CodeRabbit passed.
- [x] Publish `matterviz-preview-5` from the CI-verified `3fb9a70` commit and independently verify all release checksums and required Windows MatterViz paths.
- [ ] Manually validate `matterviz-preview-5` on Windows: right-side orbital selection, all seven grid precision levels, cached-orbital behavior after closing/ending the Multiwfn backend, and calculation of an uncached orbital while menu 0 remains active.

## Scope correction

- [x] Use `origin/main` as the only original 3Dmol GUI feature baseline.
- [x] Audit PR #25 separately; do not treat its unmerged code or protocol as baseline.
- [x] Remove Gaussian/ORCA/BDF/CP2K analysis-output parsers copied from or inspired by PR #25.
- [x] Remove `AnalysisStore`, analysis dataset CRUD/upload/inspect APIs and multi-dataset state.
- [x] Remove DOS/PDOS, IR, Raman, UV-Vis and NMR MatterViz capability declarations and controls.
- [x] Remove spectrum fixtures and tests that implied those kinds were connected.
- [x] Run final residue search for PR #25 analysis interfaces and external-output parser names.

## Authoritative parity matrix

| Feature | origin/main 3Dmol | Data source in origin/main | MatterViz status | Decision / gap |
| --- | --- | --- | --- | --- |
| DOS/PDOS | No native GUI/session path | None | Disabled/removed | Needs a future native GUI/session output protocol before implementation |
| IR | No native GUI/session path | None | Disabled/removed | Needs a future native GUI/session output protocol |
| Raman | No native GUI/session path | None | Disabled/removed | Needs a future native GUI/session output protocol |
| UV-Vis | No native GUI/session path | None | Disabled/removed | Needs a future native GUI/session output protocol |
| NMR | No native GUI/session path | None | Disabled/removed | Needs a future native GUI/session output protocol |
| Local 2D plot file | Yes | User-selected CSV/JSON in browser | Deferred | Not required for the current core GUI replacement phase |
| Cube 2D slice | Yes | Loaded cube grid | Connected | Retain and verify |

## First-stage parity

- [ ] Reconsider generic local CSV/JSON curve or heatmap import only if it becomes necessary for a concrete original-GUI workflow; it is not part of the current parity target.
- [x] Compare core original 3Dmol controls/workflows against MatterViz and update priorities.
- [x] P1: add orbital previous/next navigation plus index, energy, occupation and HOMO/LUMO context from the existing manifest.
- [x] P1: restore original drawmol orbital activation semantics: select HOMO/first orbital on startup, keep exactly one selected volume visible, reuse loaded manifest/dynamic orbital layers without another backend request, and support the original None selection.
- [x] P1: persist molecule visibility, atom/bond sizing, bond mode/strategy, labels, sphere quality and background through workbench state.
- [x] P1: provide named Ball+Stick, Spacefill, Stick and Wire convenience presets using the original GUI ratios; preserve unclamped base values and workbench state, and do not add Cartoon.
- [x] Reorganize the viewer using the VESTA screenshot as a layout reference only: retain all proven top/right actions, add a compact left surface/cell inspector and keep the central 3D viewport dominant.
- [x] Move the original-GUI representation presets and stable structure dimensions into the left inspector while retaining MatterViz native right-side controls; native topology edits invalidate stale preset markers.
- [x] Add fixed-step camera rotation, pan and zoom controls to the top toolbar using public MatterViz camera APIs, with explicit numeric step inputs and deterministic inverse-operation tests.
- [x] Redesign the rejected MatterViz `camera_up/camera_zoom` prototype before integration: construct controls with canonical up, rebuild the keyed camera subtree for roll changes, synchronize zoom from control `change` events, restore initial roll/zoom on reset, share zoom clamps, and keep side panes independent.
- [x] P1: add an explicit axes/orientation gizmo toggle and preserve it in optional workbench state.
- [x] P1: verify MatterViz native PNG export at desktop and 800px; downloaded images are valid and nonblank.
- [ ] Preserve the visible ESP legend in PNG export if a public MatterViz capture/compositing hook becomes available; native export currently captures only the WebGL canvas.
- [x] P1: expose per-layer negative phase, phase colors, cross-color colormap and editable color range using the existing state-covered fields.
- [x] P1: verify native global wireframe/material controls at desktop and 800px, including pixel changes and state coverage; no duplicate App panel is needed.
- [ ] Track original rendering smoothness as a useful MatterViz upstream improvement; do not approximate it in the WebView adapter because MatterViz currently has no equivalent mesh-quality API.
- [x] Explicitly exclude `solid+mesh` from the current target; it is a medium/low-priority visual inspection convenience.
- [x] Explicitly exclude `Cartoon` representation from the current target; it is primarily useful for biomacromolecules rather than mainstream Multiwfn workflows.
- [x] P1: cover oblique cells, negative/noninteger display ranges, independent atom supercells and preservation of MatterViz-compatible cross-boundary bond `cell_shift` metadata with focused tests.
- [ ] Complete browser-level periodic workflow validation with a real cross-boundary-bond artifact; no separate Multiwfn adapter setting currently exists and no new protocol should be invented without a native source.
- [x] P2: audit measurement parity. `origin/main` 3Dmol uses an unordered selection set and exposes no distance/angle/dihedral measurement workflow; the Qt measurement action is unimplemented. MatterViz native distance/angle plus the connected two-site bond request are not weaker than this baseline.
- [ ] Consider ordered angle/dihedral measurement only as a separately approved post-parity extension; do not add an unused frontend helper.
- [ ] P2: persist or explicitly scope slice, legend and remaining native structure control state.
- [x] P2: cover WebView startup/bind/launch/interruption and normal child-close signaling with adapter unit tests and CI.
- [x] Exercise the real `/api/return` route over HTTP and verify its JSON response, `gui_stop.flag` creation and server shutdown.
- [x] P2: complete installed Linux and Windows shell Return/shutdown smoke coverage through the real `/api/return` route; keep interactive macOS WKWebView validation in the manual prerelease checklist.
- [x] Build locked Linux, macOS and Windows MatterViz preview archives and verify extracted package structure and Multiwfn execution; Linux and Windows additionally pass real native WebView readiness.
- [x] Publish `matterviz-preview-1` as a GitHub prerelease for manual validation; keep interactive macOS WKWebView readiness in the manual checklist because hosted runners have no interactive WindowServer.
- [ ] Keep ESP work separate from the first native-parity PR and review its scientific authority carefully.
- [x] Run frontend unit tests, `npm run check`, `npm run build` and browser validation after cleanup.
- [x] Run Multiwfn/CMake builds in the locked Linux, macOS and Windows CI toolchains, including the first-class MatterViz backend and extracted packages.
- [x] Complete a high-level read-only review confirming strict origin/main scope.
- [x] Complete a read-only review of structure state and WebView lifecycle changes before commit.
- [x] Commit and push only after the scope review passes.

## Broader PR #26 risks

- [x] Complete API isolation and mutation-method audit.
- [x] Use a fresh atomically created GUI session directory for each default launch so concurrent Multiwfn instances cannot share requests/artifacts; preserve explicit environment overrides.
- [x] Bound orbital request quality and require finite, bounded isovalue in the GUI HTTP adapter, with manifest-backed orbital index checks and HTTP rejection tests.
- [x] Add a random per-session capability, strict loopback Host validation and anti-embedding/security headers for API and session routes.
- [ ] Migrate state-changing requests away from GET only with a coordinated frontend/host compatibility version; capability and Host checks protect the preserved URL contract in this milestone.
- [x] Define and test Return behavior while a backend request is already in flight: the UI, HTTP request and WebView close promptly, while an already-running Fortran calculation is deliberately not cancelled and finishes naturally.
- [x] Add a finite token-scoped WebView startup handshake with server-before-shell ordering, initial-page readiness, timeout/error cleanup and CI Rust checks.
- [x] Installed-resource/native-shell packaging smoke: Linux and Windows pass extracted adapter-to-WebView readiness; macOS passes dependency relocation, shell loading and extracted Multiwfn tests, with interactive WKWebView validation deferred to the preview tester.
- [x] Cross-platform locked WebView build and bundle-size evidence using committed `Cargo.lock` and three CI-produced preview archives.
- [x] Label frontend-sampled ESP extrema as approximate visual estimates rather than authoritative Multiwfn results.

## Preview handoff

- [x] Freeze new feature work for the manual prerelease confirmation cycle.
- [x] Pass local frontend tests/check/build, Python tests, configuration validation, workflow lint and Return browser lifecycle validation.
- [x] Complete a high-level read-only review of the final Return lifecycle and packaging-smoke changes with no blocker or high-severity finding.
- [x] Confirm the final pushed commit passes the locked Linux, macOS and Windows package jobs.
- [x] Publish the final Return-enabled build as a GitHub prerelease and pause for manual confirmation.

## Preview 2 feedback and native structure follow-up

- [x] Diagnose the Windows preview blocker: the archived 11-atom/10-bond session served `structure.mol2` successfully, but the vendored MatterViz package advertised the extension without a MOL2 parser or dispatch branch.
- [x] Emit one MatterViz-native `structure.json` for every periodic or nonperiodic structure-bearing session; the manifest points to that JSON entry.
- [x] Serialize explicit connectivity in root `properties.bonds` with zero-based `site_idx_1`/`site_idx_2` endpoints, including aromatic bond order mapping.
- [x] Remove the obsolete alternate-structure path from the GUI session protocol: no MOL2 or XYZ structure entries are emitted or required for the MatterViz replacement viewer.
- [x] Repackage the periodic rendering fix from `13a8149a` together with explicit Multiwfn `Bq` ghost-center support from `d8719d12` as `0.4.2-multiwfn.d8719d12.r4`.
- [x] Add parser coverage for native nonperiodic/periodic JSON, lattice data, labeled `Bq` ghost centers and zero-based single/double/aromatic `properties.bonds`.
- [x] Validate native nonperiodic and periodic JSON at 1440x900 and 800x700: nonblank canvas, no page errors or overflow, and a functional boundary-atom toggle with changed pixels.
- [x] Validate a native `Bq` ghost-center artifact containing an explicit bond at 1440x900 and 800x700 without mapping the center to a real element; canvas rendering, legend and layout complete without page errors.
- [x] Fix the review-found partial-FCHK-topology failure: candidate bond counts are not published until all connectivity is validated, so an unsupported later bond cannot leave a nonzero count with unallocated arrays.
- [x] Run the GUI/session source guards in the MatterViz CI workflow, including unified JSON, zero-based/aromatic bonds, ghost metadata and invalid-topology count publication.
- [ ] Run the archived 11-atom/10-bond session and installed-package explicit-connectivity smoke with `matterviz-preview-4`.
- [x] Confirm the upstream periodic proxy-loop fix and native JSON launch path in the locked Linux, macOS and Windows package jobs for commit `ce2515e`.
- [x] Compile the Fortran GUI/session adapter and pass the Linux, macOS and Windows package workflows for the native-JSON commit.
- [x] Complete the local adapter/build naming migration: first-class `matterviz` CMake backend, `Multiwfn_MatterVizGUI`, `MULTIWFN_MATTERVIZ_*`, MatterViz session/tool names and isolated MatterViz resources.
- [x] Confirm the renamed MatterViz backend and three renamed installation packages in all six branch/PR workflows for commit `d814049`.
- [x] Publish `matterviz-preview-3` from the exact CI-verified `d814049` commit; independently download the release assets, verify all SHA256 entries, required MatterViz paths and absence of obsolete 3Dmol tools.
- [x] Diagnose the Preview 3 repeat failure: Preview 3 generated a valid native `structure.json` with 11 atoms and 10 bonds, but an older Preview 2 Python/WebView process still owned `127.0.0.1:8765`; Windows address reuse let the new service report the same URL, so the new window loaded Preview 2's `structure.mol2` manifest.
- [x] Disable live address/port reuse, set Windows `SO_EXCLUSIVEADDRUSE`, atomically fall back to an OS-assigned port and test that concurrent services return their own manifests. Native Windows and CI tests pass.
- [x] Publish `matterviz-preview-4` from the exact CI-verified port-isolation merge commit `fbf7f0d`; independently verify all release SHA256 entries and the packaged Windows binding implementation.
- [ ] Manually validate `matterviz-preview-4` on Windows while Preview 2 remains open, then with the archived 11-atom/10-bond session verify the native structure, 10 explicit bonds, Return lifecycle and normal Multiwfn continuation.

## Parallel integration policy

- Bounded parity tasks may use independent worktrees and `agent/*` branches based on the latest reviewed development commit.
- Each branch must have disjoint write scope, objective verification and its own commit; it must not edit the shared TODO/log documents.
- The primary development branch owns documentation updates, reviews every agent commit, merges or cherry-picks it, resolves conflicts and reruns proportionate verification before pushing PR #26.
