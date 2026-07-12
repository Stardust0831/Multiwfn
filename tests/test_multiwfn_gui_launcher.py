import json
from pathlib import Path
import sys
import tempfile
import unittest


TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS_DIR))

from multiwfn_progress import ProgressStreamParser, packaged_backend, run_backend


class ProgressStreamParserTests(unittest.TestCase):
    def test_detects_packaged_backend_without_system_python(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            launcher = root / ("Multiwfn_QtGUI.exe" if sys.platform == "win32" else "Multiwfn_QtGUI")
            backend = root / ("Multiwfn_QtGUI.backend.exe" if sys.platform == "win32" else "Multiwfn_QtGUI.backend")
            launcher.touch()
            backend.touch()
            self.assertEqual(packaged_backend(launcher), backend.resolve())

    def test_backend_capture_creates_live_progress_json(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory)
            script = (
                "import sys;"
                "print('MULTIWFN_GUI_PROGRESS live density 0 20',flush=True);"
                "sys.stdout.write('Progress: [#####] 50.0 %\\r');sys.stdout.flush();"
                "print('MULTIWFN_GUI_PROGRESS live complete 100 100',flush=True)"
            )
            self.assertEqual(run_backend(Path(sys.executable), ["-c", script], session), 0)
            payload = json.loads((session / "esp_progress_live.json").read_text())
            self.assertEqual(payload["phase"], "complete")
            self.assertEqual(payload["progress"], 100)
            self.assertIn("Progress:", (session / "runtime.log").read_text())

    def test_maps_original_progress_to_gui_phase(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory)
            parser = ProgressStreamParser(session)
            parser.feed_record("MULTIWFN_GUI_PROGRESS abc_123 density 0 20")
            parser.feed_record(" Progress: [#################---]     50.0 % -")
            payload = json.loads((session / "esp_progress_abc_123.json").read_text())
            self.assertEqual(payload, {
                "phase": "density", "phaseProgress": 50, "progress": 10,
            })

    def test_switches_phase_and_completes(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory)
            parser = ProgressStreamParser(session)
            parser.feed_record("MULTIWFN_GUI_PROGRESS token esp 20 75")
            parser.feed_record("Progress: [################################] 80.0 %")
            payload = json.loads((session / "esp_progress_token.json").read_text())
            self.assertEqual(payload["progress"], 64)
            parser.feed_record("MULTIWFN_GUI_PROGRESS token complete 100 100")
            payload = json.loads((session / "esp_progress_token.json").read_text())
            self.assertEqual(payload["progress"], 100)
            self.assertEqual(payload["phase"], "complete")


if __name__ == "__main__":
    unittest.main()
