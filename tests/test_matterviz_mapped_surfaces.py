"""Verify that the generated GUI adapters preserve official calculation sources."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
BOUNDARIES = {
    "otherfunc.f90": (
        "call drawisosurgui(1)\n\t\tcubmat=exchangedata",
        "call draw_funcvsfunc_isosurface(1,iwork,exchangedata)\n\t\tcubmat=exchangedata",
    ),
    "visweak.f90": (
        "call drawisosurgui(1)\n\telse if (isel==5) then",
        "call draw_igm_isosurface(1,iIGMtype,itype,sl2r)\n\telse if (isel==5) then",
    ),
}


@unittest.skipUnless(shutil.which("cmake"), "CMake is required")
class MappedSurfaceAdapterTests(unittest.TestCase):
    def generate(self, work, sources):
        for name, contents in sources.items():
            # The official distribution and Windows checkouts use CRLF.
            (work / name).write_bytes(contents.replace("\n", "\r\n").encode("latin-1"))
        script = work / "generate.cmake"
        script.write_text(
            "cmake_minimum_required(VERSION 3.20)\n"
            "set(MULTIWFN_CORE_SOURCES otherfunc.f90 visweak.f90 untouched.f90)\n"
            f'include("{ROOT.as_posix()}/cmake/MatterVizMappedSurfaces.cmake")\n'
            'file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/sources.txt" "${MULTIWFN_CORE_SOURCES}")\n'
        )
        return subprocess.run(["cmake", "-P", str(script)], cwd=work, capture_output=True, text=True)

    def test_only_the_two_display_calls_change(self):
        sources = {name: (ROOT / name).read_text(encoding="latin-1") + "\n! Literal @PROJECT_NAME@ $<CONFIG> ;\n"
                   for name in BOUNDARIES}
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            result = self.generate(work, sources)
            self.assertEqual(result.returncode, 0, result.stderr)
            expected_sources = []
            for name, (before, after) in BOUNDARIES.items():
                generated = work / "matterviz-adapters" / name
                actual = generated.read_text(encoding="latin-1")
                self.assertEqual(actual.count(after), 1)
                self.assertEqual(actual.replace(after, before), sources[name])
                self.assertEqual((work / name).read_text(encoding="latin-1"), sources[name])
                expected_sources.append(generated.as_posix())
                timestamp = generated.stat().st_mtime_ns
                self.assertEqual(self.generate(work, sources).returncode, 0)
                self.assertEqual(generated.stat().st_mtime_ns, timestamp)
            self.assertEqual((work / "sources.txt").read_text().split(";"),
                             expected_sources + ["untouched.f90"])

    def test_changed_or_ambiguous_upstream_boundary_fails_configuration(self):
        sources = {name: (ROOT / name).read_text(encoding="latin-1") for name in BOUNDARIES}
        for name, (before, _) in BOUNDARIES.items():
            for duplicate in (False, True):
                with self.subTest(name=name, duplicate=duplicate), tempfile.TemporaryDirectory() as directory:
                    changed = sources[name] + "\n" + before if duplicate else sources[name].replace(before, "")
                    result = self.generate(Path(directory), {**sources, name: changed})
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("ambiguous" if duplicate else "boundary changed", result.stderr)


if __name__ == "__main__":
    unittest.main()
