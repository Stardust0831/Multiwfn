from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CMAKE = (ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
FORTRAN = (ROOT / "noGUI" / "GUI_matterviz.f90").read_text(encoding="utf-8")
SPAWN = (ROOT / "noGUI" / "matterviz_spawn.c").read_text(encoding="utf-8")
WORKFLOW = (ROOT / ".github" / "workflows" / "matterviz-gui.yml").read_text(encoding="utf-8")


class MatterVizBuildNamingTests(unittest.TestCase):
    def test_cmake_exposes_a_first_class_matterviz_backend(self):
        self.assertIn("PROPERTY STRINGS dislin 3dmol matterviz", CMAKE)
        self.assertIn('set(MULTIWFN_GUI_SOURCE noGUI/GUI_matterviz.f90)', CMAKE)
        self.assertIn('set(MULTIWFN_EXECUTABLE_NAME Multiwfn_MatterVizGUI)', CMAKE)
        self.assertIn("MULTIWFN_MATTERVIZ_DEFAULT_SHELL", CMAKE)
        self.assertNotIn("MULTIWFN_WEB_FRONTEND", CMAKE)

    def test_matterviz_resource_target_stages_only_matterviz_runtime(self):
        block = CMAKE.split('set(MULTIWFN_MATTERVIZ_BUILD_RESOURCES', 1)[1]
        block = block.split("if(WIN32)", 1)[0]
        self.assertIn("multiwfn_matterviz_server.py", block)
        self.assertIn("multiwfn_matterviz_file_dialog.py", block)
        self.assertIn("multiwfn_matterviz_webview.py", block)
        self.assertIn("frontend/matterviz-viewer/dist", block)
        self.assertNotIn("frontend/3dmol-viewer", block)
        self.assertNotIn("frontend/qt-multiwfn-gui", block)

    def test_active_adapter_contract_uses_only_matterviz_names(self):
        for obsolete in (
            "MULTIWFN_3DMOL_",
            "multiwfn_3dmol_session",
            "multiwfn_3dmol_server.py",
            "multiwfn_3dmol_file_dialog.py",
        ):
            self.assertNotIn(obsolete, FORTRAN)
        self.assertIn("MULTIWFN_MATTERVIZ_SESSION", FORTRAN)
        self.assertIn("multiwfn_matterviz_session_", FORTRAN)

    def test_windows_matterviz_host_uses_native_nonblocking_spawn(self):
        matterviz_sources = CMAKE.split('if(MULTIWFN_GUI_BACKEND MATCHES "^(3dmol|matterviz)$")', 1)[1]
        matterviz_sources = matterviz_sources.split("endif()", 1)[0]
        self.assertIn("noGUI/matterviz_spawn.c", matterviz_sources)
        self.assertIn("CreateProcessW", SPAWN)
        self.assertIn("MultiByteToWideChar(CP_ACP", SPAWN)
        self.assertNotIn("CP_UTF8", SPAWN)
        self.assertIn("CloseHandle(process.hThread)", SPAWN)
        self.assertIn("CloseHandle(process.hProcess)", SPAWN)
        self.assertIn("launch_status=launch_matterviz_process(trim(cmd))", FORTRAN)
        self.assertIn("launchcmd='\"'//trim(python)//'\" \"'//trim(tool)", FORTRAN)
        windows_launch = FORTRAN.split("#ifdef _WIN32", 1)[1].split("#else", 1)[0]
        self.assertNotIn("call execute_command_line", windows_launch)

    def test_matterviz_package_workflow_has_no_transitional_names(self):
        for obsolete in (
            "MULTIWFN_WEB_FRONTEND",
            "MULTIWFN_3DMOL_",
            "Multiwfn_3DmolGUI",
            "multiwfn_3dmol_server.py",
            "multiwfn_3dmol_file_dialog.py",
            "GUI_3dmol.f90",
        ):
            self.assertNotIn(obsolete, WORKFLOW)
        self.assertIn("MULTIWFN_GUI_BACKEND=matterviz", WORKFLOW)
        self.assertIn("Multiwfn_MatterVizGUI", WORKFLOW)


if __name__ == "__main__":
    unittest.main()
