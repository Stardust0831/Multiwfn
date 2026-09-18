"""Numerical adapter regression, linked against the actual unmodified Multiwfn core."""
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BUILD = Path(os.environ.get("MULTIWFN_TOPOLOGY_BUILD", ROOT / "build-matterviz-gui"))


class TopologyIntegration(unittest.TestCase):
    def test_original_algorithms_and_transaction(self):
        link = BUILD / "CMakeFiles/Multiwfn_MatterVizGUI.dir/link.txt"
        if not link.is_file():
            self.skipTest("Build the MatterViz CMake target first")
        command = shlex.split(link.read_text())
        with tempfile.TemporaryDirectory(prefix="multiwfn-aim-test-") as directory:
            executable = Path(directory) / "topology-test"
            output = command.index("-o")
            command[output + 1] = str(executable)
            command = [arg for arg in command if not arg.endswith("/Multiwfn.f90.o")]
            command += ["-I", str(BUILD / "mod"), "-I", str(BUILD), "-ffree-line-length-none", str(ROOT / "tests/matterviz_topology_harness.f90")]
            result = subprocess.run(command, cwd=BUILD, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            result = subprocess.run([str(executable)], cwd=directory, capture_output=True, text=True, timeout=180)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("TOPOLOGY_HARNESS_OK", result.stdout)
            fixture = os.environ.get("MULTIWFN_TOPOLOGY_FIXTURE")
            if fixture:
                result = subprocess.run([str(executable), fixture], cwd=directory, capture_output=True, text=True, timeout=3600)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("TOPOLOGY_HARNESS_OK", result.stdout)


if __name__ == "__main__":
    unittest.main()
