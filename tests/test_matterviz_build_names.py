from pathlib import Path
import ctypes
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
CMAKE = (ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
FORTRAN = (ROOT / "noGUI" / "GUI_matterviz.f90").read_text(encoding="utf-8")
SPAWN = (ROOT / "noGUI" / "matterviz_spawn.c").read_text(encoding="utf-8")
RUST_SERVICE = (ROOT / "frontend" / "matterviz-desktop" / "src" / "service.rs").read_text(
    encoding="utf-8"
)
RUST_TRANSPORT = (
    ROOT / "frontend" / "matterviz-desktop" / "src" / "transport.rs"
).read_text(encoding="utf-8")
RUST_CARGO = (ROOT / "frontend" / "matterviz-desktop" / "Cargo.toml").read_text(
    encoding="utf-8"
)
VIEWER_APP = (ROOT / "frontend" / "matterviz-viewer" / "src" / "App.svelte").read_text(
    encoding="utf-8"
)
WORKFLOW = (ROOT / ".github" / "workflows" / "matterviz-gui.yml").read_text(encoding="utf-8")
WINDOWS_ASYNC = (ROOT / "tests" / "windows" / "test_matterviz_async_launch.ps1").read_text(
    encoding="utf-8"
)
LINUX_REAL_ORBITAL = (
    ROOT / "tests" / "linux" / "test_matterviz_real_orbital.py"
).read_text(encoding="utf-8")


class MatterVizBuildNamingTests(unittest.TestCase):
    def test_cmake_exposes_a_first_class_matterviz_backend(self):
        self.assertIn("PROPERTY STRINGS dislin 3dmol matterviz", CMAKE)
        self.assertIn('set(MULTIWFN_GUI_SOURCE noGUI/GUI_matterviz.f90)', CMAKE)
        self.assertIn('set(MULTIWFN_EXECUTABLE_NAME Multiwfn_MatterVizGUI)', CMAKE)
        self.assertIn("MULTIWFN_MATTERVIZ_DESKTOP_EXECUTABLE", CMAKE)
        self.assertNotIn('set(MULTIWFN_MATTERVIZ_DEFAULT_SHELL', CMAKE)
        self.assertNotIn("MULTIWFN_WEB_FRONTEND", CMAKE)

    def test_matterviz_resource_target_stages_only_matterviz_runtime(self):
        block = CMAKE.split('set(MULTIWFN_MATTERVIZ_BUILD_RESOURCES', 1)[1]
        block = block.split("if(WIN32)", 1)[0]
        self.assertIn("MULTIWFN_MATTERVIZ_DESKTOP_EXECUTABLE", block)
        self.assertIn("frontend/matterviz-viewer/dist", block)
        self.assertNotIn("multiwfn_matterviz_server.py", block)
        self.assertNotIn("multiwfn_matterviz_file_dialog.py", block)
        self.assertNotIn("multiwfn_matterviz_webview.py", block)
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

    def test_matterviz_host_uses_structured_native_spawn_and_inherited_pipes(self):
        matterviz_sources = CMAKE.split('if(MULTIWFN_GUI_BACKEND MATCHES "^(3dmol|matterviz)$")', 1)[1]
        matterviz_sources = matterviz_sources.split("endif()", 1)[0]
        self.assertIn("noGUI/matterviz_spawn.c", matterviz_sources)
        self.assertIn("CreateProcessW", SPAWN)
        self.assertIn("execv(executable, argv)", SPAWN)
        self.assertIn("multiwfn_matterviz_spawn", SPAWN)
        self.assertIn("multiwfn_matterviz_publish_volume", SPAWN)
        self.assertIn("CreatePipe", SPAWN)
        self.assertIn("pipe2(fds, O_CLOEXEC)", SPAWN)
        self.assertIn("exec_pipe", SPAWN)
        self.assertIn("mwfn_write_all_posix", SPAWN)
        self.assertIn("mwfn_read_exact_posix_deadline", SPAWN)
        self.assertIn("CancelSynchronousIo", SPAWN)
        self.assertIn("mwfn_clear_stop_flag_posix(session_utf8)", SPAWN)
        self.assertIn("mwfn_clear_stop_flag_windows(session_utf8)", SPAWN)
        self.assertIn("SO_EXCLUSIVEADDRUSE", RUST_SERVICE)
        self.assertIn("CP_UTF8, MB_ERR_INVALID_CHARS", SPAWN)
        self.assertNotIn("CP_ACP", SPAWN)
        self.assertIn("CloseHandle(process.hThread)", SPAWN)
        self.assertIn("CloseHandle(process.hProcess)", SPAWN)
        self.assertIn("STARTF_USESTDHANDLES", SPAWN)
        self.assertIn("PROC_THREAD_ATTRIBUTE_HANDLE_LIST", SPAWN)
        self.assertIn("startup.lpAttributeList = attributes", SPAWN)
        self.assertIn("EXTENDED_STARTUPINFO_PRESENT", SPAWN)
        self.assertIn("DuplicateHandle", SPAWN)
        self.assertIn('CreateFileW(\n        L"NUL"', SPAWN)
        self.assertIn("call launch_matterviz_native", FORTRAN)
        self.assertIn("publish_matterviz_volume(reqid", FORTRAN)
        self.assertIn('"format": "mwfn-volume-v1"', FORTRAN)
        self.assertNotIn("launch_status,launch_matterviz_process", FORTRAN)
        self.assertNotIn("#ifdef _WIN32", FORTRAN)

    def test_matterviz_runtime_launches_rust_host_directly(self):
        block = FORTRAN.split("subroutine resolve_matterviz_launch_paths", 1)[1].split(
            "end subroutine", 1
        )[0]
        self.assertIn("resolve_matterviz_desktop_launcher(home,native)", block)
        launch = FORTRAN.split("subroutine launch_matterviz_native", 1)[1].split(
            "end subroutine", 1
        )[0]
        self.assertIn("multiwfn_matterviz_spawn", launch)
        self.assertNotIn("execute_command_line", launch)
        self.assertNotIn("python", launch.lower())

    def test_binary_transport_keeps_cube_as_explicit_fallback(self):
        orbital = FORTRAN.split("subroutine handle_orbital_request", 1)[1].split(
            "end subroutine", 1
        )[0]
        esp = FORTRAN.split("subroutine handle_esp_request", 1)[1].split(
            "end subroutine", 1
        )[0]
        self.assertIn("native_volume=publish_matterviz_volume", orbital)
        self.assertIn("if (native_volume) then", orbital)
        self.assertIn("call write_cube(trim(cubefile),cubmat)", orbital)
        self.assertIn("density_native=publish_matterviz_volume", esp)
        self.assertIn("potential_native=publish_matterviz_volume", esp)
        self.assertIn("if (native_pair) then", esp)
        self.assertIn("call write_cube(trim(densityfile),densitymat)", esp)
        self.assertIn("call write_cube(trim(espfile),cubmat)", esp)

    def test_pipe_transport_tests_run_on_windows_and_unix(self):
        self.assertIn('#[cfg(any(unix, windows))]\n    #[test]', RUST_TRANSPORT)
        self.assertIn("CreatePipe(&mut read, &mut write", RUST_TRANSPORT)
        self.assertIn('"Win32_Security"', RUST_CARGO)

    def test_packaged_windows_requests_a_real_native_orbital(self):
        self.assertIn("matterviz-real-orbital-Co5Cr.fch.gz", WINDOWS_ASYNC)
        self.assertIn("index=43&quality=25000", WINDOWS_ASYNC)
        self.assertIn('"mwfn-volume-v1"', WINDOWS_ASYNC)
        self.assertIn('"orbital_43_25000.cube"', WINDOWS_ASYNC)

    def test_packaged_linux_requests_a_real_native_orbital(self):
        self.assertIn("matterviz-real-orbital-Co5Cr.fch.gz", LINUX_REAL_ORBITAL)
        self.assertIn("index=43&quality=25000", LINUX_REAL_ORBITAL)
        self.assertIn('"mwfn-volume-v1"', LINUX_REAL_ORBITAL)
        self.assertIn('"orbital_43_25000.cube"', LINUX_REAL_ORBITAL)
        self.assertIn("advertised_service_base", LINUX_REAL_ORBITAL)
        self.assertIn("--force-cube-fallback", LINUX_REAL_ORBITAL)
        self.assertIn('volume_path != cube_path.name', LINUX_REAL_ORBITAL)
        self.assertIn("tests/linux/test_matterviz_real_orbital.py", WORKFLOW)
        self.assertIn("--force-cube-fallback", WORKFLOW)

    def test_matterviz_file_dialog_uses_rust_host(self):
        block = FORTRAN.split("subroutine select_file_with_dialog", 1)[1].split(
            "end subroutine", 1
        )[0]
        native_branch = block.split(
            "#ifndef MULTIWFN_LEGACY_3DMOL_BACKEND", 1
        )[1].split("#else", 1)[0]
        self.assertIn("multiwfn_matterviz_select_file", native_branch)
        self.assertNotIn("execute_command_line", native_branch)
        self.assertNotIn("python", native_branch.lower())

    def test_native_file_dialog_abi_reports_missing_executable(self):
        compiler = shutil.which("cc")
        if compiler is None:
            self.skipTest("C compiler unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            library = Path(tmp) / "libmatterviz_spawn.so"
            subprocess.run(
                [compiler, "-std=c11", "-shared", "-fPIC", str(ROOT / "noGUI" / "matterviz_spawn.c"),
                 "-o", str(library), "-lm", "-pthread"],
                check=True,
            )
            launch = ctypes.CDLL(str(library)).multiwfn_matterviz_select_file
            launch.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
            launch.restype = ctypes.c_int
            executable = Path(tmp) / "fake Rust host with spaces"
            output = Path(tmp) / "session path with spaces" / "selected_file.txt"
            output.parent.mkdir()
            executable.write_text(
                "#!/bin/sh\n"
                "[ \"$1\" = \"--select-file\" ] || exit 41\n"
                "[ \"$2\" = \"--output\" ] || exit 42\n"
                "printf '%s\\n' '/tmp/selected input.fch' > \"$3\"\n",
                encoding="ascii",
            )
            executable.chmod(0o755)
            self.assertEqual(launch(str(executable).encode(), str(output).encode()), 0)
            self.assertEqual(output.read_text(encoding="ascii"), "/tmp/selected input.fch\n")
            self.assertNotEqual(
                launch(b"/definitely/missing/matterviz-desktop", b"/tmp/path with spaces/out.txt"),
                0,
            )

    def test_frontend_propagates_the_rust_session_capability(self):
        self.assertIn("searchParams.get('cap')", VIEWER_APP)
        self.assertIn("url.searchParams.set('cap', capability)", VIEWER_APP)

    def test_managed_viewer_keeps_volume_imports_in_the_session_adapter(self):
        self.assertIn("allow_file_drop={false}", VIEWER_APP)
        self.assertIn("structure_frame_delta={structureFrameDelta}", VIEWER_APP)
        viewport = (
            ROOT
            / "frontend"
            / "matterviz-viewer"
            / "node_modules"
            / "matterviz"
            / "dist"
            / "structure"
            / "StructureViewport.svelte"
        ).read_text(encoding="utf-8")
        for camera_state in (
            "camera_position = camera_position.map",
            "camera_target = camera_target.map",
            "initial_camera_position = initial_camera_position.map",
            "initial_camera_target = initial_camera_target.map",
        ):
            self.assertIn(camera_state, viewport)

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
        self.assertIn("matterviz-desktop", WORKFLOW)
        self.assertNotIn("multiwfn_matterviz_server.py", WORKFLOW)
        self.assertNotIn("multiwfn_matterviz_webview.py", WORKFLOW)
        self.assertNotIn("multiwfn_matterviz_file_dialog.py", WORKFLOW)
        self.assertIn("MatterViz package unexpectedly contains a Python runtime artifact", WORKFLOW)
        self.assertIn("-name '*.py'", WORKFLOW)


if __name__ == "__main__":
    unittest.main()
