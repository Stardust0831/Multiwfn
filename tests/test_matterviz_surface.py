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

    def test_original_zero_argument_boundary_and_explicit_mapping_confirmation(self):
        source = (ROOT / "surfana.f90").read_bytes()
        self.assertEqual(source.count(b"call drawsurfanalysis\n"), 1)
        self.assertNotIn(b"call drawsurfanalysis(", source)
        for path in ["GUI.f90", "noGUI/GUI_empty.f90", "noGUI/GUI_matterviz.f90"]:
            text = (ROOT / path).read_text()
            self.assertIn("subroutine drawsurfanalysis\n", text)
        gui = (ROOT / "noGUI/GUI_matterviz.f90").read_text()
        initial = gui.split("subroutine drawsurfanalysis\n", 1)[1].split("end subroutine", 1)[0]
        self.assertIn("capture_surface(gui_surface,.false.,message)", initial)
        self.assertIn('"volume":null,"massDensity":null', gui)
        self.assertIn('"metadataSource":"unconfirmed"', gui)
        self.assertIn("capture_surface(gui_surface,mapped==1,message)", gui)


if __name__ == "__main__":
    unittest.main()
