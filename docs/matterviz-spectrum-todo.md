# MatterViz origin/main parity TODO

Updated: 2026-07-16

## 2026-07-14 Rust host migration

- [x] Stop extending the Python launcher workaround and define the native architecture: Fortran remains the Multiwfn calculation/session adapter; Rust owns the loopback HTTP service, WebView, lifecycle and native file dialog.
- [x] Inventory the existing Python URL, validation, file IPC, timeout, cleanup, path-security, port-isolation and shutdown contracts before porting them.
- [x] Change the MatterViz Fortran launch boundary to invoke `matterviz-desktop` directly; retain the Windows `CreateProcessW` adapter so the native calculation request loop starts while the window is open.
- [x] Remove Python discovery and Python adapter staging from the MatterViz CMake resource target; require and stage the prebuilt Rust host with the frontend.
- [x] Implement `/api/orbital`, `/api/bond`, `/api/esp`, `/api/return`, frontend/session serving and port fallback in Rust with the current URLs and file request protocol unchanged; core tests pass locally and locked full Tauri checks pass in CI.
- [x] Implement the current `--select-file --output` contract in Rust so reload/file selection does not retain a hidden Python runtime dependency.
- [x] Update Linux, macOS and Windows package workflows and extracted-package smoke tests to launch the Rust host directly; assert that MatterViz archives contain no runtime Python scripts or Python requirement.
- [x] Prove a packaged Windows uncached orbital request is consumed while the WebView remains open, then verify Return/window-close lifecycle and concurrent-session port isolation.
- [x] Prove the packaged Windows native launch and authenticated orbital index-0 control request traverse Rust HTTP, file IPC and the live Fortran request loop, followed by Return and clean parent/desktop shutdown; the later real nonzero native-volume gate also passes.
- [x] Run Rust tests/check/clippy, frontend test/check/build, CMake/source guards and locked Linux/macOS/Windows package jobs before publishing another preview.
- [x] Diagnose the first Rust-host CI failure: Linux `rfd` enabled `xdg-portal` without an async runtime, leaving `zbus` runtime dependencies unresolved; explicitly select the `async-std` backend and refresh the lockfile.
- [x] Diagnose the first Windows Rust-host run: 12 tests passed, then Return shutdown blocked in the HTTP integration test until the 60-minute job timeout; wake a potentially blocked listener during stop and bound test-client reads.
- [x] Correct the packaged Windows async regression to consume the Rust host's advertised service URL instead of assuming the preferred port; capture inherited stdout/stderr incrementally so a live Multiwfn process no longer hides launch diagnostics.
- [x] Replace PowerShell cross-thread output event handlers with a pure-.NET asynchronous line collector after the Windows runner proved event callbacks have no PowerShell runspace.
- [x] Fix the actual Windows async-launch branch selector: CMake defines `MULTIWFN_WINDOWS`, while the Fortran adapter incorrectly checked `_WIN32` and therefore sent space-containing commands through `execute_command_line`.
- [x] Remove the local integer declaration that shadowed the module `launch_matterviz_process` procedure and produced an undefined external symbol once the native Windows branch became live.
- [x] Require the corrected Linux Rust test/release build plus Linux, macOS and Windows package jobs to pass; push and PR run pairs for `ee8edec` passed completely.
- [x] Pass the complete PR frontend/Rust host plus Linux, macOS and Windows package matrix with the native Windows async regression; keep the separate nonzero orbital artifact gate open.
- [x] Draft a versioned binary volume protocol with explicit dimensions, lattice/origin, scalar type, byte order, units and integrity/size bounds in `docs/matterviz-volume-protocol.md`; production traffic remains on Cube until codecs and transport tests pass.
- [x] Correct and freeze the v1 binary volume layout: exact 48-byte prelude, 304-byte volume header, enums, CRC32C coverage, ordering, units, bounds, HTTP entry schema and explicit Cube fallback.
- [x] Separate the Rust-host final goal, binary protocol design and cross-platform test plan into maintained documents.
- [x] Implement strict Rust and TypeScript v1 codecs with shared checked-in golden frames; keep production dynamic traffic on Cube.
- [x] Add bounded authenticated Rust volume storage and `/api/volume/<id>` without changing `/api/orbital` or `/api/esp` response shapes.
- [x] Dispatch `mwfn-volume-v1` entries through frontend ArrayBuffer decoding while retaining the existing Cube parser for all Cube/legacy entries; append the capability only to same-origin binary API URLs.
- [x] Complete the pre-pipe protocol variants: signed samples, density/ESP quantity-unit pairs, and direct MatterViz Cube/binary numerical equivalence for grid, origin, lattice and range.
- [x] Add inherited bounded pipes with negotiated file/Cube fallback and migrate dynamic orbital and paired ESP publication; keep this marked as implementation-complete rather than release-verified.
- [x] Implement the structured cross-platform C launcher/publisher with direct
  argv, explicit inherited handles, ready negotiation, publish timeout and
  idempotent close.
- [x] Implement Rust pipe adoption, bounded framed reader, ACK-after-insert and
  EOF/shutdown cleanup; retain HTTP and file IPC after transport failure.
- [ ] Verify the dynamic orbital/ESP pipe path on Windows, Linux and macOS; successful native publication must avoid dynamic Cube staging, while forced negotiation/publish failure must retain the deliberate Cube fallback.
- [x] Add a synthetic end-to-end test covering authenticated `/api/orbital`, `gui_request.txt`, C frame publication, Rust ACK-after-insert, `/api/volume/<id>`, and duplicate/rejected publication followed by Cube fallback. This does not replace the real Multiwfn calculation gate.
- [ ] Add throughput, lifecycle, cancellation/cleanup, descriptor/handle-leak and malformed/oversized-volume tests for the native transport before considering removal of the file fallback.
- [x] Bound the producer's complete-frame write and ACK wait with one publish deadline; cover a stalled maximum-workload writer returning timeout instead of freezing.
- [x] Make POSIX direct launch and file-only fallback report `execv` failure through a CLOEXEC status pipe instead of treating `fork()` success as host-launch success.
- [ ] Run one real packaged nonzero uncached orbital on all three platforms (macOS may require manual WebView confirmation), assert a binary response and no successful-path `orbital_*.cube`, then force transport failure and assert Cube fallback.
- [x] Verify the checked-in `(CO)5Cr.fch` test asset through the extracted Windows package: request orbital 43 at 25k points, fetch `mwfn-volume-v1`, validate binary magic, assert no `orbital_43_25000.cube`, then Return cleanly (run `29310169491`).
- [x] Run an independent read-only C/Rust/Fortran lifecycle and numerical-semantics review of the local implementation; the initial stop-flag, stalled-write and POSIX exec findings are fixed with no remaining blocker/high/medium. Repeat release review after cross-platform jobs pass.

## 2026-07-14 Windows asynchronous launch blocker

- [x] Reproduce Preview 5 with the packaged Windows executable and prove that MinGW `execute_command_line(wait=.false.)` remains blocked until the Python/WebView launcher exits, so `run_matterviz_gui_loop` cannot consume orbital requests while the window is open.
- [x] Verify the diagnosis independently by wrapping the same Preview 5 launcher with Windows `start /b`: Multiwfn consumed `orbital 13 25000 0.05` and generated a valid cube/JSON response while the launcher remained alive.
- [x] Replace the Windows shell/Fortran async assumption with a GUI-adapter-only `CreateProcessW` C ABI; this remains the direct Rust-host spawn boundary and does not modify calculation modules.
- [x] Add a packaged-Windows regression that keeps the bundled Rust host alive and requires Multiwfn to consume `gui_request.txt` and publish the matching response before HTTP Return. The earlier Python-fixture form proved that Preview 5 failed for the expected unconsumed-request reason; the migrated test now targets the new runtime.
- [x] Require the new Windows build to pass the async request-loop regression, existing session-isolation tests and all package checks before publishing another preview.
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

## Highest priority after the trackball camera

These items are explicitly **for implementation only after the pole-free
trackball camera is complete**. They are the next highest priority, but must not
change, block, or expand the current camera implementation and validation.

- [ ] Replace `gui_request.txt`,
  `response_<id>.json`, and `gui_stop.flag` with versioned bidirectional pipe
  messages without changing Multiwfn scientific-core calculation logic.
- [ ] Deliver manifest, native structure JSON and dynamic volume frames directly
  from memory to the Rust Host. The formal runtime must not create a writable
  session directory, control files, structure/manifest artifacts or Cube files.
- [ ] Keep Cube fallback only behind an explicit development/diagnostic option.
  A formal pipe failure must report an explicit error and terminate the invalid
  session instead of silently writing a Cube artifact.
- [ ] Add Windows, Linux and macOS end-to-end coverage for request/response,
  Return/close, failure cleanup and concurrent sessions. After every successful
  normal session, assert that no runtime intermediate file or session temporary
  directory was created.

Current compatibility gates preserve the three control-file interfaces. Cube
fallback remains only on paths that have not yet migrated from v1; it is not
part of a formal major-2 request.

Scope correction for the low-copy v2 increment (2026-07-15): the control-file
migration remains deferred, but a request that has entered the formal major-2
orbital stream must not silently fall back to Cube. The retained automatic Cube
compatibility statement applies only to the still-v1 paths until their own v2
bundle migration and three-platform acceptance are complete.

## Low-copy volume transport and flat-grid work

- [x] Add a major-2 C publisher with the existing 304-byte metadata header,
  u64 lengths, incremental CRC32C and bounded direct writes from `cubmat`; cover
  fragmented reads, 1,500,001 samples, invalid data, timeout and broken pipes.
- [x] Add Rust major-2 header decoding, request-ID stream broker, bounded chunk
  forwarding and major-2 ACKs while retaining the v1 store for compatibility.
- [x] Add host/cgroup-aware memory admission. The optional
  `MULTIWFN_MATTERVIZ_MAX_ACTIVE_VOLUME_BYTES` override may only tighten the
  automatically derived budget; it is not a replacement hard maximum.
- [x] Change `/api/orbital` in a transported session to one binary HTTP response
  so Rust can forward the body under backpressure without constructing a full
  frame or waiting for the post-ACK JSON response.
- [x] Preallocate the browser response buffer from `Content-Length`, fill it
  incrementally and decode major 2 as a `Float64Array` view over the final
  buffer. Keep v1 limits and URL loading unchanged for compatibility.
- [x] Stop menu 0 from exporting an arbitrary already-allocated global
  `cubmat` as startup `cubmat.cube`; this was the source of stale density data
  in Preview 9 sessions.
- [x] Add vendor-first `ScalarGrid3D` support with flat typed arrays and legacy
  nested-grid compatibility across marching cubes, sampling, range, resampling,
  periodic operations, parsing and slices. The viewer pins revision r17
  (`736cf19985c69187f6c20ddadb9962d84b580704a0fb2f57a981a363b998c4b0`).
- [x] Move isosurface geometry generation to a module Worker. Use
  `SharedArrayBuffer` when cross-origin isolation is available; otherwise
  transfer the ordinary `ArrayBuffer`, serialize requests per grid and return
  ownership on normal success/error. A Worker crash explicitly invalidates a
  transferred grid instead of claiming that its detached buffer was restored.
- [x] Add exact geometry preflight before mesh allocation: triangle count,
  unique crossed-edge/vertex count and positions/normals/indices/colors/GPU
  estimates. Reject work that exceeds the Rust-provided post-volume geometry
  budget instead of presenting an inexact preview as exact.
- [x] Enforce one cumulative geometry budget across all resident positive,
  negative and multi-layer surfaces. Preserve the original TypedArray
  `byteOffset` and length after transferable Worker ownership returns; the
  regression test uses the real 304-byte binary volume header offset.
- [x] Resolve the current Linux process's cgroup v2/v1 leaf from
  `/proc/self/cgroup` and mountinfo, including namespace mount-root mapping,
  then walk its ancestors and apply the tightest hierarchical constraint
  instead of assuming either the leaf or cgroup root alone is effective.
- [ ] Define and implement an ordered major-2 volume bundle for ESP density and
  potential. ESP remains on the tested v1 two-volume store until this contract
  is reviewed; do not force two volumes through the single-orbital response.
- [ ] Remove the now-unused successful orbital `response_<id>.json` artifact as
  part of the deferred bidirectional control-pipe migration, not through a new
  one-off cleanup protocol.
- [x] Run Rust test/check/clippy in CI and complete Linux/macOS/Windows package
  plus real uncached orbital verification. Exact commit `1f0b060` passed the
  MatterViz GUI, build, Linux compatibility, core-source protection and legacy
  GUI workflows before Preview 10 was published.
- [x] Prove the production frontend build emits a standalone bundled module
  Worker (`marching-cubes-worker-DNZvsbt9.js`) with no unresolved relative
  imports; pass 95 frontend tests, Svelte diagnostics and the production build.

## Current Rust-host release gates

- [x] Prove a real uncached nonzero orbital uses `mwfn-volume-v1` with no
  dynamic Cube in the extracted Windows package (CI run `29310169491`).
- [x] Prove the same real FCHK/orbital path in the extracted Linux package,
  including native volume/no-Cube, Return, process-tree and inherited-output
  closure assertions (PR run `29312744850`, Linux job).
- [x] Prove the generic C-to-Rust binary transport on Windows, Linux and macOS.
- [ ] Complete the documented interactive macOS WKWebView/manual orbital gate;
  hosted runners do not provide a usable WindowServer.
- [x] Pass the explicit extracted Linux package automatic-Cube-fallback
  regression. Its test-only executable wrapper rejects the inherited-pipe
  launch and requires the unchanged C launcher to restart file-only; no
  production protocol or runtime switch is added (PR run `29314730868`, Linux
  job).
- [x] Complete final lifecycle/resource evidence, read-only review, package
  audit, prerelease publication and checksum verification. Preview 7 targets
  exact CI-verified commit `8db821c`; all downloaded assets pass the published
  SHA256 list and contain no Python or legacy 3Dmol runtime entries.

## Preview 7 manual feedback

- [x] Diagnose Enter-to-select-file failure on packaged Windows: the native
  branch still passed a quoted Rust-host command through Fortran
  `execute_command_line`, and Windows reported that path as not found.
- [x] Replace that remaining native shell boundary with a synchronous structured
  C ABI that directly starts `matterviz-desktop --select-file --output FILE`,
  waits for completion and preserves `selected_file.txt`/cancel behavior. Keep
  the legacy 3Dmol branch unchanged.
- [x] Diagnose invisible dynamic orbitals from the retained Preview 7 session:
  MO12/MO13 were calculated, ACKed, cached and decoded correctly, and MO13 at
  +/-0.05 generated nonempty meshes. Native `structure.json` remained in
  absolute coordinates while MatterViz renders volumes in the first volume's
  origin-relative Cube frame, placing the mesh about 4 Angstrom outside the
  structure camera view.
- [x] Align native structures to the first volume origin in the frontend adapter,
  including append/replace/remove transitions and periodic fractional-coordinate
  recomputation; do not alter Multiwfn calculations or the binary protocol.
- [x] Validate the captured real 50x49x52 MO13 frame at 1440x900 and 800x700:
  signed red/blue surfaces overlap CH3Cl, canvases are nonblank, and there are no
  page errors or document overflow.
- [x] Preserve structure/site identity across managed volume-frame changes so
  measurement, bond-edit and atom-edit state is not cleared. Pin MatterViz r8
  with narrowly scoped revision/delta inputs that rebuild deferred supercells
  and translate private reset-camera baselines without invoking new-structure
  cleanup.
- [x] Replay the no-startup-volume sequence with the captured MO13 artifact at
  1440x900 and 800x700: request the orbital, move the camera, reset it, and
  verify a nonblank canvas, aligned molecule/surface, no page errors and no
  document overflow.
- [x] Confirm the previously pushed file-picker/alignment increment in PR CI run
  `29324664144`: Rust/frontend plus Linux, macOS and Windows package jobs passed.
  This run predates the final pinned MatterViz r8 state fix.
- [x] Pass the focused unit/source/C/Fortran checks and locked three-platform
  package workflow, then publish a corrected preview for Windows manual retest.
  PR run `29328529075` and tag run `29329561943` passed; Preview 8 targets exact
  commit `00b79a7`, and all independently downloaded release assets match the
  published SHA256 list with no Python or 3Dmol runtime entries.

## Preview 8 manual feedback

- [x] Reproduce the live Windows session where MO12 and the molecule move
  together toward the canvas edge and atom spheres are clipped while bonds
  remain visible. Confirm both 120k and 500k binary orbital responses are valid
  and the browser reports no page error.
- [x] Identify the camera-frame cause: automatic framing leaves the declarative
  `camera_target` undefined while the actual target lives in MatterViz's
  `rotation_target_ref` and OrbitControls. r8 translated the structure and
  camera position but not that effective target.
- [x] Replace the abandoned r8-r10 structure/camera translation with MatterViz
  r12 absolute volume origins. Native binary volumes and Cube fallback paired
  with independent `structure.json` render in the original Cartesian frame;
  standalone Cube imports retain MatterViz's relative-first behavior.
- [x] Validate the retained real MO12 artifact at 1440x900 and 800x700: desktop
  atom spheres, bonds and signed surfaces remain together in the original
  molecular frame, canvases are nonblank and no page error is emitted. Switching
  from the saved 120k frame to the saved 500k frame and camera drag/reset also
  preserve alignment.
- [x] Apply the same absolute/relative-first reference-origin rule to
  cross-volume vertex sampling, and cover nonzero-origin absolute and standalone
  Cube-relative coordinates with a behavioral unit test.
- [x] Pass local focused/full tests, strict C compilation, Svelte check,
  production build and retained MO12 browser replay after reinstalling the exact
  r12 archive from the frozen lockfile.
- [x] Pass corrected-r12 independent read-only review with no finding; archive,
  lock integrity, absolute/relative sampling and scope boundaries were verified.
- [x] Pass locked three-platform CI and publish Preview 9 for Windows manual
  confirmation. PR run `29359257113` and tag run `29360374182` passed; Preview 9
  targets exact code commit `355862f`, and independently downloaded assets match
  the published SHA256 list with no Python or 3Dmol runtime entries.
- [x] Process Preview 9 feedback: remove the stale menu-0 Cube export and replace
  the bounded v1 orbital path with the reviewed low-copy major-2 stream and
  Worker-backed flat-grid rendering path.

## Preview 10 manual confirmation

- [x] Publish `matterviz-preview-10` from exact CI-verified commit `1f0b060`.
  Tag workflow `29377790013` passed and all independently downloaded Linux,
  macOS and Windows assets match `SHA256SUMS.txt`; packages contain the native
  Multiwfn executable, Rust host and built MatterViz frontend with no Python or
  legacy 3Dmol runtime entry.
- [x] Record the Preview 10 Windows blocker: cross-origin isolation selected a
  `SharedArrayBuffer` for the major-2 response, but the volume decoder passed
  its magic-byte view to `TextDecoder`, which WebView2 correctly rejects.
- [x] Replace text decoding of the fixed `MWFNVOL\0` magic with byte comparison
  and cover the strict WebView2 behavior, zero-copy shared samples, the real
  304-byte sample offset and damaged magic with a focused regression test.
- [x] Pass the locked three-platform workflow and independent read-only review,
  publish Preview 11, and verify all checksums/package contents. Exact commit
  `cf1d227` passed the PR and tag workflows; the packaged decoder uses fixed
  byte comparison and all archives contain no Python or 3Dmol runtime path.
- [ ] Pause implementation pending the original Windows Preview 11
  file/orbital/large-grid/camera/Return confirmation cycle.
- [x] Diagnose the Preview 11 zero-byte active-volume limit from the reported
  snapshot: 9.42 GiB was available, but the old policy reserved 20% of the
  61.56 GiB total (12.31 GiB), so saturating subtraction rejected even a
  0.96 MiB orbital.
- [x] Base the 20% adaptive reserve on currently available memory while keeping
  the 2 GiB minimum, configured hard ceiling, existing-volume add-back and
  cumulative geometry budget. Cover the exact reported Windows values and all
  existing low-memory/cgroup cases with Rust tests.
- [x] Pass locked three-platform CI and publish `matterviz-preview-12` from exact
  commit `a949da6`; independently verify all archive checksums, required native
  binaries/frontend assets and absence of Python or 3Dmol runtime paths.
- [ ] Pause implementation pending Windows Preview 12 orbital, memory-admission
  and lifecycle validation.
- [x] Reproduce the Preview 12 Worker failure with proxied `dimensions` and
  `lattice`: the TypedArray/SAB was cloneable, but Svelte `$state` proxy arrays
  caused `postMessage` to throw `DataCloneError: [object Array] could not be
  cloned` before marching cubes started.
- [x] Pin MatterViz r18 and normalize only Worker-bound grid metadata to plain
  tuples/options. Preserve the original TypedArray/SAB, byte offset, transfer
  behavior, geometry budget and marching-cubes inputs; cover the shared-buffer
  Proxy case with a red/green regression.
- [x] Pass independent review and locked three-platform CI and publish Preview
  13 from exact commit `c5db71c`. Tag run `29426781920` completed successfully
  and uploaded Linux, macOS and Windows packages plus `SHA256SUMS.txt`.
- [x] Supersede Preview 13 with the independently audited Preview 14; do not ask
  for manual validation of the obsolete package.

## Frontend volume-cache lifecycle

- [x] Stop retaining all previously selected orbitals. Selecting a different
  orbital removes unreferenced orbital `VolumetricData`, manifest entry and
  layer references; selecting it again must request Multiwfn calculation.
- [x] Centralize cache compaction and atomically reindex volume layers plus
  transitive `color_volume_idx` references. Retain visible layers, the active
  slice/inspector volume and hidden color sources that a retained surface uses.
- [x] Remove strong references to released TypedArray/SharedArrayBuffer backing
  stores and count shared backing stores only once. Do not claim synchronous JS
  garbage collection; deterministic release means no remaining app/Worker/GPU
  owner.
- [x] Add a generic MatterViz geometry release boundary. Removed/replaced grids
  terminate active Workers, invalidate queued work and immediately dispose
  unretained Three.js geometries before the normal 50 ms rebuild debounce.
- [x] Cover orbital A-to-B cache eviction, cache-miss detection on reselection,
  visible non-orbital retention, transitive color sources, delete/reindex,
  explicit active-volume retention, SAB aliasing, Worker cancellation and
  geometry disposal with focused pure/Worker tests. Browser replay separately
  verifies that reselection performs a third backend request.
- [x] Run the complete frontend test/check/build gates and retained browser
  replay at 1440x900 and 800x700. Both viewports perform MO1 -> MO2 -> MO1 as
  three backend requests while retaining exactly one volume, with nonblank
  Canvas, no page error and no document overflow.
- [x] Complete and adjudicate the independent read-only lifecycle review. Its
  important finding, force-recompute failure selecting a preceding visible
  non-orbital layer, is fixed by role-aware orbital restoration and covered by
  a regression test.
- [x] After review fixes, pass locked three-platform PR CI, publish Preview 14
  from exact commit `def456c`, and audit all assets. Pause implementation for
  Windows manual orbital-switch and memory-lifecycle confirmation.

## Pole-free trackball camera

- [x] Replace the Multiwfn workbench's polar `OrbitControls` interaction with
  an opt-in generic MatterViz Arcball mode. Keep Orbit as the MatterViz default
  for compatibility and do not change Multiwfn calculation/session protocols.
- [x] Make left-drag and fixed-step directions structure-relative: dragging or
  stepping up/right must turn the visible structure up/right. Support natural
  screen-normal roll from an edge circular drag and explicit clockwise/
  counterclockwise step buttons, with no release inertia.
- [x] Preserve pan, zoom, auto-rotate, reset, projection switching, camera state,
  multi-view ownership and the existing axis gizmo. Do not leave Arcball-only
  settings visible when they have no effect.
- [x] Add pole traversal, orthonormal-basis, inverse-step, projected-direction,
  roll and reset regressions. Validate production Canvas behavior at 1440x900
  and 800x700 with no page errors, overlap or horizontal overflow.
- [x] Repair the final-review Arcball reset defect: after a native pan, keep
  Three's public target, private runtime pivot, reset gizmo baseline and camera
  world direction consistent. Cover both baseline seeding and application
  Reset, then confirm pixel-identical browser reset at desktop and 800px.
- [x] Package the Arcball changes on top of MatterViz r19 without losing Worker
  cancellation or immediate geometry disposal; run frontend test/check/build,
  complete independent read-only review and locked three-platform CI before
  publishing the next prerelease for Windows manual confirmation.
- [x] Keep local-only MatterViz upstream issue/PR drafts in
  `docs/matterviz-upstream-drafts.md`. Do not publish them before manual
  prerelease acceptance and a clean rebase onto current upstream.
