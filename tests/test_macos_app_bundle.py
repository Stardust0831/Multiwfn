from pathlib import Path
import os
import plistlib
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOLS_MACOS = ROOT / "tools" / "macos"


class MacOSAppBundleTests(unittest.TestCase):
    def test_workflow_arguments_with_and_without_preview_updater(self):
        workflow = (ROOT / ".github/workflows/matterviz-gui.yml").read_text()
        macos = workflow.split("      - name: Package macOS preview\n", 1)[1]
        # Execute the real argument assembly, stubbing only the final invocation.
        # /bin/bash is Apple's Bash 3.2 in the native macOS CI job; its nounset
        # behavior differs from modern Bash when expanding an empty array.
        after_archive = macos.split('          tar -czf ', 1)[1].split("\n", 1)[1]
        code = textwrap.dedent(after_archive.split("          expected_version=", 1)[0])
        capture = 'bash() { printf "%s\\0" "$@" > "$MACOS_TEST_ARGS"; }\n'
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            package = "package with spaces"
            updater = Path("package") / package / "resources/tools/multiwfn-matterviz-updater"
            output = work / "arguments.bin"
            formal = None
            for with_updater in (False, True):
                with self.subTest(with_updater=with_updater):
                    if with_updater:
                        (work / updater).parent.mkdir(parents=True)
                        (work / updater).touch()
                    result = subprocess.run(
                        ["/bin/bash", "-euo", "pipefail", "-c", capture + code], cwd=work,
                        env={**os.environ, "PKG": package, "MACOS_TEST_ARGS": str(output)},
                        capture_output=True, text=True,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    args = output.read_bytes().decode().split("\0")[:-1]
                    self.assertEqual(args[0], "tools/macos/package_macos_app.sh")
                    self.assertIn(f"package/{package}/Multiwfn_MatterVizGUI", args)
                    self.assertIn("--create-dmg", args)
                    self.assertNotIn("", args)
                    if with_updater:
                        self.assertEqual(args, formal + ["--updater", updater.as_posix()])
                    else:
                        self.assertNotIn("--updater", args)
                        formal = args

    def test_info_plist_template_is_valid_and_contains_document_types(self):
        plist_path = TOOLS_MACOS / "Info.plist.in"
        self.assertTrue(plist_path.exists(), "Info.plist.in should exist")

        content = plist_path.read_text(encoding="utf-8")
        rendered = content.replace("@MULTIWFN_VERSION@", "2026.9.13")
        plist = plistlib.loads(rendered.encode("utf-8"))

        self.assertEqual(plist.get("CFBundleExecutable"), "Multiwfn")
        self.assertEqual(plist.get("CFBundleIdentifier"), "com.keinsci.multiwfn")
        self.assertEqual(plist.get("CFBundleIconFile"), "Multiwfn")
        self.assertEqual(plist.get("CFBundlePackageType"), "APPL")
        self.assertTrue(plist.get("NSHighResolutionCapable"))

        doc_types = plist.get("CFBundleDocumentTypes", [])
        self.assertGreater(len(doc_types), 0)

        all_extensions = set()
        for doc in doc_types:
            for ext in doc.get("CFBundleTypeExtensions", []):
                all_extensions.add(ext.lower())

        required_extensions = {
            "xyz", "fchk", "fch", "out", "log", "cub", "cube",
            "molden", "mol", "gbw", "wfn", "wfx", "cif", "pdb",
            "gjf", "com", "cp2k", "inp", "mwfn"
        }
        for ext in required_extensions:
            self.assertIn(ext, all_extensions, f"File extension '{ext}' must be registered")

    def test_launcher_script_contracts(self):
        launcher = TOOLS_MACOS / "multiwfn_macos_launcher.sh"
        self.assertTrue(launcher.exists())
        self.assertTrue(launcher.stat().st_mode & 0o111, "Launcher must be executable")

        res = subprocess.run(["bash", "-n", str(launcher)], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, f"Syntax error in launcher: {res.stderr}")

        content = launcher.read_text(encoding="utf-8")
        self.assertIn("set -euo pipefail", content)
        self.assertIn('printf "0\\n"', content, "Launcher must pipe option 0 for direct GUI entry")
        self.assertIn("${MULTIWFN_DIRECT_GUI:-0}", content, "Must respect MULTIWFN_DIRECT_GUI flag")
        self.assertIn("MULTIWFN_MATTERVIZ_HOME", content)
        self.assertIn("DYLD_LIBRARY_PATH", content)

    def test_install_and_dequarantine_command_contracts(self):
        cmd = TOOLS_MACOS / "Install_Multiwfn.command"
        self.assertTrue(cmd.exists())
        self.assertTrue(cmd.stat().st_mode & 0o111, "Command script must be executable")

        res = subprocess.run(["bash", "-n", str(cmd)], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, f"Syntax error in command script: {res.stderr}")

        content = cmd.read_text(encoding="utf-8")
        self.assertIn("/Applications/Multiwfn.app", content)
        self.assertIn("xattr -cr", content, "Installer must strip quarantine at install time")
        self.assertIn("codesign", content)

    def test_package_script_contracts(self):
        pkg_script = TOOLS_MACOS / "package_macos_app.sh"
        self.assertTrue(pkg_script.exists())
        self.assertTrue(pkg_script.stat().st_mode & 0o111, "Package script must be executable")

        res = subprocess.run(["bash", "-n", str(pkg_script)], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, f"Syntax error in package script: {res.stderr}")

        content = pkg_script.read_text(encoding="utf-8")
        self.assertIn("@executable_path/../Resources/lib", content)
        self.assertIn("install_name_tool -change", content, "Must rewrite library install names when staging pre-bundled libraries")
        self.assertIn("mktemp -t multiwfn-app-rpaths", content, "Must avoid hardcoded /tmp files")
        self.assertIn("no dynamic libraries were staged into", content, "Must fail closed if fallback lib directory is empty")
        self.assertIn("codesign --force --deep -s -", content)
        self.assertIn("hdiutil create", content)
        self.assertIn("Install_Multiwfn.command", content)

    def test_icon_generator_and_icns_file(self):
        icon_script = TOOLS_MACOS / "build_macos_icon.sh"
        self.assertTrue(icon_script.exists())
        self.assertTrue(icon_script.stat().st_mode & 0o111)

        icns_path = TOOLS_MACOS / "Multiwfn.icns"
        self.assertTrue(icns_path.exists(), "Multiwfn.icns should exist")
        self.assertGreater(icns_path.stat().st_size, 100000)

        with open(icns_path, "rb") as f:
            magic = f.read(4)
        self.assertEqual(magic, b"icns", "File must have Apple ICNS magic header")

    def test_cocoa_launcher_contract(self):
        launcher_src = TOOLS_MACOS / "launcher.m"
        self.assertTrue(launcher_src.exists(), "launcher.m must exist")

        content = launcher_src.read_text(encoding="utf-8")
        self.assertIn("openFiles:(NSArray<NSString *> *)", content, "Must handle LaunchServices openFiles event")
        self.assertIn("openFile:(NSString *)", content, "Must handle single openFile event")
        self.assertIn("NSOpenPanel", content, "Must fallback to native Cocoa open dialog")
        self.assertIn("MULTIWFN_DIRECT_GUI", content)
        self.assertIn("multiwfn_macos_launcher.sh", content)


if __name__ == "__main__":
    unittest.main()
