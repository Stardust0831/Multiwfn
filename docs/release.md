# Release Notes

GitHub Releases are produced by the `build` workflow when a `v*` tag is pushed.
The release job waits for all three noGUI matrix builds and functional tests to
pass before publishing assets.

Current release packaging:

- `Multiwfn_noGUI-Linux.tar.gz`
- `Multiwfn_noGUI-macOS.tar.gz`
- `Multiwfn_noGUI-Windows.zip`
- `LICENSE.txt`
- `SHA256SUMS.txt`

Each platform archive includes the noGUI executable, `LICENSE.txt`, and
`settings.ini`. The Linux archive may also include a `lib/` directory
containing runtime libraries collected from `ldd`, with the executable rpath set
to load them from beside the binary. The standalone `LICENSE.txt` asset is also
uploaded so the release page exposes the original Multiwfn terms directly.

The release workflow explicitly verifies license packaging before publishing:
the standalone release license must match the source-tree `LICENSE.txt`, and
each Linux, macOS, and Windows archive must contain `LICENSE.txt`.

Windows releases are intended to be self-contained while preserving OpenMP.
The upstream Windows binary package was checked only for layout reference: it
places its executable, `settings.ini`, license, and runtime DLLs in the top
directory. This project does not copy upstream DLLs. Instead, CI links
dependencies statically where practical, then copies any remaining non-system
runtime DLLs from the MSYS2 UCRT64 toolchain beside `Multiwfn_noGUI.exe`.

The release job uploads packages that were already built and tested by the
platform matrix. It does not reconstruct platform archives from raw executables.

The release job uses the built-in `GITHUB_TOKEN` and `gh release create` on the
GitHub-hosted Ubuntu runner. Local machines only need to push an annotated tag,
for example:

```sh
git tag -a v2026.6.2-nogui.1 -m "Multiwfn 2026.6.2 noGUI cross-platform build"
git push origin v2026.6.2-nogui.1
```

The release remains noGUI-only. The original DISLIN/Motif GUI path is not part
of the CMake release build.

Windows noGUI executables embed `Multiwfn.ico` through `Multiwfn.rc`. The icon
asset follows the upstream Multiwfn visual identity and is carried with the same
source/release license obligations as the rest of this redistributed Multiwfn
package.

## Published Releases

- `v2026.6.2-nogui.2`: published by GitHub Actions run 9. The source tree
  includes `LICENSE.txt`; the release page has a standalone `LICENSE.txt`
  asset; Linux/macOS tarballs and the Windows zip also contain `LICENSE.txt`.
- `v2026.6.2-nogui.3`: published by GitHub Actions run 19. This release keeps
  OpenMP enabled where CMake finds it, packages `settings.ini`, tests the Linux
  tarball in a clean Ubuntu container, and tests the Windows zip outside the
  MSYS2 shell after collecting required MSYS2 runtime DLLs beside the
  executable. Upstream Windows package layout was used only as a reference;
  upstream DLLs were not copied.
