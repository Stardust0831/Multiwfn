# Molecular frequency viewing

Open **BaneWfn GUI → Vibrational modes → Open frequency file** and choose a
one or more ordered CJSON files exported by [cclib](https://cclib.github.io/). The viewer shows the
equilibrium geometry first. Click MatterViz's Play control to animate the
selected mode; its own controls also provide scrubbing, playback speed, camera
rotation and zoom. Use the ordered file list or previous/next buttons to switch files. Only the selected file is parsed; an invalid item stays selected while the last valid scene keeps its own filename. New selections and closing discard pending old reads. Negative frequencies retain their sign and are marked
imaginary. Available IR intensities are displayed in km/mol.

For an existing Gaussian or ORCA frequency output, use cclib's established
importer/exporter before opening the result:

```sh
python -m pip install cclib==1.8.1
ccwrite cjson frequency.out
# Open frequency.cjson in BaneWfn GUI.
```

The viewer does not need Python. cclib is an external conversion tool, not a
new runtime/build dependency or a bundled launcher. This first version accepts
the cclib CJSON version-0 convention; it does not directly open `.out`/`.log`
files or advertise other CJSON dialects as compatible. Gaussian 16 and ORCA 4.2
exports are covered by real producer fixtures. Other formats need their own
import validation before being claimed as supported.

Export **one complete frequency calculation** containing geometry, frequencies
and Cartesian normal-mode displacements. A frequencies-only table cannot
animate a molecule. cclib owns output parsing, choice of calculation section,
atom order and coordinate orientation. Do not concatenate unrelated jobs or
combine a geometry with another calculation's displacements. This thin viewer
cannot reconstruct section or orientation information omitted from CJSON.

## Data and display boundary

- `atoms.elements.number` and flattened `atoms.coords.3d` describe the same
  ordered geometry, in Å. `vibrations.frequencies` is in cm⁻¹;
  `vibrations.displacement` has shape `[mode][atom][xyz]` and follows cclib's
  Cartesian `vibdisps` convention. `vibrations.intensities.IR` is optional.
- Preserve the exported frequency sign, mode order and all relative vector
  components. Mode labels are one-based **cclib export indices**, not raw ORCA
  mode numbers (cclib removes the rigid-body modes).
- Cartesian displacements are already mass-unweighted. No additional division
  by atomic masses is applied. No fictitious lattice, masses or periodic images
  are introduced for molecules.
- The small `frequency_trajectory` adapter supplies one visual sine cycle to
  MatterViz's public `TrajectoryType.frame_loader` interface. A shared scalar
  sets the maximum atomic excursion to the chosen visual amplitude in Å. This
  is a display normalization, not a physical prediction of vibration amplitude
  or time evolution. Imaginary modes are illustrated with the same visual
  cycle, not presented as stable dynamics. Frames are generated on demand;
  MatterViz owns playback, frame caching, scrubbing and rendering.
- MatterViz infers equilibrium bonds once and retains them across frames. Its
  public camera target keeps the orbit center fixed while switching modes or
  adjusting amplitude. No code accesses the component's internal DOM or runs a
  separate animation timer.
- New files start paused. Invalid imports retain the previous valid dataset.
  Incomplete arrays, nonfinite values, zero vectors and mismatched atom/mode
  counts fail with an error. Limits are 16 MiB, 2000 atoms and at most 3N modes.
- Displacement arrows start off. The toggle uses the native vector layer, with
  each per-site vector equal to the exact Cartesian shift applied to that frame.
  Arrows preserve signs and atom ratios; they are not physical forces.

## Integration and upstream compatibility

The feature is a lazily loaded panel inside the independent `banewfn_gui`
entry introduced by #73. It uses the existing Rust WebView host and reads the
selected local files with the browser File API. The same workbench host now
provides one bounded native save endpoint. There is no new service, session
format, calculation hook, process runner or packaging path. Multiwfn
core sources and the pinned BaneWfn source are unchanged; noGUI dependencies
are unchanged. Existing Multiwfn frequency calculations and spectrum plotting
continue to own their scientific behavior.

The retained MatterViz package already exports `Trajectory`; it does not
export `PhononModeExplorer`. Upstream at
[`59f6b563`](https://github.com/janosh/matterviz/blob/59f6b563527877bbc2cee66affb96a215cc8e000/src/lib/spectral/phonon-modes.ts)
still requires a real-space lattice and divides phonopy eigenvectors by
`sqrt(mass)`. Feeding molecular Cartesian data into that API would be incorrect.
This PR therefore uses the existing native trajectory renderer with a bounded
data adapter. A future MatterViz molecular-mode interface can replace that
adapter without changing the importer or application host. This is not a
claim that the upstream phonon explorer supports molecules today.

Spectrum broadening, frequency computation, new quantum-output parsers,
and CP2K/xTB import support remain outside this rendering feature.

## Verification

`pnpm test` includes the real-export data and displacement tests.
`pnpm check` validates Svelte/types. After `pnpm build`, run
`pnpm test:frequency` for the actual BaneWfn frontend and native MatterViz
renderer in Chromium. The test covers paused startup, native playback and
scrubbing, mode changes, amplitude validation, camera interaction, import
failure recovery and closing/reopening the viewer. Python is only needed to
regenerate the documented cclib fixtures.

## Camera compatibility patch

The retained renderer clears `camera_target` and `camera_zoom` on every new
structure object. A trajectory provides a new object each frame, so native
zoom was lost during playback and mode switching. The focused `r25.freq1`
backport adds upstream's `Structure.structure_series_key` contract and shares
it with `StructureViewport` to retain the native reset baseline. This viewer
passes its dataset as the key; changing files mounts a fresh scene, while
changing modes/amplitude preserves camera position, zoom and reset state.

Source design: MatterViz
[`59f6b563`, Structure.svelte](https://github.com/janosh/matterviz/blob/59f6b563527877bbc2cee66affb96a215cc8e000/src/lib/structure/Structure.svelte)
and `StructureViewport.svelte`. This is a small compatibility adaptation to
the retained renderer, not a wholesale cherry-pick of the newer session system.
Callers that omit the key retain existing behavior. A caller must use a new key
when topology changes; coordinate-only frames may share one.

Apply `vendor/patches/matterviz-0.4.2-multiwfn.d8719d12.r25.freq1.patch` with
`patch -p1` inside the extracted `r25.reps2` package. Only the two Svelte files,
their declarations and the package version change. The Python vendor replay
test verifies byte-identical contents against the new archive and checks the
complete changed-file allowlist. SHA-256 of `r25.freq1.tgz`:

```text
0f24494f31d94479a78c741958a5929cbc68efcc7af63db31f8603ecd70bf9fa
```

## Native saving and the freq2 layer

The existing MatterViz Structure and Trajectory export panes are available in
the frequency viewer. Text/JSON, PNG, GLB, OBJ+MTL and WebM keep their native
serializers and recorder. Each viewer supplies its own asynchronous byte sink;
no global browser-download override is installed. Exporting awaits the selected
lazy frame and the renderer, pauses playback, then restores the previous frame,
play/pause state and camera when the same dataset is still open. Changing the
dataset/mode/amplitude or closing interrupts an active export.

The existing workbench host accepts POST /api/viewer-export with its session
capability, same Host/Origin, one plain suggested filename, an exact allowed
Content-Type and raw bytes. The frontend cannot supply a destination path.
Only the native save dialog selects the write target. Text is bounded to
16 MiB, PNG to 32 MiB, GLB/WebM to 64 MiB; ordinary workflow requests retain
their 256 KiB limit. PNG/GLB/WebM container framing, UTF-8 text and JSON are
checked before opening a dialog. Host cancellation returns status=cancelled
and the per-view callback rejects with AbortError, never a successful save.
Write failures remain visible.

OBJ and MTL are saved sequentially, with each dialog awaited. Save both in the
same folder and retain the suggested MTL filename, which the OBJ references.
Cancelling or failing the second save explicitly reports that the OBJ was
saved but its companion was not; this is not an atomic two-file transaction.

WebM requires the current WebView to support MediaRecorder VP9. Unsupported
codecs leave recording disabled. The native sink offers WebM only, not an MP4
encoder or automatic ffmpeg conversion. A browser-only preview cannot save
through the native endpoint without its running BaneWfn host.

The traceable r25.freq2 patch is applied on the retained r25.freq1 archive.
It adds instance download/transaction callbacks, actual frame readiness and
the displacement semantic vector key. Existing freq1 archives and exact replay
tests are retained. tests/vendor-frequency.test.ts checks the exact freq2
changed-file allowlist, replayed bytes, installed package and lock integrity.

After building, test:frequency-controls exercises queue/arrows/current-frame
exports plus PNG/WebM bytes and save/cancel/error boundaries in real Chromium.
Its save endpoint is stubbed at the HTTP boundary; the Rust headless host
harness separately tests real validation, writes and distinct cancellation.
Native platform dialogs still require platform-specific acceptance.
