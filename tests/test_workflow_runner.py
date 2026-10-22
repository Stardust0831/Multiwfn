"""Exercise the vendored C++ DSL against a mock engine; no chemistry runs here."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNNER = Path(os.environ.get("MULTIWFN_TEST_WORKFLOW_RUNNER", ROOT / "build/workflow-runner/multiwfn-workflow"))


@unittest.skipUnless(RUNNER.is_file() and os.name == "posix", "build the workflow runner on POSIX first")
class WorkflowRunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="multiwfn-workflow-")
        self.addCleanup(self.temp.cleanup)
        self.case = Path(self.temp.name)
        self.engine = self.case / "Mock Multiwfn '#; engine"
        self.engine.write_text(
            "#!/usr/bin/env python3\n"
            "import json, pathlib, sys\n"
            "pathlib.Path('engine.json').write_text(json.dumps({'args':sys.argv[1:],'stdin':sys.stdin.read()}))\n"
            "print('Native analysis result: 42')\n"
            "pathlib.Path('native-result.txt').write_text('42\\n')\n"
            "sys.exit(7 if pathlib.Path('fail-engine').exists() else 0)\n"
        )
        self.engine.chmod(0o755)
        self.wfn = self.case / "Input molecule '#; file.fchk"
        self.wfn.write_text("mock wavefunction\n")
        conf = ROOT / "frontend/workflows/banewfn/conf"
        (self.case / "banewfn.rc").write_text(
            f'Multiwfn_exec="{self.engine}"\nconfpath="{conf}"\ncores=1\ncitations_output=off\n'
        )

    def run_script(self, source, *options, extension="bw"):
        script = self.case / f"analysis script.{extension}"
        script.write_text(source)
        return subprocess.run(
            [str(RUNNER), str(script), "--batch", "--wfn", str(self.wfn), "--cores", "2", *options],
            cwd=self.case, stdin=subprocess.DEVNULL, text=True, capture_output=True, timeout=10,
        )

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_raw_preserves_stdin_and_quotes_selected_paths(self):
        result = self.run_script("%raw\n100\n0\nq\nend\n")
        self.assert_success(result)
        payload = json.loads((self.case / "engine.json").read_text())
        self.assertEqual(payload["args"], [str(self.wfn), "-nt", "2", "-silent"])
        self.assertEqual(payload["stdin"], "100\n0\nq\n")
        self.assertEqual(len(list(self.case.glob("raw_*.out"))), 1)

    def test_bw_uses_original_module_library_and_variable_override(self):
        script = (ROOT / "frontend/workflows/scripts/density.bw").read_text()
        self.assert_success(self.run_script(script, "--var", "grid=2"))
        commands = json.loads((self.case / "engine.json").read_text())["stdin"]
        self.assertEqual(commands.splitlines(), ["5", "1", "2", "2", "0", "5", "-10", "q"])

    def test_bwc_runs_with_inline_conf(self):
        script = (ROOT / "frontend/workflows/scripts/mayer.bwc").read_text()
        self.assert_success(self.run_script(script, extension="bwc"))
        self.assertEqual(json.loads((self.case / "engine.json").read_text())["stdin"].splitlines(), ["9", "1", "y", "0", "q"])

    def test_preflight_generates_input_without_engine_or_command_execution(self):
        result = self.run_script("%raw\n100\nq\nend\n%command\nprintf executed > command-marker\nend\n", "--dryrun")
        self.assert_success(result)
        self.assertFalse((self.case / "engine.json").exists())
        self.assertFalse((self.case / "command-marker").exists())
        self.assertTrue(list(self.case.glob("raw_*.txt")))

    def test_nonzero_engine_exit_stops_postprocessing(self):
        (self.case / "fail-engine").touch()
        result = self.run_script("%raw\nq\n%command\nprintf executed > command-marker\nend\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.case / "command-marker").exists())

    def test_required_grep_reads_engine_log_before_command(self):
        result = self.run_script('%raw\nq\n%grep\nmatch "Native analysis result" -> selected.txt\n%command\ncat selected.txt > processed.txt\nend\n')
        self.assert_success(result)
        self.assertEqual((self.case / "processed.txt").read_text().strip(), "Native analysis result: 42")

    def test_required_grep_failure_stops_command(self):
        result = self.run_script('%raw\nq\n%grep\nmatch "Missing result" -> selected.txt\n%command\nprintf executed > command-marker\nend\n')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.case / "command-marker").exists())

    def test_standalone_command_needs_no_wavefunction(self):
        (self.case / "standalone.bw").write_text("%command\nprintf done > command-marker\nend\n")
        result = subprocess.run([str(RUNNER), "standalone.bw"], cwd=self.case, stdin=subprocess.DEVNULL, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.case / "command-marker").read_text(), "done")

    def test_wait_and_debug_are_rejected_before_engine_starts(self):
        for source in ("%raw\nq\nwait\n", "debug=true\n%raw\nq\nend\n"):
            result = self.run_script(source)
            self.assertEqual(result.returncode, 2)
            self.assertIn("terminal", result.stderr)
            self.assertFalse((self.case / "engine.json").exists())


if __name__ == "__main__":
    unittest.main()
