#!/usr/bin/env python3
"""Run Multiwfn with an unbuffered output stream for GUI progress capture."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys


MARKER_RE = re.compile(
    r"^MULTIWFN_GUI_PROGRESS\s+([A-Za-z0-9_-]{1,64})\s+"
    r"([A-Za-z0-9_-]+)\s+(\d+)\s+(\d+)$"
)
PROGRESS_RE = re.compile(r"Progress:\s*\[.*?\]\s*([0-9]+(?:\.[0-9]+)?)\s*%")


class ProgressStreamParser:
    def __init__(self, session_dir: Path):
        self.session_dir = Path(session_dir)
        self.token = ""
        self.phase = ""
        self.phase_start = 0
        self.phase_end = 100

    def feed_record(self, record: str) -> None:
        text = record.strip()
        marker = MARKER_RE.match(text)
        if marker:
            self.token, self.phase = marker.group(1), marker.group(2)
            self.phase_start, self.phase_end = int(marker.group(3)), int(marker.group(4))
            self._write(100 if self.phase == "complete" else 0)
            return
        progress = PROGRESS_RE.search(text)
        if progress and self.token:
            self._write(round(float(progress.group(1))))

    def _write(self, phase_progress: int) -> None:
        phase_progress = max(0, min(100, phase_progress))
        overall = round(
            self.phase_start
            + (self.phase_end - self.phase_start) * phase_progress / 100
        )
        payload = {
            "phase": self.phase,
            "phaseProgress": phase_progress,
            "progress": overall,
        }
        target = self.session_dir / f"esp_progress_{self.token}.json"
        temporary = target.with_suffix(".json.tmp")
        self.session_dir.mkdir(parents=True, exist_ok=True)
        temporary.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        temporary.replace(target)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", default="multiwfn_3dmol_session")
    parser.add_argument("--log", default=None)
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    if args.command[:1] == ["--"]:
        args.command = args.command[1:]
    if not args.command:
        parser.error("a Multiwfn command is required after --")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    session_dir = Path(args.session).expanduser().resolve()
    log_path = Path(args.log).expanduser().resolve() if args.log else session_dir / "runtime.log"
    session_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["MULTIWFN_3DMOL_SESSION"] = str(session_dir)
    env.setdefault("GFORTRAN_UNBUFFERED_ALL", "y")
    env.setdefault("FOR_DISABLE_BUFFERING", "1")

    parser = ProgressStreamParser(session_dir)
    process = subprocess.Popen(
        args.command,
        stdin=None,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env,
    )
    pending = bytearray()
    assert process.stdout is not None
    with log_path.open("ab", buffering=0) as log:
        while chunk := process.stdout.read1(4096):
            log.write(chunk)
            if not args.quiet:
                sys.stdout.buffer.write(chunk)
                sys.stdout.buffer.flush()
            pending.extend(chunk)
            while True:
                separators = [pos for pos in (pending.find(b"\r"), pending.find(b"\n")) if pos >= 0]
                if not separators:
                    break
                end = min(separators)
                parser.feed_record(pending[:end].decode("utf-8", errors="replace"))
                del pending[: end + 1]
        if pending:
            parser.feed_record(pending.decode("utf-8", errors="replace"))
    return process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
