import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


@unittest.skipIf(os.name == "nt", "The native Windows launcher is covered by the CMake package build")
class NativeProgressLauncherTests(unittest.TestCase):
    def test_c_launcher_captures_original_progress(self):
        compiler = shutil.which("cc") or shutil.which("gcc")
        if not compiler:
            self.skipTest("No C compiler is available")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            launcher = root / "Multiwfn_QtGUI"
            backend = root / "Multiwfn_QtGUI.backend"
            subprocess.run([
                compiler,
                '-DMULTIWFN_BACKEND_BASENAME="Multiwfn_QtGUI.backend"',
                str(ROOT / "tools" / "multiwfn_progress_launcher.c"),
                "-o", str(launcher),
            ], check=True)
            backend.write_text(
                "#!/bin/sh\n"
                "printf 'MULTIWFN_GUI_PROGRESS native density 0 20\\n'\n"
                "printf 'Progress: [#####] 50.0 %%\\r'\n"
                "printf 'MULTIWFN_GUI_PROGRESS native complete 100 100\\n'\n",
                encoding="utf-8",
            )
            backend.chmod(backend.stat().st_mode | stat.S_IXUSR)
            session = root / "session"
            env = os.environ.copy()
            env["MULTIWFN_3DMOL_SESSION"] = str(session)
            completed = subprocess.run([str(launcher)], env=env, check=False)
            self.assertEqual(completed.returncode, 0)
            payload = json.loads((session / "esp_progress_native.json").read_text())
            self.assertEqual(payload["phase"], "complete")
            self.assertEqual(payload["progress"], 100)
            self.assertIn("Progress:", (session / "runtime.log").read_text())


if __name__ == "__main__":
    unittest.main()
