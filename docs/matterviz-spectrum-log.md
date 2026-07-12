# MatterViz parity development log

## 2026-07-13: scope correction

- Re-established `origin/main` (`d204ae429752617b6fce82ee45012bbe07ddb64c`) as the sole original 3Dmol GUI baseline.
- Compared `origin/main`, the current branch and the unmerged PR #25 branch. `origin/main` has no DOS/PDOS, IR, Raman, UV-Vis or NMR GUI/session structured-data path.
- Confirmed PR #25 introduced `multiwfn_analysis.py`, `AnalysisStore`, dataset import/CRUD endpoints, analysis workers and DOS/IR/NMR protocol/UI. Raman and UV-Vis were not even part of PR #25 and had been added locally from external Gaussian/ORCA output parsing.
- Corrected the prior classification that treated PR #25 adapters as existing backend data. External output parsers are not a Multiwfn-native calculation-to-session chain and cannot establish MatterViz parity.
- Removed all external-output parsers, `AnalysisStore`, analysis dataset APIs, source-file detection, five-kind spectrum capability declarations, SpectrumPanel/adapters, fixtures and associated tests.
- Removed the previously committed DOS-only MatterViz panel and parser because the same native session capability is absent from `origin/main`.
- Preserved the audit result in the parity TODO. The actual original 3Dmol plotting baseline is a generic user-selected CSV/JSON 2D curve/heatmap loader plus cube slices; MatterViz still needs the generic local plot import.
- No commit or push was made before this cleanup.
- Cleanup verification passed: 33 frontend unit tests, zero Svelte diagnostics, production Vite build and `git diff --check`.
- Playwright passed at 1440x900 and 800x700 using a manifest with no analysis section: the structure canvas loaded, no page/console errors occurred, and no DOS/PDOS/IR/Raman/UV-Vis/NMR/Spectrum capability control was present.
- High-level read-only scope review found no cleanup defect and confirmed: PR #25 is not used as baseline, no external parser masquerade remains, no multi-dataset platform remains, and the five disputed spectrum capabilities now match `origin/main` by remaining unavailable.
- A local-only CSV/JSON 2D Plot panel was briefly implemented and verified, then removed after product clarification that generic file plotting is not required for the current core Multiwfn GUI replacement phase.
- Completed a core `origin/main` parity audit. Highest-priority gaps are orbital metadata/navigation, structure/style controls, volume/surface controls and full periodic workflow verification. Measurements, bond analysis and 2D slices have the core data paths but need stronger wrapper-level acceptance tests; state and lifecycle are partial.
- Identified ESP extrema provenance as the only current frontend-derived scientific result: it is a bounded visual estimate, not a Multiwfn-native extrema calculation. Updated UI labels accordingly and kept deeper ESP work outside the first native-parity phase.
- Improved the native orbital workflow using existing manifest metadata only: added previous/next navigation, an orbital selector, energy/occupation display and HOMO/LUMO context. No calculation or protocol changes were required.
- Final orbital review tightened edge cases: metadata selection is used only when the manifest item list covers the full orbital count, larger spaces retain numeric navigation, and HOMO/LUMO labels appear only for explicitly closed-shell sessions. Desktop and 800px Playwright navigation passed without page errors.

## Earlier work, superseded

- A generic five-kind spectrum protocol, broadening engine, frontend panel and PR #25-derived backend parser path were implemented and locally tested.
- Although those components passed focused tests and browser pixel checks, they expanded PR #26 beyond the authoritative baseline and were removed during the scope correction.
