"""Compare packaged density, Mayer and ESP workflows with independent stdin.

Uses the real two-atom RHF/def2-TZVP example wavefunction. The reference commands
are written out here, not read from the workflow's generated input. No GUI or
electronic structure optimization is needed. All runs use the same engine/core.
"""
import array
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

FIXTURE = Path(__file__).parent / "fixtures/workflow-h2.fch"


def read_cube(path):
    lines = path.read_text().splitlines()
    atoms = int(lines[2].split()[0])
    assert atoms > 0
    dimensions = [int(lines[index].split()[0]) for index in (3, 4, 5)]
    assert all(size > 1 for size in dimensions)
    header = [[float(value) for value in line.split()] for line in lines[2:6 + atoms]]
    samples = array.array("d", (float(value.replace("D", "E"))
                               for line in lines[6 + atoms:] for value in line.split()))
    assert len(samples) == math.prod(dimensions), (path, len(samples), dimensions)
    assert all(math.isfinite(value) for value in samples), path
    return header, samples


def compare_cube(actual, reference):
    header, samples = read_cube(actual)
    expected_header, expected = read_cube(reference)
    assert header == expected_header, f"Cube geometry differs: {actual}: {header} != {expected_header}"
    assert len(samples) == len(expected)
    assert any(value != 0 for value in samples)
    for index, (value, target) in enumerate(zip(samples, expected)):
        assert math.isclose(value, target, rel_tol=1e-8, abs_tol=1e-12), (actual, index, value, target)
    return samples


def check(root):
    root = root.resolve()
    suffix = ".exe" if os.name == "nt" else ""
    runner = root / "resources/tools" / ("multiwfn-workflow" + suffix)
    engine = root / ("Multiwfn_MatterVizGUI" + suffix)
    library = root / "resources/workflows"
    # Independent menu transcripts cover native density export, the Mayer
    # matrix, and the bundled ESP recipe's own 627.51 kcal/mol conversion.
    cases = [
        ("density", "density.bw", "5\n1\n1\n2\n0\n5\n-10\nq\n"),
        ("mayer", "mayer.bwc", "9\n1\ny\n0\nq\n"),
        ("esp", "ESP/ESP_vcube.bwc", "5\n1\n1\n2\n0\n5\n12\n1\n2\n0\nr\ntotesp.cub\n13\n11\n5\n627.51\n0\ntotesp.cub\n-1\n5\n-10\nq\n"),
    ]
    with tempfile.TemporaryDirectory(prefix="workflow science ") as directory:
        work = Path(directory)
        startup = work / "H2.fch"
        shutil.copyfile(FIXTURE, startup)
        digest = hashlib.sha256(startup.read_bytes()).hexdigest()
        env = dict(os.environ, OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1", OMP_THREAD_LIMIT="1")
        for name, recipe, commands in cases:
            actual, direct = work / name, work / (name + "-stdin")
            for folder in (actual, direct):
                folder.mkdir()
                if (root / "settings.ini").is_file():
                    shutil.copyfile(root / "settings.ini", folder / "settings.ini")
            (actual / "banewfn.rc").write_text(
                f'Multiwfn_exec="{engine.as_posix()}"\nconfpath="{(library / "conf").as_posix()}"\n'
                'cores=1\ncitations_output=off\n', encoding="utf-8")
            overrides = []
            if name == "esp":
                # Inline conf defaults are per-step GUI fields. Override both
                # to the same low grid so the pair is directly renderable.
                parameters = actual / "parameters.json"
                parameters.write_text(json.dumps({"0/0/grid": "1", "0/1/grid": "1"}))
                overrides = ["--parameters-json", str(parameters)]
            executed = subprocess.run(
                [str(runner), str(library / "scripts" / recipe), "--batch", "--wfn", str(startup),
                 "--cores", "1", "--var", "grid=1", *overrides],
                cwd=actual, env=env, stdin=subprocess.DEVNULL, capture_output=True,
                text=True, errors="replace", timeout=180,
            )
            assert executed.returncode == 0, executed.stdout + executed.stderr
            reference = subprocess.run(
                [str(engine), str(startup), "-nt", "1", "-silent"], input=commands,
                cwd=direct, env=env, capture_output=True, text=True, errors="replace", timeout=180,
            )
            assert reference.returncode == 0, reference.stdout + reference.stderr
            if name == "mayer":
                matrix = (actual / "bndmat.txt").read_text()
                assert matrix == (direct / "bndmat.txt").read_text()
                rows = re.findall(r"(?m)^\s*[12]\s+(\d+\.\d+)\s+(\d+\.\d+)\s*$", matrix)
                assert len(rows) == 2, matrix
                assert math.isclose(float(rows[0][1]), 1, abs_tol=1e-6), matrix
                assert rows[0][1] == rows[1][0], matrix
            elif name == "density":
                density = compare_cube(actual / "density.cub", direct / "density.cub")
                assert min(density) >= 0 and max(density) > 0
            else:
                # These are the same filename/unit declarations consumed by
                # the result handoff; the frontend regression verifies colors.
                compare_cube(actual / "ESP/H2_den.cub", direct / "density.cub")
                compare_cube(actual / "ESP/H2_kcal_esp.cub", direct / "totesp.cub")
            assert hashlib.sha256(startup.read_bytes()).hexdigest() == digest
            print(f"Workflow science passed: {name}; artifacts match direct stdin", flush=True)


if __name__ == "__main__":
    check(Path(sys.argv[1]))
