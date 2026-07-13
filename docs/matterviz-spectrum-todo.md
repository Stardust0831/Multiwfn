# MatterViz origin/main parity TODO

Updated: 2026-07-13

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
- [ ] Run Multiwfn/CMake build when a CMake toolchain is available.
- [x] Complete a high-level read-only review confirming strict origin/main scope.
- [x] Complete a read-only review of structure state and WebView lifecycle changes before commit.
- [x] Commit and push only after the scope review passes.

## Broader PR #26 risks

- [x] Complete API isolation and mutation-method audit.
- [x] Use a fresh atomically created GUI session directory for each default launch so concurrent Multiwfn instances cannot share requests/artifacts; preserve explicit environment overrides.
- [x] Bound orbital request quality and require finite, bounded isovalue in the GUI HTTP adapter, with manifest-backed orbital index checks and HTTP rejection tests.
- [ ] Add a per-session capability and loopback/Host protections for mutation endpoints; migrate state-changing requests away from unauthenticated GET where compatibility allows.
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
- [ ] Run the archived 11-atom/10-bond session and installed-package explicit-connectivity smoke after CI produces the next package.
- [x] Confirm the upstream periodic proxy-loop fix and native JSON launch path in the locked Linux, macOS and Windows package jobs for commit `ce2515e`.
- [x] Compile the Fortran GUI/session adapter and pass the Linux, macOS and Windows package workflows for the native-JSON commit.
- [x] Complete the local adapter/build naming migration: first-class `matterviz` CMake backend, `Multiwfn_MatterVizGUI`, `MULTIWFN_MATTERVIZ_*`, MatterViz session/tool names and isolated MatterViz resources.
- [ ] Confirm the renamed MatterViz backend and three renamed installation packages in CI before tagging the next prerelease.

## Parallel integration policy

- Bounded parity tasks may use independent worktrees and `agent/*` branches based on the latest reviewed development commit.
- Each branch must have disjoint write scope, objective verification and its own commit; it must not edit the shared TODO/log documents.
- The primary development branch owns documentation updates, reviews every agent commit, merges or cherry-picks it, resolves conflicts and reruns proportionate verification before pushing PR #26.
