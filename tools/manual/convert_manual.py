#!/usr/bin/env python3
"""Download and convert the Multiwfn manual PDF into searchable text files."""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

MANUAL_INDEX_URL = "http://sobereva.com/multiwfn/"
MANUAL_URL = "http://sobereva.com/multiwfn/misc/Multiwfn_manual_2026.7.3.pdf"
DEFAULT_OUTPUT_DIR = Path("build/manual")
USER_AGENT = "Multiwfn manual converter/1.0"


@dataclass(frozen=True)
class TocEntry:
    level: int
    title: str
    page: int | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Download a Multiwfn manual PDF and extract Markdown plus optional "
            "per-page or per-section text files."
        )
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument(
        "--url",
        default=MANUAL_URL,
        help=f"manual PDF URL to download (default: {MANUAL_URL})",
    )
    source.add_argument(
        "--latest",
        action="store_true",
        help=f"discover the latest manual PDF link from {MANUAL_INDEX_URL}",
    )
    source.add_argument(
        "--pdf",
        type=Path,
        help="use an existing local PDF instead of downloading",
    )
    parser.add_argument(
        "--index-url",
        default=MANUAL_INDEX_URL,
        help="Multiwfn page used with --latest",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"directory for downloaded PDFs and extracted output (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--format",
        choices=("markdown", "pages", "sections", "all"),
        default="markdown",
        help="output shape to write (default: markdown)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="re-download a PDF even when the target cache file already exists",
    )
    return parser.parse_args()


def require_pypdf():
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise SystemExit(
            "Missing dependency: pypdf\n"
            "Install it with: python3 -m pip install pypdf"
        ) from exc
    return PdfReader


def http_get(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=60) as response:
        return response.read()


def discover_latest_manual_url(index_url: str) -> str:
    candidates: list[str] = []
    seen: set[str] = set()
    queue = [index_url]

    while queue and len(seen) < 32:
        page_url = queue.pop(0)
        if page_url in seen:
            continue
        seen.add(page_url)
        try:
            html = http_get(page_url).decode("utf-8", errors="replace")
        except Exception:
            if page_url == index_url:
                raise
            continue
        candidates.extend(extract_manual_links(page_url, html))
        if candidates:
            return max(candidates, key=manual_version_key)
        queue.extend(link for link in extract_local_html_links(page_url, html) if link not in seen)

    if not candidates:
        raise SystemExit(f"No Multiwfn manual PDF link found at {index_url}")
    return max(candidates, key=manual_version_key)


def extract_manual_links(base_url: str, html: str) -> list[str]:
    matches = re.findall(r'[^"\'<>\s]*Multiwfn_manual_[^"\'<>\s]*?\.pdf', html, re.I)
    return [urljoin(base_url, match) for match in matches]


def extract_local_html_links(base_url: str, html: str) -> list[str]:
    base = urlparse(base_url)
    links: list[str] = []
    for match in re.findall(r'(?:href|src)=["\']([^"\']+)["\']', html, re.I):
        url = urljoin(base_url, match)
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or parsed.netloc != base.netloc:
            continue
        if not parsed.path.lower().endswith((".html", ".htm", "/")):
            continue
        links.append(url)
    return links


def manual_version_key(url: str) -> tuple[int, ...]:
    name = Path(urlparse(url).path).name
    match = re.search(r"Multiwfn_manual_([0-9.]+)\.pdf", name, re.I)
    if not match:
        return (0,)
    return tuple(int(part) for part in match.group(1).split(".") if part.isdigit())


def download_pdf(url: str, output_dir: Path, force: bool) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = Path(urlparse(url).path).name or "Multiwfn_manual.pdf"
    target = output_dir / filename
    if target.exists() and not force:
        return target
    target.write_bytes(http_get(url))
    return target


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_pages(reader) -> list[str]:
    pages: list[str] = []
    for page in reader.pages:
        pages.append(normalize_text(page.extract_text() or ""))
    return pages


def extract_toc(reader) -> list[TocEntry]:
    outlines = getattr(reader, "outline", None)
    if outlines is None:
        outlines = getattr(reader, "outlines", [])
    return list(flatten_outline(reader, outlines))


def flatten_outline(reader, outlines, level: int = 1) -> Iterable[TocEntry]:
    for item in outlines:
        if isinstance(item, list):
            yield from flatten_outline(reader, item, level + 1)
            continue
        title = getattr(item, "title", str(item)).strip()
        page_number: int | None
        try:
            page_number = reader.get_destination_page_number(item) + 1
        except Exception:
            page_number = None
        yield TocEntry(level=level, title=title, page=page_number)


def slugify(value: str, fallback: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9._-]+", "-", value)
    value = value.strip(".-_")
    return value[:80] or fallback


def write_markdown(pdf_path: Path, pages: list[str], toc: list[TocEntry], output_dir: Path) -> Path:
    target = output_dir / f"{pdf_path.stem}.md"
    lines = [
        f"# {pdf_path.stem}",
        "",
        f"Source PDF: `{pdf_path.name}`",
        "",
    ]
    if toc:
        lines.extend(["## Table of Contents", ""])
        for entry in toc:
            indent = "  " * max(entry.level - 1, 0)
            page_label = f" (page {entry.page})" if entry.page is not None else ""
            lines.append(f"{indent}- {entry.title}{page_label}")
        lines.append("")
    lines.extend(["## Pages", ""])
    for index, text in enumerate(pages, start=1):
        lines.extend([f"### Page {index}", "", text or "_No extractable text on this page._", ""])
    target.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return target


def write_pages(pages: list[str], output_dir: Path) -> Path:
    pages_dir = output_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    for index, text in enumerate(pages, start=1):
        target = pages_dir / f"page-{index:04d}.txt"
        target.write_text((text or "").rstrip() + "\n", encoding="utf-8")
    return pages_dir


def write_sections(pages: list[str], toc: list[TocEntry], output_dir: Path) -> Path:
    sections_dir = output_dir / "sections"
    sections_dir.mkdir(parents=True, exist_ok=True)
    if not toc:
        readme = sections_dir / "README.txt"
        readme.write_text("No PDF outline was found; use pages/ output instead.\n", encoding="utf-8")
        return sections_dir

    entries = [entry for entry in toc if entry.page is not None]
    entries.sort(key=lambda entry: (entry.page or 0, entry.level, entry.title))
    for index, entry in enumerate(entries):
        start = max((entry.page or 1) - 1, 0)
        next_pages = [candidate.page for candidate in entries[index + 1 :] if candidate.page]
        end = min(next_pages[0] - 1, len(pages)) if next_pages else len(pages)
        if end <= start:
            end = min(start + 1, len(pages))
        title = slugify(entry.title, f"section-{index + 1:04d}")
        target = sections_dir / f"{index + 1:04d}-p{entry.page:04d}-{title}.txt"
        body = [
            entry.title,
            f"PDF page range: {start + 1}-{end}",
            "",
            "\n\n".join(page for page in pages[start:end] if page),
        ]
        target.write_text("\n".join(body).rstrip() + "\n", encoding="utf-8")
    return sections_dir


def main() -> int:
    args = parse_args()
    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.pdf:
        pdf_path = args.pdf
        if not pdf_path.exists():
            raise SystemExit(f"PDF not found: {pdf_path}")
    else:
        url = discover_latest_manual_url(args.index_url) if args.latest else args.url
        pdf_path = download_pdf(url, output_dir, args.force)

    PdfReader = require_pypdf()
    reader = PdfReader(str(pdf_path))
    pages = extract_pages(reader)
    toc = extract_toc(reader)

    written: list[Path] = []
    if args.format in ("markdown", "all"):
        written.append(write_markdown(pdf_path, pages, toc, output_dir))
    if args.format in ("pages", "all"):
        written.append(write_pages(pages, output_dir))
    if args.format in ("sections", "all"):
        written.append(write_sections(pages, toc, output_dir))

    print(f"PDF: {pdf_path}")
    print(f"Pages: {len(pages)}")
    print(f"TOC entries: {len(toc)}")
    for path in written:
        print(f"Wrote: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
