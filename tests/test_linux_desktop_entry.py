"""Exercise the built launcher and a real GIO desktop-entry launch after relocation."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(sys.platform.startswith("linux"), "Linux application entry")
class LinuxDesktopEntryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.work = Path(self.temporary.name)
        self.app = self.work / 'Multiwfn 中文 space $dollar `tick` "quote" %percent \\slash'
        self.app.mkdir()
        binary = Path(os.environ.get("MULTIWFN_TEST_LINUX_LAUNCHER", ROOT / "build/banewfn_gui"))
        self.assertTrue(binary.is_file(), f"Build the Linux banewfn_gui target first: {binary}")
        shutil.copy2(binary, self.app / "banewfn_gui")
        for source in [ROOT / "tools/run-workflows-gui", ROOT / "tools/linux/install-desktop-entry.sh"]:
            target = self.app / source.name
            shutil.copy2(source, target)
            target.chmod(0o755)
        tools = self.app / "resources/tools"
        tools.mkdir(parents=True)
        shutil.copy2(ROOT / "frontend/workflows/icons/banewfn.png", self.app / "resources/banewfn.png")
        shutil.copy2(ROOT / "tools/linux/banewfn-mime.xml", self.app / "resources/banewfn-mime.xml")
        host = tools / "matterviz-desktop"
        host.write_text('#!/bin/sh\nprintf "%s\\0" "$@" > "$MULTIWFN_TEST_CAPTURE"\nexit 17\n')
        host.chmod(0o755)
        self.capture = self.work / "arguments.bin"
        self.env = dict(os.environ, MULTIWFN_TEST_CAPTURE=str(self.capture),
                        XDG_DATA_HOME=str(self.work / "user data"))

    def arguments(self):
        return self.capture.read_bytes().decode().split("\0")[:-1]

    def test_relocated_symlink_arguments_and_exit_code(self):
        link = self.work / "application-link"
        link.symlink_to(self.app / "banewfn_gui")
        for args in [[], ['启动 文件 $a `b` "c" %.xyz']]:
            result = subprocess.run([str(link), *args], cwd=self.work, env=self.env, capture_output=True)
            self.assertEqual(result.returncode, 17, result.stderr)
            self.assertEqual(self.arguments(), ["--workbench", *args])

    @unittest.skipUnless(shutil.which("gio"), "GIO desktop launcher required")
    def test_installed_icon_launches_exact_startup_file(self):
        result = subprocess.run([str(self.app / "install-desktop-entry.sh")], env=self.env,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        entry = Path(self.env["XDG_DATA_HOME"]) / "applications/BaneWfn.desktop"
        self.assertTrue(entry.is_file())
        startup = self.work / '启动 文件 $a `b` "c" %.xyz'
        startup.write_text("fixture")
        for args in [[], [str(startup)]]:
            self.capture.unlink(missing_ok=True)
            result = subprocess.run(["gio", "launch", str(entry), *args], env=self.env,
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            deadline = time.monotonic() + 5
            while not self.capture.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertEqual(self.arguments(), ["--workbench", *args])

    @unittest.skipUnless(shutil.which("gio"), "GIO desktop launcher required")
    def test_banewfn_gui_entry_and_icon_do_not_shadow_cli(self):
        startup = self.work / "苯 file.fch"
        startup.write_text("fixture")
        result = subprocess.run([str(self.app / "banewfn_gui"), str(startup)], env=self.env,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertEqual(self.arguments(), ["--workbench", str(startup)])
        subprocess.run([str(self.app / "install-desktop-entry.sh")], env=self.env, check=True, capture_output=True)
        entry = Path(self.env["XDG_DATA_HOME"]) / "applications/BaneWfn.desktop"
        self.assertIn("banewfn_gui", entry.read_text())
        self.assertIn("/resources/banewfn.png", entry.read_text())
        self.capture.unlink()
        result = subprocess.run(["gio", "launch", str(entry), str(startup)], env=self.env, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        deadline = time.monotonic() + 5
        while not self.capture.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertEqual(self.arguments(), ["--workbench", str(startup)])
        self.assertFalse((self.app / "banewfn").exists())
        self.assertFalse((self.app / "Multiwfn").exists())

    def test_incomplete_package_reports_failure(self):
        (self.app / "run-workflows-gui").unlink()
        result = subprocess.run([str(self.app / "banewfn_gui")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("cannot start", result.stderr)
        result = subprocess.run([str(self.app / "install-desktop-entry.sh")], env=self.env,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertFalse((Path(self.env["XDG_DATA_HOME"]) / "applications/BaneWfn.desktop").exists())


if __name__ == "__main__":
    unittest.main()
