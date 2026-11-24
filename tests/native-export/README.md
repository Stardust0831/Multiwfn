# Existing native package acceptance

The separate `matterviz-native-export.yml` workflow uses existing artifacts
from a successful package run. Its defaults identify PR #82 at `38f63b1`.
It verifies the source SHA and artifact SHA-256 before extraction and does
not build the application or rerun the Linux acceptance suite.

After GitHub registers the workflow, run it against the branch with
`gh workflow run matterviz-native-export.yml --ref <branch>` and optionally
set `package_run` and `package_head`. A new workflow that exists only on a
branch may initially return HTTP 404 from the dispatch API; its first pull
request run registers it. Subsequent driver-only changes can use manual
dispatch with existing package artifacts.
Use `-f platform=windows` or `-f platform=macos` to repeat only the affected
platform; the default is both.

Windows uses the runner's native UI Automation API and input desktop. It
records the session, window station, WebView2 runtime, accessibility tree
and screenshots, then clicks the packaged WebView and system Save dialog.
The four cases assert cancellation without a file, a decoded nonblank PNG,
rejection of overwrite preserving the original hash, and confirmed overwrite
replacing a sentinel. `results.json` distinguishes the stage that failed.

macOS records the unchanged app launcher's result separately, then opens the
same app's packaged host with a managed water fixture. It records the Quartz
session and AX results, checks existing Accessibility/Screen Recording/input
access without requesting it, and exercises the same four save cases through
WKWebView and NSSavePanel. An AX authorization failure is a blocked native
interaction, not a passing save test. A passing host save test does not excuse
a failed app entry; `app-launcher.json` and its log retain that separate result.

No desktop permissions, repository settings, signatures or system services
are changed. Only the workflow's normal read-only artifact access is used.
Evidence is uploaded even on failure; a blocked environment remains visible
as a non-successful platform result.
