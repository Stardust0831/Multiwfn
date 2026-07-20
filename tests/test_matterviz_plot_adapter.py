import unittest
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CAPTURE = (ROOT / "noGUI" / "matterviz_plot_capture.f90").read_text(encoding="utf-8")
DISLIN = (ROOT / "noGUI" / "dislin_d_empty.f90").read_text(encoding="utf-8")
GUI = (ROOT / "noGUI" / "GUI_matterviz.f90").read_text(encoding="utf-8")
CMAKE = (ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
HARNESS = ROOT / "tests" / "matterviz_plot_capture_harness.f90"


class MatterVizPlotAdapterTests(unittest.TestCase):
    def test_scientific_sources_do_not_contain_matterviz_plot_hooks(self):
        for name in ("DOS.f90", "spectrum.f90", "Multiwfn.f90"):
            source = (ROOT / name).read_text(encoding="utf-8")
            self.assertNotIn("matterviz_plot_capture", source)
            self.assertNotIn("show_captured_matterviz_plot", source)

    def test_matterviz_build_uses_the_gui_capture_boundary(self):
        self.assertIn("noGUI/matterviz_plot_capture.f90", CMAKE)
        self.assertIn("MULTIWFN_MATTERVIZ_BACKEND", CMAKE)
        for hook in (
            "matterviz_capture_metafl",
            "matterviz_capture_reset",
            "matterviz_capture_name",
            "matterviz_capture_graph",
            "matterviz_capture_curve",
            "matterviz_show_captured_plot",
        ):
            self.assertIn(hook, DISLIN)
        self.assertIn("subroutine show_captured_matterviz_plot", GUI)

    def test_capture_and_control_limits_are_explicit(self):
        self.assertIn("matterviz_plot_max_series=128", CAPTURE)
        self.assertNotIn("matterviz_plot_max_values", CAPTURE)
        self.assertIn("stat=allocation_status", CAPTURE)
        self.assertIn("multiwfn-matterviz-plot", GUI)
        self.assertIn("multiwfn-matterviz-control", GUI)

    def test_line_with_markers_is_supported_and_published_as_xy(self):
        supported = GUI.split("logical function matterviz_layer_supported", 1)[1].split(
            "end function", 1
        )[0]
        publisher = GUI.split("subroutine publish_matterviz_plot_layer", 1)[1].split(
            "end subroutine", 1
        )[0]
        self.assertIn("'line+scatter'", supported)
        self.assertIn("case('line','scatter','line+scatter','symbol')", publisher)

    def test_linked_capture_boundary_behavior(self):
        compiler = shutil.which("gfortran") or shutil.which("gfortran-13")
        if compiler is None:
            self.skipTest("GNU Fortran is unavailable")
        with tempfile.TemporaryDirectory() as temp_dir:
            executable = Path(temp_dir) / "capture-harness"
            subprocess.run(
                [
                    compiler,
                    "-cpp",
                    "-DMULTIWFN_MATTERVIZ_BACKEND",
                    str(ROOT / "noGUI" / "matterviz_plot_capture.f90"),
                    str(ROOT / "noGUI" / "dislin_d_empty.f90"),
                    str(HARNESS),
                    "-o",
                    str(executable),
                ],
                check=True,
                cwd=temp_dir,
            )
            result = subprocess.run(
                [str(executable)], check=True, capture_output=True, text=True
            )
        self.assertIn("MATTERVIZ_CAPTURE_OK", result.stdout)


if __name__ == "__main__":
    unittest.main()
