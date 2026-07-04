#!/usr/bin/env python3
"""Import an official Multiwfn Linux source archive into the working tree."""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
import urllib.request
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path


DEFAULT_MANIFEST = Path(".multiwfn-upstream-manifest.json")


@dataclass(frozen=True)
class ImportedArchive:
    archive_url: str
    archive_name: str
    sha256: str
    files: list[str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive-url", required=True, help="Official source zip URL")
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--summary-out", type=Path)
    return parser.parse_args()


def download(url: str, target: Path) -> str:
    digest = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=180) as response, target.open("wb") as fh:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            fh.write(chunk)
    return digest.hexdigest()


def archive_members(archive: Path) -> tuple[str, list[zipfile.ZipInfo]]:
    with zipfile.ZipFile(archive) as zf:
        members = [info for info in zf.infolist() if not info.is_dir()]
    prefixes = {info.filename.split("/", 1)[0] for info in members if "/" in info.filename}
    if len(prefixes) != 1:
        raise SystemExit(f"Expected one top-level archive directory, found: {sorted(prefixes)}")
    return prefixes.pop(), members


def load_previous_manifest(path: Path) -> ImportedArchive | None:
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return ImportedArchive(**data)


def remove_previous_files(repo_root: Path, manifest: ImportedArchive | None, new_files: set[str]) -> None:
    if manifest is None:
        return
    for rel in manifest.files:
        if rel in new_files:
            continue
        path = repo_root / rel
        if path.exists() and path.is_file():
            path.unlink()
            prune_empty_parents(path.parent, repo_root)


def prune_empty_parents(path: Path, stop: Path) -> None:
    stop = stop.resolve()
    while path.resolve() != stop:
        try:
            path.rmdir()
        except OSError:
            return
        path = path.parent


def import_archive(repo_root: Path, archive: Path, archive_url: str, sha256: str, manifest_path: Path) -> ImportedArchive:
    top, members = archive_members(archive)
    imported_files: list[str] = []
    with zipfile.ZipFile(archive) as zf:
        for info in members:
            rel = info.filename.split("/", 1)[1]
            if not rel:
                continue
            rel_path = Path(rel)
            if rel_path.is_absolute() or ".." in rel_path.parts:
                raise SystemExit(f"Refusing unsafe archive member path: {info.filename}")
            target = repo_root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(zf.read(info))
            imported_files.append(rel)

    imported_files = sorted(imported_files)
    previous = load_previous_manifest(manifest_path)
    remove_previous_files(repo_root, previous, set(imported_files))

    imported = ImportedArchive(
        archive_url=archive_url,
        archive_name=Path(archive_url).name,
        sha256=sha256,
        files=imported_files,
    )
    manifest_path.write_text(json.dumps(asdict(imported), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return imported


def write_summary(path: Path, imported: ImportedArchive) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Imported official Multiwfn source",
        "",
        f"- Archive: `{imported.archive_name}`",
        f"- URL: {imported.archive_url}",
        f"- SHA256: `{imported.sha256}`",
        f"- Imported files: {len(imported.files)}",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    repo_root = args.repo_root.resolve()
    manifest_path = (repo_root / args.manifest).resolve()
    with tempfile.TemporaryDirectory(prefix="multiwfn-upstream-import.") as tmp:
        archive = Path(tmp) / Path(args.archive_url).name
        sha256 = download(args.archive_url, archive)
        imported = import_archive(repo_root, archive, args.archive_url, sha256, manifest_path)
    if args.summary_out:
        write_summary(args.summary_out, imported)
    print(json.dumps(asdict(imported), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
