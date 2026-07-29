# MatterViz 2D plot protocol v2

Status: implementation contract for PR #49

## Scope

`multiwfn-matterviz-plot` version 2 describes the two-dimensional scientific
scene which Multiwfn has already submitted to its DISLIN boundary. The scene
does not contain analysis inputs and the frontend must not reconstruct or
reinterpret scientific quantities.

Version 1 remains valid for DOS, IR, Raman, UV-Vis and NMR artifacts. Version 2
adds general XY and two-dimensional field layers without changing version 1.

## Scene JSON

The plot is embedded in the workbench manifest:

```json
{
  "format": "multiwfn-matterviz-plot",
  "version": 2,
  "title": "Interaction region indicator",
  "semanticKind": "iri",
  "page": { "width": 3000, "height": 2250 },
  "panels": [{
    "id": "panel-1",
    "viewport": [0.1, 0.1, 0.8, 0.8],
    "axes": {
      "x1": { "label": "sign(lambda2) rho", "range": [-0.4, 0.1], "scale": "linear" },
      "y1": { "label": "IRI", "range": [0, 2.5], "scale": "linear" }
    },
    "layers": [{
      "id": "points-1",
      "type": "scatter",
      "xAxis": "x1",
      "yAxis": "y1",
      "data": { "datasetId": 1 },
      "style": { "color": "#222222", "marker": "circle", "markerSize": 4 }
    }]
  }]
}
```

`kind` is optional descriptive metadata and never controls parsing. Panel IDs,
layer IDs and axis keys are unique within their owner. A viewport is normalized
`[left, top, width, height]` with positive width and height and bounds inside the
page.

Axes are explicitly registered under `x1`, `x2`, `y1` and `y2`. Each axis has a
non-degenerate finite range in display order and `scale` equal to `linear` or
`log`. Log ranges and every value rendered on them must be positive.

The supported layer types are `line`, `scatter`, `line+scatter`, `bars`,
`error-bars`, `fill` and `contour`. Panel annotations are metadata, not
dataset-backed layers. Numeric
arrays use data references. A data reference is `{ "datasetId": positive
integer }` and may be shared by layers. Each dataset contains one or more
explicitly named array roles such as x/y. Contour layers
also declare a positive `[nx, ny]`, `order: "x-fastest"`, and a `z` reference.
No layer may silently fall back to another type. Filled contours, rasters,
relief maps and streamlines remain fail-closed until their native color,
lighting or integration semantics are represented by a later protocol version.

## Binary data frame

Large arrays travel on the existing inherited scientific-data pipe. The first
eight bytes select the codec, so existing `MWFNVOL` frames remain unchanged.

`MWFNP2D` version 1 is a fixed 80-byte little-endian header, a directory of
32-byte array entries, and contiguous Float64 array bodies:

| Offset | Bytes | Field |
| ---: | ---: | --- |
| 0 | 8 | ASCII `MWFNP2D\0` |
| 8 | 2 | major = 1 |
| 10 | 2 | minor = 0 |
| 12 | 2 | message type = 1 (dataset) |
| 14 | 2 | flags = 1 |
| 16 | 4 | header bytes = 80 |
| 20 | 8 | dataset ID, nonzero and unique in the session |
| 28 | 4 | array count, 1 through 8 |
| 32 | 4 | directory entry bytes = 32 |
| 36 | 8 | directory bytes = array count * 32 |
| 44 | 8 | total Float64 body bytes |
| 52 | 8 | total element count |
| 60 | 4 | CRC32C of the header with this field zeroed |
| 64 | 4 | CRC32C of all array bodies |
| 68 | 4 | reserved = 0 |
| 72 | 8 | complete frame bytes |

Each directory entry stores a unique role byte at offset 0, an element count at
offset 8, a body-relative byte offset at offset 16 and an array byte count at
offset 24. Roles are x=1, y=2, z=3, u=4, v=5, error-low=6,
error-high=7 and baseline=8. Entries are tightly packed in body order.

ACK frames reuse the 64-byte volume ACK shape and the `MWFNP2D` magic. Static
plot publication uses the dataset ID as both request identity and dataset ID,
plus a zero success status. The producer does not
allocate a second full body: it computes CRC32C over the caller-owned array,
writes the header, streams bounded chunks, then waits for ACK.

Rust validates finite values, exact sizes, CRCs, IDs and session byte budget
before exposing `GET /api/plot-data/<id>` as
`application/vnd.multiwfn.matterviz-plot-data-v1`. Authentication and loopback
host checks are identical to `/api/volume/<id>`.

## Lifetime and limits

The plot store has one entry per referenced dataset. It rejects duplicates and
uses the shared active scientific-data memory budget rather than a fixed point
count. Closing or replacing a plot clears all plot datasets. The browser drops
TypedArrays, worker jobs, ImageBitmaps and derived SVG/Canvas geometry when the
scene is replaced or closed.

The scene is rejected as a unit when a referenced dataset is absent, dimensions
overflow, an unsupported layer is present, a log invariant fails, or a resource
limit is exceeded. Partial plots are not displayed.
