#!/usr/bin/env python3
"""Check the official Multiwfn site for newer Linux source archives."""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable


DEFAULT_INDEX_URLS = (
    "http://sobereva.com/multiwfn/",
    "http://sobereva.com/multiwfn/download.html",
    "http://sobereva.com/multiwfn/misc/",
)

ARCHIVE_RE = re.compile(
    r"Multiwfn_(?P<version>\d{4}\.\d{1,2}\.\d{1,2})_src_Linux\.zip",
    re.IGNORECASE,
)
SOURCE_VERSION_RE = re.compile(r"\bVersion\s+(\d{4}\.\d{1,2}\.\d{1,2})\b")


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        for key, value in attrs:
            if key.lower() == "href" and value:
                self.hrefs.append(value)


@dataclass(frozen=True)
class Archive:
    version: str
    name: str
    url: str

    @property
    def version_tuple(self) -> tuple[int, int, int]:
        return parse_version(self.version)


def parse_version(value: str) -> tuple[int, int, int]:
    parts = value.split(".")
    if len(parts) != 3:
        raise ValueError(f"expected YYYY.M.D version, got {value!r}")
    return tuple(int(part) for part in parts)  # type: ignore[return-value]


def fetch_text(url: str, timeout: float) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "multiwfn-upstream-check/1.0 (+https://github.com/)",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def archives_from_html(base_url: str, html: str) -> list[Archive]:
    parser = LinkParser()
    parser.feed(html)

    archives: dict[str, Archive] = {}
    href_names: set[str] = set()

    for candidate in parser.hrefs:
        match = ARCHIVE_RE.search(candidate)
        if not match:
            continue
        url = urllib.parse.urljoin(base_url, candidate)
        name = ARCHIVE_RE.search(urllib.parse.unquote(url))
        if not name:
            continue
        archive_name = name.group(0)
        version = name.group("version")
        archives[url] = Archive(version=version, name=archive_name, url=url)
        href_names.add(archive_name.lower())

    for match in ARCHIVE_RE.finditer(html):
        archive_name = match.group(0)
        if archive_name.lower() in href_names:
            continue
        url = urllib.parse.urljoin(base_url, archive_name)
        archives[url] = Archive(version=match.group("version"), name=archive_name, url=url)

    return sorted(archives.values(), key=lambda item: item.version_tuple)


def discover_archives(urls: Iterable[str], timeout: float) -> tuple[list[Archive], list[str]]:
    archives: dict[str, Archive] = {}
    errors: list[str] = []

    for url in urls:
        try:
            html = fetch_text(url, timeout)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            errors.append(f"{url}: {exc}")
            continue
        for archive in archives_from_html(url, html):
            archives[archive.url] = archive

    return sorted(archives.values(), key=lambda item: item.version_tuple), errors


def read_current_version(path: Path) -> str:
    text = path.read_text(encoding="utf-8", errors="replace")
    match = SOURCE_VERSION_RE.search(text)
    if not match:
        raise ValueError(f"could not find 'Version YYYY.M.D' in {path}")
    return match.group(1)


def write_markdown_summary(
    path: Path,
    current_version: str,
    latest: Archive | None,
    archives: list[Archive],
    errors: list[str],
) -> None:
    lines = [
        "# Multiwfn upstream source check",
        "",
        f"- Current imported source: `{current_version}`",
    ]

    if latest:
        status = "newer source available" if latest.version_tuple > parse_version(current_version) else "up to date"
        lines.extend(
            [
                f"- Latest official Linux source archive: `{latest.name}`",
                f"- Latest archive URL: {latest.url}",
                f"- Status: **{status}**",
            ]
        )
    else:
        lines.append("- Latest official Linux source archive: not found")

    if archives:
        lines.extend(["", "## Discovered archives", ""])
        for archive in reversed(archives[-10:]):
            lines.append(f"- `{archive.name}` - {archive.url}")

    if errors:
        lines.extend(["", "## Fetch warnings", ""])
        lines.extend(f"- {error}" for error in errors)

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--url",
        action="append",
        dest="urls",
        help="Index URL to scan. May be repeated. Defaults to official Multiwfn pages.",
    )
    parser.add_argument(
        "--current-version",
        help="Current imported upstream version. Defaults to parsing --current-version-file.",
    )
    parser.add_argument(
        "--current-version-file",
        default="Multiwfn.f90",
        type=Path,
        help="Source file containing 'Version YYYY.M.D'.",
    )
    parser.add_argument("--json-out", type=Path, help="Write machine-readable result JSON.")
    parser.add_argument("--summary-out", type=Path, help="Write a Markdown summary.")
    parser.add_argument("--timeout", type=float, default=20.0, help="HTTP timeout in seconds.")
    parser.add_argument(
        "--fail-on-newer",
        action="store_true",
        help="Exit with status 2 when a newer upstream source archive is found.",
    )
    args = parser.parse_args(argv)

    try:
        current_version = args.current_version or read_current_version(args.current_version_file)
        parse_version(current_version)
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    archives, errors = discover_archives(args.urls or DEFAULT_INDEX_URLS, args.timeout)
    latest = archives[-1] if archives else None
    newer_available = latest is not None and latest.version_tuple > parse_version(current_version)

    result = {
        "current_version": current_version,
        "latest": asdict(latest) if latest else None,
        "newer_available": newer_available,
        "archives": [asdict(archive) for archive in archives],
        "errors": errors,
        "checked_urls": list(args.urls or DEFAULT_INDEX_URLS),
    }

    print(json.dumps(result, indent=2, sort_keys=True))

    if args.json_out:
        args.json_out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if args.summary_out:
        write_markdown_summary(args.summary_out, current_version, latest, archives, errors)

    if not archives:
        print("error: no Multiwfn Linux source archives were found", file=sys.stderr)
        return 1
    if errors:
        print("warning: one or more upstream pages could not be fetched", file=sys.stderr)
    if newer_available and args.fail_on_newer:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
