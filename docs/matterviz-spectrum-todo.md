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
- [x] P1: persist molecule visibility, atom/bond sizing, bond mode/strategy, labels, sphere quality and background through workbench state.
- [ ] P1: decide whether Ball+Stick, Spacefill, Stick and Wire need named convenience presets beyond the already reachable MatterViz primitive controls; do not add Cartoon.
- [ ] Reorganize the viewer using the VESTA screenshot as a layout reference only: keep all proven top/right Multiwfn actions, add a compact left display/material panel, and leave the central 3D viewport dominant.
- [ ] Add fixed-step camera rotation, pan and zoom controls to the top toolbar using public MatterViz camera APIs, with explicit numeric step inputs and deterministic inverse-operation tests.
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
- [ ] P2: complete an installed-shell browser/WebView Return and shutdown smoke test.
- [ ] Keep ESP work separate from the first native-parity PR and review its scientific authority carefully.
- [x] Run frontend unit tests, `npm run check`, `npm run build` and browser validation after cleanup.
- [ ] Run Multiwfn/CMake build when a CMake toolchain is available.
- [x] Complete a high-level read-only review confirming strict origin/main scope.
- [x] Complete a read-only review of structure state and WebView lifecycle changes before commit.
- [x] Commit and push only after the scope review passes.

## Broader PR #26 risks

- [x] Complete API isolation and mutation-method audit.
- [ ] Use a unique per-process GUI session directory to prevent two Multiwfn instances in one working directory from sharing requests/artifacts.
- [ ] Bound orbital request quality and require finite, bounded isovalue in the GUI HTTP adapter.
- [ ] Add a per-session capability and loopback/Host protections for mutation endpoints; migrate state-changing requests away from unauthenticated GET where compatibility allows.
- [ ] Define and test Return behavior while a long backend calculation is already in flight.
- [ ] Finite WebView startup handshake and failure reporting.
- [ ] Installed-resource/native-shell packaging smoke test.
- [ ] Cross-platform locked WebView build and bundle-size evidence.
- [x] Label frontend-sampled ESP extrema as approximate visual estimates rather than authoritative Multiwfn results.

## Parallel integration policy

- Bounded parity tasks may use independent worktrees and `agent/*` branches based on the latest reviewed development commit.
- Each branch must have disjoint write scope, objective verification and its own commit; it must not edit the shared TODO/log documents.
- The primary development branch owns documentation updates, reviews every agent commit, merges or cherry-picks it, resolves conflicts and reruns proportionate verification before pushing PR #26.
