#!/usr/bin/env python3
"""Compare weak-interaction display grids and scales with official Cube/VMD output.

Run under the same dbus/xvfb environment as test_matterviz_real_orbital.py.
The small two-Gaussian H2 fixture tests the display boundary, not chemistry accuracy.
"""
import argparse
import array
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlsplit
from urllib.request import ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parents[2]
TEMPLATES = ROOT / "tests/fixtures/weak-interaction-vmd"

# Menu input stops immediately before the requested isovalue. IRI uses high
# precision to cover the old 1,500,000-point limit; the other cases use low.
CASES = [
    ("IRI", "IRIfill.vmd", "20\n4\n3\n3\n7\n", 0.1),
    ("NCI (RDG)", "RDGfill.vmd", "20\n1\n1\n3\n7\n", None),
    ("NCI (promolecular RDG)", "RDGfill_pro.vmd", "20\n2\n1\n3\n7\n", None),
    ("DORI", "DORIfill.vmd", "20\n5\n1\n3\n7\n", None),
    ("IGM inter", "IGM_inter.vmd", "20\n10\n2\n1\n2\n1\n1\n3\n4\n1\n", None),
    ("IGM intra", "IGM_intra.vmd", "20\n10\n1\na\n1\n1\n3\n4\n2\n", None),
    ("IGMH inter", "IGM_inter.vmd", "20\n11\n2\n1\n2\n1\n3\n4\n1\n", None),
    ("mIGM inter", "IGM_inter.vmd", "20\n-10\n2\n1\n2\n1\n1\n3\n4\n1\n", None),
]


def vmd_settings(filename):
    template = (TEMPLATES / filename).read_text()
    assert "mol color Volume 0" in template and "color scale method BGR" in template
    coloring = re.search(r"mol new (\S+)", template)[1]
    surface = re.search(r"mol addfile (\S+)", template)[1]
    iso = float(re.search(r"mol representation Isosurface (\S+) 1 ", template)[1])
    bounds = [float(v) for v in re.search(r"mol scaleminmax top 1 (\S+) (\S+)", template).groups()]
    midpoint_match = re.search(r"color scale midpoint (\S+)", template)
    midpoint = float(midpoint_match[1]) if midpoint_match else 0.5
    return surface, coloring, iso, bounds, midpoint


def compare_cube(frame, path):
    assert struct.unpack_from("<H", frame, 8)[0] == 2
    nx, ny, nz = struct.unpack_from("<3I", frame, 56)
    values = array.array("d")
    values.frombytes(frame[304:])
    if sys.byteorder != "little":
        values.byteswap()
    lines = path.read_text().splitlines()
    assert tuple(abs(int(lines[axis + 3].split()[0])) for axis in range(3)) == (nx, ny, nz)
    atoms = abs(int(lines[2].split()[0]))
    cube = array.array("d", (float(v) for line in lines[6 + atoms:] for v in line.split()))
    assert len(values) == len(cube) == nx * ny * nz
    # Cube writes k fastest with five decimal places in scientific notation;
    # the native frame retains all f64 digits with i fastest.
    for i in range(nx):
        for j in range(ny):
            for k in range(nz):
                actual = values[i + nx * (j + ny * k)]
                exported = cube[(i * ny + j) * nz + k]
                assert math.isclose(actual, exported, rel_tol=5.1e-6, abs_tol=1e-99), (actual, exported)
    return (nx, ny, nz)


def run(executable, case):
    name, template, menu, iso_override = case
    surface_file, color_file, iso, bounds, midpoint = vmd_settings(template)
    if iso_override is not None:
        iso = iso_override
    opener = build_opener(ProxyHandler({}))
    with tempfile.TemporaryDirectory(prefix="matterviz-mapped-iri-") as directory:
        work = Path(directory)
        shutil.copy2(ROOT / "tests/fixtures/matterviz-mapped-iri-h2.wfx", work / "input.wfx")
        settings = (ROOT / "settings.ini").read_text()
        settings = re.sub(r"(?m)^(\s*nthreads=)\s*\d+", r"\g<1> 2", settings)
        # The default fragment prescreen omits intra/total exports. Compute
        # complete fields here so every sample can be compared with a Cube.
        settings = re.sub(r"(?m)^\s*IGMvdwscl=.*$", "", settings)
        settings += "\n IGMvdwscl= 0.0\n"
        (work / "settings.ini").write_text(settings)
        env = {**os.environ, "MULTIWFN_MATTERVIZ_HOME": str(executable.parent),
               "MULTIWFN_MATTERVIZ_PORT": "0", "GFORTRAN_UNBUFFERED_ALL": "1",
               "OPENBLAS_NUM_THREADS": "1"}
        env.pop("MULTIWFN_MATTERVIZ_ALLOW_CUBE_FALLBACK", None)
        process = subprocess.Popen([str(executable), str(work / "input.wfx")], cwd=work, env=env,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, start_new_session=True)
        output = []
        reader = threading.Thread(target=lambda: output.extend(process.stdout), daemon=True)
        reader.start()
        try:
            process.stdin.write(menu + f"{iso}\n3\n0\n0\nq\n")
            process.stdin.flush()
            deadline = time.monotonic() + 300
            url = None
            while time.monotonic() < deadline and process.poll() is None:
                matches = re.findall(r"GUI service: (http://\S+)", "".join(output))
                if matches:
                    url = matches[-1]
                    break
                time.sleep(0.1)
            assert url, f"{name} session did not start"
            parsed = urlsplit(url)
            base = f"{parsed.scheme}://{parsed.netloc}"
            cap = parse_qs(parsed.query)["cap"][0]

            def get(path):
                with opener.open(base + path + "?cap=" + cap, timeout=60) as response:
                    if path.startswith("/api/volume/"):
                        assert int(response.headers["X-MatterViz-Geometry-Memory-Budget"]) > 0
                    return response.read()

            manifest = json.loads(get("/session/manifest.json"))
            surface, coloring = manifest["cubes"]
            assert surface["name"] == name and surface["isovalue"] == iso
            assert surface["analysisKind"] == "weak-interaction-surface"
            assert coloring["analysisKind"] == "weak-interaction-color"
            assert surface["format"] == coloring["format"] == "mwfn-volume-v2"
            assert surface["mode"] == "positive" and surface["opacity"] == 1
            assert coloring["visible"] is False
            assert surface["colorMapping"] == {
                "path": coloring["path"], "range": bounds,
                "stops": [{"position": 0, "color": "#0000ff"}, {"position": midpoint, "color": "#00ff00"},
                          {"position": 1, "color": "#ff0000"}]}
            cube_paths = [work / color_file, work / surface_file]
            before = [hashlib.sha256(path.read_bytes()).digest() for path in cube_paths]
            shape = compare_cube(get(surface["path"]), cube_paths[1])
            if name == "IRI":
                assert math.prod(shape) > 1_500_000
            assert compare_cube(get(coloring["path"]), cube_paths[0]) == shape
            assert json.loads(get("/api/return")) == {"ok": True}
            assert process.wait(timeout=30) == 0
            assert [hashlib.sha256(path.read_bytes()).digest() for path in cube_paths] == before
            print(f"MAPPED_SURFACE_OK: {name} {shape}; surface={surface_file}, coloring={color_file}; "
                  f"scale matches {template}; grids unchanged after Return", flush=True)
        except BaseException:
            print("".join(output[-100:]))
            raise
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=10)
            reader.join(timeout=5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--executable", type=Path, required=True)
    executable = parser.parse_args().executable.resolve()
    for case in CASES:
        run(executable, case)
