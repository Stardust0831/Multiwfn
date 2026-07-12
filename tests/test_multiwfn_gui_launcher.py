import json
from pathlib import Path
import sys
import tempfile
import unittest


TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS_DIR))

from multiwfn_gui_launcher import ProgressStreamParser


class ProgressStreamParserTests(unittest.TestCase):
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
