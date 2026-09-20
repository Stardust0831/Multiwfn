"""Replay retained vendor extensions and verify the combined workbench package."""
import hashlib
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

VENDOR = Path(__file__).resolve().parents[1] / "frontend/matterviz-viewer/vendor"
VERSION = "matterviz-0.4.2-multiwfn.d8719d12.r25"


class TopologyVendor(unittest.TestCase):
    def test_upstream_fixes_replay_from_workbench2_without_losing_extensions(self):
        with tempfile.TemporaryDirectory(prefix="upstream-vendor-replay-") as directory:
            base, target = Path(directory) / "base", Path(directory) / "target"
            base.mkdir()
            target.mkdir()
            subprocess.run(["tar", "-xzf", str(VENDOR / (VERSION + ".workbench2.tgz")), "-C", str(base)], check=True)
            subprocess.run(["tar", "-xzf", str(VENDOR / (VERSION + ".upstream1.tgz")), "-C", str(target)], check=True)
            before = {path.relative_to(base): path.read_bytes() for path in base.rglob("*") if path.is_file()}
            with (VENDOR / "patches" / (VERSION + ".upstream1.patch")).open("rb") as patch:
                subprocess.run(["patch", "-p1", "-d", str(base / "package")], stdin=patch, check=True, capture_output=True)
            after = {path.relative_to(base): path.read_bytes() for path in base.rglob("*") if path.is_file()}
            packaged = {path.relative_to(target): path.read_bytes() for path in target.rglob("*") if path.is_file()}
            self.assertEqual(after, packaged)
            self.assertEqual(set(before), set(after))
            changed = {str(path) for path in before if before[path] != after[path]}
            self.assertEqual(changed, {
                "package/package.json",
                "package/dist/io/decompress.js", "package/dist/io/decompress.d.ts",
                "package/dist/io/is-binary.js", "package/dist/isosurface/parse.js",
                "package/dist/isosurface/sampling.js", "package/dist/isosurface/sampling.d.ts",
                "package/dist/isosurface/Isosurface.svelte",
            })

    def test_workbench_patch_replays_from_r25_to_exact_package_contents(self):
        archive = VENDOR / (VERSION + ".workbench1.tgz")
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), "52b5475da106a6faf9daabc440c327f3f9e2998fa1efda4d1ed35d046c041118")
        with tempfile.TemporaryDirectory(prefix="workbench-vendor-replay-") as directory:
            base, target = Path(directory) / "base", Path(directory) / "target"
            base.mkdir()
            target.mkdir()
            subprocess.run(["tar", "-xzf", str(VENDOR / (VERSION + ".tgz")), "-C", str(base)], check=True)
            subprocess.run(["tar", "-xzf", str(archive), "-C", str(target)], check=True)
            with (VENDOR / "patches" / (VERSION + ".workbench1.patch")).open("rb") as patch:
                subprocess.run(["patch", "-p1", "-d", str(base / "package")], stdin=patch, check=True, capture_output=True)
            files = {path.relative_to(base) for path in base.rglob("*") if path.is_file()}
            self.assertEqual(len(files), 768)
            self.assertEqual(files, {path.relative_to(target) for path in target.rglob("*") if path.is_file()})
            for path in files:
                self.assertEqual((base / path).read_bytes(), (target / path).read_bytes(), str(path))

    def test_workbench_preserves_both_reviewed_vendor_branches(self):
        def contents(suffix):
            with tarfile.open(VENDOR / (VERSION + suffix + ".tgz")) as archive:
                return {member.name: archive.extractfile(member).read()
                        for member in archive.getmembers() if member.isfile()}

        base = contents("")
        surface = contents(".surface1.picking1")
        material = contents(".material2")
        combined = contents(".workbench1")
        surface_changes = {name for name, data in surface.items() if data != base.get(name)}
        material_changes = {name for name, data in material.items() if data != base.get(name)}
        self.assertEqual(set(combined), set(surface) | set(material))
        # The material branch extends the shared palette files; all topology,
        # visibility and picking changes live in its six separate structure files.
        topology_files = surface_changes - material_changes
        self.assertEqual(len(topology_files), 6)
        for name in topology_files:
            self.assertEqual(combined[name], surface[name], name)
        for name in material_changes - {"package/package.json"}:
            self.assertEqual(combined[name], material[name], name)
        for name in set(base) - surface_changes - material_changes:
            self.assertEqual(combined[name], base[name], name)

    def test_hidden_bond_picking_patch_replays_to_exact_package_contents(self):
        archive = VENDOR / (VERSION + ".surface1.picking1.tgz")
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), "4043470e8540d54797c0f0c21f67d62ba140e4ffc55f1d8c0bbaea37380898ef")
        with tempfile.TemporaryDirectory(prefix="bond-picking-vendor-replay-") as directory:
            base, target = Path(directory) / "base", Path(directory) / "target"
            base.mkdir()
            target.mkdir()
            subprocess.run(["tar", "-xzf", str(VENDOR / (VERSION + ".surface1.tgz")), "-C", str(base)], check=True)
            subprocess.run(["tar", "-xzf", str(archive), "-C", str(target)], check=True)
            with (VENDOR / "patches" / (VERSION + ".surface1.picking1.patch")).open("rb") as patch:
                subprocess.run(["patch", "-p1", "-d", str(base / "package")], stdin=patch, check=True, capture_output=True)
            files = {path.relative_to(base) for path in base.rglob("*") if path.is_file()}
            self.assertEqual(len(files), 764)
            self.assertEqual(files, {path.relative_to(target) for path in target.rglob("*") if path.is_file()})
            for path in files:
                self.assertEqual((base / path).read_bytes(), (target / path).read_bytes(), str(path))

    def test_surface_mask_patch_replays_to_exact_package_contents(self):
        archive = VENDOR / (VERSION + ".surface1.tgz")
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), "33893d62a52936a0334dac1b580c98dcd5b39e6807afd2d5a93c03707a128a1c")
        with tempfile.TemporaryDirectory(prefix="surface-vendor-replay-") as directory:
            base, target = Path(directory) / "base", Path(directory) / "target"
            base.mkdir()
            target.mkdir()
            subprocess.run(["tar", "-xzf", str(VENDOR / (VERSION + ".topology2.tgz")), "-C", str(base)], check=True)
            subprocess.run(["tar", "-xzf", str(archive), "-C", str(target)], check=True)
            with (VENDOR / "patches" / (VERSION + ".surface1.patch")).open("rb") as patch:
                subprocess.run(["patch", "-p1", "-d", str(base / "package")], stdin=patch, check=True, capture_output=True)
            files = {path.relative_to(base) for path in base.rglob("*") if path.is_file()}
            self.assertEqual(files, {path.relative_to(target) for path in target.rglob("*") if path.is_file()})
            for path in files:
                self.assertEqual((base / path).read_bytes(), (target / path).read_bytes(), str(path))

    def test_camera_esp_patch_replays_to_exact_package_contents(self):
        archive = VENDOR / (VERSION + ".topology2.tgz")
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), "05ca32f4f7b3708422baf251d21cb759f653f03fde6505233341e1beec12c186")
        with tempfile.TemporaryDirectory(prefix="camera-esp-vendor-replay-") as directory:
            base, target = Path(directory) / "base", Path(directory) / "target"
            base.mkdir()
            target.mkdir()
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
            base.mkdir()
            target.mkdir()
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
