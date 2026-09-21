# Weak-interaction isosurfaces in MatterViz

MatterViz uses the scientific fields computed by Multiwfn and the display
relationships in its official VMD templates. IRI/RDG/DORI or delta-g determines
the isosurface geometry; a separate `sign(lambda2)rho` field determines color
at each surface vertex. The coloring dataset is available in Reps but has its
own isosurface hidden initially.

## Official reference scales

The reference files are preserved in
[`tests/fixtures/weak-interaction-vmd/`](../tests/fixtures/weak-interaction-vmd/).
All use VMD's BGR scale: pure blue `#0000ff`, green `#00ff00`, and red `#ff0000`,
with piecewise linear RGB interpolation and endpoint clipping. Ranges are in
atomic units of `sign(lambda2)rho`, not the full minimum/maximum of the data.

| Analysis / VMD template | Surface grid | Coloring grid | Template isovalue | Color range (a.u.) | Green position |
| --- | --- | --- | ---: | --- | ---: |
| IRI / `IRIfill.vmd` | `func2.cub` | `func1.cub` | 1.0 | -0.04 to 0.02 | 66.6% |
| NCI / `RDGfill.vmd` | `func2.cub` | `func1.cub` | 0.5 | -0.035 to 0.02 | 50% |
| Promolecular NCI / `RDGfill_pro.vmd` | `func2.cub` | `func1.cub` | 0.3 | -0.035 to 0.03 | 50% |
| DORI / `DORIfill.vmd` | `func2.cub` | `func1.cub` | 0.95 | -0.04 to 0.02 | 66.6% |
| IGM inter / `IGM_inter.vmd` | `dg_inter.cub` | `sl2r.cub` | 0.01 | -0.05 to 0.05 | 50% |
| IGM intra / `IGM_intra.vmd` | `dg_intra.cub` | `sl2r.cub` | 0.2 | -0.05 to 0.05 | 50% |

The templates without a `color scale midpoint` command use a fresh VMD
session's default of 0.5. IRI and DORI explicitly set `0.666`, which puts pure
green at -0.00004 a.u., approximately zero. MatterViz preserves that literal
value; it does not move green to 50%, symmetrize the range, or use a rainbow
preset. VMD's `Scene::create_colorscale` / `scale_color` implement the same
three-color interpolation. The separate IRI scatter-plot template has its own
scale and is not used to set these isosurface limits.

The user's menu input always supplies the isovalue. For example, entering
`0.1` for IRI keeps `0.1`; the VMD example's `1.0` is not silently substituted.
These positive scalar surfaces start with a single opaque surface, matching
the templates' default Opaque material. Reps still allows subsequent changes
to the isovalue, opacity, color range and color stops. The displayed
`sign(λ₂)ρ` legend follows the visible mapped representation's actual scale
and shows a.u. without electrostatic-potential unit conversion.

IGMH and mIGM use the same inter/intra scale with the fields produced by their
own analysis. The total delta-g surface uses `dg.cub` with the same signed
density scale. Viewing `sign(lambda2)rho` itself remains a normal scalar-field
view. Arbitrarily opened Cube files are not paired by filename heuristics, and
averaged trajectory analyses are outside this adapter's scope.

## Display boundary and ownership

In `funcvsfunc`, option 7 copies the surface field from `cubmattmp` to
`cubmat`, after saving the signed density in the local `exchangedata` array.
At the GUI call, **both globals contain the surface field**. Mapping one onto
the other cannot reproduce the VMD result. In IGM the signed density similarly
lives in the local `sl2r` array.

For the MatterViz build, `cmake/MatterVizMappedSurfaces.cmake` generates copies
of `otherfunc.f90` and `visweak.f90` in the build directory. It substitutes
only those two existing display calls to pass the local coloring array and
analysis identifier to `noGUI/GUI_matterviz.f90`. Tracked official calculation
sources remain untouched. Missing or duplicate call boundaries stop CMake
configuration, so an upstream source update cannot silently break the pairing.

The GUI adapter borrows the coloring array during the synchronous GUI call,
publishes the two fields through the binary volume transport, and clears its
pointer before returning. It neither modifies these arrays nor recalculates
the fields. The explicit diagnostic Cube path uses the same two arrays.

The manifest declares the relationship on the surface entry:

```json
{
  "name": "IRI",
  "path": "/api/volume/1",
  "format": "mwfn-volume-v2",
  "analysisKind": "weak-interaction-surface",
  "mode": "positive",
  "isovalue": 0.1,
  "opacity": 1,
  "colorMapping": {
    "path": "/api/volume/2",
    "range": [-0.04, 0.02],
    "stops": [
      {"position": 0, "color": "#0000ff"},
      {"position": 0.666, "color": "#00ff00"},
      {"position": 1, "color": "#ff0000"}
    ]
  }
}
```

The second entry has `analysisKind: "weak-interaction-color"` and
`visible: false`. The frontend checks that the referenced dataset is distinct
and has compatible grid geometry, then uses MatterViz's existing volume
sampling and vertex-color rendering. Saved Reps preserve the relationship by
dataset path, including when the loaded dataset order changes.

Native volume responses also provide the existing geometry memory budget. The
host reserves room for its retained grids and the frontend's copy of them;
the viewer shares the remaining budget between visible representations. This
keeps the original grid for marching cubes instead of the renderer's default
500,000-point downsampling. If the mesh exceeds the available budget, the
viewer reports the limit rather than silently reducing the requested precision.

## Verification

- `tests/test_matterviz_mapped_surfaces.py` runs the CMake generator and checks
  that only the two permitted display calls change, including with CRLF input
  and literal CMake-like strings in upstream text. It checks failure on changed
  or ambiguous boundaries.
- `tests/linux/test_matterviz_mapped_surfaces.py` drives the actual Multiwfn
  menus for IRI, NCI, promolecular NCI, DORI, IGM inter/intra, IGMH and mIGM.
  It checks manifest parameters against the VMD files and compares every native
  grid sample with the corresponding Cube export. The IRI case uses high grid
  precision (107 × 107 × 156, above the old 1,500,000-point transport limit)
  and explicitly requests 0.1. Re-export after Return must be byte-identical.
  The small H2 fixture is a transport/display test, not a chemistry benchmark.
- `frontend/matterviz-viewer/tests/volume-mapping.test.ts` checks interpolation,
  clipping, hidden coloring surfaces, saved Reps and invalid pair rejection.

A manual browser check also uses the official water-tetramer `complex.wfn`
example: its 94 × 94 × 60 grid matches `func2.cub` for IRI and `func1.cub` for
coloring within Cube text rounding (maximum relative difference below 5e-6).
VMD and MatterViz have different lighting and renderers; these checks establish
the field relationship and color-scale agreement, not pixel-identical images.
