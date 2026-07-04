#!/usr/bin/env python3
"""Download Multiwfn builds and run comparable Linux/Windows benchmarks."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path


VERSION = "2026.6.2"
PRE_BASELINE_TAG = "v2026.6.2-nogui.3"
CURRENT_TAG = "v2026.6.2-nogui.4"
REPO_RELEASE = "https://github.com/Stardust0831/Multiwfn/releases/download"
OFFICIAL_BASE = "http://sobereva.com/multiwfn/misc"


@dataclass(frozen=True)
class Runner:
    name: str
    exe: Path
    root: Path
    settings: Path


@dataclass(frozen=True)
class Case:
    name: str
    input_file: str
    commands: list[str]
    output_file: str | None
    category: str
    threads: int = 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--suite", choices=["smoke", "standard", "full"], default="standard")
    parser.add_argument("--repeats", type=int, default=2)
    parser.add_argument("--work-dir", type=Path, default=Path("perf-work"))
    parser.add_argument("--output-dir", type=Path, default=Path("perf-results"))
    parser.add_argument("--versions", default="official,project-prebaseline,project-current")
    args = parser.parse_args()

    if args.repeats < 1:
        raise SystemExit("--repeats must be >= 1")

    system = platform.system().lower()
    if system not in {"linux", "windows"}:
        raise SystemExit(f"Unsupported benchmark OS: {platform.system()}")

    args.work_dir.mkdir(parents=True, exist_ok=True)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    selected = [item.strip() for item in args.versions.split(",") if item.strip()]
    runners, examples_dir = prepare_runners(system, selected, args.work_dir)
    cases = build_cases(args.suite, system)

    results: list[dict[str, object]] = []
    signatures: dict[str, dict[str, dict[str, object]]] = {}
    for case in cases:
        signatures[case.name] = {}
        for runner in runners:
            for repeat in range(1, args.repeats + 1):
                result = run_case(runner, examples_dir, case, repeat, args.output_dir)
                results.append(result)
                if repeat == 1:
                    signatures[case.name][runner.name] = {
                        "numeric_digest": result["numeric_digest"],
                        "output_stats": result["output_stats"],
                    }

    comparisons = compare_signatures(signatures)
    write_outputs(args.output_dir, results, comparisons, runners, cases, args.suite)
    failed = [row for row in comparisons if row["status"] == "failed"]
    if failed:
        print(f"{len(failed)} consistency comparison(s) failed", file=sys.stderr)
        return 1
    return 0


def prepare_runners(system: str, selected: list[str], work_dir: Path) -> tuple[list[Runner], Path]:
    downloads = work_dir / "downloads"
    packages = work_dir / "packages"
    downloads.mkdir(parents=True, exist_ok=True)
    packages.mkdir(parents=True, exist_ok=True)

    runners: list[Runner] = []
    examples_dir: Path | None = None
    for name in selected:
        if name == "official":
            runner = prepare_official(system, downloads, packages)
            examples_dir = find_examples(runner.root)
        elif name == "project-prebaseline":
            runner = prepare_project_release(system, PRE_BASELINE_TAG, name, downloads, packages)
        elif name == "project-current":
            runner = prepare_project_release(system, CURRENT_TAG, name, downloads, packages)
        else:
            raise SystemExit(f"Unknown version selector: {name}")
        runners.append(runner)

    if examples_dir is None:
        official = prepare_official(system, downloads, packages)
        examples_dir = find_examples(official.root)
    return runners, examples_dir


def prepare_official(system: str, downloads: Path, packages: Path) -> Runner:
    if system == "linux":
        archive = downloads / f"Multiwfn_{VERSION}_bin_Linux_noGUI.zip"
        url = f"{OFFICIAL_BASE}/Multiwfn_{VERSION}_bin_Linux_noGUI.zip"
        root = packages / "official-linux"
        download(url, archive)
        extract_zip(archive, root)
        exe = find_one(root, "Multiwfn_noGUI")
    else:
        archive = downloads / f"Multiwfn_{VERSION}_bin_Win64.7z"
        url = f"{OFFICIAL_BASE}/Multiwfn_{VERSION}_bin_Win64.7z"
        root = packages / "official-windows"
        download(url, archive)
        extract_7z(archive, root)
        exe = find_one(root, "Multiwfn.exe")
    exe.chmod(exe.stat().st_mode | 0o111)
    return Runner("official", exe, root, find_settings(root))


def prepare_project_release(system: str, tag: str, name: str, downloads: Path, packages: Path) -> Runner:
    if system == "linux":
        archive_name = "Multiwfn_noGUI-Linux.tar.gz"
    else:
        archive_name = "Multiwfn_noGUI-Windows.zip"
    archive = downloads / f"{tag}-{archive_name}"
    url = f"{REPO_RELEASE}/{tag}/{archive_name}"
    root = packages / f"{name}-{system}"
    download(url, archive)
    if archive.suffix == ".zip":
        extract_zip(archive, root)
    else:
        extract_tar(archive, root)
    exe_name = "Multiwfn_noGUI.exe" if system == "windows" else "Multiwfn_noGUI"
    exe = find_one(root, exe_name)
    exe.chmod(exe.stat().st_mode | 0o111)
    return Runner(name, exe, root, find_settings(root))


def download(url: str, target: Path) -> None:
    if target.exists() and target.stat().st_size > 0:
        return
    print(f"Downloading {url}")
    tmp = target.with_suffix(target.suffix + ".tmp")
    with urllib.request.urlopen(url, timeout=120) as response:
        tmp.write_bytes(response.read())
    tmp.replace(target)


def extract_zip(archive: Path, target: Path) -> None:
    marker = target / ".extracted"
    if marker.exists():
        return
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(target)
    marker.write_text("ok\n")


def extract_tar(archive: Path, target: Path) -> None:
    marker = target / ".extracted"
    if marker.exists():
        return
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as tf:
        tf.extractall(target)
    marker.write_text("ok\n")


def extract_7z(archive: Path, target: Path) -> None:
    marker = target / ".extracted"
    if marker.exists():
        return
    target.mkdir(parents=True, exist_ok=True)
    subprocess.run(["7z", "x", str(archive), f"-o{target}", "-y"], check=True)
    marker.write_text("ok\n")


def find_one(root: Path, name: str) -> Path:
    matches = [path for path in root.rglob(name) if path.is_file()]
    if not matches:
        raise FileNotFoundError(f"Cannot find {name} under {root}")
    return matches[0]


def find_settings(root: Path) -> Path:
    return find_one(root, "settings.ini")


def find_examples(root: Path) -> Path:
    matches = [path for path in root.rglob("examples") if path.is_dir()]
    if not matches:
        raise FileNotFoundError(f"Cannot find official examples under {root}")
    return matches[0]


def build_cases(suite: str, system: str) -> list[Case]:
    if suite == "smoke":
        density_grid = "36,36,36"
        elf_grid = "34,34,34"
        cube_n = 40
        threads = [1, 2]
    elif suite == "full":
        density_grid = "96,96,96"
        elf_grid = "86,86,86"
        cube_n = 120
        threads = [1, 4]
    else:
        density_grid = "72,72,72"
        elf_grid = "66,66,66"
        cube_n = 96
        threads = [1, 4]

    cases: list[Case] = [
        Case(
            "matrix_mayer_bond_order",
            "phenanthrene.fch",
            ["9", "1", "0", "0", "q"],
            None,
            "blas-lapack",
            1,
        ),
        Case(
            "synthetic_cube_roundtrip",
            f"synthetic_{cube_n}.cub",
            ["13", "0", "roundtrip.cub", "-1", "q"],
            "roundtrip.cub",
            "real-space-grid-io",
            1,
        ),
    ]

    for nthreads in threads:
        cases.append(
            Case(
                f"density_grid_{nthreads}t",
                "phenanthrene.fch",
                ["5", "1", "4", density_grid, "2", "0", "q"],
                "density.cub",
                "parallel-grid",
                nthreads,
            )
        )
        cases.append(
            Case(
                f"elf_grid_{nthreads}t",
                "phenanthrene.fch",
                ["5", "9", "4", elf_grid, "2", "0", "q"],
                "ELF.cub",
                "parallel-grid",
                nthreads,
            )
        )

    if suite != "smoke":
        cases.append(
            Case(
                "c60_geometry_scan",
                "C60.xyz",
                ["26", "1", "", "q", "0", "q"],
                None,
                "geometry-baseline",
                1,
            )
        )
    return cases


def run_case(runner: Runner, examples_dir: Path, case: Case, repeat: int, output_dir: Path) -> dict[str, object]:
    case_dir = output_dir / "runs" / runner.name / case.name / f"repeat-{repeat}"
    case_dir.mkdir(parents=True, exist_ok=True)

    input_path = prepare_input(case.input_file, examples_dir, case_dir)
    write_settings(runner.settings, case_dir / "settings.ini", case.threads)

    commands = "\n".join(case.commands) + "\n"
    (case_dir / "input.txt").write_text(commands, encoding="utf-8")
    stdout_path = case_dir / "stdout.log"
    stderr_path = case_dir / "stderr.log"

    env = os.environ.copy()
    env.update(
        {
            "OMP_NUM_THREADS": str(case.threads),
            "OPENBLAS_NUM_THREADS": str(case.threads),
            "MKL_NUM_THREADS": str(case.threads),
            "OMP_STACKSIZE": env.get("OMP_STACKSIZE", "32M"),
            "KMP_STACKSIZE": env.get("KMP_STACKSIZE", "32M"),
        }
    )
    start = time.perf_counter()
    proc = subprocess.run(
        [str(runner.exe), str(input_path)],
        input=commands,
        text=True,
        cwd=case_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        timeout=900,
    )
    elapsed = time.perf_counter() - start
    stdout_path.write_text(proc.stdout, encoding="utf-8", errors="replace")
    stderr_path.write_text(proc.stderr, encoding="utf-8", errors="replace")

    if proc.returncode != 0:
        raise RuntimeError(
            f"{runner.name}/{case.name} failed with exit {proc.returncode}; "
            f"see {stdout_path} and {stderr_path}"
        )

    output_stats: dict[str, object] = {}
    if case.output_file:
        output_path = case_dir / case.output_file
        if not output_path.exists():
            raise RuntimeError(f"{runner.name}/{case.name} did not produce {case.output_file}")
        output_stats = cube_stats(output_path)

    numeric_digest = numeric_output_digest(proc.stdout)
    success = required_markers_present(case, proc.stdout)
    if not success:
        raise RuntimeError(
            f"{runner.name}/{case.name} failed with exit {proc.returncode}; "
            f"see {stdout_path} and {stderr_path}"
        )

    return {
        "runner": runner.name,
        "case": case.name,
        "category": case.category,
        "threads": case.threads,
        "repeat": repeat,
        "seconds": elapsed,
        "returncode": proc.returncode,
        "numeric_digest": numeric_digest,
        "output_stats": output_stats,
        "run_dir": str(case_dir),
    }


def prepare_input(input_name: str, examples_dir: Path, case_dir: Path) -> Path:
    if input_name.startswith("synthetic_") and input_name.endswith(".cub"):
        n = int(input_name.removeprefix("synthetic_").removesuffix(".cub"))
        path = case_dir / input_name
        generate_cube(path, n)
        return path
    src = examples_dir / input_name
    if not src.exists():
        raise FileNotFoundError(f"Missing official example input: {src}")
    dst = case_dir / input_name
    shutil.copy2(src, dst)
    return dst


def write_settings(src: Path, dst: Path, threads: int) -> None:
    text = src.read_text(encoding="utf-8", errors="replace")
    text = re.sub(r"(?m)^(\s*nthreads\s*=\s*)\d+", rf"\g<1>{threads}", text)
    dst.write_text(text, encoding="utf-8")


def generate_cube(path: Path, n: int) -> None:
    with path.open("w", encoding="ascii") as fh:
        fh.write("Synthetic benchmark cube\n")
        fh.write("Generated by tests/perf/benchmark_multiwfn.py\n")
        fh.write("    1   -6.000000   -6.000000   -6.000000\n")
        fh.write(f"{n:5d}    0.150000    0.000000    0.000000\n")
        fh.write(f"{n:5d}    0.000000    0.150000    0.000000\n")
        fh.write(f"{n:5d}    0.000000    0.000000    0.150000\n")
        fh.write("    6    0.000000    0.000000    0.000000    0.000000\n")
        line: list[str] = []
        for k in range(n):
            z = (k - n / 2) / n
            for j in range(n):
                y = (j - n / 2) / n
                for i in range(n):
                    x = (i - n / 2) / n
                    value = math.sin(11 * x) * math.cos(7 * y) + 0.25 * math.sin(5 * z)
                    line.append(f"{value:13.6E}")
                    if len(line) == 6:
                        fh.write(" ".join(line) + "\n")
                        line.clear()
        if line:
            fh.write(" ".join(line) + "\n")


def cube_stats(path: Path) -> dict[str, object]:
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        fh.readline()
        fh.readline()
        natoms_line = fh.readline()
        natoms = abs(int(natoms_line.split()[0]))
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


def numeric_output_digest(text: str) -> str:
    ignore = ("Current date:", "wall clock time", "took up")
    digest = hashlib.sha256()
    for line in text.splitlines():
        if any(item in line for item in ignore):
            continue
        for token in re.findall(r"[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[EeDd][-+]?\d+)?", line):
            value = float(token.replace("D", "E"))
            digest.update(f"{value:.8e}\n".encode("ascii"))
    return digest.hexdigest()


def required_markers_present(case: Case, stdout: str) -> bool:
    if case.name == "matrix_mayer_bond_order":
        return "Bond orders with absolute value" in stdout and "Total valences" in stdout
    if case.name == "synthetic_cube_roundtrip":
        return "Loaded" in stdout and "cube file has been outputted" in stdout
    if case.output_file:
        return "Calculation of grid data" in stdout and "Grid data has been exported" in stdout
    if case.name == "c60_geometry_scan":
        return "Formula: C60" in stdout and "Geometry center" in stdout
    return True


def compare_signatures(signatures: dict[str, dict[str, dict[str, object]]]) -> list[dict[str, object]]:
    comparisons: list[dict[str, object]] = []
    for case_name, per_runner in signatures.items():
        if "official" not in per_runner:
            continue
        reference = per_runner["official"]
        for runner_name, signature in per_runner.items():
            if runner_name == "official":
                continue
            status = "ok"
            detail = "numeric digest matched"
            if signature["numeric_digest"] != reference["numeric_digest"]:
                status = "warn"
                detail = "numeric stdout digest differed"
            ref_stats = reference["output_stats"]
            stats = signature["output_stats"]
            if ref_stats and stats:
                ok, stat_detail = compare_cube_stats(ref_stats, stats)
                if not ok:
                    status = "failed"
                detail = stat_detail if detail == "numeric digest matched" else f"{detail}; {stat_detail}"
            comparisons.append(
                {
                    "case": case_name,
                    "reference": "official",
                    "runner": runner_name,
                    "status": status,
                    "detail": detail,
                }
            )
    return comparisons


def compare_cube_stats(reference: dict[str, object], observed: dict[str, object]) -> tuple[bool, str]:
    if reference["count"] != observed["count"]:
        return False, f"cube count differed: {reference['count']} vs {observed['count']}"
    checks = []
    for key in ("min", "max", "sum", "sum_abs"):
        ref = float(reference[key])
        val = float(observed[key])
        tol = max(1e-7, abs(ref) * 2e-6)
        checks.append(abs(ref - val) <= tol)
    if all(checks):
        return True, "cube statistics matched within tolerance"
    return False, "cube statistics differed beyond tolerance"


def write_outputs(
    output_dir: Path,
    results: list[dict[str, object]],
    comparisons: list[dict[str, object]],
    runners: list[Runner],
    cases: list[Case],
    suite: str,
) -> None:
    with (output_dir / "results.csv").open("w", newline="", encoding="utf-8") as fh:
        fieldnames = ["runner", "case", "category", "threads", "repeat", "seconds", "returncode", "numeric_digest", "run_dir"]
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in results:
            writer.writerow({key: row[key] for key in fieldnames})

    (output_dir / "results.json").write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
    (output_dir / "comparisons.json").write_text(json.dumps(comparisons, indent=2), encoding="utf-8")

    medians: dict[tuple[str, str], float] = {}
    grouped: dict[tuple[str, str], list[float]] = {}
    for row in results:
        grouped.setdefault((str(row["runner"]), str(row["case"])), []).append(float(row["seconds"]))
    for key, values in grouped.items():
        medians[key] = median(values)

    lines = [
        f"# Multiwfn Performance Benchmark ({suite})",
        "",
        f"Runners: {', '.join(runner.name for runner in runners)}",
        f"Cases: {', '.join(case.name for case in cases)}",
        "",
        "## Median Runtime",
        "",
        "| case | " + " | ".join(runner.name for runner in runners) + " |",
        "| --- | " + " | ".join("---:" for _ in runners) + " |",
    ]
    for case in cases:
        row = [case.name]
        for runner in runners:
            value = medians.get((runner.name, case.name))
            row.append(f"{value:.3f}s" if value is not None else "n/a")
        lines.append("| " + " | ".join(row) + " |")

    lines.extend(["", "## Consistency", "", "| case | runner | status | detail |", "| --- | --- | --- | --- |"])
    for row in comparisons:
        lines.append(f"| {row['case']} | {row['runner']} | {row['status']} | {row['detail']} |")

    summary = "\n".join(lines) + "\n"
    (output_dir / "summary.md").write_text(summary, encoding="utf-8")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as fh:
            fh.write(summary)


def median(values: list[float]) -> float:
    sorted_values = sorted(values)
    mid = len(sorted_values) // 2
    if len(sorted_values) % 2:
        return sorted_values[mid]
    return (sorted_values[mid - 1] + sorted_values[mid]) / 2


if __name__ == "__main__":
    raise SystemExit(main())
