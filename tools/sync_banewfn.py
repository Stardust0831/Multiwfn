#!/usr/bin/env python3
"""Refresh the offline BaneWfn dependency from an explicit, immutable Git revision."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "frontend/workflows/banewfn.lock.json"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def exported(source, revision):
    def git(*args):
        return subprocess.check_output(["git", "-C", str(source), *args])
    revision = git("rev-parse", "--verify", revision + "^{commit}").decode().strip()
    paths = git("ls-tree", "-r", "--name-only", revision, "--", "src", "apps/banewfn",
                "conf", "scripts/gui", "VERSION", "LICENSE",
                "packaging/windows/resources/mothwfn.ico").decode().splitlines()
    files = {}
    for name in paths:
        if name.startswith("scripts/gui/"):
            target = "scripts/" + name.removeprefix("scripts/gui/")
        elif name.endswith("mothwfn.ico"):
            target = "icons/banewfn.ico"
        else:
            target = "banewfn/" + name
        data = git("show", revision + ":" + name)
        # Normalize text transport only; source logic belongs to BaneWfn.
        if not name.endswith(".ico"):
            text = data.decode("utf-8").replace("\r\n", "\n")
            data = ("\n".join(line.rstrip() for line in text.splitlines()).rstrip("\n") + "\n").encode("utf-8")
        files[target] = data
    for required in ("banewfn/src/CMakeLists.txt", "banewfn/apps/banewfn/main.cpp", "banewfn/VERSION", "scripts/mayer.bwc"):
        if required not in files:
            raise ValueError("BaneWfn revision is missing " + required)
    ico = files["icons/banewfn.ico"]
    size, offset = struct.unpack_from("<II", ico, 14)
    png = ico[offset:offset + size]
    if not png.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("The BaneWfn icon must contain a PNG image")
    files["icons/banewfn.png"] = png
    lock = {"repository": "https://github.com/bane-dysta/banewfn", "revision": revision,
            "version": files["banewfn/VERSION"].decode().strip(),
            "files": {name: digest(data) for name, data in sorted(files.items())}}
    return files, lock


def verify(lock):
    failures = []
    for name, expected in lock["files"].items():
        path = LOCK.parent / name
        if not path.is_file() or digest(path.read_bytes()) != expected:
            failures.append(name)
    for directory in ("banewfn/src", "banewfn/apps", "banewfn/conf", "scripts", "icons"):
        for path in (LOCK.parent / directory).rglob("*"):
            if path.is_file() and path.relative_to(LOCK.parent).as_posix() not in lock["files"]:
                failures.append(path.relative_to(LOCK.parent).as_posix())
    if failures:
        raise ValueError("BaneWfn snapshot differs from its lock: " + ", ".join(failures))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--source", type=Path)
    parser.add_argument("--revision")
    args = parser.parse_args()
    if args.check:
        verify(json.loads(LOCK.read_text()))
        print("BaneWfn locked snapshot verified")
        return
    if not args.source or not args.revision:
        parser.error("updates require --source and --revision")
    previous = json.loads(LOCK.read_text()) if LOCK.exists() else {"files": {}}
    if LOCK.exists():
        verify(previous)
    files, lock = exported(args.source, args.revision)
    for name, data in files.items():
        path = LOCK.parent / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    for name in previous["files"].keys() - files.keys():
        (LOCK.parent / name).unlink()
    LOCK.write_text(json.dumps(lock, indent=2) + "\n")
    verify(lock)
    print(f"BaneWfn {lock['version']} pinned to {lock['revision']}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
