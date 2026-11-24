# Molecular frequency viewing

Open **BaneWfn GUI → Vibrational modes → Open frequency file** and choose a
CJSON file exported by [cclib](https://cclib.github.io/). The viewer shows the
equilibrium geometry first. Click MatterViz's Play control to animate the
selected mode; its own controls also provide scrubbing, playback speed, camera
rotation and zoom. Negative frequencies retain their sign and are marked
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

## Integration and upstream compatibility

The feature is a lazily loaded panel inside the independent `banewfn_gui`
entry introduced by #73. It uses the existing Rust WebView host and reads the
selected local file with the browser File API. There is no new HTTP endpoint,
session format, calculation hook, process runner or packaging path. Multiwfn
core sources and the pinned BaneWfn source are unchanged; noGUI dependencies
are unchanged. Existing Multiwfn frequency calculations and spectrum plotting
continue to own their scientific behavior.

The panel passes a lazy frame source to the native MatterViz `Trajectory` component. The adapter uses molecular Cartesian displacements and preserves their relative amplitudes. Playback and frame selection use the upstream controls.

Spectrum broadening, frequency computation, new quantum-output parsers,
CP2K/xTB support and video export are outside this rendering PR.

## Verification

`pnpm test` includes the real-export data and displacement tests.
`pnpm check` validates Svelte/types. After `pnpm build`, run
`pnpm test:frequency` for the actual BaneWfn frontend and native MatterViz
renderer in Chromium. The test covers paused startup, native playback and
scrubbing, mode changes, amplitude validation, camera interaction, import
failure recovery and closing/reopening the viewer. Python is only needed to
regenerate the documented cclib fixtures.
