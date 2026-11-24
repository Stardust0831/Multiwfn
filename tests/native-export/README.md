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

Windows uses the runner's native UI Automation API and input desktop. It
records the session, window station, WebView2 runtime, accessibility tree
and screenshots, then clicks the packaged WebView and system Save dialog.
The four cases assert cancellation without a file, a decoded nonblank PNG,
rejection of overwrite preserving the original hash, and confirmed overwrite
replacing a sentinel. `results.json` distinguishes the stage that failed.

macOS opens the unchanged app from the existing DMG through its packaged
launcher, records the Quartz session/window and AX results, and checks
existing Accessibility/Screen Recording/input access without requesting it.
An AX authorization failure is a blocked native interaction, not a passing
save test. If AX is available, inspect the saved tree before extending the
platform-specific interaction steps. Window existence alone proves neither
rendering nor chooser behavior.

No desktop permissions, repository settings, signatures or system services
are changed. Only the workflow's normal read-only artifact access is used.
Evidence is uploaded even on failure; a blocked environment remains visible
as a non-successful platform result.
