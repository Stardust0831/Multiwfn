import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]


@unittest.skipIf(os.name == "nt", "The native Windows launcher is covered by the CMake package build")
class NativeProgressLauncherTests(unittest.TestCase):
    def test_c_launcher_captures_original_progress(self):
        compiler = shutil.which("cc") or shutil.which("gcc")
        if not compiler:
            self.skipTest("No C compiler is available")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "launcher 空格"
            root.mkdir()
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
                "printf '%s' \"$1\" > forwarded-argument.txt\n"
                "printf 'MULTIWFN_GUI_PROGRESS native density 0 20\\n'\n"
                "printf 'Progress: [#####] 50.0 %%\\r'\n"
                "printf 'MULTIWFN_GUI_PROGRESS native complete 100 100\\n'\n",
                encoding="utf-8",
            )
            backend.chmod(backend.stat().st_mode | stat.S_IXUSR)
            session = root / "nested" / "会话" / "session"
            env = os.environ.copy()
            env["MULTIWFN_3DMOL_SESSION"] = str(session)
            env["PATH"] = f"{root}{os.pathsep}{env.get('PATH', '')}"
            completed = subprocess.run([launcher.name, "argument with spaces 轨道"], env=env, check=False, cwd=root)
            self.assertEqual(completed.returncode, 0)
            payload = json.loads((session / "esp_progress_native.json").read_text())
            self.assertEqual(payload["phase"], "complete")
            self.assertEqual(payload["progress"], 100)
            self.assertIn("Progress:", (session / "runtime.log").read_text())
            self.assertEqual((root / "forwarded-argument.txt").read_text(), "argument with spaces 轨道")

    def test_launcher_forwards_termination_to_backend_group(self):
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
            marker = root / "terminated.txt"
            backend.write_text(
                f"#!/bin/sh\ntrap 'printf terminated > \"{marker}\"; exit 0' TERM INT HUP QUIT\nwhile :; do sleep 1; done\n",
                encoding="utf-8",
            )
            backend.chmod(backend.stat().st_mode | stat.S_IXUSR)
            process = subprocess.Popen([str(launcher)], cwd=root)
            time.sleep(0.15)
            process.terminate()
            self.assertEqual(process.wait(timeout=5), 0)
            self.assertEqual(marker.read_text(), "terminated")


if __name__ == "__main__":
    unittest.main()
