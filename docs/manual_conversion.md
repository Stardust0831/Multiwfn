# Multiwfn Manual Conversion

`tools/manual/convert_manual.py` downloads the Multiwfn manual PDF and converts
it into Markdown or text files that are easier to search. Generated files are
written under `build/manual/` by default, which keeps the large PDF and extracted
text out of version control.

## Dependencies

Use a regular Python environment. Conda is not required.

```sh
python3 -m pip install pypdf
```

The script uses only the Python standard library plus `pypdf`.

## Basic Usage

Convert the pinned 2026.7.3 manual URL to one Markdown file:

```sh
python3 tools/manual/convert_manual.py
```

Write all supported outputs:

```sh
python3 tools/manual/convert_manual.py --format all
```

This produces:

- `build/manual/Multiwfn_manual_2026.7.3.pdf`: cached downloaded PDF.
- `build/manual/Multiwfn_manual_2026.7.3.md`: Markdown with PDF outline and page text.
- `build/manual/pages/page-0001.txt`: one text file per PDF page.
- `build/manual/sections/*.txt`: section files based on the PDF outline.

If the PDF has no outline, section output writes a short notice and page output
remains the reliable fallback.

## Update to the Latest Manual

The latest manual link is published from:

```text
http://sobereva.com/multiwfn/
```

To discover the newest `Multiwfn_manual_*.pdf` link from that page and convert
it:

```sh
python3 tools/manual/convert_manual.py --latest --format all
```

To force a fresh download of a cached PDF:

```sh
python3 tools/manual/convert_manual.py --latest --format all --force
```

To pin a specific manual URL:

```sh
python3 tools/manual/convert_manual.py \
  --url http://sobereva.com/multiwfn/misc/Multiwfn_manual_2026.7.3.pdf \
  --format all
```

To convert an already downloaded local PDF without network access:

```sh
python3 tools/manual/convert_manual.py --pdf /path/to/Multiwfn_manual.pdf --format all
```

Do not commit generated PDFs or extracted manual output. Keep them in
`build/manual/` or another ignored scratch directory.

## GitHub Actions

Run **Actions -> manual-conversion -> Run workflow** to convert the pinned or
latest manual in CI. The workflow installs `pypdf`, writes generated files under
`build/manual/`, and uploads Markdown/text outputs as an artifact. The PDF is
used as a temporary input and is excluded from the uploaded artifact.
