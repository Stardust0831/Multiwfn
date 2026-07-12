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
- [ ] P1: verify remaining representation presets, axes behavior and PNG export through MatterViz native controls.
- [x] P1: expose per-layer negative phase, phase colors, cross-color colormap and editable color range using the existing state-covered fields.
- [ ] P1: verify and expose remaining global surface material/mesh/quality controls not already available through MatterViz native controls.
- [ ] P1: verify periodic oblique cells, negative/noninteger surface ranges, independent atom supercells and cross-boundary bonds end to end. In progress on `agent/periodic-parity-tests`.
- [ ] P2: add wrapper-level measurement tests for distance, angle and dihedral selection ordering. In progress on `agent/measurement-parity-tests`.
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

- [ ] API isolation and mutation-method review.
- [ ] Finite WebView startup handshake and failure reporting.
- [ ] Installed-resource/native-shell packaging smoke test.
- [ ] Cross-platform locked WebView build and bundle-size evidence.
- [x] Label frontend-sampled ESP extrema as approximate visual estimates rather than authoritative Multiwfn results.

## Parallel integration policy

- Bounded parity tasks may use independent worktrees and `agent/*` branches based on the latest reviewed development commit.
- Each branch must have disjoint write scope, objective verification and its own commit; it must not edit the shared TODO/log documents.
- The primary development branch owns documentation updates, reviews every agent commit, merges or cherry-picks it, resolves conflicts and reruns proportionate verification before pushing PR #26.
