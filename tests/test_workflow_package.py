"""Run the extracted native sidecar, module library and engine on every OS.

Only XYZ I/O is executed; density and Mayer recipes are rendered in dry-run mode.
"""
import os
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from test_workbench_cli import check as check_workbench
from test_workflow_shell import check as check_shell


def check(root):
    root = root.resolve()
    suffix = ".exe" if os.name == "nt" else ""
    runner = root / "resources/tools" / ("multiwfn-workflow" + suffix)
    engine = root / ("Multiwfn_MatterVizGUI" + suffix)
    library = root / "resources/workflows"
    check_workbench(runner)
    check_shell(runner)
    if os.name == "nt":
        subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                        str(Path(__file__).with_name("test_windows_workflow_association.ps1")),
                        "-Package", str(root)], check=True, timeout=30)
    for required in (runner, engine, library / "LICENSE", library / "NOTICE.md"):
        assert required.is_file(), f"Missing package file: {required}"
    with tempfile.TemporaryDirectory(prefix="workflow package ") as directory:
        work = Path(directory)
        startup = work / "single atom.xyz"
        startup.write_text("1\nPackage fixture\nHe 0 0 0\n", encoding="utf-8")
        (work / "banewfn.rc").write_text(
            f'Multiwfn_exec="{engine.as_posix()}"\n'
            f'confpath="{(library / "conf").as_posix()}"\n'
            'cores=1\ncitations_output=off\n', encoding="utf-8",
        )

        def run(script, *options):
            result = subprocess.run(
                [str(runner), str(script), "--wfn", str(startup), *options],
                cwd=work, stdin=subprocess.DEVNULL, capture_output=True,
                text=True, errors="replace", timeout=30,
            )
            assert result.returncode == 0, result.stdout + result.stderr

        for name in ("density.bw", "mayer.bwc"):
            run(library / "scripts" / name, "--dryrun")
        generated = "\n".join(p.read_text() for p in work.glob("*.txt"))
        assert "9\n1\ny\n0\nq" in generated, generated
        assert "5\n1\n" in generated, generated
        # Exercise every bundled recipe through the same inspection/override
        # and native-input generation interfaces used by the workbench.
        values = {"plane": "1,2,3", "state": "1", "frag1": "1", "frag2": "2",
                  "ring": "1,2,3", "cp": "1", "fragdef": "fragdef.txt"}
        for recipe in sorted((library / "scripts").rglob("*")):
            if recipe.suffix not in (".bw", ".bwc"):
                continue
            args = [str(runner), "--inspect-json", str(recipe), "--conf-dir",
                    str(library / "conf"), "--wfn", str(startup)]
            inspected = subprocess.run(args, cwd=work, capture_output=True,
                                       text=True, encoding="utf-8", timeout=15)
            assert inspected.returncode == 0, inspected.stdout + inspected.stderr
            model = json.loads(inspected.stdout)
            overrides = {field["id"]: values[field["name"]]
                         for field in model["fields"] if field["value"] == "?"}
            params = work / "library-parameters.json"
            params.write_text(json.dumps(overrides), encoding="utf-8")
            resolved = subprocess.run(args + ["--parameters-json", str(params)],
                                      cwd=work, capture_output=True, text=True,
                                      encoding="utf-8", timeout=15)
            assert resolved.returncode == 0, resolved.stdout + resolved.stderr
            assert json.loads(resolved.stdout)["runnable"], (recipe, resolved.stdout)
            run(recipe, "--dryrun", "--parameters-json", str(params))
        script = work / "export.bw"
        script.write_text("%raw\nxyz\nexported.xyz\nq\nend\n", encoding="utf-8")
        run(script)
        output = (work / "exported.xyz").read_text()
        assert output.splitlines()[0].strip() == "1", output
        assert "He" in output, output
    print(f"Workflow package passed: {root}")


if __name__ == "__main__":
    check(Path(sys.argv[1]))
