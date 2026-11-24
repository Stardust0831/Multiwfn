# Native package acceptance

The macOS package job in `matterviz-gui.yml` mounts its newly built DMG read-only
and tests the extracted, signature-verified app. It records the PR head, actual
checkout SHA, DMG hash and packaged launcher/core/host hashes. Cocoa source and
shell-launcher source hashes are included; the packaged shell must match source.

The Swift driver opens the real app through LaunchServices, first without a
file (and selects a document in NSOpenPanel), then with a different document.
It checks the exact loaded path in core output and compares species and all
coordinates in the real host's session against the requested input. These
integration checks exercise the actual core/host protocol rather than a stub.
It then clicks the app's WebView and NSSavePanel for four export cases, checks
Return/process termination, and verifies direct-GUI and ordinary CLI entries.
There is no fallback that starts a host with a fabricated session.

The separate `matterviz-native-export.yml` workflow can repeat acceptance of
existing packages without rebuilding or running Linux tests:

```sh
gh workflow run matterviz-native-export.yml --ref <branch> \
  -f package_run=<successful-package-run> -f package_head=<source-sha> \
  -f platform=macos
```

Set `platform=windows` or `both` when needed. The source run and artifact SHA-256
are checked before extraction. A macOS run whose only failure is the app UI
step can also supply its DMG when all packaging checks and other jobs passed;
provenance retains the original failed result. This permits correcting a UI
driver against the same verified package. There is no automatic PR run against a stale
package; current macOS app entry regression runs in the package job itself.
The historical `38f63b1` host-only acceptance artifacts remain valid evidence
for that older package, including its failed app launcher.

Windows uses native UIAutomation and the runner's input desktop. macOS uses
AX/CGEvent and the existing login session. Both retain session information,
screenshots, accessibility trees, decoded PNG dimensions and file hashes.
The LaunchServices test removes CI/SSH markers only from its launch environment
to exercise the normal Cocoa desktop route. Ordinary CLI tests retain those
markers and verify the intentionally supported CLI routing.
The four export cases assert cancellation without a file, a nonblank PNG,
refused overwrite preserving the original bytes, and confirmed overwrite
replacing a sentinel. `results.json` identifies the failed stage.

No desktop permissions, repository settings or system services are changed.
The existing-package workflow does not alter signatures. Evidence is retained
even on failure; missing desktop authorization is a failed/blocked result.
