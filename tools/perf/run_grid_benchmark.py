#!/usr/bin/env python3
"""Run one Multiwfn grid benchmark against a local executable."""

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import time
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, required=True)
    parser.add_argument("--settings", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--property-menu", default="9", help="Submenu item under main menu 5")
    parser.add_argument("--grid", default="300,300,300")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--summary-out", type=Path, required=True)
    parser.add_argument("--json-out", type=Path, required=True)
    return parser.parse_args()


def write_settings(src, dst, threads):
    text = src.read_text(encoding="utf-8", errors="replace")
    text = re.sub(r"(?m)^(\s*nthreads\s*=\s*)\d+", rf"\g<1>{threads}", text)
    dst.write_text(text, encoding="utf-8")


def cube_stats(path):
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        fh.readline()
        fh.readline()
        natoms = abs(int(fh.readline().split()[0]))
        nx = int(fh.readline().split()[0])
        ny = int(fh.readline().split()[0])
        nz = int(fh.readline().split()[0])
        for _ in range(natoms):
            fh.readline()
        count = 0
        total = 0.0
        total_abs = 0.0
        min_value = math.inf
        max_value = -math.inf
        digest = hashlib.sha256()
        for line in fh:
            for token in line.split():
                value = float(token.replace("D", "E"))
                count += 1
                total += value
                total_abs += abs(value)
                min_value = min(min_value, value)
                max_value = max(max_value, value)
                digest.update(f"{value:.10e}\n".encode("ascii"))
    return {
        "count": count,
        "expected_count": nx * ny * nz,
        "min": min_value,
        "max": max_value,
        "sum": total,
        "sum_abs": total_abs,
        "rounded_value_sha256": digest.hexdigest(),
    }


def main():
    args = parse_args()
    args.work_dir.mkdir(parents=True, exist_ok=True)
    args.summary_out.parent.mkdir(parents=True, exist_ok=True)
    args.json_out.parent.mkdir(parents=True, exist_ok=True)

    input_path = args.work_dir / args.input.name
    shutil.copy2(args.input, input_path)
    write_settings(args.settings, args.work_dir / "settings.ini", args.threads)

    commands = "\n".join(["5", args.property_menu, "4", args.grid, "2", "0", "q"]) + "\n"
    (args.work_dir / "input.txt").write_text(commands, encoding="utf-8")

    env = os.environ.copy()
    env.update(
        {
            "OMP_NUM_THREADS": str(args.threads),
            "OPENBLAS_NUM_THREADS": str(args.threads),
            "MKL_NUM_THREADS": str(args.threads),
            "OMP_STACKSIZE": env.get("OMP_STACKSIZE", "32M"),
            "KMP_STACKSIZE": env.get("KMP_STACKSIZE", "32M"),
        }
    )

    start = time.perf_counter()
    proc = subprocess.run(
        [str(args.exe), str(input_path)],
        input=commands,
        text=True,
        cwd=args.work_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        timeout=900,
    )
    elapsed = time.perf_counter() - start

    stdout_path = args.work_dir / "stdout.log"
    stderr_path = args.work_dir / "stderr.log"
    stdout_path.write_text(proc.stdout, encoding="utf-8", errors="replace")
    stderr_path.write_text(proc.stderr, encoding="utf-8", errors="replace")

    if proc.returncode != 0:
        raise SystemExit(f"Multiwfn exited with {proc.returncode}; see {stdout_path} and {stderr_path}")

    cube_path = args.work_dir / "ELF.cub"
    if not cube_path.exists():
        raise SystemExit(f"Expected {cube_path} to be generated")

    stats = cube_stats(cube_path)
    cube_path.unlink()

    internal_seconds = None
    match = re.search(r"Calculation of grid data took up wall clock time\s+(\d+) s", proc.stdout)
    if match:
        internal_seconds = int(match.group(1))

    result = {
        "elapsed_seconds": elapsed,
        "internal_seconds": internal_seconds,
        "returncode": proc.returncode,
        "grid": args.grid,
        "threads": args.threads,
        "cube_stats": stats,
    }
    args.json_out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    lines = [
        "# Multiwfn Local Grid Benchmark",
        "",
        f"- Executable: `{args.exe}`",
        f"- Input: `{args.input}`",
        f"- Grid: `{args.grid}`",
        f"- Threads: `{args.threads}`",
        f"- Elapsed: `{elapsed:.3f} s`",
        f"- Multiwfn internal grid time: `{internal_seconds if internal_seconds is not None else 'n/a'} s`",
        f"- Cube SHA256: `{stats['rounded_value_sha256']}`",
        f"- Cube sum: `{stats['sum']}`",
        f"- Cube sum_abs: `{stats['sum_abs']}`",
    ]
    args.summary_out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(args.summary_out.read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
