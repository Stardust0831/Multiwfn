"""Exercise deletion and rename against the actual CMake staging target.

The uniquely named source fixtures are removed even on failure. Only files owned
by this test are created/deleted; existing conf, recipes and results stay intact.
"""
import hashlib
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]


def check(build):
    build = build.resolve()
    cache = (build / "CMakeCache.txt").read_text()
    assert f"CMAKE_HOME_DIRECTORY:INTERNAL={ROOT.as_posix()}" in cache
    assert "MULTIWFN_WITH_WORKFLOWS:BOOL=ON" in cache
    staged = build / "resources/workflows"
    conf = ROOT / "frontend/workflows/banewfn/conf"
    scripts = ROOT / "frontend/workflows/scripts"
    name = "staging-regression-" + uuid.uuid4().hex
    removed = conf / (name + ".conf")
    old = scripts / (name + ".bw")
    renamed = scripts / (name + "-renamed.bw")
    sibling = staged / (name + ".txt")

    def stage():
        result = subprocess.run(
            ["cmake", "--build", str(build), "--target", "multiwfn_workflow_resources", "--parallel", "2"],
            capture_output=True, text=True, errors="replace", timeout=600,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        for source, target in [(conf, staged / "conf"), (scripts, staged / "scripts")]:
            def hashes(directory):
                return {path.relative_to(directory).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                        for path in directory.rglob("*") if path.is_file()}
            assert hashes(source) == hashes(target), f"Staged resources differ: {target}"
        assert sibling.read_text() == "preserve resources outside the owned subdirectories\n"

    try:
        sibling.write_text("preserve resources outside the owned subdirectories\n")
        removed.write_text("[main]\nq\n")
        old.write_text("%raw\nq\nend\n")
        stage()
        assert (staged / "conf" / removed.name).is_file()
        assert (staged / "scripts" / old.name).is_file()
        removed.unlink()
        old.rename(renamed)
        stage()
        assert not (staged / "conf" / removed.name).exists()
        assert not (staged / "scripts" / old.name).exists()
        assert (staged / "scripts" / renamed.name).is_file()
        renamed.unlink()
        stage()
        assert not (staged / "scripts" / renamed.name).exists()
    finally:
        dirty = any(path.exists() for path in (removed, old, renamed))
        for path in (removed, old, renamed):
            path.unlink(missing_ok=True)
        if dirty:
            stage()
        sibling.unlink(missing_ok=True)
    print("Workflow resource staging passed: add, delete, rename; unrelated files preserved")


if __name__ == "__main__":
    check(Path(sys.argv[1]))
