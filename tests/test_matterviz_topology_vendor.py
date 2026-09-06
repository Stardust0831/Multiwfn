"""Replay the narrow topology extension against the retained, unchanged r25 package."""
import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest

VENDOR = Path(__file__).resolve().parents[1] / "frontend/matterviz-viewer/vendor"
VERSION = "matterviz-0.4.2-multiwfn.d8719d12.r25"


class TopologyVendor(unittest.TestCase):
    def test_camera_esp_patch_replays_to_exact_package_contents(self):
        archive = VENDOR / (VERSION + ".topology2.tgz")
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), "05ca32f4f7b3708422baf251d21cb759f653f03fde6505233341e1beec12c186")
        with tempfile.TemporaryDirectory(prefix="camera-esp-vendor-replay-") as directory:
            base, target = Path(directory) / "base", Path(directory) / "target"
            base.mkdir(); target.mkdir()
            subprocess.run(["tar", "-xzf", str(VENDOR / (VERSION + ".topology1.tgz")), "-C", str(base)], check=True)
            subprocess.run(["tar", "-xzf", str(archive), "-C", str(target)], check=True)
            with (VENDOR / "patches" / (VERSION + ".topology2.patch")).open("rb") as patch:
                subprocess.run(["patch", "-p1", "-d", str(base / "package")], stdin=patch, check=True, capture_output=True)
            files = {path.relative_to(base) for path in base.rglob("*") if path.is_file()}
            self.assertEqual(files, {path.relative_to(target) for path in target.rglob("*") if path.is_file()})
            for path in files:
                self.assertEqual((base / path).read_bytes(), (target / path).read_bytes(), str(path))

    def test_patch_replays_to_exact_package_contents(self):
        archive = VENDOR / (VERSION + ".topology1.tgz")
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), "62111bf2085538beec5652f7d3c28d0193409525743969adbc935151e18cbb52")
        with tempfile.TemporaryDirectory(prefix="topology-vendor-replay-") as directory:
            base, target = Path(directory) / "base", Path(directory) / "target"
            base.mkdir(); target.mkdir()
            subprocess.run(["tar", "-xzf", str(VENDOR / (VERSION + ".tgz")), "-C", str(base)], check=True)
            subprocess.run(["tar", "-xzf", str(archive), "-C", str(target)], check=True)
            with (VENDOR / "patches" / (VERSION + ".topology1.patch")).open("rb") as patch:
                subprocess.run(["patch", "-p1", "-d", str(base / "package")], stdin=patch, check=True, capture_output=True)
            files = {path.relative_to(base) for path in base.rglob("*") if path.is_file()}
            self.assertEqual(files, {path.relative_to(target) for path in target.rglob("*") if path.is_file()})
            for path in files:
                self.assertEqual((base / path).read_bytes(), (target / path).read_bytes(), str(path))


if __name__ == "__main__":
    unittest.main()
