# MatterViz Rust host goal

Updated: 2026-07-14

## Final state

- MatterViz WebView is a native companion GUI for Multiwfn. Fortran retains all
  scientific calculation and the original GUI request-loop semantics; Rust
  owns process launch, WebView, loopback HTTP, session lifetime, and transport.
- Windows, Linux, and macOS release packages behave equivalently and contain no
  Python runtime dependency.
- Current frontend URLs and structured session JSON remain compatible.
- Dynamic orbital and ESP grids travel through a bounded versioned binary
  protocol over inherited pipes. Routine dynamic Cube files are eliminated;
  Cube remains an explicit compatibility and diagnostic fallback until native
  transport is proven and may remain available for debugging afterward.
- No Multiwfn calculation-core source is modified. Native volume publication is
  confined to `noGUI/GUI_matterviz.f90` and the GUI/session launch adapter.

## Non-goals for this phase

- No external quantum-chemistry text parsers, analysis dataset platform, or
  PR #25-only spectrum capability.
- No DOM/Plotly/3Dmol data scraping.
- No generic CSV/JSON curve or heatmap import.
- No shared-memory implementation before bounded-pipe benchmarks justify it.
- No MatterViz flat-grid upstream redesign inside this PR; the frontend adapter
  may perform one bounded conversion to the current nested grid API.
