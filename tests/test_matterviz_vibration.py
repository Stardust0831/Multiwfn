"""Vibration adapter regression, linked against the actual unmodified Multiwfn core."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BUILD = Path(os.environ.get("MULTIWFN_VIBRATION_BUILD", ROOT / "build-matterviz-gui"))


class VibrationIntegration(unittest.TestCase):
    def test_normal_mode_extraction_and_manifest(self):
        link = BUILD / "CMakeFiles/Multiwfn_MatterVizGUI.dir/link.txt"
        if not link.is_file():
            self.skipTest("Build the MatterViz CMake target first")
        command = shlex.split(link.read_text())
        with tempfile.TemporaryDirectory(prefix="multiwfn-vibration-test-") as directory:
            executable = Path(directory) / "vibration-test"
            output = command.index("-o")
            command[output + 1] = str(executable)
            command = [arg for arg in command if not arg.endswith("/Multiwfn.f90.o")]
            command += [
                "-I", str(BUILD / "mod"), "-I", str(BUILD),
                "-ffree-line-length-none", str(ROOT / "tests/matterviz_vibration_harness.f90"),
            ]
            result = subprocess.run(command, cwd=BUILD, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            result = subprocess.run(
                [str(executable), str(ROOT / "tests/fixtures")],
                cwd=directory, capture_output=True, text=True, timeout=180,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("VIBRATION_HARNESS_OK", result.stdout)

            manifest_path = Path(directory) / "vibration_manifest_check.json"
            manifest = json.loads(manifest_path.read_text())
            self.assertEqual(manifest["format"], "multiwfn-matterviz-vibration")
            self.assertEqual(manifest["version"], 1)
            self.assertEqual(manifest["multiwfnGui"], {"entry": "drawvibgui"})
            self.assertEqual(manifest["structure"]["path"], "structure.json")
            vibrations = manifest["vibrations"]
            self.assertEqual(vibrations["sourceProgram"], "gaussian")
            self.assertEqual(vibrations["spectrumKind"], "ir")
            self.assertEqual(vibrations["atomCount"], 3)
            self.assertEqual(vibrations["modeCount"], 3)
            self.assertEqual(vibrations["coordinateUnit"], "angstrom")
            self.assertEqual(vibrations["frequencyUnit"], "cm^-1")
            self.assertEqual(vibrations["intensityUnit"], "km/mol")
            self.assertEqual(len(vibrations["modes"]), 3)
            self.assertEqual(vibrations["modes"][0]["index"], 1)
            self.assertAlmostEqual(vibrations["modes"][0]["frequency"], 1650.0)
            self.assertAlmostEqual(vibrations["modes"][0]["intensity"], 61.5)
            displacements = vibrations["displacements"]
            self.assertEqual(displacements["datasetId"], 7)
            self.assertEqual(displacements["format"], "mwfn-plot-data-v1")
            self.assertEqual(displacements["role"], "u")
            self.assertEqual(displacements["layout"], "mode-major-atom-xyz")
            self.assertEqual(displacements["shape"], [3, 3, 3])


if __name__ == "__main__":
    unittest.main()
