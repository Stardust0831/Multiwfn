"""Packaging contract tests for the standalone multiwfn-vibration launcher.

Static style follows tests/test_macos_app_bundle.py: no real bundle or frozen
binary is required. The tests assert that the MatterViz workflow freezes the
launcher with PyInstaller and packages it on all three platforms, that the
packaged smoke test exercises the frozen executable, that the no-Python
package gate cannot match the frozen executable name, that the macOS app
script and the CMake staging target carry the optional launcher hooks, and
that the docs describe the installed entry point.

The file-dialog batch queue is exercised functionally against a fake
matterviz-desktop shell script implementing the --select-file --output
contract (exit 0 + output file = selected path; exit 0 without it = cancel;
exit 2 = dialog error).
"""
from __future__ import annotations

import contextlib
import fnmatch
import http.client
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import threading
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
TOOLS_DIR = ROOT / "tools"
sys.path.insert(0, str(TOOLS_DIR))

import multiwfn_vibration_viewer as viewer  # noqa: E402
from tests.test_matterviz_vibration_viewer import (  # noqa: E402
    XTB_G98_SAMPLE,
    XTB_OUTPUT_SAMPLE,
)

FIXTURES = ROOT / "tests" / "fixtures"
WORKFLOW = (ROOT / ".github" / "workflows" / "matterviz-gui.yml").read_text(encoding="utf-8")


def workflow_step(name: str) -> str:
    """Body of one '      - name: <name>' step in the MatterViz workflow."""
    body = WORKFLOW.split(f"      - name: {name}\n", 1)[1]
    return body.split("\n      - name:", 1)[0]


class WorkflowFreezeContractTests(unittest.TestCase):
    def test_freeze_step_freezes_a_onefile_launcher(self):
        step = workflow_step("Freeze the standalone vibration launcher")
        self.assertIn("python -m pip install pyinstaller", step)
        self.assertIn("--onefile", step)
        self.assertIn("--name multiwfn-vibration", step)
        self.assertIn("tools/multiwfn_vibration_viewer.py", step)
        # Build intermediates go to dedicated directories outside package/.
        self.assertIn("--distpath vibration-launcher-dist", step)
        self.assertIn("--workpath vibration-launcher-build", step)

    def test_freeze_step_has_a_python_setup(self):
        self.assertIn("actions/setup-python@v5", WORKFLOW)
        self.assertIn("Set up Python for the vibration launcher freeze", WORKFLOW)

    def test_all_platforms_copy_the_frozen_launcher_into_resources_tools(self):
        linux = workflow_step("Package Linux preview")
        self.assertIn("cp vibration-launcher-dist/multiwfn-vibration", linux)
        self.assertIn('"package/$PKG/resources/tools/multiwfn-vibration"', linux)
        macos = workflow_step("Package macOS preview")
        self.assertIn("cp vibration-launcher-dist/multiwfn-vibration", macos)
        self.assertIn('"package/$PKG/resources/tools/multiwfn-vibration"', macos)
        windows = workflow_step("Package Windows preview")
        self.assertIn("cp vibration-launcher-dist/multiwfn-vibration.exe", windows)
        self.assertIn('"package/$PKG/resources/tools/multiwfn-vibration.exe"', windows)

    def test_macos_app_bundle_receives_the_launcher_like_the_optional_updater(self):
        macos = workflow_step("Package macOS preview")
        self.assertIn(
            'app_args+=(--vibration-launcher "package/$PKG/resources/tools/multiwfn-vibration")',
            macos,
        )

    def test_packaged_smoke_step_runs_help_and_builds_a_session(self):
        step = workflow_step("Smoke test the packaged vibration launcher")
        self.assertIn('"$launcher" --help', step)
        self.assertIn("tests/fixtures/h2o_freq_gaussian.out", step)
        self.assertIn("--no-launch --no-pick", step)
        self.assertIn("json.loads", step)
        self.assertIn("manifest.json", step)
        self.assertIn("multiwfn-matterviz-vibration", step)

    def test_verify_package_contents_checks_the_launcher(self):
        step = workflow_step("Verify package contents")
        self.assertIn('test -f "package/$PKG/resources/tools/multiwfn-vibration.exe"', step)
        self.assertIn('test -x "package/$PKG/resources/tools/multiwfn-vibration"', step)

    def test_python_gate_is_kept_and_cannot_match_the_frozen_executable(self):
        self.assertIn(
            "MatterViz package unexpectedly contains a Python runtime artifact",
            WORKFLOW,
        )
        gate_file_patterns = ("*.py", "*.pyc", "*.pyo", "requirements*.txt")
        for name in ("multiwfn-vibration", "multiwfn-vibration.exe"):
            with self.subTest(name=name):
                for pattern in gate_file_patterns:
                    self.assertFalse(fnmatch.fnmatchcase(name, pattern), pattern)
                self.assertNotEqual(name, "__pycache__")

    def test_freeze_intermediates_stay_out_of_the_package_tree(self):
        for line in WORKFLOW.splitlines():
            if "package/$PKG" not in line:
                continue
            self.assertNotIn("vibration-launcher-build", line, line)
            self.assertNotIn(".spec", line, line)

    def test_ci_runs_this_module_and_watches_it_in_pr_paths(self):
        occurrences = WORKFLOW.count("tests/test_matterviz_vibration_packaging.py")
        self.assertGreaterEqual(occurrences, 2, "PR paths list plus unittest invocation")


class MacosAppAndCmakeContractTests(unittest.TestCase):
    def test_package_script_accepts_an_optional_vibration_launcher(self):
        script = (ROOT / "tools" / "macos" / "package_macos_app.sh").read_text(encoding="utf-8")
        self.assertIn("--vibration-launcher <path>", script)
        self.assertIn('VIBRATION_LAUNCHER="$2"', script)
        self.assertIn('cp "$VIBRATION_LAUNCHER" "$RESOURCES/tools/multiwfn-vibration"', script)
        self.assertIn('chmod +x "$RESOURCES/tools/multiwfn-vibration"', script)

    def test_cmake_stages_an_optional_vibration_launcher(self):
        cmake = (ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
        self.assertIn("MULTIWFN_VIBRATION_LAUNCHER_EXECUTABLE", cmake)
        self.assertIn("copy_if_different", cmake)
        self.assertIn("/tools/multiwfn-vibration${CMAKE_EXECUTABLE_SUFFIX}", cmake)

    def test_docs_describe_the_installed_executable(self):
        for relative in (
            "docs/matterviz-vibration-protocol.md",
            "docs/matterviz-vibration-review-fixes.md",
            "docs/macos-app-packaging.md",
            "docs/release.md",
            "frontend/matterviz-viewer/README.md",
        ):
            with self.subTest(document=relative):
                self.assertIn(
                    "multiwfn-vibration",
                    (ROOT / relative).read_text(encoding="utf-8"),
                )


class FrozenLayoutTests(unittest.TestCase):
    def test_frozen_resolve_desktop_uses_the_executable_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            desktop = root / "matterviz-desktop"
            desktop.touch()
            with mock.patch.dict(os.environ, {"MULTIWFN_MATTERVIZ_WEBVIEW": ""}), \
                 mock.patch.object(viewer.sys, "frozen", True, create=True), \
                 mock.patch.object(viewer.sys, "executable", str(root / "multiwfn-vibration")):
                self.assertEqual(viewer.resolve_desktop(), desktop.resolve())

    def test_source_tree_resolve_desktop_ignores_the_frozen_branch(self):
        with mock.patch.dict(os.environ, {"MULTIWFN_MATTERVIZ_WEBVIEW": ""}), \
             mock.patch.object(viewer.sys, "frozen", False, create=True):
            resolved = viewer.resolve_desktop()
        if resolved is not None:
            self.assertEqual(resolved.name, "matterviz-desktop")

    def test_frozen_frontend_dist_resolves_beside_the_packaged_tools(self):
        with tempfile.TemporaryDirectory() as directory:
            resources = Path(directory) / "resources"
            dist = resources / "frontend" / "matterviz-viewer" / "dist"
            dist.mkdir(parents=True)
            (dist / "vibration.html").write_text("<html></html>", encoding="utf-8")
            tools = resources / "tools"
            tools.mkdir()
            with mock.patch.object(viewer.sys, "frozen", True, create=True), \
                 mock.patch.object(viewer.sys, "executable", str(tools / "multiwfn-vibration")):
                self.assertEqual(viewer.resolve_frontend_dist(), dist.resolve())


class FrontendStaticDeliveryTests(unittest.TestCase):
    """The launcher serves vibration.html and its assets from the frontend dist.

    The entry document and assets are public package content guarded only by
    the loopback Host check; /session/* and /api/* keep the bearer capability.
    """

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name).resolve()
        self.session = root / "session"
        self.export = root / "export"
        self.frontend = root / "frontend-dist"
        (self.frontend / "assets").mkdir(parents=True)
        (self.frontend / "vibration.html").write_text("<html>vibration</html>", encoding="utf-8")
        (self.frontend / "assets" / "vibration.js").write_text("console.log(1)\n", encoding="utf-8")
        (root / "secret.txt").write_text("top secret", encoding="utf-8")
        data = viewer.parse_gaussian_output(FIXTURES / "h2o_freq_gaussian.out")
        viewer.write_session(data, self.session)
        frame = viewer.encode_plot_dataset(1, data.displacements)
        handler = viewer.make_vibration_handler(self.session, {1: frame}, self.export, self.frontend)
        self.capability = handler.capability
        handler.log_message = lambda *args: None  # type: ignore[method-assign]
        self.server = viewer.bind_vibration_server("127.0.0.1", 0, handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self._stop)

    def _stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.directory.cleanup()

    def _get(self, path, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        connection.request("GET", path, headers=headers or {})
        response = connection.getresponse()
        payload = response.read()
        connection.close()
        return response, payload

    def test_entry_document_and_assets_are_served_without_the_capability(self):
        response, payload = self._get("/vibration.html")
        self.assertEqual(response.status, 200)
        self.assertIn(b"vibration", payload)
        response, payload = self._get("/")
        self.assertEqual(response.status, 200)
        self.assertIn(b"vibration", payload)
        response, payload = self._get("/assets/vibration.js")
        self.assertEqual(response.status, 200)
        self.assertIn(b"console.log", payload)

    def test_static_delivery_still_requires_the_loopback_host(self):
        response, _ = self._get("/vibration.html", {"Host": "untrusted.invalid"})
        self.assertEqual(response.status, 403)

    def test_static_delivery_is_traversal_guarded(self):
        response, _ = self._get("/../secret.txt")
        self.assertIn(response.status, (403, 404))
        response, _ = self._get("/%2e%2e/secret.txt")
        self.assertIn(response.status, (403, 404))

    def test_session_and_api_routes_keep_the_capability_gate(self):
        for path in ("/session/manifest.json", "/api/plot-data/1", "/api/return"):
            with self.subTest(path=path):
                response, _ = self._get(path)
                self.assertEqual(response.status, 403)
        response, payload = self._get(f"/session/manifest.json?cap={self.capability}")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(payload)["format"], "multiwfn-matterviz-vibration")

    def test_missing_frontend_dist_keeps_the_404(self):
        root = Path(self.directory.name)
        handler = viewer.make_vibration_handler(self.session, {}, self.export, root / "no-such-dist")
        handler.log_message = lambda *args: None  # type: ignore[method-assign]
        server = viewer.bind_vibration_server("127.0.0.1", 0, handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=10)
            connection.request("GET", "/vibration.html")
            response = connection.getresponse()
            response.read()
            connection.close()
            self.assertEqual(response.status, 404)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


def make_fake_desktop(directory: Path, selections: list[str]) -> Path:
    """Fake matterviz-desktop implementing the --select-file --output contract.

    Invocation N pops line N of selections.txt: a nonempty line is written to
    the --output file (selection); once the queue is exhausted the output file
    stays unwritten (user cancel). FAKE_DESKTOP_RC forces a nonzero exit code
    (dialog failure, e.g. no desktop session). calls.txt records the count.
    """
    queue = directory / "selections.txt"
    queue.write_text("".join(f"{item}\n" for item in selections), encoding="utf-8")
    script = directory / "matterviz-desktop"
    script.write_text(
        "#!/bin/sh\n"
        'home="$(dirname "$0")"\n'
        'calls="$home/calls.txt"\n'
        "n=0\n"
        '[ -f "$calls" ] && n=$(cat "$calls")\n'
        "n=$((n + 1))\n"
        'echo "$n" > "$calls"\n'
        'if [ "${FAKE_DESKTOP_RC:-0}" != "0" ]; then exit "${FAKE_DESKTOP_RC}"; fi\n'
        'line=$(sed -n "${n}p" "$home/selections.txt")\n'
        '[ -n "$line" ] || exit 0\n'
        'while [ $# -gt 0 ]; do\n'
        '  if [ "$1" = "--output" ]; then shift; printf "%s\\n" "$line" > "$1"; exit 0; fi\n'
        "  shift\n"
        "done\n"
        "exit 0\n",
        encoding="utf-8",
    )
    script.chmod(script.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return script


@unittest.skipIf(os.name == "nt", "the fake desktop shell is a POSIX shell script")
class FileDialogQueueTests(unittest.TestCase):
    def _run_main(self, argv, *, env_extra=None):
        env = {"MULTIWFN_MATTERVIZ_WEBVIEW": self.fake_desktop, "DISPLAY": ":99"}
        env.update(env_extra or {})
        stderr = io.StringIO()
        with mock.patch.dict(os.environ, env), contextlib.redirect_stderr(stderr):
            code = viewer.main(argv)
        return code, stderr.getvalue()

    def _calls(self, directory: Path) -> str | None:
        record = directory / "calls.txt"
        return record.read_text(encoding="utf-8").strip() if record.exists() else None

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.fake_dir = self.root / "fake-desktop"
        self.fake_dir.mkdir()

    def _prepare(self, selections):
        fake = make_fake_desktop(self.fake_dir, [str(item) for item in selections])
        self.fake_desktop = str(fake)
        return fake

    def test_pick_collects_the_queue_in_order_until_cancel(self):
        first = FIXTURES / "h2o_freq_gaussian.out"
        second = self.root / "second.out"
        second.write_text(first.read_text(encoding="utf-8"), encoding="utf-8")
        self._prepare([first, second])
        session_root = self.root / "sessions"
        code, _ = self._run_main(["--no-launch", "--session-dir", str(session_root)])
        self.assertEqual(code, 0)
        for name in ("01-h2o_freq_gaussian", "02-second"):
            manifest = json.loads((session_root / name / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["format"], "multiwfn-matterviz-vibration")
        # Two selections plus the final cancel round.
        self.assertEqual(self._calls(self.fake_dir), "3")

    def test_pick_cancel_without_selection_prints_usage_and_exits_2(self):
        self._prepare([])
        code, stderr = self._run_main(["--no-launch"])
        self.assertEqual(code, 2)
        self.assertIn("usage:", stderr)
        self.assertIn("no input files were selected", stderr)
        self.assertEqual(self._calls(self.fake_dir), "1")

    def test_pick_dialog_error_is_reported(self):
        self._prepare([])
        code, stderr = self._run_main(["--no-launch"], env_extra={"FAKE_DESKTOP_RC": "2"})
        self.assertEqual(code, 2)
        self.assertIn("file dialog failed", stderr)
        self.assertIn("desktop session", stderr)

    def test_no_pick_with_no_inputs_exits_2_without_calling_the_dialog(self):
        self._prepare([FIXTURES / "h2o_freq_gaussian.out"])
        code, stderr = self._run_main(["--no-pick"])
        self.assertEqual(code, 2)
        self.assertIn("--no-pick", stderr)
        self.assertIsNone(self._calls(self.fake_dir))

    def test_positional_inputs_never_open_the_dialog(self):
        self._prepare([FIXTURES / "h2o_freq_gaussian.out"])
        session_root = self.root / "sessions"
        code, _ = self._run_main(
            [str(FIXTURES / "h2o_freq_gaussian.out"), "--no-launch", "--session-dir", str(session_root)]
        )
        self.assertEqual(code, 0)
        self.assertIsNone(self._calls(self.fake_dir))
        self.assertTrue((session_root / "manifest.json").is_file())

    def test_pick_xtb_prompts_for_the_g98_companion(self):
        xtb_output = self.root / "xtb_vib.out"
        g98 = self.root / "g98.out"
        xtb_output.write_text(XTB_OUTPUT_SAMPLE, encoding="utf-8")
        g98.write_text(XTB_G98_SAMPLE, encoding="utf-8")
        self._prepare([xtb_output, g98])
        session_root = self.root / "sessions"
        code, _ = self._run_main(["--no-launch", "--session-dir", str(session_root)])
        self.assertEqual(code, 0)
        manifest = json.loads((session_root / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["vibrations"]["sourceProgram"], "xtb")
        # Input round, cancel round, g98 companion round.
        self.assertEqual(self._calls(self.fake_dir), "3")

    def test_pick_xtb_without_the_companion_keeps_the_g98_hint(self):
        xtb_output = self.root / "xtb_vib.out"
        xtb_output.write_text(XTB_OUTPUT_SAMPLE, encoding="utf-8")
        self._prepare([xtb_output])
        code, stderr = self._run_main(["--no-launch", "--session-dir", str(self.root / "sessions")])
        self.assertEqual(code, 2)
        self.assertIn("--g98-out", stderr)


if __name__ == "__main__":
    unittest.main()
