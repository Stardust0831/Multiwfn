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

Each platform archive includes the noGUI executable and `LICENSE.txt`. The
standalone `LICENSE.txt` asset is also uploaded so the release page exposes the
original Multiwfn terms directly.

The release workflow explicitly verifies license packaging before publishing:
the standalone release license must match the source-tree `LICENSE.txt`, and
each Linux, macOS, and Windows archive must contain `LICENSE.txt`.

Windows releases are intended to be self-contained. The CI build links GNU
Fortran runtime and BLAS/LAPACK dependencies statically where possible and
checks the generated `Multiwfn_noGUI.exe` import table before uploading the
artifact. A release must not depend on MSYS2/OpenBLAS DLLs being installed on
the user's machine.

The release job uses the built-in `GITHUB_TOKEN` and `gh release create` on the
GitHub-hosted Ubuntu runner. Local machines only need to push an annotated tag,
for example:

```sh
git tag -a v2026.6.2-nogui.1 -m "Multiwfn 2026.6.2 noGUI cross-platform build"
git push origin v2026.6.2-nogui.1
```

The release remains noGUI-only. The original DISLIN/Motif GUI path is not part
of the CMake release build.

## Published Releases

- `v2026.6.2-nogui.2`: published by GitHub Actions run 9. The source tree
  includes `LICENSE.txt`; the release page has a standalone `LICENSE.txt`
  asset; Linux/macOS tarballs and the Windows zip also contain `LICENSE.txt`.
