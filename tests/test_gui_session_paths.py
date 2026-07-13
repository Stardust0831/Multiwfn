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

    def test_manifest_uses_unified_matterviz_json_structure(self):
        manifest = self.source.split("subroutine write_manifest", 1)[1]
        self.assertIn('"structure": { "path": "structure.json", "format": "json" }', manifest)
        self.assertNotIn('"structure.mol2"', manifest)
        self.assertNotIn('"structure.xyz"', manifest)
        self.assertNotIn("mattervizStructure", manifest)

    def test_structure_json_writer_is_called_for_allocated_structure(self):
        self.assertIn(
            'if (allocated(a).and.ncenter>0) call write_structure_json(trim(session)//"/structure.json")',
            self.source,
        )
        writer = self.source.split("subroutine write_structure_json", 1)[1]
        self.assertIn('"sites"', writer)
        self.assertIn('"species"', writer)
        self.assertIn('"abc": [0, 0, 0]', writer)
        self.assertIn('"properties": {}', writer)
        self.assertIn('a(i)%index==0', writer)
        self.assertIn('"multiwfnGhost": true', writer)
        self.assertIn('"charge": 0', writer)
        self.assertIn('"properties": { "bonds": [', writer)
        self.assertIn("element=ind2name(a(i)%index)", writer)

    def test_structure_json_bonds_are_zero_based_and_map_aromatic_order(self):
        writer = self.source.split("subroutine write_structure_json", 1)[1]
        self.assertIn("gui_bond_atom1(ibond)-1", writer)
        self.assertIn("gui_bond_atom2(ibond)-1", writer)
        self.assertIn('"order": "aromatic"', writer)
        self.assertRegex(writer, r'"order":[ \"]+.*gui_bond_order\(ibond\)')

    def test_invalid_fchk_topology_does_not_publish_a_partial_bond_count(self):
        reader = self.source.split("subroutine read_gui_fchk_topology", 1)[1]
        reader = reader.split("integer function gui_fchk_bond_type", 1)[0]
        validation = reader.split("valid=.true.", 1)[1].split("if (.not.valid) goto 900", 1)[0]
        self.assertIn("candidate_bond_count=0", validation)
        self.assertIn("candidate_bond_count=candidate_bond_count+1", validation)
        self.assertNotIn("gui_bond_count=gui_bond_count+1", validation)
        self.assertIn("gui_bond_count=candidate_bond_count", reader)


if __name__ == "__main__":
    unittest.main()
