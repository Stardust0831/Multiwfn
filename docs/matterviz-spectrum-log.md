# MatterViz parity development log

## 2026-07-23: prerelease updater architecture

- Started the updater on an independent branch from current `origin/main`, not
  on the native-plot PR. Work is confined to the MatterViz GUI, Rust middleware,
  release packaging and tests; scientific calculation modules remain outside
  scope.
- Audited the signed updater in `Stardust0831/ssh-mountmate`. Its Ed25519 key
  registry, bounded release metadata and detached helper are useful foundations,
  but its whole-directory swap is unsuitable for a Multiwfn folder that may
  contain user files.
- Chose a signed file-level ownership inventory. Unknown regular files remain
  untouched, `settings.ini` is always preserved, and any managed-file change or
  new-path collision aborts the update before disk mutation. New and removed
  official files are handled by authenticated old/new inventories.
- Limited the first feature to manual checks from preview packages, the latest
  newer signed preview, normal user-driven Multiwfn exit, manual restart and
  three-platform support. Formal releases omit the updater and UI capability.
- Production key setup is deferred until implementation and security review
  pass. CI uses ephemeral keys; production custody will use a protected GitHub
  Environment plus an encrypted offline recovery copy.
- Static integration review rejected the first updater-core transaction rather
  than treating it as complete. Staging occupied the same directory that the
  installer rejected as an unfinished transaction, and backup renames preceded
  their durable journal entries, so normal installation and crash recovery were
  not yet valid.
- Corrected the trust design to avoid a circular archive hash. Each preview
  package carries a separately signed installed-inventory proof that binds the
  repository, channel, tag, target and managed inventory digest. The external
  signed release manifest then binds that inventory digest and the completed
  archive name, size and SHA-256. User-modified `settings.ini` remains outside
  the managed digest.
- Host integration now passes the Multiwfn PID from the native C launcher,
  exposes capability-protected local status/check/stage/install routes, accepts
  only versioned updater JSON, preserves structured conflict replies from
  nonzero helper exits and confirms a pending update only after frontend
  readiness. The preview-only frontend has explicit idle, available, staging,
  ready, conflict, error and recovery states; its focused protocol tests pass.
- Independent security review rejected the initial core as not ready because
  file renames were weaker than journal durability, applying and installed
  transactions shared one confirmation bit, the helper was not detached and
  Linux tracked reusable numeric PIDs. The corrected core now uses explicit
  applying/installed lifecycle states, idempotent rollback, Unix directory
  fsync, Windows write-through rename, detached process creation and Linux
  pidfds. Host startup preserves recovery state and only confirms an explicitly
  installed transaction after frontend readiness.
- Local C, Python, workflow-schema and focused updater-frontend checks pass.
  Full frontend execution remains dependency-blocked in this worktree, and no
  Rust toolchain is installed. A one-time CI bootstrap will therefore generate
  the genuine updater lockfile and rustfmt output before the workflow is changed
  back to strict locked, read-only verification.

## 2026-07-14: Native Rust host migration started

- Corrected the implementation direction after the Python launcher fixes became a second process-lifecycle layer: MatterViz will use one native Rust host for the local HTTP/session service, WebView creation, API routing, native file selection, port binding and shutdown. Fortran remains the tightly coupled Multiwfn calculation adapter and continues to own the existing request loop; no calculation core was changed.
- Completed a source-level inventory of the Python behavior that must remain compatible during migration: fixed frontend/session URLs, orbital/bond/ESP validation, serialized `gui_request.txt` and `response_<id>.json` waits, Return stop signaling, bounded cleanup, session path containment, preferred-port fallback and concurrent-session isolation. Browser-only Python launch behavior is not part of the native MatterViz runtime contract.
- Split migration into two verifiable milestones. Milestone 1 preserves the current file IPC while replacing the Python service and launcher on Windows, Linux and macOS. Milestone 2 introduces a versioned binary volume protocol and replaces dynamic Cube staging with bounded shared memory or pipes; it will not be mixed into the initial orbital-recovery fix.
- Updated the Fortran MatterViz path to resolve and launch `resources/tools/matterviz-desktop[.exe]` directly with `--frontend`, `--session` and `--manifest`. Windows still uses the native asynchronous `CreateProcessW` adapter, which is required for the Fortran orbital request loop to start immediately. The legacy 3Dmol development backend retains its existing Python/Qt choices.
- Updated the MatterViz CMake resource target to require a prebuilt Rust host, stage it with the frontend and stop discovering or copying Python adapters. The native file-dialog call site now targets the Rust host's compatible `--select-file --output` mode.
- Implemented the Rust host modules for CLI, loopback service, session/static routes, orbital/bond/ESP/Return APIs, serialized file IPC, cleanup/pruning, native file selection and coordinated stop/window lifecycle. A temporary core-only Rust harness compiled these modules with Rust 1.88 and passed 12 unit/integration tests, including request validation, `.10g`-compatible numeric payloads, a complete orbital file-IPC round trip, path/Host containment, capability rejection, fragmented requests, manifest/WASM serving, checked Return shutdown and busy-port fallback.
- Generated the locked Rust dependency graph and formatted the host. Rust 1.88 Windows-target Tauri `cargo check --locked` and `cargo clippy --locked -- -D warnings` pass locally using a no-op resource-compiler fixture; native linking/window execution still requires the real platform toolchains. The locked Linux/macOS/Windows workflow now runs Rust test/check/release build before packaging, including on pull requests.
- Added a random 256-bit per-session API capability propagated only through the WebView URL, strict single-Host validation against the actual loopback authority, Windows `SO_EXCLUSIVEADDRUSE`, security headers, bounded request headers and a read deadline. Return reports success only after `gui_stop.flag` is written; a failed stop write keeps the service/window available instead of abandoning the Fortran loop.
- Replaced package staging and extracted Linux/Windows smoke paths with direct Rust-host launch and HTTP Return checks, while preserving the prerelease publication job. The Windows asynchronous regression now uses the packaged Rust executable and DLLs instead of fake Python launchers.
- Added `docs/matterviz-volume-protocol.md`: the next milestone uses a versioned little-endian frame protocol over inherited anonymous pipes, with bounded Rust HTTP delivery and Cube fallback. Named shared memory is deferred until pipe benchmarks justify its additional cross-platform complexity.
- Final local verification passes: Rust 1.88 core host tests 12/12; Windows-target Tauri check and strict clippy; 47 Python reference/source tests with one expected Windows-only skip; MatterViz frontend 71/71, zero Svelte diagnostics and production build; configuration/YAML/source guards and `git diff --check`. The final high-level read-only review found no remaining blocker, high or medium issue. Native Fortran/CMake, real Linux/Windows WebView packages and the authenticated Windows request-loop regression remain CI gates; no preview has been published.

## 2026-07-14: Windows request loop launch diagnosis and fix

- Manual Preview 5 validation showed `/api/orbital` returning `Multiwfn backend unavailable` while the terminal and WebView were still open. The archived session contained valid native structure/manifest data; the request endpoint and frontend parameters were correct.
- Reproduced the packaged executable with a controlled long-lived launcher. On MinGW Windows, `execute_command_line(..., wait=.false.)` did not return until that launcher exited, so the subsequent `run_matterviz_gui_loop` never ran while the GUI was open. Closing the GUI created `gui_stop.flag`; only then did Multiwfn continue, immediately leave the loop and return to the main menu.
- Confirmed the causal fix without rebuilding by launching the same Preview 5 child through `start /b`: an `orbital 13 25000 0.05` request was consumed and produced `orbital_13_25000.cube` plus an `ok: true` response while the child remained alive.
- Implemented a narrow GUI/session adapter fix: MatterViz/legacy-web CMake builds now link `noGUI/matterviz_spawn.c`; Windows uses `CreateProcessW`, closes the returned process/thread handles and enters the existing Fortran request loop immediately. No orbital, grid or other Multiwfn calculation source was changed.
- Added static build guards and a native packaged-Windows lifecycle test using a fake long-lived GUI server. The test asserts request consumption and matching response while the launcher PID is alive, then exercises `gui_stop.flag` and graceful `q` exit. Preview 5 fails this regression exactly at the unconsumed request. Local protocol/source tests pass 44 tests with one expected Windows socket skip; C/YAML/PowerShell parsing checks pass. A positive Windows result awaits CI compilation because the local WSL environment has no CMake/MinGW toolchain.
- The first Windows CI build exposed two harness/encoding issues before release: nested `pwsh` failures were not propagated by the outer PowerShell step, and combining the asynchronous lifecycle assertion with a non-ASCII path made the child-launch failure ambiguous. The workflow now fails explicitly on a nonzero regression exit. The decisive lifecycle test uses absolute ASCII paths containing spaces plus the resolved full Python executable path; broader Unicode-path support remains a separate adapter compatibility item.
- A second enforced Windows run still failed before the fake Python launcher could report readiness. The remaining difference from the successful `start /b` reproduction was handle inheritance: CI starts Multiwfn with redirected standard streams, while the native spawn disabled inheritance. The adapter now passes the current stdin/stdout/stderr handles explicitly with `STARTF_USESTDHANDLES` and enables inheritance, matching both redirected CI execution and the normal user console.
- High-level review rejected unrestricted handle inheritance because a long-lived GUI child could retain unrelated Multiwfn files or pipes. The native adapter now duplicates only stdin/stdout/stderr (falling back to `NUL` for missing console handles) and restricts `CreateProcessW` inheritance through `STARTUPINFOEXW` plus `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`.
- The enforced Windows fixture initially created only the browser-mode server script, while the packaged executable is compiled with WebView as its default shell. To keep the test focused on asynchronous process launch rather than environment/default-shell selection, the fake MatterViz home now supplies identical long-lived `multiwfn_matterviz_server.py` and `multiwfn_matterviz_webview.py` entry points, matching the real package layout.

## 2026-07-13: frontend parity increment pending release

- Continued strict `origin/main` 3Dmol GUI parity work on the MatterViz frontend branch; this does not add DOS/PDOS, IR, Raman, UV-Vis or NMR capabilities.
- Added a right-side orbital selection panel using existing manifest metadata, including None selection, orbital navigation and closed-shell HOMO/LUMO context. The panel exposes an independent orbital isovalue and the complete grid precision set: 25k, 50k, 120k, 300k, 500k, 1000k and 1500k points. A final review caught and corrected an open-shell frontier-label regression through a shared helper and unit test.
- Added stale-backend handling that preserves the loaded structure canvas and cached orbital layers, disables uncached orbital requests, and directs the user to reopen Multiwfn menu 0 for new calculations.
- Extended workbench state round-tripping for slice plane/Miller indices, position, resolution, colormap, range mode and manual bounds, plus ESP legend visibility/position and the linked ESP range.
- Added a periodic cross-boundary structure artifact and parser test preserving MatterViz-compatible bond `cell_shift` metadata. The artifact rendered differently with and without the shift at desktop and 800px without page errors; a real Multiwfn-generated cross-boundary workflow remains a parity gap.
- Live request verification recorded: `orbital 42 300000 0.031`. A packaged-asset-equivalent browser audit passed at 1440x900 and 800x700 with all seven grid levels, no viewer/panel overlap, correct `Cached only` fallback, disabled uncached orbitals, a retained structure canvas and no page errors. Current local frontend evidence also includes 71 passing `npm test` tests, `npm run check` with zero diagnostics and a successful `npm run build`; these are work-in-progress checks only. No preview containing this increment has been released.
- Committed the reviewed increment as `3fb9a70` and pushed it to PR #26; CI must pass before another preview is published.
- All six GitHub Actions runs for `3fb9a70` passed (`matterviz-gui` push/PR, build, Linux compatibility, GUI demo and core-source protection), and CodeRabbit completed successfully. The branch is cleared for the next manual-validation preview.
- Published GitHub prerelease [`matterviz-preview-5`](https://github.com/Stardust0831/Multiwfn/releases/tag/matterviz-preview-5) from the exact CI-verified `3fb9a70` code commit. Tag workflow [`29269376924`](https://github.com/Stardust0831/Multiwfn/actions/runs/29269376924) passed the adapter, Windows session isolation, Linux/macOS/Windows packaging and release jobs.
- Independently downloaded all four assets and verified every `SHA256SUMS.txt` entry. Asset sizes are Linux 16,346,842 bytes, macOS 12,307,539 bytes, Windows 21,787,290 bytes and checksums 353 bytes; the Windows archive contains `Multiwfn_MatterVizGUI.exe`, the MatterViz server/WebView tools and the built MatterViz frontend, with no 3Dmol path. Development pauses for manual Windows confirmation.

## 2026-07-13: scope correction

- Re-established `origin/main` (`d204ae429752617b6fce82ee45012bbe07ddb64c`) as the sole original 3Dmol GUI baseline.
- Compared `origin/main`, the current branch and the unmerged PR #25 branch. `origin/main` has no DOS/PDOS, IR, Raman, UV-Vis or NMR GUI/session structured-data path.
- Confirmed PR #25 introduced `multiwfn_analysis.py`, `AnalysisStore`, dataset import/CRUD endpoints, analysis workers and DOS/IR/NMR protocol/UI. Raman and UV-Vis were not even part of PR #25 and had been added locally from external Gaussian/ORCA output parsing.
- Corrected the prior classification that treated PR #25 adapters as existing backend data. External output parsers are not a Multiwfn-native calculation-to-session chain and cannot establish MatterViz parity.
- Removed all external-output parsers, `AnalysisStore`, analysis dataset APIs, source-file detection, five-kind spectrum capability declarations, SpectrumPanel/adapters, fixtures and associated tests.
- Removed the previously committed DOS-only MatterViz panel and parser because the same native session capability is absent from `origin/main`.
- Preserved the audit result in the parity TODO. The original 3Dmol code contains a generic user-selected CSV/JSON 2D curve/heatmap loader, but product scope now defers that utility because it is not required for the current core GUI replacement phase; cube slices remain connected.
- No commit or push was made before this cleanup.
- Cleanup verification passed: 33 frontend unit tests, zero Svelte diagnostics, production Vite build and `git diff --check`.
- Playwright passed at 1440x900 and 800x700 using a manifest with no analysis section: the structure canvas loaded, no page/console errors occurred, and no DOS/PDOS/IR/Raman/UV-Vis/NMR/Spectrum capability control was present.
- High-level read-only scope review found no cleanup defect and confirmed: PR #25 is not used as baseline, no external parser masquerade remains, no multi-dataset platform remains, and the five disputed spectrum capabilities now match `origin/main` by remaining unavailable.
- A local-only CSV/JSON 2D Plot panel was briefly implemented and verified, then removed after product clarification that generic file plotting is not required for the current core Multiwfn GUI replacement phase.
- Completed a core `origin/main` parity audit. Highest-priority gaps are orbital metadata/navigation, structure/style controls, volume/surface controls and full periodic workflow verification. Measurements, bond analysis and 2D slices have the core data paths but need stronger wrapper-level acceptance tests; state and lifecycle are partial.
- Identified ESP extrema provenance as the only current frontend-derived scientific result: it is a bounded visual estimate, not a Multiwfn-native extrema calculation. Updated UI labels accordingly and kept deeper ESP work outside the first native-parity phase.
- Improved the native orbital workflow using existing manifest metadata only: added previous/next navigation, an orbital selector, energy/occupation display and HOMO/LUMO context. No calculation or protocol changes were required.
- Final orbital review tightened edge cases: metadata selection is used only when the manifest item list covers the full orbital count, larger spaces retain numeric navigation, and HOMO/LUMO labels appear only for explicitly closed-shell sessions. Desktop and 800px Playwright navigation passed without page errors.
- Expanded the native volume-layer workflow without changing data production: each layer now exposes positive/negative phase colors and visibility; compatible cross-volume coloring exposes colormap and numeric range controls. Existing workbench state fields already preserve these values.
- Extended workbench state to preserve stable MatterViz structure appearance: molecule/atom visibility, bond display, atom radius, equal-size atoms, bond thickness/strategy, site labels/indices, sphere quality and background color/opacity. The original GUI `showMolecule` manifest value now initializes whole-molecule visibility, hiding both atoms and bonds when disabled.
- Hardened the WebView adapter so every resolved-session exit path signals `gui_stop.flag`, including missing inputs, both bind attempts failing, desktop launch failure, service interruption and normal window close. Added seven lifecycle unit tests and CI coverage without changing Multiwfn calculation code.
- Reconfirmed that generic CSV/JSON curve and heatmap import is not required for the current original-GUI replacement target; no such importer or capability is present in PR #26.
- Verification for this increment: 37 frontend unit tests passed; Svelte check reported zero diagnostics; the production build passed; seven WebView adapter tests, Python compilation, desktop configuration validation and `git diff --check` passed; Playwright structure-state round trips passed at 1440x900 and 800x700 with no page errors.
- Final read-only review found no blocking correctness or scope issue and explicitly confirmed strict `origin/main` scope, whole-molecule visibility semantics, optional state compatibility and normal/failure WebView signaling. Real installed-shell concurrent shutdown remains a documented smoke-test gap.
- Adopted independent `agent/*` worktree branches for bounded, non-overlapping parity tasks while long PR CI runs. Measurement ordering tests and periodic workflow tests were started in separate branches; the development branch remains the sole owner of TODO/log integration and final conflict resolution.
- The measurement branch correctly stopped without code changes after disproving the checklist assumption: `origin/main` 3Dmol stores modified-click selections in an unordered set and has no geometry-measurement API, while the Qt action is explicitly unimplemented. MatterViz already provides native distance/angle overlays; ordered angle/dihedral behavior would be a new extension, not a first-stage parity requirement.
- The periodic branch added focused coverage for negative/fractional display ranges remaining independent from persisted atom-supercell settings and for preservation of MatterViz-compatible cross-boundary bond `cell_shift` metadata through oblique-cell injection. It deliberately did not invent a new Multiwfn adapter field.
- Surface-control audit separated rendering smoothness from calculation grid quality: the latter is already connected, while the former requires a real MatterViz geometry/API improvement. Product scope keeps smoothness as an upstream enhancement and explicitly declines `solid+mesh` and biomacromolecule-focused `Cartoon` work for this phase.
- Browser verification at 1440x900 and 800x700 confirmed native MatterViz wireframe and material controls are reachable and change rendered pixels. Native PNG export produced valid nonblank images without page errors; a temporary ESP fixture confirmed that the DOM legend is currently omitted because MatterViz exports only the WebGL canvas.
- API/mutation review found session isolation and orbital resource validation to be the highest bounded adapter risks. It also recorded unauthenticated mutation endpoints and Return-during-calculation semantics for staged remediation; traversal containment, request serialization, bond/ESP allowlists and same-origin normal frontend requests were confirmed safeguards.
- Adopted the provided VESTA screenshot as a UI-layout reference, not a feature baseline: retain every proven Multiwfn top/right action, keep the 3D viewport dominant, move stable display/material controls into a compact left panel, and add top fixed-step rotate/pan/zoom tools only through public MatterViz camera APIs. VESTA-only scientific tools remain out of scope.
- Added an explicit Axes toggle backed by MatterViz `scene_props.show_gizmo` and optional workbench-state persistence. State import/export passed at 1440x900 and 800x700 with the checkbox disabled as requested and no page errors.
- Hardened orbital GUI HTTP requests before they reach Multiwfn: positive grid quality is limited to the native 25k-1.5M range, index is bounded by manifest metadata when available, isovalue must be finite and within the existing GUI range, duplicate parameters are rejected, and invalid requests cannot create a backend request file. Fifteen Python tests passed.
- PR CI for `12aaa0d` completed successfully across frontend/adapter, Linux glibc compatibility, three noGUI platforms and three GUI packaging platforms; core-source guard and CodeRabbit also passed.
- Replaced the fixed default `multiwfn_3dmol_session` with a fresh atomically created per-launch directory, while preserving explicit `MULTIWFN_3DMOL_SESSION` paths. Creation failure now aborts instead of falling back to shared state; concurrent harness checks and 19 Python tests passed. The integration agent also passed a focused `gfortran` syntax/harness check, while the primary shell did not expose `gfortran` for a duplicate local run.
- A first MatterViz `camera_up/camera_zoom` prototype was intentionally rejected after high-level review. Runtime `camera.up` changes conflict with OrbitControls' constructor-cached up-space, wheel zoom was not reliably synchronized, reset preserved roll, zoom bounds diverged and multi-view ownership was undefined. No vendor package or Multiwfn camera toolbar was built from that unstable commit.
- Added the first VESTA-inspired layout phase without changing the feature baseline: every established top command and MatterViz native right-side control remains, while a left rail opens compact Structure, Surfaces and periodic Cell inspectors. Structure duplication is intentionally limited to App-authoritative Axes/Background until MatterViz can publish native scene changes outward.
- Layout acceptance passed at 1440x900 and 800x700: no page errors or document overflow, the desktop viewport remained 1096x822, the mobile viewport remained 756x623 under a closable drawer, all top commands were present, wireframe/material changes produced distinct canvas hashes, and opening Layers closed an existing Slice panel. Final read-only review approved the change.
- PR CI for `94c49c9` passed frontend/adapter, Linux glibc compatibility, three noGUI platforms, three GUI packaging platforms, core-source guard and CodeRabbit.
- Finalized the VESTA-inspired inspector layout as a presentation adaptation only. The 44px left rail and 300px desktop inspector expose App-authoritative structure, surface/material and periodic-cell controls; the 800px layout uses an overlay drawer. Proven Multiwfn commands remain in the top toolbar and MatterViz native scene controls remain on the right.
- Completed the fixed-step camera workflow requested for the top toolbar: numeric rotation degrees with camera-relative X/Y orbit and Z roll, world-unit screen-relative pan, and reciprocal percentage zoom for perspective and orthographic cameras. Each command disables auto-rotation so a requested deterministic step is not immediately obscured by continuous motion.
- Integrated the revised MatterViz camera API only after two rejected iterations exposed constructor-cached OrbitControls up-space, stale wheel/touch zoom binding, incomplete reset semantics, divergent zoom limits, multi-view ownership ambiguity and a pre-rekey pose overwrite. The accepted design supplies canonical up before control construction, keys the primary camera/control subtree by up, synchronizes position/target/up/orthographic zoom from OrbitControls `change`, restores initial up/zoom, shares zoom clamps and leaves side panes independent.
- Updated optional workbench state to preserve camera up, orthographic zoom and projection while ignoring malformed/nonfinite values. Camera step inputs are normalized to finite per-control limits before use. The frontend suite now contains 47 tests including camera basis, inverse rotation/pan/zoom, input boundaries, degeneracy and persisted-state coverage.
- Browser acceptance passed at 1440x900 and 800x700 with no page errors or document overflow: positive/negative X rotation, left/right pan and reciprocal zoom restored the original pose; Z roll preserved position/target while changing up; mixed X/Y rotation plus Z roll followed by the native Reset restored initial position, target, up and zoom; rotation changed canvas pixels; and a wheel event on the rendering canvas updated the exported orthographic zoom binding. A separate existing overlay hit-target issue may affect where a real pointer wheel lands, but the fixed-step zoom command and OrbitControls binding path are functional.
- A final high-level review rejected the first integrated package because keyed camera reconstruction could redefine OrbitControls' reset baseline after mixed X/Y orbit and Z roll, its declarations omitted the new public bindings, numeric input limits were presentation-only, and package provenance named an older commit. The accepted fix stores the original position/target/up/zoom outside the keyed scene, rewrites the controls reset baseline, and has a real Three.js/OrbitControls reconstruction test; two focused MatterViz files passed six tests.
- Vendored final MatterViz package `matterviz-0.4.2-multiwfn.2f2dc280.r2.tgz` with lock integrity `sha512-Wc4uK2xR7huaSPy8I+BcxNxGlL3Vjg1U9EzmP7iQD02SdQNhR+OPzi+aV8wtX8qgbikdEecQcghKGdY3i42JHw==`; retained the generated inline element data module required by the Vite production build. Full declaration generation timed out locally after 240 seconds, so the no-types build was paired with audited declarations for the changed public camera fields and then checked from the consuming application. Browser validation caught and removed one orphaned legacy zoom-state reference, a missing camera-mount dependency in the reset snapshot effect, and an early pre-layout zoom baseline before this final package was accepted. A permanent consumer test now checks both camera fields in the public props and Svelte bindable-key declaration.
- Added original-GUI representation convenience presets to the VESTA-inspired left inspector: Ball+Stick, Spacefill, Stick and Wire atomically map atom/bond visibility and the original 3Dmol radius/thickness ratios. These are visual workflow equivalents rather than claims of pixel-identical 3Dmol geometry; Cartoon and `solid+mesh` remain excluded.
- Hardened representation switching so clamped Spacefill/Wire output does not destroy the user's underlying atom or bond size. Manual dimension refinement updates the active preset base, native right-side topology changes invalidate stale preset markers, and workbench export/import preserves the preset plus both base values.
- Representation browser acceptance passed at 1440x900 and 800x700 with no page errors or horizontal overflow. All four presets produced distinct canvas hashes; atom base `3` survived the Spacefill clamp round trip and bond base `0.01` survived the Wire `0.025` floor round trip. The frontend suite now contains 55 passing tests.
- Added a real HTTP `/api/return` integration test proving the JSON response, `gui_stop.flag` creation and service shutdown. This does not replace the still-pending installed native-shell Return smoke test.
- Replaced implicit WebView startup success with a finite session-local handshake: the adapter creates a unique token, starts the HTTP service before launching the shell, and waits up to 15 seconds by default for Tauri to report the initial page `Finished`. Shell errors, early exits, service failure and timeout now signal stop, close the service and reap the child. CI now runs Rust `cargo test` and `cargo check` because the local environment does not expose Cargo.
- Final read-only review caught a shutdown deadlock when `Thread.start()` itself raises and found that tokenless status records weakened launch isolation. Cleanup now calls `shutdown()` only after the service thread starts successfully, still closes the bound socket on failure, and requires an exact launch-token match. Two regressions bring the focused adapter suite to 14 passing tests.
- Browser-level validation of a real periodic cross-boundary bond remains pending. Unit coverage preserves MatterViz-compatible `cell_shift`, but the original GUI/session adapter has no native structured source for such a chain, so no protocol or artifact was invented to claim completion.
- Added a locked MatterViz prerelease pipeline without expanding GUI functionality. `Cargo.lock` now fixes the Tauri dependency graph; tag builds compile the MatterViz frontend, native WebView shell and WebView-default Multiwfn executable on Linux, macOS and Windows, then package the session adapter, frontend assets, settings, license and runtime requirements.
- Packaging review found and corrected several release-only defects before publication: a missing Windows ICO resource, Linux headless D-Bus/WebKit setup and overly broad process cleanup, macOS duplicate/transitive RPATH handling, Windows MSYS/Python separation, and generated `__pycache__` files in archives.
- Final branch packaging run `29229161693` passed all three platforms. Linux uses an explicit glibc 2.35 floor and passed an extracted Multiwfn-session-to-adapter-to-Tauri/WebKit readiness test under Xvfb. Windows passed DLL closure, a PATH-clean extracted Multiwfn functional test and real WebView readiness. macOS passed dylib relocation with duplicate-RPATH rejection, shell loading and extracted Multiwfn functional tests; interactive WKWebView readiness remains manual because hosted runners provide no interactive WindowServer.
- Published GitHub prerelease [`matterviz-preview-1`](https://github.com/Stardust0831/Multiwfn/releases/tag/matterviz-preview-1) from `d5866195f6d9b91ee094875b4c32ad8ad6815e05`. Tag workflow `29229812055` passed frontend/adapter plus Linux, macOS and Windows packages. Assets are Linux 16,333,725 bytes, macOS 12,295,616 bytes, Windows 21,771,703 bytes, plus `SHA256SUMS.txt`; the release is explicitly marked prerelease for manual confirmation.
- Froze feature development for the final packaging/runtime confirmation cycle. The existing `matterviz-preview-1` remains a valid packaging baseline, but it predates the final Return lifecycle change and is not being represented as the new confirmation build.
- Restored original-GUI Return semantics across the browser, adapter and packaged shell. The frontend suppresses duplicate Return requests and attempts `window.close()` after both HTTP success and failure; the adapter passes the exact session stop-file path to Tauri; adapter-managed Tauri shells observe the flag and exit through `AppHandle::exit(0)`; the adapter retains bounded terminate/kill cleanup as a fallback.
- Backend request polling now releases both consumed and unconsumed GUI requests promptly after Return, while preserving a completed response if it wins the same polling iteration. This does not cancel Multiwfn core work: a Fortran calculation that has already started continues naturally, by design, while the UI and HTTP layers stop waiting.
- Linux and Windows extracted-package smoke tests now exercise the real `/api/return` route, require a successful JSON response, wait for adapter exit and verify `gui_stop.flag`. macOS retains noninteractive dependency/loading and extracted-Multiwfn checks because hosted runners cannot provide a manual WKWebView session.
- Final local verification passed: 58 frontend unit tests, zero Svelte diagnostics, production Vite build, 31 Python tests, Python compilation, desktop configuration validation, Actionlint, `git diff --check` and Playwright Return success/failure/duplicate-click scenarios with no page errors. A high-level read-only review found no blocker or high-severity issue; Rust compilation and native package runtime remain CI-gated because the local host lacks the required D-Bus development package.
- Commit `8936ea8f9ecaecff60d8a95dd996a944aa0b298a` passed all PR and push checks. Push workflow [`29232532379`](https://github.com/Stardust0831/Multiwfn/actions/runs/29232532379) passed the frontend/adapter job and locked Linux, macOS and Windows package jobs; the related build, Linux glibc compatibility, noGUI GUI-release matrix and core-source guard workflows also passed.
- Published GitHub prerelease [`matterviz-preview-2`](https://github.com/Stardust0831/Multiwfn/releases/tag/matterviz-preview-2) from `8936ea8f9ecaecff60d8a95dd996a944aa0b298a`. Tag workflow [`29233289220`](https://github.com/Stardust0831/Multiwfn/actions/runs/29233289220) rebuilt and passed the frontend/adapter plus all three platform packages, then uploaded Linux (16,336,171 bytes), macOS (12,299,357 bytes), Windows (21,777,859 bytes) and `SHA256SUMS.txt`. Development is paused for manual prerelease confirmation.
- Resumed strict native-parity work with the highest-impact audited orbital lifecycle gap. MatterViz drawmol sessions now choose the HOMO preview when available, otherwise the first orbital and then the first cube, and make only that selected volume visible just like the original 3Dmol GUI.
- Selecting an already loaded orbital now activates the cached volume without another Multiwfn request or duplicate layer. The original `None` selection is available and hides all volumes; any later orbital selection restores single-active visibility while users may still explicitly enable additional layers in the layer panel.
- Added pure tests for HOMO/fallback selection, exact cached orbital lookup, duplicate entries, malformed indices and `volume_idx`-based exclusive visibility. Verification passed with 62 frontend tests, zero Svelte diagnostics and a production build. Playwright at 1440x900 and 800x700 confirmed HOMO-only startup, zero `/api/orbital` calls for cached previews, canvas pixel changes after switching, None hiding all layers, exclusive visibility restoration, no page errors and no horizontal overflow.
- Manual Windows validation of `matterviz-preview-2` found a release blocker: a formatted-checkpoint session served `structure.mol2` successfully but rendered `No structure is available in this session`. The archived session under `G:\Downloads\Multiwfn-MatterViz-matterviz-preview-2-Windows` contains a valid 11-atom/10-bond CRLF MOL2 and valid manifest; transport, encoding and path casing are correct.
- Root cause is the vendored MatterViz package: `.mol2` is listed as a structure extension, but `parse_any_structure` has no MOL2 parser or dispatch branch. The frontend therefore throws before assigning `structure`.
- The same review found two orbital lifecycle blockers before commit: grid-quality changes must force recomputation instead of hitting the index cache, and asynchronous responses must retain the requested orbital index even if UI state changes. Workbench restore must also synchronize the orbital control. These corrections are implemented and covered by the rerun described below.

## 2026-07-13: native structure protocol correction

- Corrected the Preview 2 remediation to use one MatterViz-native `structure.json` for both periodic and nonperiodic structure-bearing sessions. `manifest.json` now references that JSON artifact directly; the GUI no longer emits MOL2 or XYZ structure entries for the replacement viewer.
- The native artifact contains `sites` and keeps explicit connectivity in root `properties.bonds`; bond endpoints are zero-based and aromatic orders are represented explicitly. This preserves formatted-checkpoint connectivity without relying on a parser that MatterViz does not ship.
- Source-level regression guards now check the unified manifest path, native site fields, root bond properties and zero-based endpoints.
- Periodic native JSON then exposed a separate MatterViz proxy identity loop. Upstream fixed that rendering defect in `matterviz-rendering` commit `13a8149a`. A later read-only review also identified that Multiwfn ghost centers use the pseudo-symbol `Bq`, which the MatterViz structure type did not declare. MatterViz commit `d8719d12` now treats `Bq` as a structure-only pseudo-species, keeps it out of periodic-table data, skips it for XRD scattering and excludes it from real-element symmetry selection. The viewer vendors both fixes as `matterviz-0.4.2-multiwfn.d8719d12.r4.tgz`; previous custom packages were removed.
- The same review found a high-severity partial-topology failure: FCHK validation could increment the global bond count before encountering a later invalid bond, leaving a nonzero count with unallocated arrays for the JSON writer. Validation now uses a local candidate count and publishes it only after the entire reciprocal topology is accepted. The source-level regression is included in the MatterViz CI workflow.
- Added frontend parser regression coverage for native nonperiodic and periodic JSON, labeled `Bq` ghost centers, root zero-based single/double/aromatic bonds, lattice matrices and derived lattice parameters. Because the MatterViz package uses Vite-resolved extensionless ESM imports, this test loads the published package through Vite SSR rather than weakening the production package contract for Node's direct resolver.
- Local browser validation passed at 1440x900 and 800x700 for both native nonperiodic and periodic sessions: canvases were nonblank, expected elements and cell controls appeared, the boundary-atom toggle changed pixels, and there were no page errors or horizontal overflow. The prior `effect_update_depth_exceeded` failure did not recur.
- Reran the orbital lifecycle Playwright audit after the vendor replacement. HOMO startup, cached selection without backend requests, grid-quality recomputation, no duplicate replacement layer, None visibility, delayed-response index ownership and workbench restore all passed at desktop and 800px without errors or overflow.
- A dedicated `Bq` browser artifact also passed at 1440x900 and 800x700 with the pseudo-species and bonded hydrogen visible, nonblank canvases, no page errors and no overflow. It is not relabeled as a chemical element.
- Current local verification after the native-JSON correction includes 65 frontend tests, 35 Python tests, Python compilation, desktop configuration validation, Actionlint, shell syntax, `git diff --check`, zero viewer Svelte diagnostics and a production Vite build. Focused MatterViz tests passed 171 structure/camera cases plus 86 XRD/symmetry/composition cases; MatterViz's repository-wide Svelte check retains pre-existing color-store, camera typing and optional anywidget declaration errors, while no `StructureElement`/`Bq` diagnostic remains.
- Native-JSON commit `ce2515e3f4b90777516d399530353fc7d5b18e4a` passed all six triggered workflows. This includes core-source protection, general builds, Linux compatibility, the legacy GUI release matrix, the MatterViz PR job, and push workflow [`29248145852`](https://github.com/Stardust0831/Multiwfn/actions/runs/29248145852) with locked Linux, macOS and Windows MatterViz packages. The Fortran adapter compiled and extracted package checks passed on all supported CI paths.

## 2026-07-13: first-class MatterViz naming

- Replaced the active transitional `3dmol` plus `MULTIWFN_WEB_FRONTEND=matterviz` build combination with a first-class `MULTIWFN_GUI_BACKEND=matterviz` path. The active executable is `Multiwfn_MatterVizGUI`, its shell option is `MULTIWFN_MATTERVIZ_DEFAULT_SHELL`, and its staged resources contain only the MatterViz server, file dialog, WebView launcher and built frontend.
- Renamed the active Fortran adapter, Python server/file-dialog tools, server tests, environment variables and default session prefix to MatterViz names. No compatibility wrapper or duplicate old-name tool was added; the explicitly labeled legacy 3Dmol/Qt CMake branch remains separate from the MatterViz package path.
- Updated current English/Chinese build, contribution, WebView and viewer documentation. Historical 3Dmol reference documents remain historical; the explicitly legacy frontend README only received factual path corrections for the renamed shared adapter and tools.
- Added build-name guard tests covering the CMake backend, executable, isolated resources, Fortran runtime contract and package workflow. Local verification passes 65 frontend tests, zero viewer diagnostics, production build, 39 Python tests, Python compilation, Actionlint for all affected workflows, shell syntax, browser structure/orbital audits and `git diff --check`.
- Naming commit `d814049a80514c8f5bf0e11530287041bcdddbd2` passed all six branch/PR workflows: build `29250882244`, core protection `29250882307`, Linux compatibility `29250882294`, legacy GUI packages `29250882268`, MatterViz PR validation `29250882285`, and MatterViz push/packages `29250879215`. The latter produced successful Linux, macOS and Windows packages using the first-class backend and executable name.
- Published GitHub prerelease [`matterviz-preview-3`](https://github.com/Stardust0831/Multiwfn/releases/tag/matterviz-preview-3) from that exact commit. Tag workflow [`29252215944`](https://github.com/Stardust0831/Multiwfn/actions/runs/29252215944) rebuilt and passed the adapter plus all three platform packages and release job. Assets are Linux 16,342,968 bytes, macOS 12,301,933 bytes, Windows 21,781,242 bytes and `SHA256SUMS.txt` 353 bytes.
- Independently downloaded all four published assets. Every SHA256 entry matches; each archive contains `Multiwfn_MatterVizGUI`, the three MatterViz Python tools and `frontend/matterviz-viewer/dist/index.html`, with no obsolete 3Dmol server/file-dialog tools or executable. The remaining gate is manual Windows validation with the archived 11-atom/10-bond session.

## 2026-07-13: Preview 3 concurrent-session failure and Preview 4

- Windows validation initially appeared to reproduce the old MOL2 parsing failure in Preview 3. Direct inspection disproved a native-JSON regression: Preview 3 generated `structure.json` and a manifest referencing it, containing all 11 atoms and 10 formatted-checkpoint bonds.
- Process inspection found Preview 2 and Preview 3 Python services plus WebView shells alive concurrently, both reporting `127.0.0.1:8765`. Forty direct requests to that endpoint all returned Preview 2's `structure.mol2` manifest. Windows `SO_REUSEADDR` semantics allowed the newer server to bind the same address without receiving the requests.
- Port-isolation PR [`#29`](https://github.com/Stardust0831/Multiwfn/pull/29) disables address/port reuse, sets `SO_EXCLUSIVEADDRUSE` on Windows and binds the preferred port atomically before falling back to an OS-assigned port. Browser and WebView launch paths share the same helper.
- Added tests proving a busy preferred port falls back, concurrent services receive different ports and each serves its own manifest, plus a Windows-only exclusive-socket assertion. A standalone Windows PR job prevents this behavior from being Linux-only evidence. Linux ran 43 tests with the Windows assertion skipped; native Windows and GitHub Windows both ran all 31 server/WebView tests successfully.
- Merge commit `fbf7f0d48d643e2afaee638538904bb1df906784` passed all six PR/push workflows, including Windows session isolation and three-platform packages. Tag workflow [`29263108804`](https://github.com/Stardust0831/Multiwfn/actions/runs/29263108804) published [`matterviz-preview-4`](https://github.com/Stardust0831/Multiwfn/releases/tag/matterviz-preview-4).
- Preview 4 assets are Linux 16,342,317 bytes, macOS 12,301,987 bytes, Windows 21,781,452 bytes and `SHA256SUMS.txt` 353 bytes. Independent downloads match every checksum; the Windows archive contains the exclusive binding and atomic fallback implementation and no obsolete 3Dmol tools. Manual concurrent-preview and archived-session validation remains open.

## 2026-07-14: Rust host CI correction

- The first Rust-host push/PR runs failed only on Linux while compiling `zbus`. The `rfd` dependency disabled default features and enabled `xdg-portal` without selecting either supported async runtime, so Linux compiled runtime-dependent code without `async-io`, `async-lock`, `async-process`, `async-executor`, `async-task` and `blocking` dependencies.
- Corrected the dependency contract by explicitly enabling `rfd`'s `async-std` feature alongside `xdg-portal`. This does not change the HTTP URLs, session files, Fortran request loop, orbital calculation path or packaged runtime architecture.
- The failed run's macOS desktop-shell build passed, while Linux Rust test/package jobs failed before Multiwfn packaging and Windows remained incomplete. No prerelease is eligible until the corrected locked builds and package/runtime regressions pass on all three platforms.
- Local Rust 1.88 verification passed locked Cargo metadata, formatting and the feature graph showing all required `zbus` async dependencies enabled. Configuration validation, `git diff --check` and 16 GUI/session build-contract tests passed. Full Linux Tauri compilation remains CI-gated because this WSL image lacks `pkg-config` and the Wayland/WebKit development stack installed by the workflow.
- The corrected Linux Rust host and Linux/macOS packages passed in both push and PR runs. Windows compiled the desktop shell and passed 12 of 13 tests in about two minutes, then the final HTTP Return test blocked until the 60-minute job timeout. The stop path now wakes the loopback listener before joining so a Windows `accept()` cannot strand shutdown; test clients and service join both use five-second deadlines so a recurrence fails promptly.
- The next Windows run passed the Rust host tests and reached the packaged async regression, but the script polled only preferred port 18767 and hid all process output behind `ReadToEndAsync` while Multiwfn remained alive. The regression now captures inherited output line by line and tests the actual service URL advertised by Rust, preserving and exercising the required busy-port fallback rather than treating fallback as launch failure.
- A parallel launch-adapter audit found that the Windows code constructed a `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` but never assigned it to `STARTUPINFOEXW.lpAttributeList`. The assignment and a source guard are now present, so `CreateProcessW` actually applies the intended stdin/stdout/stderr-only inheritance contract.
- The first real-time diagnostic attempt used PowerShell `OutputDataReceived` callbacks, which execute without a PowerShell runspace on the Windows runner and failed before the host checks. Output capture now uses a small pure-.NET async line collector that continuously drains both inherited streams into concurrent queues; it needs no PowerShell callback runspace and keeps diagnostics and EOF lifecycle checks available during blocking HTTP operations.
- With real-time diagnostics active, Windows exposed the original launch defect directly: the child command failed at the first space in the temporary path. CMake defines `MULTIWFN_WINDOWS`, but the Fortran launch branch checked `_WIN32`, so GNU Fortran compiled the shell-based `execute_command_line` path instead of the native C adapter. All Fortran Windows conditionals now use the CMake-owned macro; `_WIN32` remains only in the C adapter where the C compiler defines it.
- Enabling the native branch exposed a link-time name-shadowing defect: `launch_matterviz_gui` declared `launch_matterviz_process` as a local integer even though it is a module procedure. Removing the local declaration restores the module procedure's explicit interface and prevents GNU Fortran from emitting an unresolved external `launch_matterviz_process_` reference.
- PR run `29294956626` then passed the frontend/Rust host and Linux, macOS and Windows packages. The Windows package is the first CI proof of the native space-containing launch path, advertised loopback service, authenticated orbital request through file IPC to the live Fortran loop, Return, and parent/desktop EOF cleanup. The request uses orbital index 0 and proves the control path, not a real uncached cube calculation.
- The parallel push run passed Windows but had one macOS-only flaky fragmented-request assertion. The test inserted a scheduler-sensitive sleep between TCP writes despite the deliberate two-second header deadline; it now uses `TCP_NODELAY` and two immediate writes, preserving split-write coverage without allowing runner scheduling delays to masquerade as parser failure.
- The final fragmented-request test uses a valid 2048-byte padding header with the terminating blank line in a later write. Since the server read buffer is 1024 bytes, this deterministically exercises multiple reads without depending on TCP packet boundaries or sleeps.
- Commit `ee8edece79d57e188f4f3068988e13cbf7703f88` passed both MatterViz push run [`29295909660`](https://github.com/Stardust0831/Multiwfn/actions/runs/29295909660) and PR run [`29295912514`](https://github.com/Stardust0831/Multiwfn/actions/runs/29295912514), including frontend tests/check/build, Rust fmt/test/check/clippy/release build, CMake/source guards, Linux/macOS/Windows packages and extracted runtime checks. Related build `29295912495`, Linux compatibility `29295912636`, GUI release `29295912576` and core guard `29295912520` also passed. No prerelease was published from those branch runs.

## Earlier work, superseded

- A generic five-kind spectrum protocol, broadening engine, frontend panel and PR #25-derived backend parser path were implemented and locally tested.
- Although those components passed focused tests and browser pixel checks, they expanded PR #26 beyond the authoritative baseline and were removed during the scope correction.
# 2026-07-14 binary volume phase 2

- Kept the calculation boundary fixed: no `savecubmat` or calculation-core
  changes; future publication hooks remain in `noGUI/GUI_matterviz.f90` after
  orbital sign correction and before the ESP density buffer is overwritten.
- Corrected the protocol draft's impossible 32-byte prelude (its listed fields
  totaled 36 bytes) and froze an explicit 48-byte prelude plus 304-byte v1
  volume header.
- Defined Fortran-native `i`-fastest and Cube `k`-fastest ordering separately,
  exact units, CRC32C coverage, checked limits, authenticated HTTP entry shape,
  and non-silent Cube fallback rules.
- Split final-state goals and the cross-platform codec/store/pipe/release test
  matrix into `matterviz-rust-host-goal.md` and
  `matterviz-volume-test-plan.md`. Codec implementation is the next gate;
  production traffic still uses Cube artifacts.
- Added strict Rust and TypeScript v1 codecs sharing one asymmetric 2x2x3
  orbital golden frame. Cross-checking exposed and corrected a fixture field
  overwrite, a Rust statistics-validation typo, a fixture include path error,
  and an incorrect Cube-order test expectation before integration.
- Added an 8-entry/64 MiB per-session Rust LRU storing immutable validated
  frames, plus the capability-protected `GET /api/volume/<id>` route with exact
  binary MIME, duplicate rejection, deterministic eviction and Return/shutdown
  cleanup. No producer feeds this store yet.
- Added frontend `mwfn-volume-v1` dispatch, strict binary MIME/CRC validation,
  parser-compatible Bohr-to-angstrom conversion, and bounded conversion into
  MatterViz's current nested grid. Cube and legacy entries retain their existing
  parser path.
- Corrected the adapter geometry after reviewing MatterViz sampling:
  `VolumetricData.lattice` now comes from `voxel_axes * dimensions`; the
  protocol's independent lattice is not substituted for the grid transform.
  Partially periodic volume adaptation is rejected because MatterViz currently
  exposes only one volume-wide periodic boolean.
- The phase review reproduced a Rust/TypeScript parity gap where TypeScript
  accepted an authenticated frame with extra CRC-covered body bytes. The
  decoder now requires `body_bytes == sample_bytes`, and the adapter rejects a
  finite voxel axis whose dimension scaling overflows to a nonfinite grid
  lattice before allocating the nested grid.
- Froze decoder acceptance to exact v1.0 (`minor=0`, 304-byte header and only
  the two CRC flags), added signed-sample and all quantity/unit-pair coverage,
  and added a direct MatterViz `parse_cube` comparison against the binary
  adapter for grid values, origin, grid lattice and data range.
- Froze the next transport boundary as two inherited anonymous pipes: Fortran
  sends volume frames and Rust returns a CRC-protected ACK only after store
  insertion. Defined the structured direct-launch C ABI, ready negotiation,
  ownership/close rules and mandatory Cube fallback on any publish failure.
- Verification: standalone Rust codec/store tests pass 10/10; frontend tests
  pass 76/76; `npm run check` reports 0 errors/0 warnings; `npm run build`
  succeeds. Full local Tauri `cargo test --locked` is blocked before crate
  compilation because this WSL environment lacks `pkg-config`/Wayland system
  dependencies; three-platform Cargo/package verification remains required.

## 2026-07-14 binary pipe integration

- Implemented the frozen two-pipe transport without changing Multiwfn
  calculation modules. The GUI/session adapter publishes the existing
  in-memory `cubmat` after orbital sign correction; ESP preserves density in
  memory only until the potential publication decision is known.
- Added a structured native C launcher on Windows, Linux and macOS. It starts
  the Rust host directly, restricts inherited handles/descriptors, negotiates a
  ready frame, performs bounded complete writes, validates correlated ACKs and
  relaunches file-only if negotiation fails. The legacy 3Dmol launcher remains
  separate.
- Added Rust pipe ownership, fragmented/concatenated frame handling,
  validation through the shared decoder, bounded per-session storage and ACK
  only after insertion. EOF, malformed input and shutdown clear native volumes
  without stopping HTTP or the preserved request-file fallback.
- Dynamic orbital responses now use `/api/volume/<id>` and
  `mwfn-volume-v1` only after a successful ACK. Publish rejection, timeout or
  broken transport closes native IPC and writes the original Cube response.
  Paired ESP responses are binary only when both density and potential are
  accepted; otherwise both Cube artifacts are produced.
- Local verification on the integrated tree: `Multiwfn_MatterVizGUI` compiled
  and linked successfully through CMake/Ninja; the C adapter passes strict C11
  compilation; GUI/session source guards pass 17/17; frontend tests pass
  79/79; `svelte-check` reports 0 errors/0 warnings; and the production frontend
  build succeeds. A temporary Rust 1.88 toolchain then rebuilt the lightweight
  host harness at a fixture-compatible path: all 29 tests pass, including the
  codec, bounded store, HTTP route, request-file backend and both pipe transport
  tests; lightweight `cargo check` and strict Clippy also pass. The two pipe
  tests now compile for Windows as well as Unix; a Rust 1.88
  `x86_64-pc-windows-gnu` test-target check passes after enabling the exact
  `Win32_Security` feature required by the in-process `CreatePipe` fixture.
  Full local
  Tauri compilation remains system-library-gated by the unavailable
  WebKit/Wayland development stack and therefore belongs to the package CI.
- Release status remains open. Required evidence is a fresh locked Rust suite,
  synthetic request-to-volume/Cube-fallback integration test, descriptor and
  handle lifecycle coverage, three-platform packages, and a real packaged
  nonzero uncached orbital. No prerelease is published from this state.
- Added an isolated test-only Rust crate that compiles the production C
  publisher and reuses the production Rust backend, transport, store and HTTP
  modules. It proves authenticated `/api/orbital` request-file creation,
  C-encoded publication, ACK-after-insert, exact binary retrieval, duplicate-ID
  rejection (`-1005`), transport closure, native-store clearing and Cube
  fallback. It passes 30/30 tests plus strict Clippy locally and is wired into
  the Linux, Windows and macOS package matrix. This is synthetic transport
  evidence, not a substitute for the real packaged nonzero-orbital gate.
- The independent lifecycle review found that a transport-enabled Rust startup
  failure can write `gui_stop.flag` before the C launcher relaunches file-only.
  Both POSIX and Windows fallback paths now remove that flag before relaunch,
  preventing the Fortran request loop and replacement WebView from exiting
  immediately. Strict C compilation, the focused C-to-Rust test and the full
  MatterViz executable relink pass after the fix.
- The final lifecycle review identified two release blockers and both are now
  addressed in the C adapter. Complete-frame write and ACK read share one
  absolute publish deadline: POSIX uses nonblocking `write` plus `poll`, while
  Windows uses a watchdog that cancels timed-out synchronous pipe I/O and joins
  before the frame is freed. A stalled maximum-size frame now returns the stable
  timeout error in under two seconds instead of freezing.
- POSIX launch now uses a CLOEXEC exec-status pipe. Successful `execv` closes
  the status writer automatically; a failed exec reports its `errno`, is
  reaped, and cannot be mistaken for a live file-only GUI. The isolated C/Rust
  crate verifies that a nonexistent host produces launch failure rather than
  entering an orphaned request loop.
- The final focused re-review found no remaining blocker, high or medium issue
  in these repaired paths. Windows checks the absolute deadline before every
  write and retries cancellation until an I/O appears or publication ends;
  POSIX recomputes remaining time after interruption, and ACK readers consume
  the same absolute deadline. Windows cancellation behavior and handle-count
  stability remain three-platform CI/runtime gates rather than Linux-local
  evidence.
- The first three-platform run compiled and passed the new transport test on
  Windows. Linux strict Clippy then exposed a test-only `insert_volume` helper
  as dead production code, and macOS rejected the Linux-specific
  `sigtimedwait` declaration. The helper is now `#[cfg(test)]`; SIGPIPE cleanup
  uses portable `sigwait` only after confirming the blocked signal is pending.
- The next Linux package run passed the host's strict Rust checks, then exposed
  a synthetic-test race: the test treated creation of `gui_request.txt` as a
  complete write and could read it before the payload arrived. It now waits for
  a complete matching request ID and payload, preserving the file protocol's
  asynchronous observation semantics.
- Added the real 11-atom, 223-orbital `(CO)5Cr.fch` wavefunction from the
  earlier Multiwfn 3Dmol GUI demo as a deterministic test-only gzip fixture.
  The Windows extracted-package regression now requests uncached orbital 43 at
  25k points, requires an authenticated `mwfn-volume-v1` response with valid
  magic, asserts that the successful path created no dynamic Cube, and retains
  the existing Return and descendant-handle shutdown checks. This fixture is
  not staged into release packages.
- Recorded two post-Goal architecture items without changing this PR: migrate
  the three control-file interfaces to versioned bidirectional pipe messages,
  and, only after stable three-platform acceptance, make Cube fallback an
  explicit development/diagnostic mode rather than an automatic release
  behavior. The current Goal continues to preserve both compatibility
  contracts through validation and prerelease.
- CI run `29310169491` passed the Rust/frontend job and all three package jobs.
  Its extracted Windows package loaded the real FCHK, computed orbital 43,
  served a valid native volume without staging `orbital_43_25000.cube`, and
  completed the Return/process-shutdown assertions. The same run also passed
  the generic C-to-Rust transport tests on Windows, Linux and macOS.
- Added the corresponding extracted-package Linux real-orbital regression. It
  launches the packaged Rust WebView under Xvfb, reads and validates the
  actually advertised loopback service URL, requests orbital 43 at 25k points,
  validates the binary volume/no-Cube contract, and checks Return plus process
  cleanup. This Linux evidence remains pending until the updated workflow
  completes.
- PR CI run `29312744850` then passed the extracted Linux package regression at
  commit `faf192e`: the real orbital completed through native binary transport,
  no Cube was staged, Return succeeded, the observed WebView process tree
  exited, and inherited stdout/stderr readers reached EOF.
- The complete `29312744850` run passed the Rust/frontend suite and the locked
  Linux, Windows and macOS package jobs; it published no release asset.
- Extended that Linux regression with a deliberate packaged Cube-fallback
  mode. A test-only host wrapper exits only when it sees inherited volume-pipe
  arguments; the unchanged C adapter must detect negotiation failure, clear
  the stale stop flag, relaunch the real Rust host file-only, compute the same
  orbital and serve the staged Cube. This adds no production switch and keeps
  automatic fallback behavior unchanged for the current Goal.
- The Linux job in PR run `29314730868` passed both extracted-package modes:
  `native volume` and `Cube fallback`. The latter also proved that a failed
  transport child can leave `gui_stop.flag`, the C adapter removes it before
  file-only relaunch, and the live fallback session serves the generated Cube.
- The first macOS attempt in that run hit one intermittent test-client
  `ECONNRESET` after receiving an HTTP response; the failed job passed unchanged
  on rerun, confirming no fallback regression. The test-only raw HTTP reader is
  now portable across this macOS close behavior while still requiring complete
  headers and the exact `Content-Length` body. Production service code is
  unchanged.
- Final candidate commit `8db821c` passed PR run `29316873086`: Rust/frontend,
  Linux, Windows and macOS all succeeded, including the portable HTTP reader,
  real Windows orbital, Linux native/fallback modes and per-package Python
  artifact rejection. Local evidence also passed frontend test/check/build,
  20 GUI/session source guards, workflow YAML parsing, strict C11 compilation
  and `git diff --check`; local Cargo remained unavailable and was covered by
  locked CI.
- Published `matterviz-preview-7` from exact commit `8db821c` in tag run
  `29317949338`. The independently downloaded Linux, macOS and Windows assets
  all match `SHA256SUMS.txt`; each contains the native MatterViz executable,
  Rust host and frontend, with no Python or legacy 3Dmol runtime entry. Release:
  <https://github.com/Stardust0831/Multiwfn/releases/tag/matterviz-preview-7>.
- Paused implementation after publication for manual preview confirmation. The
  deferred control-pipe migration and release-mode Cube policy remain explicitly
  post-Goal work and were not implemented in this PR phase.

## 2026-07-14 Preview 7 manual feedback

- Windows manual testing found two release regressions. Pressing Enter at the
  initial file prompt printed the system path-not-found message instead of
  opening the Rust file picker. After entering a path manually, menu 0 loaded
  the molecule and accepted orbital selection but displayed no isosurface.
- Inspected the retained live session rather than inferring from the screenshot.
  Its manifest contained 40 orbitals and no startup Cube; response files proved
  MO12 and MO13 completed as `mwfn-volume-v1` volumes 1 and 2. The live Rust host
  served volume 2 as a valid 1,019,504-byte frame with dimensions 50x49x52,
  range -0.7028304 to 0.6916017 and origin (-4.07045, -3.69201, -4.66053)
  Angstrom after conversion. Direct marching cubes at +/-0.05 produced 1,912
  and 1,980 faces, so calculation, pipe, store, decoder and meshing were sound.
- Identified the rendering mismatch at the structure/volume boundary. MatterViz's
  Cube parser subtracts the volume origin from embedded atom coordinates, while
  the independent native `structure.json` path retained absolute atom positions.
  Added an immutable frontend translation between volume frames, with lattice
  fractional-coordinate recomputation and no cumulative drift across volume
  replacement/removal.
- Replayed the captured real MO13 frame through the rebuilt frontend. At
  1440x900 and 800x700 the red/blue signed surfaces overlap CH3Cl, the WebGL
  canvas is nonblank, document overflow is absent and no page/console error is
  emitted.
- Removed the last native file-picker shell boundary. Fortran now calls a
  synchronous structured C ABI; Windows uses UTF-16 `CreateProcessW` and waits
  for the Rust dialog process, while POSIX uses direct `fork`/`execv` with an
  exec-status pipe and `waitpid`. The Rust CLI and `selected_file.txt` protocol
  remain unchanged, and legacy 3Dmol behavior is untouched.
- The independent review found two managed-state gaps in the initial origin
  fix. Existing explicit camera position/target now receive the same frame
  translation as the structure. Structure and site identity remain stable so a
  volume-frame-only transition preserves measurement and edit state. The pinned
  MatterViz r8 component exposes a narrow structure revision input consumed only
  by supercell derivation, ensuring deferred periodic supercells also rebuild
  without invoking new-molecule cleanup effects. The same revision and its
  frame delta translate each viewport's live camera and private reset-camera
  baseline, so primary and secondary panes remain aligned and a later reset
  stays in the active volume frame. Viewports compare the stable
  logical input structure for snapshot invalidation, so derived supercell and
  periodic image-atom rebuilds do not masquerade as a newly loaded system.
  MatterViz's generic two-way file drop is disabled in this managed Multiwfn
  viewer because it bypasses session volume metadata and origin tracking;
  manifest/API imports remain authoritative.
- Local verification of the final r8 adapter passed all 85 frontend tests, zero
  Svelte diagnostics, the production Vite build, 22 GUI/session and native
  launcher tests, strict C11 compilation and `git diff --check`. A dynamic
  browser replay started with structure only, requested the captured real MO13
  frame, moved and reset the camera at 1440x900 and 800x700, and retained aligned
  molecule/surface rendering with nonblank canvases, no page errors and no
  document overflow.
- PR run `29324664144` passed the Rust/frontend job and Linux, macOS and Windows
  package jobs for pushed commit `c88adcd`. It covers the native file-picker and
  initial alignment increment but predates MatterViz r8; a fresh locked package
  run remains mandatory before Preview 8.
- Final independent read-only review of the r8 state path found no blocker,
  high or medium issue. It confirmed single-application camera deltas in primary
  and secondary panes, stable logical identity across periodic derived rebuilds,
  cumulative revisions and the narrow r8 vendor scope. Three-platform package
  CI and packaged Windows manual behavior remain release gates.
- Exact commit `00b79a7` passed PR run `29328529075`: frontend/Rust host and
  Linux, macOS and Windows package jobs all succeeded. The general build,
  Linux compatibility, legacy GUI release matrix and core-source protection
  workflows for the same SHA also passed.
- Published GitHub prerelease [`matterviz-preview-8`](https://github.com/Stardust0831/Multiwfn/releases/tag/matterviz-preview-8)
  from that exact commit in tag run `29329561943`; all build/package/publish jobs
  passed. Independently downloaded Linux, macOS and Windows assets match every
  entry in `SHA256SUMS.txt`, contain the native Multiwfn executable, Rust host
  and MatterViz frontend, and contain no Python, `.py` or 3Dmol runtime entry.
- Implementation is paused for Windows manual confirmation of Enter file
  selection, orbital alignment/switching, grid quality/isovalue, camera reset
  and Return. Deferred control-pipe and formal-release Cube-policy work remains
  post-Goal and was not pulled into Preview 8.

## 2026-07-15 Preview 8 manual feedback

- Windows manual testing found that MO12 eventually appeared, but the orbital
  and molecule moved together toward the canvas edge; atom spheres were mostly
  clipped and bonds remained visible. The retained session published valid
  1,015,504-byte 120k and 4,131,056-byte 500k binary responses with no browser
  error, ruling out calculation, request-loop and binary-store failures.
- Reproduced the same result by opening a fresh page against the still-running
  port 2473 service and requesting MO12. The failure is whole-scene framing,
  not structure/isosurface misregistration.
- r8 moved the structure and declarative camera position by the volume-origin
  delta. On the automatic-framing path, however, `camera_target` is undefined;
  the effective target remains inside `rotation_target_ref` and OrbitControls.
  The camera position therefore moved while its actual look target stayed in
  the old frame, pushing the aligned molecule and orbital toward the viewport
  edge. Instrumentation then proved App and `Structure` received revision 1 but
  the revision embedded in `shared_viewport_props` did not update either nested
  viewport. The r10 correction passes revision/delta explicitly to primary and
  secondary viewport tags, then synchronizes all camera target stores and live
  Three.js controls from one absolute translated target.
- Further instrumentation showed viewport reconstruction initializes directly
  at the latest revision, making any delta hook intrinsically timing-sensitive.
  Source review then exposed the actual ownership error: MatterViz subtracts the
  first volume origin because its Cube parser also shifts embedded Cube atoms,
  while Multiwfn supplies an independent absolute-coordinate `structure.json`.
- Discarded the r8-r10 translation machinery and rebuilt the pinned vendor from
  r4 as r12 with one `VolumetricData.origin_mode` extension. Native binary
  volumes use `absolute`, so marching-cubes geometry retains the Multiwfn grid
  origin and the structure/camera never move. Cube fallback is also marked
  absolute when a manifest declares independent structure JSON; standalone Cube
  files keep MatterViz's default relative-first convention.
- Replayed the retained real MO12 frame through r12 at 1440x900 and 800x700.
  Desktop rendering shows all atom spheres, bonds and signed lobes together in
  the original molecular frame with no page error or document overflow. The
  saved 500k replacement frame and camera drag/reset preserve the same alignment.
  The 800px layout remains compact with the existing inspector overlay behavior.
- Final read-only review found that cross-volume coloring still converted scene
  vertices as if every first volume were origin-relative. The r12 package now
  uses one reference-origin helper for geometry, cache identity and sampling, so
  nonzero-origin absolute density/ESP fields are sampled at the rendered
  Cartesian position while standalone Cube data retains relative-first behavior.
- Reinstalled the exact r12 tarball with the frozen lockfile, then passed all 81
  frontend tests, the 22 GUI/session and packaging source tests, strict C11
  compilation, Svelte diagnostics and the production build. A second retained
  MO12 replay at 1440x900 and 800x700 switched from the real 120k frame to the
  real 500k frame, dragged and reset the camera, and reported nonblank canvases,
  no page errors and no document overflow.
- Corrected-r12 read-only review reported no critical, important or minor
  finding. It verified all three renderer call sites use the shared reference
  origin, installed files match the archive, the archive SHA-512 matches the
  lockfile, and the diff does not touch calculation-core or binary-protocol code.
- Exact code commit `355862f` passed PR run [`29359257113`](https://github.com/Stardust0831/Multiwfn/actions/runs/29359257113): frontend/Rust host and Linux, macOS and Windows package jobs all
  succeeded. Related build `29359256268`, Linux compatibility `29359256620`,
  legacy GUI release `29359256520` and core-source guard `29359256585` also
  passed; the duplicate push run was cancelled after the PR run started.
- Tag run [`29360374182`](https://github.com/Stardust0831/Multiwfn/actions/runs/29360374182) rebuilt all three platforms and published GitHub prerelease
  [`matterviz-preview-9`](https://github.com/Stardust0831/Multiwfn/releases/tag/matterviz-preview-9) from exact code commit `355862f`. Independently downloaded
  Linux, macOS and Windows assets all match `SHA256SUMS.txt`; each contains the
  native Multiwfn executable, Rust host and frontend and contains no Python,
  `.py` or 3Dmol runtime entry. Implementation is paused for Windows manual
  confirmation.

## 2026-07-15 Preview 9 cache diagnosis and low-copy v2 implementation

- Proved the retained Preview 9 `cubmat.cube` was stale rather than newly
  calculated density. After removing the differing Cube headers, its data body
  was byte-identical to a previous session orbital Cube. The menu 0 launcher
  exported any allocated global `cubmat` and labeled it density. Menu 0 now
  skips that startup export; other GUI entry points are left unchanged until
  their real `cubmat` ownership is migrated.
- Established a measured storage baseline for 10,000,000 f64 samples: a flat
  `Float64Array` used 76.3 MiB, while conversion to `number[][][]` raised RSS
  from 145.8 MiB to 318.8 MiB. This justified a generic MatterViz
  `ScalarGrid3D`, not a Multiwfn-only data type.
- Implemented a major-2 C publisher that keeps the v1 304-byte metadata layout
  but removes the fixed 1,500,000-sample and 12 MB body limits. It scans the
  caller-owned Fortran buffer once for finite statistics and CRC, then writes
  bounded ranges directly from the contiguous samples without a full C frame
  or body allocation. The strict C harness passes exact wire/CRC/statistics,
  37-byte fragmented reads, 1,500,001 samples, invalid/overflow inputs, timeout,
  broken pipe and no-proportional-allocation checks.
- Added Rust major-2 decoding, incremental CRC, a bounded request-ID broker,
  actual-memory admission for Linux/cgroups, Windows and macOS, and direct HTTP
  forwarding. The broker is registered before `gui_request.txt` is written,
  avoiding the request/producer race. HELLO remains major 1; each major-2 volume
  receives a major-2 ACK.
- Changed transported orbital requests to a single binary `/api/orbital`
  response. This is required by backpressure: Fortran cannot write its JSON
  response until Rust ACKs the volume, and Rust must drain the bounded broker
  while the body is produced. Bond and ESP JSON endpoints remain unchanged.
- The browser now allocates one final response buffer from `Content-Length`,
  fills it from stream chunks and exposes samples as a `Float64Array` view over
  that buffer. A major-2 test above the old point limit confirms the samples
  share the original `ArrayBuffer`; fragmented and truncated HTTP bodies are
  covered.
- Integrated the vendor-first flat-grid contract
  `{ data, dimensions, order: 'x-fastest' | 'z-fastest' }` while preserving
  nested grids and the existing `data_order` metadata. Focused tests cover
  marching cubes, sampling, range, downsample, periodic pad/tile, slices and a
  10M-point single typed buffer. Binary/Cube equivalence is now asserted by
  logical coordinates so differing physical storage orders remain valid.
- Kept ESP on v1 pending a reviewed ordered-bundle response for density plus
  potential. The formal v2 orbital path reports transport/memory failure and
  does not silently emit Cube. Control files and session bootstrap artifacts
  remain explicitly deferred; this increment does not claim a zero-file
  runtime.
- Completed Worker geometry and conservative preflight in MatterViz revision
  r17. Cross-origin-isolated pages use `SharedArrayBuffer`; ordinary buffers are
  transferred to a per-grid serialized Worker queue and returned on normal
  success/error. Stale generations are discarded, and a Worker failure after
  transfer marks that grid invalid instead of hiding detached-buffer loss.
- Independent read-only review found that r15 rebuilt a returned transferable
  grid at byte offset zero, corrupting the second signed orbital surface because
  native samples begin after the 304-byte protocol header. r17 restores the
  original offset and element length, keeps recoverable shared grids valid on
  Worker errors, removes an undefined estimate fallback and charges all resident
  surfaces against one cumulative geometry budget. A regression test now sends
  a `Float64Array` view beginning at byte 304 through repeated Worker ownership.
- The review also found root-only Linux cgroup probing and a likely Clippy
  `new_without_default` failure. Admission now resolves the process leaf from
  `/proc/self/cgroup` plus mountinfo for cgroup v2/v1 and handles namespace root
  mappings, walks leaf-to-root ancestors for the tightest hierarchical
  constraint, and handles unlimited sentinels and malformed fallback. `Crc32c`
  now implements `Default`.
- The final r17 archive also reports shared-buffer Worker failures without
  claiming data loss and exposes the remaining-budget arithmetic to executable
  tests rather than relying only on source-pattern assertions.
- The final r17 archive SHA-256 is
  `736cf19985c69187f6c20ddadb9962d84b580704a0fb2f57a981a363b998c4b0`.
  The production build emits
  `dist/assets/marching-cubes-worker-DNZvsbt9.js`; inspection confirms the
  Worker contains its dependency graph and has no unresolved relative import.
- Local verification passes all 95 frontend tests, `svelte-check` with zero
  errors/warnings, the production build, the strict C stream harness, 53
  GUI/session source-contract tests and Python syntax checks. Existing Vite
  chunk-size, lightningcss `::highlight` and occupied test WebSocket-port
  warnings remain nonblocking. Rust compilation, live browser replay and
  Linux/macOS/Windows CI remain open release gates because Cargo and a browser
  runner are unavailable in the current WSL environment.
- Initial CI run `29373727626` reached Rust on Linux and macOS. It exposed only
  an unformatted Rust diff and a test-only borrow error where a registration
  borrowed `broker` before the same `Arc` was moved into the transport. The
  test now passes `broker.clone()`, and an extracted Ubuntu rustfmt toolchain
  formats and checks both Rust source trees locally. Runtime ownership is
  unchanged; the corrected commit must still pass Cargo test/check/Clippy and
  all package jobs before a prerelease is created.
- Follow-up run `29374177183` compiled the Rust host on macOS and completed
  Linux Cargo check. It then exposed a Clippy `large_enum_variant` warning and
  a nondeterministic service test whose live host-memory admission could reject
  its tiny synthetic frame under runner load. `StreamEvent::Begin` now boxes
  its metadata, and test builds inject a fixed active-volume limit through a
  test-only atomic hook. Production memory discovery and admission are not
  bypassed or weakened.
- Run `29374587125` then passed the Rust host and e2e suites (50 tests), Cargo
  check and Clippy. Its remaining main-job failure occurred after the C stream
  harness itself passed: the shell's allocation audit invoked `rg`, which is
  not installed on that runner. The audit now uses `grep -E`; its checked range
  and no-allocation assertion are unchanged.
- Final-scope run `29375165944` passed the Rust/frontend host plus Linux and
  macOS package jobs. Windows compiled Multiwfn and passed C-to-Rust transport,
  then failed only because PowerShell interpreted literal `0xffffffff` as
  signed `-1` before assigning it to `UInt32` in the test CRC helper. The helper
  now uses `[uint32]::MaxValue` and an explicit UInt32 XOR for the final CRC.
- Run `29376141053` confirmed all non-Windows jobs again, but PowerShell also
  treated the high-bit CRC polynomial literal as a negative `Int32`. The helper
  now performs the complete CRC state update in `UInt64` with positive decimal
  constants and narrows only the final 32-bit result, eliminating signed
  hexadecimal conversions.
- Exact commit `1f0b060` passed the authoritative MatterViz GUI run
  [`29376971579`](https://github.com/Stardust0831/Multiwfn/actions/runs/29376971579),
  build `29376971508`, Linux compatibility `29376971534`, core-source protection
  `29376971542` and legacy GUI release `29376971532`. This closes the Rust
  test/check/Clippy and three-platform package gates for the major-2 increment.
- Tag workflow [`29377790013`](https://github.com/Stardust0831/Multiwfn/actions/runs/29377790013)
  passed and published GitHub prerelease
  [`matterviz-preview-10`](https://github.com/Stardust0831/Multiwfn/releases/tag/matterviz-preview-10)
  from exact code commit `1f0b060`. Independently downloaded assets match the
  published checksums: Linux `4d9c0519e4771f12ed69e597cef893be469281e44df76481fe8924ebe39e2977`
  (17,866,053 bytes), macOS
  `c49fdf2f13335f462974e23d57af23823e0bf98cbf7834fc7e1bf030d76b11fd`
  (12,637,067 bytes), and Windows
  `0b4b1c6ea018523de077e6174b472381a2dbab9c71ac80dd61c3de72c8772073`
  (22,013,534 bytes). Each archive contains the native Multiwfn executable,
  Rust host and built MatterViz frontend and contains no Python, `.py` or 3Dmol
  runtime entry. Development pauses for manual Preview 10 confirmation.

## 2026-07-15 Preview 10 SharedArrayBuffer decoder blocker

- Windows manual validation reached the native major-2 orbital response but
  failed before header validation with `Failed to execute 'decode' on
  'TextDecoder': The provided ArrayBufferView value must not be shared.` The
  Rust service deliberately serves COOP/COEP headers, so WebView2 enables
  cross-origin isolation and the frontend allocates one `SharedArrayBuffer` for
  the streamed response. `decode_matterviz_volume` then passed the first eight
  shared bytes to `TextDecoder`; Chromium rejects shared views for that API.
- Replaced `TextDecoder` with an exact byte comparison for the fixed
  `MWFNVOL\0` magic. The volume body remains on the original shared allocation,
  and its `Float64Array` still starts at the protocol's 304-byte offset; there
  is no response-sized copy, ordinary-buffer fallback or protocol change.
- Added a regression that substitutes Chromium-strict `TextDecoder` behavior,
  decodes a major-2 frame from `SharedArrayBuffer`, proves buffer identity and
  offset preservation, and still rejects damaged magic. The test fails at the
  reported call site before the fix and passes afterward. All 96 frontend tests,
  Svelte diagnostics with zero errors/warnings and the production build pass;
  three-platform package CI and a corrected prerelease remain required.
- Exact fix commit `cf1d227` passed MatterViz GUI run
  [`29381046108`](https://github.com/Stardust0831/Multiwfn/actions/runs/29381046108),
  build `29381046160`, Linux compatibility `29381046106`, core-source protection
  `29381046112` and legacy GUI release `29381046110`. Independent read-only
  review found no critical, important or minor issue and confirmed the decoder
  retains shared and ordinary buffer identity and the 304-byte sample offset.
- Tag workflow [`29382168513`](https://github.com/Stardust0831/Multiwfn/actions/runs/29382168513)
  passed and published GitHub prerelease
  [`matterviz-preview-11`](https://github.com/Stardust0831/Multiwfn/releases/tag/matterviz-preview-11)
  from exact commit `cf1d227`. Independently downloaded assets match
  `SHA256SUMS.txt`: Linux
  `d9428effee95931601faa03471d898156e1135f5f4ba2fb4951b28e51935572c`
  (17,866,615 bytes), macOS
  `2f3071e283823fe68fe8e9ae89efd7adce59246f85f76769e8bcf639d5578b90`
  (12,637,044 bytes), and Windows
  `a2e38d51ab233b9c56aeb47eb6b76971a29fc623c4e3ba54db5f7ea60115bc19`
  (22,013,668 bytes). All archives contain Multiwfn, the Rust host and built
  frontend with no Python or 3Dmol runtime path. The Windows bundle contains the
  compiled magic byte array `[77,87,70,78,86,79,76,0]`; its volume decoder uses
  byte comparison and does not contain the reported shared-view error path.
  Development pauses for Windows Preview 11 confirmation.

## 2026-07-15 Preview 11 active-memory admission blocker

- Windows manual validation then rejected a 1,006,880-byte orbital with an
  active limit of zero despite 10,116,157,440 bytes being available. The old
  policy reserved `max(2 GiB, 20% of total physical memory)`; on the reported
  approximately 61.56 GiB host that reserve was 13,218,844,672 bytes, larger
  than current availability, so saturating subtraction produced zero.
- The adaptive percentage now uses current available memory while retaining a
  2 GiB minimum reserve. For the reported snapshot this leaves about 7.42 GiB
  for active volumes and exact preflighted geometry instead of rejecting a
  0.96 MiB frame. Existing active volumes remain added back to avoid charging
  them twice, and `MULTIWFN_MATTERVIZ_MAX_ACTIVE_VOLUME_BYTES` remains a hard
  ceiling rather than an allocation promise.
- A regression with the exact reported total, available and requested byte
  counts fails against the old 12.31 GiB reserve and passes with the 2 GiB
  adaptive reserve. Direct Rust compilation passes all 14 memory-budget tests,
  including the 20%-of-available branch, sub-2-GiB rejection and Linux cgroup
  hierarchy constraints.
- Session JSON remains intentional and separate from the binary data plane:
  `manifest.json` declares capabilities/artifacts and `structure.json` carries
  native periodic or molecular topology. `response_<id>.json` plus
  `gui_request.txt`/`gui_stop.flag` still form the compatibility control plane;
  their versioned bidirectional-pipe migration remains explicitly deferred and
  is not mixed into this release-blocker fix. Successful major-2 orbital sample
  arrays do not travel through JSON or Cube files.
- Exact fix commit `a949da6` passed MatterViz GUI run
  [`29418052737`](https://github.com/Stardust0831/Multiwfn/actions/runs/29418052737),
  build `29418052564`, Linux compatibility `29418052623`, core-source protection
  `29418052553` and legacy GUI release `29418052672`. The independent review's
  only minor finding, missing direct coverage of the percentage branch, was
  resolved with a 20-GiB-available case expecting a 4-GiB reserve.
- Tag workflow [`29419208006`](https://github.com/Stardust0831/Multiwfn/actions/runs/29419208006)
  passed and published GitHub prerelease
  [`matterviz-preview-12`](https://github.com/Stardust0831/Multiwfn/releases/tag/matterviz-preview-12)
  from exact commit `a949da6`. Independently downloaded assets match the
  published checksums: Linux
  `f132ea90c40acab41065b5ef7f4fd230343c54d18f2a419610c449bf409d0cc9`
  (17,865,922 bytes), macOS
  `08809ddbec302dd3dc52c4110864731588236df174a0817c8637c690bcb66f09`
  (12,637,244 bytes), and Windows
  `bf4914f08bc9476502842d376790b207fa9f5cf9ea53e6c2b09ccb7a39ba5f0c`
  (22,014,120 bytes). All archives contain the Multiwfn executable, Rust host,
  built frontend and Worker with no Python or 3Dmol runtime path. Development
  pauses for Windows Preview 12 confirmation.

## 2026-07-15 Preview 12 Worker structured-clone blocker

- Windows validation progressed through binary transport, shared-buffer decode
  and memory admission, then failed when starting marching cubes with `Failed
  to execute 'postMessage' on 'Worker': [object Array] could not be cloned.`
  The volume TypedArray and `SharedArrayBuffer` were valid; assigning the
  `VolumetricData` object into Svelte `$state` proxied its ordinary nested
  `dimensions` and `lattice` arrays, and browser structured clone rejects Proxy
  objects.
- A focused test passes proxied grid dimensions and nested lattice rows with a
  real `SharedArrayBuffer` through the Worker coordinator. It reproduces the
  exact `DataCloneError` against r17. MatterViz r18 rebuilds only the
  Worker-bound 3-vector, 3x3 lattice and scalar options as plain data. The grid
  TypedArray and backing SAB/transfer ownership remain unchanged, so no
  volume-sized copy is introduced.
- The r18 archive differs from r17 only in `dist/isosurface/geometry.js` and the
  package version. Its SHA-256 is
  `787172c86cae9e959a10041be8f58e1d0adac33eb5a69dc7d9f85354d7c1d84e`;
  the frozen pnpm integrity is
  `sha512-OACzfVXZ9UFTivwT3eo5uyygK1Z1ME/9DdaV6fKAWKF6ZKwkAEWF4RxBlTd7KzkG6l+KX/lEyePEtgTMW4SL4Q==`.
  All 97 frontend tests, Svelte diagnostics with zero errors/warnings and the
  production build pass. Cross-platform package CI and manual WebView2 replay
  remain release gates.

## 2026-07-15 frontend volume-cache lifecycle

- Traced retained orbital memory to the viewer's parallel `volumetricData`,
  `volumeEntries` and layer arrays: each new orbital appended another
  `VolumetricData`, and later selection deliberately reused it. The SAB decoder
  and binary stream were not the leak; application state kept every historical
  orbital strongly reachable and reported all of them as `activeVolumeBytes`.
- Added one pure cache compactor that computes retained indices, follows
  surface-to-color-volume references transitively and rebuilds all volume,
  entry, layer, active and color indices atomically. Orbital visibility is now
  exclusive only among orbital layers, so unrelated visible scientific layers
  remain usable. Hidden old orbitals are evicted before an uncached backend
  request; request failure does not resurrect released buffers.
- JavaScript cannot explicitly free an ArrayBuffer or SharedArrayBuffer. The
  implemented contract therefore removes every application strong reference,
  verifies shared backing stores are deduplicated, terminates Worker ownership
  and disposes derived Three.js geometry/GPU buffers. Actual backing-store
  reclamation remains correctly delegated to the browser garbage collector.
- Read-only lifecycle inspection found that MatterViz r18 did not cancel an
  in-flight marching-cubes Worker on volume removal/unmount and could let an
  async extraction commit geometry after teardown. MatterViz r19 adds a
  destructive per-grid release operation, a separate release epoch so ordinary
  newer-request staleness remains unchanged, explicit rejection cleanup and
  immediate geometry reconciliation before the rebuild debounce.
- Focused cache/Worker tests pass 11/11 for switching/reindexing, SAB aliases, Worker
  release and immediate geometry disposal. `svelte-check` and the production
  build also exit successfully. The r19 archive SHA-256 is
  `4122eba0c8a1d1c11a253a4f2fac2faec7101a304c9ccd88afc2d17a3356615e`
  with frozen integrity
  `sha512-byjPRlRT6tsDL8RPfQh+Ety+yYfax/BZubqfn4zkOvtcnGNvw+5LSGVE5oi2vz2pKu1AiIDRAIEP5TgSg8jEcQ==`.
  After review fixes the complete frontend suite passes 106/106,
  `svelte-check` reports no diagnostics and the production build exits
  successfully. A production-asset Playwright replay
  with the Rust host's COOP/COEP headers passed at 1440x900 and 800x700: each
  viewport requested MO1, MO2 and MO1 again, retained exactly one volume,
  rendered 12,880 non-white Canvas pixels, had no horizontal overflow and
  emitted no page error. Independent review and three-platform CI remain open
  gates; neither the major-2 binary protocol nor Multiwfn calculation code
  changed.
- Independent review found one important recovery bug rather than a resource
  leak: after failed force recomputation, the selector restored from the first
  visible layer, which can now be a preserved density layer before the still
  visible orbital. Restoration now filters by orbital role and positive orbital
  index; a regression covers a visible density layer preceding MO12. Review
  also prompted narrowing the TODO's test claims to distinguish pure lifecycle
  tests from the separate browser request replay.
- Exact commit `def456c` passed push MatterViz run `29431208734`, PR MatterViz
  run `29431213279`, build `29431213124`, Linux compatibility `29431213336`,
  core protection `29431213042` and legacy GUI run `29431212765`. The first
  PR/macOS attempt had two transient HTTP test failures from truncated/reset
  local socket responses while the same commit's push/macOS run passed all 44
  Rust tests; the isolated rerun passed without source changes.
- Tag workflow `29433975758` passed frontend/Rust plus Linux, macOS and Windows
  packaging and published
  [`matterviz-preview-14`](https://github.com/Stardust0831/Multiwfn/releases/tag/matterviz-preview-14)
  from exact commit `def456cfea53bb26bfc8237d70a8769ec72e83a1`.
  Independently downloaded assets match `SHA256SUMS.txt`: Linux
  `b6123ac576c8e0310f265b5f5078d71c6149a305b95742689a4edd19c17c9524`
  (17,871,442 bytes), macOS
  `320cf8d21190dc2d11c30097d60d66446dc200cb76bf27cf19f763a683c9e9b6`
  (12,641,628 bytes), and Windows
  `705385b82776c0775ab603cd042ea2fb0ccb50f2d2386668c3209056a124c6e3`
  (22,018,270 bytes). All packages contain the native Multiwfn executable,
  Rust host, built frontend and Worker; path scans find no Python, 3Dmol or
  staged Cube artifact. The Windows source map and bundle contain r19 release
  epochs, Worker cancellation, immediate volume-identity geometry disposal and
  the cache compactor. Development pauses for Windows manual confirmation.

## 2026-07-16 pole-free trackball camera

- Traced the reported polar behavior to Three.js `OrbitControls`: its spherical
  polar coordinates inherently retain north/south poles. The fixed-step toolbar
  also mixed camera-local right/back with a retained up vector, so its direction
  semantics were not consistently screen-relative. VMD documentation confirms
  virtual-trackball rotation as the established pole-free interaction model;
  Three.js already ships `ArcballControls`, so no VMD source or new plotting/
  graphics dependency was copied into MatterViz.
- Added an opt-in generic MatterViz `camera_control_mode: 'orbit' | 'arcball'`.
  Orbit remains the upstream-compatible default, while the Multiwfn workbench
  explicitly selects Arcball. Arcball disables inertial animation, double-click
  focus, FOV gestures and its internal gizmo; left drag rotates, right/Ctrl-left
  pans, middle/wheel zooms and edge circular drag produces screen-normal roll.
  Its camera subtree is not keyed by live `camera_up`, avoiding control teardown
  during roll. Reset, camera export/restore, orthographic zoom, auto-rotate,
  movement callbacks and the existing MatterViz axis gizmo share the existing
  camera state path. Auto-rotate pauses while the user is dragging.
- Replaced X/Y/Z step pairs with explicit up/down/left/right and clockwise/
  counterclockwise icon buttons while retaining the numeric degree step. Pure
  camera tests cover semantic inverse pairs, four repeated 90-degree steps,
  orthonormal bases, distance/target preservation, projection direction, roll,
  perspective/orthographic behavior and malformed inputs.
- MatterViz focused source tests pass 16/16. Repository-wide source
  `svelte-check` reports only its pre-existing color-store/anywidget diagnostics
  (30 errors and one warning) and no diagnostic in any changed camera file.
  The consuming Multiwfn viewer passes all 113 tests, reports zero Svelte
  diagnostics and builds 1,377 modules successfully.
- Vendored `matterviz-0.4.2-multiwfn.d8719d12.r20.tgz` with SHA-256
  `b9ae757aa5f107d70a64a82df019e34bfe536db9ac35a30b532d7c7294040c9f`
  and frozen SHA-512 integrity
  `ilzk/lMJDpFYKljVapEcUG5dpELMb5V3VXJFjVizsQn8JSyFh8TG62e93zQxgY5+wxkOO3weIXzRHgJCh8gq9w==`.
  The r19 Worker-release files `geometry.js`, `geometry.d.ts` and
  `Isosurface.svelte` retain their exact prior hashes; a consumer regression
  also checks release epochs and `release_isosurface_geometry` remain present.
- A clean temporary installation with pnpm 11.5.0 and
  `--frozen-lockfile --ignore-scripts` resolves exactly
  `matterviz@0.4.2-multiwfn.d8719d12.r20`. The installed package exposes the
  Arcball camera declarations and implementation while retaining the r19
  `release_epochs` lifecycle. The final consuming-tree rerun passes 111/111
  tests at that checkpoint; the post-review package passes 113/113 tests,
  `svelte-check` with zero diagnostics and the production build with 1,377
  transformed modules.
- Production-asset Playwright checks pass at 1440x900 and 800x700. Both sizes
  render nonblank Canvas output (20,717 and 35,987 non-white pixels), horizontal
  drag changes 33,833 and 11,576 pixels, horizontal/vertical motion turns the
  visible structure in the drag direction, a quarter-circle edge drag changes
  roll without changing target distance, and the pose is unchanged 350 ms after
  release. Both have all six step buttons, no page/console error, no horizontal
  overflow and no incoherent overlap in inspected screenshots. Right-drag pan
  updates the persisted target by 5.52 and 7.42 world units, and wheel zoom
  updates orthographic zoom at both viewport sizes.
- Per the updated priority decision, versioned bidirectional control pipes and
  complete runtime zero-disk delivery become the highest-priority task only
  after this camera release closes. That follow-up must remove formal session
  directories/artifacts and keep Cube fallback explicit and diagnostic-only;
  it does not change the current camera protocol or implementation.
- Independent review blocked the first r20 candidate because its whole-file
  camera overlay had accidentally removed the r19 `on_geometry_error` relay,
  `CameraControlMode` had no emitted public declaration, and native Arcball
  `reset()` became inconsistent after a panned target was fed through
  `update()`. The rebuilt package restores all six structure/viewport callback
  locations, emits a compile-checked public type, skips redundant target
  updates and includes a red/green panned-reset regression. The three r19
  lifecycle files remain byte-identical.
- Aggressive repeated-drag browser testing then exposed Svelte's update-depth
  guard: every Arcball pointer move was round-tripping a live Three pose through
  declarative camera props. Arcball now owns live motion during an interaction
  and publishes its final pose on end; genuine external commands are applied
  only after numerical comparison, and exported state is frame-bounded. The
  final production assets complete seven consecutive same-direction vertical
  drags at both 1440x900 and 800x700 with a distinct Canvas image after every
  step. Pan and circular roll change pixels, the post-release image remains
  stable, all six toolbar controls occur exactly once, horizontal overflow is
  zero and no page/console error is emitted. Enabling the existing axes gizmo
  and clicking an axis handle changes the Canvas with no page error, exercising
  the Arcball `getTarget`/`setPosition` adapter rather than only its type surface.
- Added `docs/matterviz-upstream-drafts.md` as a local-only staging document for
  small upstream PRs covering flat scalar grids, Worker lifecycle, declarative
  camera state, opt-in Arcball and structure fidelity, plus a separate rendering
  smoothness issue. Nothing was published upstream; Multiwfn transport and
  product-specific behavior are explicitly excluded.
- Preserved the generic MatterViz camera implementation as local commit
  `70136670` on `agent/camera-up-zoom-api`. It was not pushed and no upstream
  issue or PR was created; the unrelated `windows-preview/` directory remains
  untouched and untracked.
- The final release review found one remaining real-pan reset mismatch: Three
  r185 translates its private Arcball gizmo during pan without updating
  `_currentTarget`, so assigning the original public target could be mistaken
  for a no-op and `saveState()` could pair the original camera with the panned
  pivot. Local MatterViz commit `3e2c1754` now rebases the change detector on
  the actual pivot, preserves the private reset matrix while restoring a live
  pose, and centralizes baseline seeding. The focused source suite passes
  17/17, including private-pivot and world-direction assertions after a real
  native pan.
- Rebuilt the consumer package as
  `matterviz-0.4.2-multiwfn.d8719d12.r23.tgz` (SHA-256
  `b025200c6f6b476dd9bfa07c765418bea7ed8badfb407bc55363a15a09918f55`,
  frozen SHA-512
  `6bF9c5+SbhY12UK5eQDTOgmw+reUQ1aApDxtqn5TeWptX/Pt8/oN+/Bs+3vAnWm9wR0ONz6FVX8x3SeRPWHRxA==`).
  It overlays only the reset/runtime and navigation-tip files on r20; the r19
  Worker, geometry disposal and `on_geometry_error` relay remain intact. A
  clean pnpm 11.5 frozen install resolves r23; the viewer passes 113/113 tests,
  `svelte-check` with zero diagnostics and a 1,377-module production build.
- Production browser reruns pass at 1440x900 and 800x700: seven consecutive
  pole-crossing drags, pan, circular roll, no inertia, all six toolbar buttons,
  zero overflow and zero page errors remain valid. After closing overlay UI,
  right-drag pan changes the scene and double-click Reset restores the inspected
  scene region pixel-for-pixel at both sizes. The real axis-gizmo click still
  changes the Canvas without an error.
- Exact code commit `98297ceabe2a204628679e86e54c80c87af8d3c2` passed
  all six PR/push workflow groups. MatterViz PR run `29460398236` and push run
  `29460395250` each passed frontend/Rust integration plus Linux, macOS and
  Windows packages; build `29460398179`, Linux compatibility `29460398190`,
  GUI package matrix `29460398609` and core guard `29460398180` also passed.
  The final independent read-only review reported no blocker or important
  finding and verified the real-pan repair and byte-identical r20 Worker/
  lifecycle files.
- Published GitHub prerelease
  [`matterviz-preview-15`](https://github.com/Stardust0831/Multiwfn/releases/tag/matterviz-preview-15)
  from that exact code commit. Tag workflow
  [`29461298608`](https://github.com/Stardust0831/Multiwfn/actions/runs/29461298608)
  passed all build, three-platform package and publish jobs. Independently
  downloaded assets pass `SHA256SUMS.txt`: Linux 17,914,797 bytes
  (`5ac6c4165918ce0a8e486cbeab118808ecd236a3df45e240c360bafae9beb75b`),
  macOS 12,684,765 bytes
  (`74a86f33d623ee97a4f53982c5454893cb2c76f274cde3f12ab6c0474dfefc52`)
  and Windows 22,060,561 bytes
  (`f66d5a59b13c77e423ea2b5936a76ef1c345638bd7b9a31f9e37ef71a73b706a`).
  Every archive contains the native Multiwfn executable, Rust desktop host,
  MatterViz frontend, license, settings and README; none contains Python,
  3Dmol, session/control files or staged Cube/CUB data. Implementation now
  pauses for Windows manual confirmation before the zero-disk IPC goal begins.

## 2026-07-16 runtime zero-disk IPC

- Windows manual acceptance closed the pole-free camera milestone, so the
  deferred runtime zero-disk work became active. A read-only source audit mapped
  every current disk dependency: session directory creation, manifest and
  structure JSON, initial/preview/dynamic Cube files, request/response/stop
  control files, cleanup polling and the file picker's `selected_file.txt`.
- Fixed the architecture boundary before implementation. The existing
  `MWFNVOL` channel remains dedicated to scalar data and ACK/backpressure. A
  separate versioned `MWFNCTL` request/response pair carries in-memory session
  bootstrap, correlated analysis results and shutdown. Rust keeps the existing
  HTTP URLs but serves session objects from memory; formal failure is terminal,
  while file/Cube behavior requires the explicit diagnostic environment flag.
- Added `docs/matterviz-control-protocol.md` with the v1 48-byte header, CRC,
  JSON envelope, request-ID rules, 64 MiB bootstrap bound, endpoint ownership,
  lifecycle and three-platform acceptance matrix. No Multiwfn calculation-core
  file is in the allowed write scope.
- The test audit found strong reusable major-2 and real-orbital coverage but no
  existing zero-disk proof. Linux and Windows package tests currently create
  and wait on session artifacts, Windows stages the downloaded HTTP body, and
  macOS only verifies noninteractive package linkage. The new gates must assert
  controlled writable-root snapshots, concurrent isolation, bounded pipe
  failure without fallback, and diagnostic Cube behavior as a separate mode.
- Implemented the fixed 48-byte `MWFNCTL` codec in Rust and C, paired inherited
  request/response pipes on POSIX and Windows, Rust hello validation in the C
  launcher, and a bounded 64 MiB C memory builder so Fortran can serialize JSON
  without a scratch file. Strict C11 `-Werror -pedantic` stream tests pass.
- Added validated Rust `SessionData` storage and changed the formal service to
  block on `session_init` before opening the WebView. Manifest, structure and
  optional state retain the existing HTTP URLs but are served from immutable
  in-memory JSON. A regression starts with nonexistent session/manifest paths,
  performs an authenticated bond request and shutdown over anonymous pipes,
  and verifies the path remains absent.
- Refactored the Fortran manifest and structure writers through one JSON sink,
  so diagnostic files and in-memory bootstrap share exactly the same serializer.
  Formal `drawmolgui` now creates only an identity string, sends bootstrap,
  orbital/bond/ESP responses and Return over control pipes, and keeps scalar
  volumes on `MWFNVOL`; Cube output remains explicit diagnostic behavior.
- Installed a disposable Rust 1.88 toolchain under `/tmp` for local checking.
  A Tauri-native build is blocked locally by missing Wayland/dbus development
  packages, but a no-Tauri harness compiled the production protocol, transport,
  service and volume modules and passed 58/58 tests. Full `cargo fmt --check`
  passes and the strict C stream suite remains green. Non-`drawmolgui` initial
  volume entries and the native file picker are the next zero-disk gaps.
- Completed the remaining zero-disk bootstrap gaps. Initial `cubmat` and
  `cubmattmp` arrays now publish as generic scalar `MWFNVOL` entries before the
  in-memory `session_init`; non-`drawmolgui` sessions stay in the same serialized
  control loop until shutdown. Formal sessions therefore do not create a real
  session path for these GUI entry points.
- Added bounded control-read deadlines on Unix and Windows and retained one
  deadline across fragmented header/body reads. Formal orbital, bond, ESP and
  Return requests now use correlated `MWFNCTL` envelopes; scalar payloads remain
  on the existing volume channel, and formal transport failure is terminal.
- Replaced the native file picker's `selected_file.txt` with `MWFNPICK` v1 over
  one inherited result pipe. Rust writes selected/cancel/error frames; C validates
  version, header/body CRC, UTF-8, NUL, bounds, trailing bytes and capacity before
  returning a fixed Fortran buffer. The nonlegacy Fortran branch no longer asks
  for or creates a session directory when the user presses Enter to select a file.
- Migrated the Linux and Windows real-orbital package gates to in-memory HTTP
  response bytes and pre/post writable-tree snapshots. They reject newly created
  directories as well as manifest, structure, request, response, stop, Cube and
  staged volume files. Windows additionally asserts all four formal pipe
  arguments on the Rust Host process. The package matrix runs the in-memory Rust
  service regression on Linux, macOS and Windows, plus strict native C control/
  picker tests on Linux and macOS; hosted macOS still does not claim an
  interactive WKWebView session.
- Local verification after the final lifecycle fixes passes the strict C
  stream/control/picker suite, 82/82 production-module and direct C-ABI Rust
  integration tests, `clippy -D warnings`, both Rust formatting checks, 103/103
  viewer tests, Svelte check, generated production assets, configuration
  validation and 38 Python contract/service tests (one Windows-only socket
  assertion skipped on Linux). The full Tauri and Fortran builds remain CI
  gates because this WSL environment lacks the required WebKit/Wayland
  development packages and a Fortran compiler.
- Remaining release work is deliberately narrow: run formatting/check/build and
  the locked three-platform package jobs, inspect their zero-artifact evidence,
  obtain a final high-level read-only review, then publish a prerelease for manual
  confirmation. No upstream MatterViz draft is published as part of this goal.
- The first high-level zero-disk review found that control errors were reported
  but the byte stream remained reusable, the C/Fortran receiver did not enforce
  the JSON envelope, a 250 ms partial read could lose framing, and the picker
  counted user interaction against a 15-second transport deadline. These were
  accepted as release blockers rather than documented away.
- Runtime control send/read/CRC/timeout/correlation/malformed-result failures now
  atomically revoke the control transport, clear volumes, stop HTTP and cause the
  formal WebView host to exit with status 2. Normal Return keeps the transport
  valid long enough to send shutdown and exits with status 0. Cross-platform
  tests cover timeout, corrupt CRC, fragmented response and mismatched IDs.
- C now performs a non-consuming 250 ms idle readiness poll, then applies one
  30-second completion deadline after the first byte. A partial-frame timeout is
  a terminal protocol error. It also rejects control-body NUL and invalid UTF-8.
  Rust emits one canonical request JSON order and Fortran reconstructs that exact
  envelope with the validated header request ID before executing any command.
- The picker now waits indefinitely for the human dialog decision and starts its
  15-second bound only after result bytes become readable. The separate Fortran
  buffer limit rejects overlong paths instead of truncating them. Formal manifest
  bootstrap also rejects external structure/volume URLs.
- The matrix integration crate now calls the compiled C control ABI directly on
  every platform for round-trip, fragmentation, CRC rejection and idle timeout;
  Windows therefore no longer relies only on the happy-path packaged orbital for
  control failure coverage. Interactive native picker behavior remains a manual
  desktop gate.
- The follow-up lifecycle review found four final gaps: Return send failure did
  not terminate the formal host, idle Multiwfn death could leave the host
  orphaned, valid `structure: null` manifests were rejected, and legacy
  `layers` paths were not covered by formal URL validation. Return failure now
  revokes the transport and exits with status 2; volume-pipe EOF sets the shared
  stop signal; structureless sessions are accepted; and `layers` use the same
  positive local `/api/volume/<id>` policy as `cubes`. Focused Rust tests cover
  each lifecycle/bootstrap behavior.
- The final independent re-review found no critical, important or minor issue.
  It confirmed terminal Return failure, idle backend EOF shutdown,
  structureless bootstrap, legacy-layer URL containment, the formal/diagnostic
  split and the absence of scientific-core changes. The change is ready to
  enter CI; prerelease remains conditional on full Fortran/Tauri/MinGW builds,
  packaged Linux/Windows zero-artifact orbital gates and the documented manual
  desktop checks.
- Candidate `e1fa00f` entered CI but did not pass, and no prerelease was
  published. Both PR/push MatterViz workflows exposed the same three root
  causes: production `clippy -D warnings` rejected test-only codec aliases and
  decoders as dead code; the Windows service tests lacked their control-frame
  reader because its helper was Unix-only; and the Linux package's preliminary
  diagnostic-artifact generator unintentionally launched GTK without Xvfb.
  Core protection, noGUI and legacy GUI/package jobs passed.
- The corrective change removes unused aliases, compiles decoder-only picker
  code and the blocking control reader only for tests, makes the shared service
  frame reader available on Unix and Windows, and runs preliminary file-artifact
  generation as explicit `MULTIWFN_MATTERVIZ_ALLOW_CUBE_FALLBACK=1` diagnostic
  mode through a lifecycle stub that writes the diagnostic stop flag and whose
  launch is checked explicitly. The subsequent extracted Rust Host and real-orbital
  zero-disk gates remain unchanged. Local reruns pass 82/82 Rust integration,
  strict C, harness clippy/formatting and 38 Python contracts; full Tauri and
  platform package confirmation returns to CI. A follow-up read-only review
  found no critical, important or minor issue in the corrected Rust cfg or
  diagnostic lifecycle stub and approved the patch for commit/CI.
- Replacement candidate `f9c9929` passed production Tauri clippy, the Windows
  C-to-Rust tests, Linux/macOS packages, the Linux diagnostic artifact smoke and
  packaged real-orbital zero-disk gates. Only the duplicated Windows package
  jobs failed, after the real Host had already prepared and advertised its
  in-memory session: under PowerShell StrictMode the startup assertion applied
  `.Count` to a scalar `Where-Object` result. Both stdout predicates now wrap
  the entire pipeline in `@(...)`, with a source-contract regression; product
  runtime code is unchanged.
- Final code candidate `371ca63ac7afe34314972967d58cc8de34ef5a8f` passed all
  21 branch/PR check contexts: 17 successes and four intentionally skipped
  release/publish jobs. MatterViz runs `29500247805` and `29500241767` passed
  the production Rust/Tauri host plus Linux, macOS and Windows package jobs.
  Both Windows archive-verification jobs completed the formal real-orbital
  request, binary response, Return/process-tree shutdown and no-runtime-artifact
  assertions. GUI/noGUI, glibc compatibility and core protection runs also
  passed. The formal zero-disk IPC goal is therefore ready for a tagged
  prerelease and manual desktop confirmation.
- Published GitHub prerelease
  [`matterviz-preview-16`](https://github.com/Stardust0831/Multiwfn/releases/tag/matterviz-preview-16)
  from exact green code commit `371ca63ac7afe34314972967d58cc8de34ef5a8f`.
  Tag workflow [`29502181879`](https://github.com/Stardust0831/Multiwfn/actions/runs/29502181879)
  passed the Rust Host, Linux, macOS, Windows and publish jobs. Independent
  downloads match `SHA256SUMS.txt`: Linux 17,961,348 bytes
  (`8a4e51bfc08c493d4e5cfc34b7daba068d66042569c61db8c3de920a7e0d7582`),
  macOS 12,720,536 bytes
  (`7b3d78e67675ec1570361cc8c99661a69f87407763fc3b69665b89edbfd3adf3`)
  and Windows 22,098,386 bytes
  (`4d748e895ed2e9b64b17eac0b53a4af4fc6b8e76b040c8126b07cbdf46a0d034`).
  Every archive contains the native Multiwfn executable, Rust Host, built
  MatterViz frontend, settings, README and license; filename scans find no
  Python, 3Dmol, session/control, manifest/structure or Cube runtime artifact.
  Development pauses for manual Preview 16 confirmation.
- The final PR #26 architecture audit found no scientific-core intrusion,
  PR #25 analysis-platform residue, unsupported spectrum declaration, DOM
  scraping, production Python/3Dmol dependency or formal file-session fallback.
  Before opening review, current build/visualization/frontend docs were aligned
  with the in-memory `MWFNCTL`/`MWFNVOL`/`MWFNPICK` boundary, the old handoff was
  marked historical, and six unreferenced intermediate MatterViz vendor
  archives were removed so only lockfile-pinned r23 remains. A follow-up
  independent review found no remaining architecture or scope blocker.
- At the user's explicit release decision, added a formal MatterViz tag path
  alongside the unchanged preview path. `v*-matterviz.*` tags use the same
  three-platform build, real-orbital, Return/process and zero-runtime-artifact
  gates, then publish a non-prerelease Latest release with `--verify-tag`;
  `matterviz-preview-*` remains prerelease-only. The first planned formal tag is
  `v2026.7.10-matterviz.1` from the PR #26 branch.
- Published the non-draft, non-prerelease GitHub Latest release
  [`v2026.7.10-matterviz.1`](https://github.com/Stardust0831/Multiwfn/releases/tag/v2026.7.10-matterviz.1)
  from exact PR #26 commit `a2bf7d3b2b7c093c3bb211338e815de504ddfa6a`.
  Tag workflow [`29511412031`](https://github.com/Stardust0831/Multiwfn/actions/runs/29511412031)
  passed the Rust Host, Linux, macOS, Windows and publish jobs. Independent
  downloads match `SHA256SUMS.txt`: Linux 17,960,202 bytes
  (`a8d09abf153c635ef5de0da5548ca4664cac4f515963d38370dae8da2729ed88`),
  macOS 12,720,770 bytes
  (`8c0d5d40031eddef000a6fb4e21c06bbef6a1ab3471093dce104c52ab05a1f23`)
  and Windows 22,098,383 bytes
  (`d8269b0eb1164a6881bf89d8f2583f0392ab85765843ca49c5b3cd5a38d67459`).
  Each archive contains the native Multiwfn executable, Rust Host, built
  MatterViz frontend, settings, README and license. A combined filename scan
  found no Python, 3Dmol, legacy control/session, manifest/structure JSON or
  Cube runtime artifact.
- Post-release defect audit confirmed three reports. First, macOS queried the
  nonexistent `vm.page_inactive_count` sysctl and silently substituted zero;
  with the fixed 2 GiB reserve this could reduce the active-volume limit to
  zero on an otherwise healthy low-free/high-inactive system. The Rust Host now
  reads free and inactive counts from Mach `HOST_VM_INFO64` in one snapshot.
  A deterministic 16 KiB-page case with 128 MiB free and 6 GiB inactive proves
  that a normal volume remains admissible.
- The binary protocol defines sample positions as
  `origin + i*a + j*b + k*c`, but the adapter and nonperiodic session lattice
  metadata used `n * voxel_axis` for every grid. MatterViz finite sampling and
  marching cubes use `n - 1` intervals, producing an `n/(n-1)` spatial scale
  error. Finite binary grids and their session metadata now use `n - 1`, while
  periodic grids continue to use `n`; a real `2x2x2` marching-cubes regression
  places the half-value plane at `x=0.5`. Degenerate singleton finite axes are
  rejected rather than assigned a fabricated voxel span. The generic MatterViz
  Cube parser has the same finite-grid issue and is recorded for a separate
  upstream fix; it is not used by the formal zero-disk native path.
- Generic compatible cross-volume coloring was rendered correctly but the
  fallback in `esp_pair()` exposed the ESP legend and extrema analysis for any
  cross-colored layer. ESP tools now require explicit `esp-density` and
  `esp-potential` provenance plus the active density-to-potential mapping.
  Recoloring, deleting/reindexing a paired volume or restoring generic state
  cannot retain an ESP-labeled legend or stale ESP-extrema panel.
  Local verification passes 83/83 Rust integration tests, Rust Clippy with
  warnings denied, 115/115 frontend tests, Svelte check, production build and
  47 MatterViz Python contract tests with one platform-only skip. macOS native
  compilation and the three-platform package matrix remain CI gates.
- PR #26's required-conversation rule exposed eight unresolved CodeRabbit
  threads. Four targeted the analysis/spectrum files removed during the PR #25
  scope correction and are obsolete. The four current findings were
  reproducible and fixed: nullish slice inputs no longer become numeric zero;
  ESP index sampling requires matching dimensions, origin, lattice and boundary
  mode; mobile ESP ticks retain label width; and out-of-range restored
  `colorVolumeIndex` references are discarded instead of clamped to an unrelated
  volume. The frontend now passes 116/116 tests, zero Svelte diagnostics and a
  production build with these regressions. PR #26 also cross-references issue
  #11 as the selected MatterViz implementation without auto-closing that broader
  backend-evaluation issue.
- Final latest-head verification completed for
  `699680bc30e94b7519424cb97361e9bba924842f`. MatterViz PR run `29519458883`,
  MatterViz push run `29519457146`, build `29519458664`, GUI compatibility
  `29519458749`, GUI demo/package `29519458762` and core guard `29519458673`
  all passed. Linux, macOS and Windows MatterViz package jobs are green, the PR
  check rollup has no pending or failed checks, CodeRabbit reports success and
  all 19 review threads remain resolved. GitHub now reports the branch as
  mergeable but `REVIEW_REQUIRED`; the remaining gate is approval from the
  requested independent reviewer, not an unresolved bot conversation.
- Preview-only signed updater bootstrap run `29950460567` reached all three
  platforms. The frontend gate exposed invalid MatterViz icon names, Linux and
  macOS exposed a fixed-array test helper, and Windows reached the updater and
  exposed stable-Rust portability errors in hard-link metadata plus ordinary
  borrow/path typing errors. The frontend now passes 124 tests, Svelte check
  and both preview/formal production builds locally; the Rust corrections are
  staged for the next CI bootstrap, which must generate and return the updater
  lockfile and current rustfmt output before the workflow is made strict.
- A temporary local Rust 1.88 toolchain subsequently generated the checked-in
  updater `Cargo.lock` and normalized both updater and Host sources. Updater
  verification passes 16/16 tests, `cargo check --locked`, rustfmt check and
  Clippy with warnings denied; the authenticated N-to-N+1 test now uses real
  Ed25519 test proofs and covers preserved settings, added/removed managed
  files and an unknown user sentinel. A cross-platform hard-link regression
  exercises the stable Win32 metadata replacement. Local Host compilation
  reaches native Wayland/DBus discovery but this WSL environment lacks
  `pkg-config` and the corresponding development libraries, so full Host and
  package verification remains in three-platform CI.
- Final read-only review found a crash window in recursive transaction cleanup:
  losing `journal.json` before the active directory disappeared made recovery
  impossible. Candidate and transaction cleanup now first durably rename the
  owned directory to a unique retired name and only then delete recursively;
  a simulated post-rename crash proves the remnant is not interpreted as an
  active transaction. Managed executable permissions are authenticated too.
  Native package jobs now execute updater tests, including the platform PID
  wait and unsupported-target rejection, rather than compiling the binary only.
- Strict workflow run `29952704277` exposed four integration errors rather than
  updater-protocol failures: stale public Host wrappers failed Clippy, the
  shared volume test crate omitted the new updater module, and Win32 wait
  constants were imported from the wrong modules. The wrappers were removed,
  the test crate now includes `updater.rs`, and constants use Foundation plus
  the documented process synchronization mask. Local updater tests pass 21/21
  and the expanded volume e2e suite passes 106/106 before the next CI run.
- Final exact-head workflow run `29954169768` passed all four required jobs for
  commit `2c6e7a919a11ffb8471760c0fbe41ced36762d4c`: frontend/Rust Host and the
  Linux, macOS and Windows package matrices. Each native package job ran the
  updater tests before release build; sign-preview and release jobs were
  correctly skipped. Focused follow-up review found no remaining critical or
  important issue in the cleanup, platform-test and CI-integration fixes. No
  preview tag is created until the protected signing Environment and public
  trust registry are configured and the first trust-root package is reviewed.
