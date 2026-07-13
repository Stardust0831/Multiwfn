from pathlib import Path
import re
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "noGUI" / "GUI_3dmol.f90"


class GuiSessionPathSourceTests(unittest.TestCase):
    """Static guardrails for the Fortran session-directory adapter.

    The full GUI executable is not part of the normal Python test job.  These
    checks keep the atomic-create and failure-path contract visible whenever
    the adapter is edited.
    """

    @classmethod
    def setUpClass(cls):
        cls.source = SOURCE.read_text(encoding="utf-8")

    def test_explicit_override_is_created_without_default_fallback(self):
        self.assertRegex(
            self.source,
            r'get_environment_variable\("MULTIWFN_3DMOL_SESSION",requested,status=istat\)',
        )
        self.assertIn("call ensure_dir(trim(session),ok)", self.source)
        self.assertIn("call create_default_session_dir(session,ok)", self.source)
        self.assertNotIn('session="multiwfn_3dmol_session"', self.source)

    def test_default_creation_retries_atomic_mkdir_collisions(self):
        self.assertIn("do attempt=0,99", self.source)
        self.assertIn("call mkdir_path(trim(candidate),istat)", self.source)
        self.assertIn("inquire(file=trim(candidate),exist=alive)", self.source)
        self.assertIn("if (istat==0.and.alive)", self.source)
        self.assertIn("multiwfn_3dmol_session_", self.source)
        self.assertIn("clock_count,gui_session_serial,attempt", self.source)

    def test_failure_aborts_before_launch(self):
        self.assertIn("call get_session_dir(session,session_ok)", self.source)
        self.assertIn("if (.not.session_ok) return", self.source)
        self.assertIn("no shared fallback session will be used", self.source)

    def test_session_path_rejects_shell_metacharacters(self):
        safety = self.source.split("logical function session_path_is_safe", 1)[1]
        safety = safety.split("subroutine mkdir_path", 1)[0]
        codes = re.search(r"case\(([0-9, ]+)\)", safety).group(1).split(",")
        shell_codes = {33, 34, 36, 37, 94, 96}
        self.assertTrue(shell_codes.issubset({int(code) for code in codes}))


if __name__ == "__main__":
    unittest.main()
