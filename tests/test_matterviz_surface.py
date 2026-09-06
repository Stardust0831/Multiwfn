"""Read-only surface adapter, linked against the actual Multiwfn types."""
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BUILD = Path(os.environ.get("MULTIWFN_TOPOLOGY_BUILD", ROOT / "build-matterviz-gui"))


class SurfaceIntegration(unittest.TestCase):
    def test_surface_snapshot(self):
        link = BUILD / "CMakeFiles/Multiwfn_MatterVizGUI.dir/link.txt"
        if not link.is_file():
            self.skipTest("Build the MatterViz CMake target first")
        command = shlex.split(link.read_text())
        with tempfile.TemporaryDirectory(prefix="multiwfn-surface-test-") as directory:
            executable = Path(directory) / "surface-test"
            command[command.index("-o") + 1] = str(executable)
            command = [arg for arg in command if not arg.endswith("/Multiwfn.f90.o")]
            command += ["-I", str(BUILD / "mod"), "-I", str(BUILD), "-ffree-line-length-none", str(ROOT / "tests/matterviz_surface_harness.f90")]
            result = subprocess.run(command, cwd=BUILD, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            result = subprocess.run([str(executable)], cwd=directory, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("SURFACE_HARNESS_OK", result.stdout)

    def test_core_bridge_only_adds_read_only_arguments(self):
        source = (ROOT / "surfana.f90").read_bytes()
        self.assertEqual(source.count(b"call drawsurfanalysis(isurftype,imapfunc,iskipmapfunc,totvol)"), 1)
        for path in ["GUI.f90", "noGUI/GUI_empty.f90", "noGUI/GUI_matterviz.f90"]:
            text = (ROOT / path).read_text()
            self.assertIn("subroutine drawsurfanalysis(surface_type,mapped_function,skip_mapping,surface_volume)", text)
            self.assertIn("integer,intent(in),optional :: surface_type,mapped_function,skip_mapping", text)


if __name__ == "__main__":
    unittest.main()
