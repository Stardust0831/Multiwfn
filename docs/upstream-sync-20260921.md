# Official Multiwfn 2026.9.20 synchronization

The manually dispatched `track-upstream-source` run 35592135589 confirmed
2026.9.20 as the latest source release. The official download pages succeeded;
the optional directory listing returned HTTP 403. The tracking branch already
contained this snapshot at `ec4576e`.

Archive: `http://sobereva.com/multiwfn/misc/Multiwfn_2026.9.20_src_Linux.zip`.
SHA-256: `aff012903b7478041acf841528a5e3e578fe35d6f9d7bd18a391490838cc4639`.
All 74 manifest-listed files on the tracking branch match the downloaded archive
byte for byte. The merge preserves the original import commit and manifest.

The upstream change reads CP2K 2026.2 fixed-width Cube data one `(x,y)` column
at a time, including a final record shorter than six samples. It also supports
this format in `readcubetmp`, used when loading an auxiliary grid. The version
banner and a Gaussian comment were updated; other computational sources did
not change in this snapshot.

The only merge conflict was in the Cube fallback. Retain this fork's existing
`abs(ncentertmp)+6` header offset while adopting upstream's new column loop.
That offset counts atoms in the input Cube, even when menu `1000 -> 19` keeps
a different molecular structure in memory. This is the sole remaining
`fileIO.f90` difference against the official snapshot.

The noGUI regression now uses a 2×2×7 CP2K grid with adjacent negative fields
and short records. It checks all 28 samples after direct import/export,
addition of CP2K and ordinary auxiliary Cubes, and grid-only loading while
retaining a three-atom water structure. The existing geometry, ordinary Cube,
Molden-cell and trajectory fluctuation tests remain enabled. The generated
MatterViz display-boundary checks also run against the synchronized sources.

MatterViz was checked through `719bc4df6d876d290288ac9efffbcc5031356d08`
(upstream #472). Its new thermal cutaways, trajectory heatmap legends and movie
exports depend on newer rendering, data and export interfaces. They do not
supply an isolated fix needed by the current static Multiwfn workflows. Keep
the tested renderer and its previous correctness backports for this release;
the larger migration remains separate.
