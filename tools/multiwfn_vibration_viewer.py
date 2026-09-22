#!/usr/bin/env python3
"""Standalone MatterViz vibrational mode animation launcher for Multiwfn.

This program follows the external-orchestration model recorded in
docs/matterviz-vibration-protocol.md and issue #58: no Multiwfn source code is
involved or modified. The launcher itself parses the vibrational data of a
Gaussian, ORCA, CP2K or xTB frequency output file (mirroring the conventions of
the Multiwfn spectrum module's PVS normal-coordinate analysis), builds a
MatterViz vibration session (manifest.json + structure.json + one MWFNP2D
binary displacement dataset), serves it over a loopback HTTP service and opens
the session in the matterviz-desktop shell with `--url`. The viewer page
(vibration.html) loads the session initially paused.

Pipeline:
  1. Parse frequencies, optional IR intensities, per-atom normal-mode
     displacement vectors and the final geometry from the output file(s).
  2. Write the session files into a temporary directory (or --session-dir).
  3. Serve /session/* and /api/plot-data/<id> on http://127.0.0.1:<port>.
  4. Launch matterviz-desktop --url <session url> and wait until the user
     returns from the GUI (/api/return, gui_stop.flag or shell exit), then
     shut the HTTP service down.

When an input file lacks displacement data (e.g. a frequency run that did not
print normal modes), --compute drives an external engine as a batch process:
the task is queued, `<engine> <file>` is fed numeric menu lines over stdin in
its own task directory, and the launcher collects the task's declared file
artifact (--compute-artifact), verifies it parses into vibrational data with
at least one nonzero displacement vector, and only then builds the session.
Stock Multiwfn cannot close this loop — its menus write no normal-mode
vectors — so --multiwfn must point at a wrapper that produces a complete
quantum-chemistry output (see docs/matterviz-vibration-protocol.md). The
engine's captured stdout is kept only as a diagnostic log and is never parsed.

xTB note: xTB output carries frequencies/intensities but no normal-mode
vectors; pass the companion g98.out produced by `xtb --g98` via --g98-out. The
geometry and the displacements are both read from g98.out (same atom order),
so the xTB flow never needs any geometry before the g98.out path is known.

CLI (source tree):
  python3 tools/multiwfn_vibration_viewer.py [OUTPUT [OUTPUT ...]]
      [--g98-out PATH] [--multiwfn EXE] [--compute] [--compute-artifact PATH]
      [--no-launch] [--session-dir DIR] [--export-dir DIR] [--port N]
      [--no-pick]

Installed standalone executable (PyInstaller-frozen, shipped beside
matterviz-desktop in resources/tools/ of the MatterViz packages):
  multiwfn-vibration [OUTPUT [OUTPUT ...]] [same options]

With no OUTPUT argument and a desktop session, the launcher opens the native
file dialog of the matterviz-desktop shell (`--select-file`) repeatedly to
collect the batch queue: every picked file is queued and the dialog reopens
until Cancel ends the collection; an empty collection prints the usage and
exits 2. When a picked input is an xTB spectrum and --g98-out was not given,
one more dialog round offers to pick the companion g98.out. --no-pick turns
the dialog collection off (no OUTPUT then prints the usage and exits 2), which
keeps headless/CI invocations well-defined.

Frozen layout: a PyInstaller onefile build unpacks its modules into a
temporary directory, so __file__ cannot locate the bundled tools; when
sys.frozen is set the launcher resolves matterviz-desktop from the
executable's own directory (sys.executable) instead.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass, field
import http.server
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import socketserver
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class VibrationError(ValueError):
    """The input could not be parsed into a vibration session."""


class UnsupportedFormatError(VibrationError):
    """The input file is not a supported program output."""


class MissingDisplacementError(VibrationError):
    """Frequencies parsed but the normal-mode displacement data is absent."""


class MissingArtifactError(VibrationError):
    """An external compute task did not produce its declared artifact."""


# ---------------------------------------------------------------------------
# CRC32C (Castagnoli, reflected polynomial 0x82F63B78) and MWFNP2D v1 framing
# ---------------------------------------------------------------------------

_CRC32C_TABLE: list[int] | None = None


def _crc32c_table() -> list[int]:
    global _CRC32C_TABLE
    if _CRC32C_TABLE is None:
        table = []
        for value in range(256):
            crc = value
            for _ in range(8):
                crc = (crc >> 1) ^ (0x82F63B78 & -(crc & 1))
            table.append(crc)
        _CRC32C_TABLE = table
    return _CRC32C_TABLE


def crc32c(data: bytes) -> int:
    table = _crc32c_table()
    crc = 0xFFFFFFFF
    for byte in data:
        crc = table[(crc ^ byte) & 0xFF] ^ (crc >> 8)
    return (~crc) & 0xFFFFFFFF


PLOT_DATA_MAGIC = b"MWFNP2D\x00"
PLOT_DATA_HEADER_BYTES = 80
PLOT_DATA_ENTRY_BYTES = 32
PLOT_DATA_ROLE_U = 4
PLOT_DATA_MIME = "application/vnd.multiwfn.matterviz-plot-data-v1"


def encode_plot_dataset(dataset_id: int, values, role: int = PLOT_DATA_ROLE_U) -> bytes:
    """Encode one single-array MWFNP2D v1 frame (docs/matterviz-plot-protocol-v2.md).

    The layout mirrors the JavaScript reference in
    frontend/matterviz-viewer/tests/vibration.test.ts: an 80-byte little-endian
    header, one 32-byte directory entry per array and a contiguous f64 body.
    The header CRC is computed over the final header with its own field zeroed.
    """
    if not isinstance(dataset_id, int) or dataset_id <= 0:
        raise ValueError("dataset_id must be a positive integer")
    values = list(values)
    body = struct.pack(f"<{len(values)}d", *values)

    entry = bytearray(PLOT_DATA_ENTRY_BYTES)
    entry[0] = role
    struct.pack_into("<Q", entry, 8, len(values))
    struct.pack_into("<Q", entry, 16, 0)
    struct.pack_into("<Q", entry, 24, len(body))

    header = bytearray(PLOT_DATA_HEADER_BYTES)
    header[0:8] = PLOT_DATA_MAGIC
    struct.pack_into("<H", header, 8, 1)   # major version
    struct.pack_into("<H", header, 10, 0)  # minor version
    struct.pack_into("<H", header, 12, 1)  # dataset type
    struct.pack_into("<H", header, 14, 1)  # flags
    struct.pack_into("<I", header, 16, PLOT_DATA_HEADER_BYTES)
    struct.pack_into("<Q", header, 20, dataset_id)
    struct.pack_into("<I", header, 28, 1)  # array count
    struct.pack_into("<I", header, 32, PLOT_DATA_ENTRY_BYTES)
    struct.pack_into("<Q", header, 36, PLOT_DATA_ENTRY_BYTES)  # directory bytes
    struct.pack_into("<Q", header, 44, len(body))
    struct.pack_into("<Q", header, 52, len(values))
    # offset 60: header CRC (kept zero until the header is final)
    struct.pack_into("<I", header, 64, crc32c(body))
    # offset 68: reserved, zero
    struct.pack_into("<Q", header, 72, PLOT_DATA_HEADER_BYTES + PLOT_DATA_ENTRY_BYTES + len(body))
    struct.pack_into("<I", header, 60, crc32c(bytes(header)))
    return bytes(header) + bytes(entry) + body


# ---------------------------------------------------------------------------
# Vibrational data model and shared validation
# ---------------------------------------------------------------------------

ELEMENTS = [
    "X",
    "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne",
    "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
    "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
    "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr",
    "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn",
    "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd",
    "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb",
    "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg",
    "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th",
    "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm",
    "Md", "No", "Lr", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds",
    "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og",
]


@dataclass
class AtomSite:
    element: str
    z: int
    x: float
    y: float
    z_coord: float


@dataclass
class VibrationData:
    source_program: str               # gaussian | orca | cp2k | xtb
    spectrum_kind: str | None         # "ir" when IR intensities were parsed
    intensity_unit: str | None        # "km/mol" for IR
    atoms: list[AtomSite] = field(default_factory=list)
    frequencies: list[float] = field(default_factory=list)
    intensities: list[float] | None = None
    # Flat mode-major [mode][atom][xyz] normalized Cartesian displacement
    # patterns as printed by the source program (not mass weighted).
    displacements: list[float] = field(default_factory=list)
    # Preserve source mode numbers when projected zero vectors are omitted in xTB.
    mode_indices: list[int] | None = None

    @property
    def natom(self) -> int:
        return len(self.atoms)

    @property
    def nmode(self) -> int:
        return len(self.frequencies)


def _parse_float(token: str) -> float:
    return float(token.replace("D", "e").replace("d", "e"))


def _line_floats(text: str) -> list[float]:
    values = []
    for token in text.split():
        try:
            values.append(_parse_float(token))
        except ValueError:
            break
    return values


def _line_ints(text: str) -> list[int]:
    values = []
    for token in text.split():
        try:
            values.append(int(token))
        except ValueError:
            break
    return values


def validate_vibration_data(data: VibrationData, *, allow_projected_modes: bool = False) -> VibrationData:
    """Mirror the fail-closed checks of the Fortran adapter (matterviz_vibration.f90)."""
    if data.nmode <= 0:
        raise VibrationError("No vibrational transitions are loaded")
    if data.natom <= 0:
        raise VibrationError(
            "Vibrational mode animation requires the molecular geometry; "
            "no coordinate block was found in the input"
        )
    if not all(math.isfinite(value) for value in data.frequencies):
        raise VibrationError("The loaded frequencies contain non-finite values")
    if data.intensities is not None:
        if len(data.intensities) != data.nmode:
            raise VibrationError("The number of intensities does not match the number of modes")
        if not all(math.isfinite(value) for value in data.intensities):
            raise VibrationError("The loaded intensities contain non-finite values")
    for site in data.atoms:
        if not (math.isfinite(site.x) and math.isfinite(site.y) and math.isfinite(site.z_coord)):
            raise VibrationError("The loaded geometry contains non-finite coordinates")
    expected = data.nmode * data.natom * 3
    if len(data.displacements) != expected:
        raise VibrationError(
            f"The displacement table holds {len(data.displacements)} values, expected {expected}"
        )
    if not all(math.isfinite(value) for value in data.displacements):
        raise VibrationError("The normal-mode table contains non-finite values")
    for imode in range(data.nmode):
        base = imode * data.natom * 3
        total = sum(value * value for value in data.displacements[base:base + data.natom * 3])
        if total <= 0.0:
            if allow_projected_modes and data.source_program == "xtb" and abs(data.frequencies[imode]) <= 0.01:
                continue
            raise VibrationError(f"Mode {imode + 1} has a zero displacement vector")
    return data


# ---------------------------------------------------------------------------
# Output program detection, mirroring outputprog in util.f90
# ---------------------------------------------------------------------------

def _contains_label(lines: list[str], label: str, maxline: int) -> bool:
    for line in lines[:maxline]:
        if label in line:
            return True
    return False


def detect_program(path) -> str:
    lines = _read_lines(path)
    if _contains_label(lines, "Gaussian, Inc", 500) or _contains_label(lines, "Entering Gaussian System", 200):
        return "gaussian"
    if _contains_label(lines, "O   R   C   A", 500):
        return "orca"
    if _contains_label(lines, "CP2K|", 500):
        return "cp2k"
    if _contains_label(lines, "x T B", 500) or any(
        line.strip().casefold() == "$vibrational spectrum" for line in lines
    ):
        return "xtb"
    raise UnsupportedFormatError(
        "Vibrational mode animation is not supported for this input file; "
        "Gaussian, ORCA, CP2K and xTB output files are supported"
    )


def _read_lines(path) -> list[str]:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            return handle.read().splitlines()
    except OSError as exc:
        raise VibrationError(f"Unable to open the input file: {path} ({exc})") from exc


def _rindex(lines: list[str], label: str) -> int | None:
    for index in range(len(lines) - 1, -1, -1):
        if label in lines[index]:
            return index
    return None


# ---------------------------------------------------------------------------
# Per-atom displacement tables ("Atom  AN" / "Atom AN" / "ATOM  EL" blocks),
# mirroring read_mode_atom_tables: three modes per block, one row per atom,
# list-directed (token) fields. Fixed atoms stay zero.
# ---------------------------------------------------------------------------

def _read_mode_atom_tables(
    lines: list[str],
    label_pattern: re.Pattern,
    natom: int,
    nmodes: int,
    label: str,
    *,
    require_all_atoms: bool = False,
) -> list[list[list[float]]]:
    norm = [[[0.0, 0.0, 0.0] for _ in range(natom)] for _ in range(nmodes)]
    cursor = 0
    inow = 0
    while inow < nmodes:
        iread = min(3, nmodes - inow)
        found = None
        for index in range(cursor, len(lines)):
            if label_pattern.search(lines[index]):
                found = index
                break
        if found is None:
            raise MissingDisplacementError(
                f'Unable to find the normal-mode displacement table ("{label}") in the output file'
            )
        row = found + 1  # the label line itself carries the X Y Z column header
        seen_atoms: set[int] = set()
        while row < len(lines):
            line = lines[row]
            if line[:6].strip() == "":
                break
            tokens = line.split()
            try:
                iatm = int(tokens[0])
            except (ValueError, IndexError):
                raise VibrationError("Unexpected atom index in the normal-mode displacement table") from None
            if iatm < 1 or iatm > natom or iatm in seen_atoms:
                raise VibrationError("Unexpected atom index in the normal-mode displacement table")
            try:
                values = [_parse_float(token) for token in tokens[2:2 + 3 * iread]]
            except ValueError:
                raise VibrationError("Failed to parse the normal-mode displacement table") from None
            if len(values) != 3 * iread:
                raise MissingDisplacementError("The normal-mode displacement table is truncated")
            seen_atoms.add(iatm)
            for imode in range(iread):
                norm[inow + imode][iatm - 1] = values[3 * imode:3 * imode + 3]
            row += 1
        if require_all_atoms and len(seen_atoms) != natom:
            raise MissingDisplacementError("The normal-mode displacement table is missing atom rows")
        cursor = row
        inow += iread
    return norm


def _flatten_modes(norm: list[list[list[float]]]) -> list[float]:
    return [component for mode in norm for atom in mode for component in atom]


# ---------------------------------------------------------------------------
# Gaussian output (also used for the xTB companion g98.out)
# ---------------------------------------------------------------------------

_GAUSSIAN_TABLE_LABEL = re.compile(r"Atom\s+AN\b")


def _gaussian_geometry(lines: list[str], source: str) -> list[AtomSite]:
    labels = ("Standard orientation:", "Input orientation:")
    for label in sorted(labels, key=lambda value: _rindex(lines, value) if _rindex(lines, value) is not None else -1, reverse=True):
        index = _rindex(lines, label)
        if index is None:
            continue
        atoms = []
        row = index + 5  # label, dashed line, two column headers, dashed line
        while row < len(lines) and "----" not in lines[row]:
            tokens = lines[row].split()
            if len(tokens) < 6:
                raise VibrationError(f"Failed to parse the {label} coordinate block in {source}")
            try:
                atomic_number = int(tokens[1])
                x, y, z = (_parse_float(token) for token in tokens[3:6])
            except ValueError:
                raise VibrationError(f"Failed to parse the {label} coordinate block in {source}") from None
            element = ELEMENTS[atomic_number] if 0 <= atomic_number < len(ELEMENTS) else "X"
            atoms.append(AtomSite(element, atomic_number, x, y, z))
            row += 1
        if not atoms:
            raise VibrationError(f"The {label} coordinate block in {source} is empty")
        return atoms
    raise VibrationError(
        f"Unable to find a Standard or Input orientation coordinate block in {source}"
    )


def _labeled_series(lines: list[str], label: str) -> list[float]:
    """Concatenate the numeric tails of repeated 'Label -- v1 v2 v3' rows."""
    values = []
    for line in lines:
        if label in line and "--" in line:
            tail = line.split("--", 1)[1]
            try:
                values.extend(_parse_float(token) for token in tail.split())
            except ValueError:
                raise VibrationError(f"Failed to parse a '{label.strip()}' line in the output file") from None
    return values


def _mode_count_from_blocks(lines: list[str], label: str, index_offset: int) -> int | None:
    """Mode count from the index row above the LAST 'Label --' block.

    Mirrors the spectrum module: repeated frequency sections restart their
    numbering, and the final block decides how many transitions are loaded.
    """
    count = None
    for index, line in enumerate(lines):
        if label in line and index - index_offset >= 0:
            numbers = _line_ints(lines[index - index_offset])
            if numbers:
                count = max(numbers)
    return count


def _frequency_section_ranges(lines: list[str], label: str, offset: int) -> list[tuple[int, int]]:
    """Split on restarted mode numbering or an explicit new job/geometry header.

    A section contains all its consecutive blocks, not just its final triplet.
    Geometry is read from the prefix before its first block, while frequency,
    intensity and vector parsing is restricted to the selected range.
    """
    starts: list[int] = []
    previous_line: int | None = None
    previous_mode: int | None = None
    boundaries = ("Harmonic frequencies", "Standard orientation:", "Input orientation:",
                  "Entering Gaussian System", "&COORD", "MODULE QUICKSTEP", "CP2K| version")
    for index, line in enumerate(lines):
        if label not in line:
            continue
        numbers = _line_ints(lines[index - offset].replace("VIB|", " ")) if index >= offset else []
        header = max(0, index - offset) if numbers else index
        restarted = bool(numbers and previous_mode is not None and numbers[0] <= previous_mode)
        new_header = previous_line is not None and any(
            any(marker in value for marker in boundaries)
            for value in lines[previous_line + 1:header]
        )
        if not starts or restarted or new_header:
            starts.append(header)
        previous_line = index
        previous_mode = max(numbers) if numbers else None
    return list(zip(starts, starts[1:] + [len(lines)]))


def _geometry_prefix(lines: list[str], start: int, source: str) -> list[str]:
    """Do not borrow geometry across independent concatenated program runs."""
    markers = ("Entering Gaussian System",) if source in ("gaussian", "xtb") else ("CP2K| version",)
    job_start = 0
    for index, line in enumerate(lines[:start]):
        if any(marker in line for marker in markers):
            job_start = index
    return lines[job_start:start]


def _parse_gaussian_family(
    path, source_program: str, table_label: re.Pattern, table_name: str,
    *, allow_projected_modes: bool = False,
) -> VibrationData:
    all_lines = _read_lines(path)
    ranges = _frequency_section_ranges(all_lines, "Frequencies --", 2)
    if not ranges:
        raise VibrationError(f"No vibrational frequencies ('Frequencies --') were found in {path}")
    last_error = None
    for start, stop in reversed(ranges):
        try:
            atoms = _gaussian_geometry(_geometry_prefix(all_lines, start, source_program), str(path))
            data = _parse_gaussian_section(
                all_lines[start:stop], atoms, path, source_program, table_label, table_name,
                allow_projected_modes=allow_projected_modes,
            )
        except MissingDisplacementError as exc:
            last_error = exc
            continue
        if last_error is not None:
            print(f"Warning: using an earlier complete frequency section in {path}; {last_error}", file=sys.stderr)
        return data
    assert last_error is not None
    raise last_error


def _parse_gaussian_section(
    lines: list[str], atoms: list[AtomSite], path, source_program: str,
    table_label: re.Pattern, table_name: str, *, allow_projected_modes: bool = False,
) -> VibrationData:
    frequencies = _labeled_series(lines, "Frequencies -- ")
    if not frequencies:
        raise VibrationError(f"No vibrational frequencies ('Frequencies --') were found in {path}")
    count = _mode_count_from_blocks(lines, "Frequencies -- ", 2)
    if count is None:
        count = len(frequencies)
    if len(frequencies) < count:
        raise MissingDisplacementError("The frequency table is truncated in the output file")
    if len(frequencies) != count:
        raise VibrationError("The frequency indices do not match the selected section")

    intensities = _labeled_series(lines, "IR Inten    --")
    spectrum_kind = None
    intensity_unit = None
    if intensities:
        if len(intensities) < count:
            raise MissingDisplacementError("The IR intensity table is truncated in the output file")
        intensities = intensities[:count]
        spectrum_kind = "ir"
        intensity_unit = "km/mol"
    else:
        intensities = None

    norm = _read_mode_atom_tables(
        lines, table_label, len(atoms), count, table_name, require_all_atoms=True
    )
    data = VibrationData(
        source_program=source_program,
        spectrum_kind=spectrum_kind,
        intensity_unit=intensity_unit,
        atoms=atoms,
        frequencies=frequencies,
        intensities=intensities,
        displacements=_flatten_modes(norm),
    )
    return validate_vibration_data(data, allow_projected_modes=allow_projected_modes)


def parse_gaussian_output(path) -> VibrationData:
    return _parse_gaussian_family(path, "gaussian", _GAUSSIAN_TABLE_LABEL, "Atom  AN")


# ---------------------------------------------------------------------------
# ORCA output: full normal-mode matrix, LAST section of repeated runs
# ---------------------------------------------------------------------------

_ORCA_GEOMETRY_LABEL = "CARTESIAN COORDINATES (ANGSTROEM)"
_ORCA_FIRST_VIB_LABEL = "The first frequency considered to be a vibration is"
_ORCA_MATRIX_LABEL = "Thus, these vectors are normalized but"
_ORCA_FREQ_LINE = re.compile(r"^\s*\d+:\s+[-+0-9.eEdD]+\s+cm\*\*-1")
_ORCA_MODE_ROW = re.compile(r"^\s*\d+:")


def _orca_geometry(lines: list[str]) -> list[AtomSite]:
    index = _rindex(lines, _ORCA_GEOMETRY_LABEL)
    if index is None:
        raise VibrationError(
            'Unable to find the "CARTESIAN COORDINATES (ANGSTROEM)" block in the ORCA output file'
        )
    atoms = []
    row = index + 2  # label line and dashed line
    while row < len(lines) and lines[row].strip() != "":
        tokens = lines[row].split()
        if len(tokens) < 4:
            raise VibrationError("Failed to parse the ORCA coordinate block")
        try:
            x, y, z = (_parse_float(token) for token in tokens[1:4])
        except ValueError:
            raise VibrationError("Failed to parse the ORCA coordinate block") from None
        element = tokens[0].capitalize()
        z_number = ELEMENTS.index(element) if element in ELEMENTS else 0
        atoms.append(AtomSite(element, z_number, x, y, z))
        row += 1
    if not atoms:
        raise VibrationError("The ORCA coordinate block is empty")
    return atoms


def _orca_first_vibration(lines: list[str]) -> int:
    index = _rindex(lines, _ORCA_FIRST_VIB_LABEL)
    if index is None:
        raise MissingDisplacementError(
            "Unable to find the vibrational frequencies section in the ORCA output file"
        )
    line = lines[index]
    tail = line[52:] if len(line) > 52 else ""
    numbers = _line_ints(tail) or _line_ints(line.rsplit("is", 1)[-1])
    if not numbers or numbers[0] < 0:
        raise VibrationError("Failed to locate the first vibrational mode in the ORCA output file")
    return numbers[0]


def _orca_frequencies(lines: list[str], iskip: int) -> tuple[list[float], list[float] | None]:
    """Frequencies/intensities from the LAST IR SPECTRUM table, else the raw cm**-1 list."""
    index = _rindex(lines, "IR SPECTRUM")
    if index is not None:
        rows = []
        intensity_index = 2  # Legacy tables without an Int header.
        for line in lines[index + 1:]:
            if _ORCA_MODE_ROW.match(line):
                rows.append(line)
            elif rows:
                break
            else:
                header = [token.casefold() for token in line.split()]
                if "mode" in header:
                    for column in ("int", "intensity"):
                        if column in header:
                            intensity_index = header.index(column)
                            break
        frequencies: list[float] = []
        intensities: list[float] = []
        for line in rows:
            tokens = line.rstrip(":").split()
            tokens[0] = tokens[0].rstrip(":")
            try:
                frequencies.append(_parse_float(tokens[1]))
            except (ValueError, IndexError):
                raise VibrationError("Failed to parse the ORCA IR spectrum table") from None
            try:
                intensities.append(_parse_float(tokens[intensity_index]))
            except (ValueError, IndexError):
                intensities.append(float("nan"))
        if frequencies:
            if any(not math.isfinite(value) for value in intensities):
                return frequencies, None
            return frequencies, intensities
    # Fall back to the plain frequency list of the LAST VIBRATIONAL FREQUENCIES section.
    section = _rindex(lines, "VIBRATIONAL FREQUENCIES")
    if section is None:
        raise VibrationError(
            "Unable to find the vibrational frequencies in the ORCA output file"
        )
    stop = _rindex(lines, _ORCA_MATRIX_LABEL)
    if stop is None or stop < section:
        stop = len(lines)
    frequencies = []
    for line in lines[section + 1:stop]:
        if _ORCA_FREQ_LINE.match(line):
            try:
                frequencies.append(_parse_float(line.split(":", 1)[1].split()[0]))
            except (ValueError, IndexError):
                raise VibrationError("Failed to parse the ORCA vibrational frequencies") from None
    frequencies = frequencies[iskip:]
    if not frequencies:
        raise VibrationError("No vibrational frequencies were found in the ORCA output file")
    return frequencies, None


def _orca_mode_matrix(lines: list[str], natom: int, nmodes: int, iskip: int) -> list[list[list[float]]]:
    """Full normal-mode matrix of the LAST frequency section, f11.6 fields of 6 columns."""
    index = _rindex(lines, _ORCA_MATRIX_LABEL)
    if index is None:
        raise MissingDisplacementError(
            "Unable to find the normal-mode matrix in the ORCA output file"
        )
    ncols = iskip + nmodes
    nrows = 3 * natom
    matrix: list[list[float]] = [[] for _ in range(nrows)]
    row = index + 2  # marker line and the "NORMAL MODES" title line
    columns_read = 0
    while columns_read < ncols:
        block_cols = min(6, ncols - columns_read)
        row += 1  # column-number header of this frame
        for irow in range(nrows):
            if row >= len(lines):
                raise VibrationError("Failed to parse the normal-mode matrix in the ORCA output file")
            body = lines[row][11:]  # inskipcol=11 row label
            for icol in range(block_cols):
                field = body[11 * icol:11 * icol + 11].strip()
                try:
                    value = _parse_float(field) if field else 0.0
                except ValueError:
                    raise VibrationError(
                        "Failed to parse the normal-mode matrix in the ORCA output file"
                    ) from None
                matrix[irow].append(value)
            row += 1
        columns_read += block_cols
    norm = [
        [[matrix[3 * iatm + idir][iskip + imode] for idir in range(3)] for iatm in range(natom)]
        for imode in range(nmodes)
    ]
    return norm


def parse_orca_output(path) -> VibrationData:
    lines = _read_lines(path)
    atoms = _orca_geometry(lines)
    iskip = _orca_first_vibration(lines)
    frequencies, intensities = _orca_frequencies(lines, iskip)
    norm = _orca_mode_matrix(lines, len(atoms), len(frequencies), iskip)
    data = VibrationData(
        source_program="orca",
        spectrum_kind="ir" if intensities is not None else None,
        intensity_unit="km/mol" if intensities is not None else None,
        atoms=atoms,
        frequencies=frequencies,
        intensities=intensities,
        displacements=_flatten_modes(norm),
    )
    return validate_vibration_data(data)


# ---------------------------------------------------------------------------
# CP2K output: "VIB|Frequency (cm^-1)" blocks and "ATOM  EL" tables
# ---------------------------------------------------------------------------

_CP2K_TABLE_LABEL = re.compile(r"ATOM\s+EL\b")
_CP2K_FREQ_LABEL = "VIB|Frequency (cm^-1)"
_CP2K_INTENSITY_PREFIX = re.compile(r"^\s*VIB\|[^0-9+\-.]*")
_CP2K_QUICKSTEP_ROW = re.compile(r"^\s*\d+\s+\d+\s+([A-Za-z]{1,3})\s+")


def _cp2k_geometry(lines: list[str]) -> list[AtomSite]:
    coord_index = None
    for index in range(len(lines) - 1, -1, -1):
        if re.search(r"&COORD\b", lines[index], re.IGNORECASE):
            coord_index = index
            break
    if coord_index is not None:
        atoms = []
        for line in lines[coord_index + 1:]:
            if re.search(r"&END\b", line, re.IGNORECASE):
                break
            tokens = line.split()
            if len(tokens) < 4:
                continue
            match = re.match(r"[A-Za-z]+", tokens[0])
            if match is None:
                continue
            try:
                x, y, z = (_parse_float(token) for token in tokens[1:4])
            except ValueError:
                continue
            element = match.group(0).capitalize()
            z_number = ELEMENTS.index(element) if element in ELEMENTS else 0
            atoms.append(AtomSite(element, z_number, x, y, z))
        if atoms:
            return atoms
    # Fall back to the "MODULE QUICKSTEP: ATOMIC COORDINATES IN angstrom" section.
    quickstep = None
    for index in range(len(lines) - 1, -1, -1):
        if "MODULE QUICKSTEP" in lines[index] and "ATOMIC COORDINATES" in lines[index]:
            quickstep = index
            break
    if quickstep is None:
        raise VibrationError(
            "Unable to find a &COORD block or MODULE QUICKSTEP coordinate section in the CP2K output file"
        )
    atoms = []
    started = False
    for line in lines[quickstep + 1:]:
        match = _CP2K_QUICKSTEP_ROW.match(line)
        if match is None:
            if started:
                break
            continue
        tokens = line.split()
        if len(tokens) < 6:
            if started:
                break
            continue
        try:
            x, y, z = (_parse_float(token) for token in tokens[3:6])
        except ValueError:
            if started:
                break
            continue
        element = match.group(1).capitalize()
        z_number = ELEMENTS.index(element) if element in ELEMENTS else 0
        atoms.append(AtomSite(element, z_number, x, y, z))
        started = True
    if not atoms:
        raise VibrationError("The CP2K coordinate section is empty")
    return atoms


def parse_cp2k_output(path) -> VibrationData:
    """Read the last complete CP2K section; never pair arrays across runs."""
    all_lines = _read_lines(path)
    ranges = _frequency_section_ranges(all_lines, _CP2K_FREQ_LABEL, 1)
    if not ranges:
        raise VibrationError("No CP2K vibrational frequency section was found")
    last_error = None
    for start, stop in reversed(ranges):
        try:
            atoms = _cp2k_geometry(_geometry_prefix(all_lines, start, "cp2k"))
            data = _parse_cp2k_section(all_lines[start:stop], atoms)
        except MissingDisplacementError as exc:
            last_error = exc
            continue
        if last_error is not None:
            print(f"Warning: using an earlier complete frequency section in {path}; {last_error}", file=sys.stderr)
        return data
    assert last_error is not None
    raise last_error


def _parse_cp2k_section(lines: list[str], atoms: list[AtomSite]) -> VibrationData:
    frequencies: list[float] = []
    intensities: list[float] = []
    have_intensity = True
    for index, line in enumerate(lines):
        if _CP2K_FREQ_LABEL not in line:
            continue
        tail = line.split("(cm^-1)", 1)[1]
        block_freqs = _line_floats(tail)
        if not block_freqs:
            raise VibrationError("Failed to parse a CP2K frequency line")
        frequencies.extend(block_freqs)
        if index + 1 < len(lines) and "VIB|" in lines[index + 1]:
            intensity_tail = _CP2K_INTENSITY_PREFIX.sub("", lines[index + 1])
            block_intensities = _line_floats(intensity_tail)
        else:
            block_intensities = []
        if len(block_intensities) < len(block_freqs):
            have_intensity = False
        intensities.extend(block_intensities[:len(block_freqs)])
    if not frequencies:
        raise VibrationError(
            "No vibrational frequencies ('VIB|Frequency (cm^-1)') were found in the CP2K output file"
        )

    count = None
    for index, line in enumerate(lines):
        if _CP2K_FREQ_LABEL in line and index >= 1:
            numbers = _line_ints(lines[index - 1].replace("VIB|", " "))
            if numbers:
                count = max(numbers)
    if count is None:
        count = len(frequencies)
    if len(frequencies) < count:
        raise MissingDisplacementError("The CP2K frequency table is truncated in the output file")
    if len(frequencies) != count:
        raise VibrationError("The CP2K frequency indices do not match the selected section")
    if have_intensity and len(intensities) >= count:
        intensities = intensities[:count]
        spectrum_kind = "ir"
        intensity_unit = "km/mol"
    else:
        intensities = None
        spectrum_kind = None
        intensity_unit = None

    norm = _read_mode_atom_tables(
        lines, _CP2K_TABLE_LABEL, len(atoms), count, "ATOM  EL", require_all_atoms=True
    )
    data = VibrationData(
        source_program="cp2k",
        spectrum_kind=spectrum_kind,
        intensity_unit=intensity_unit,
        atoms=atoms,
        frequencies=frequencies,
        intensities=intensities,
        displacements=_flatten_modes(norm),
    )
    return validate_vibration_data(data)


# ---------------------------------------------------------------------------
# xTB output: frequencies from "$vibrational spectrum", geometry and
# displacements from the companion g98.out (same atom order)
# ---------------------------------------------------------------------------

_XTB_G98_TABLE_LABEL = re.compile(r"Atom\s+AN\b")


def parse_xtb_output(path, g98_path=None) -> VibrationData:
    lines = _read_lines(path)
    sections = [index for index, line in enumerate(lines)
                if line.strip().casefold() == "$vibrational spectrum"]
    if not sections:
        raise VibrationError("Unable to recognize the xTB vibrational spectrum section in the output file")
    if g98_path is None:
        raise MissingDisplacementError(
            "xTB spectra carry no normal-mode vectors; pass the companion g98.out with --g98-out"
        )
    section = sections[-1]
    end = next((index for index in range(section + 1, len(lines))
                if lines[index].strip().startswith("$")), None)
    if end is None or lines[end].strip().casefold() != "$end":
        raise VibrationError("The final xTB vibrational spectrum section is incomplete (missing $end)")
    frequencies: list[float] = []
    intensities: list[float] = []
    for line in lines[section + 1:end]:
        tokens = line.split("#", 1)[0].split()
        if not tokens:
            continue
        try:
            mode = int(tokens[0])
            if mode != len(frequencies) + 1:
                raise VibrationError("xTB mode numbers must be consecutive, starting at 1")
            # Translation/rotation rows omit the symmetry token. Active rows
            # may append IR/Raman selection-rule fields; those are not data.
            try:
                _parse_float(tokens[1])
                frequency_column = 1
            except ValueError:
                frequency_column = 2
            frequencies.append(_parse_float(tokens[frequency_column]))
            intensities.append(_parse_float(tokens[frequency_column + 1]))
        except (ValueError, IndexError) as exc:
            raise VibrationError(f"Failed to parse xTB spectrum row: {line.strip()}") from exc
    if not frequencies:
        raise VibrationError("No vibrational frequencies were found in the xTB spectrum")

    companion = _parse_gaussian_family(
        g98_path, "xtb", _XTB_G98_TABLE_LABEL, "Atom AN", allow_projected_modes=True,
    )
    if len(frequencies) != companion.nmode or any(
        not math.isclose(value, reference, rel_tol=0.0, abs_tol=0.02)
        for value, reference in zip(frequencies, companion.frequencies)
    ):
        raise VibrationError("The xTB spectrum frequencies/mode count do not match the g98.out companion")
    # Keep all rows through the correspondence check. Only then omit projected
    # zero-frequency/zero-vector columns that cannot be animated. Do not omit
    # genuine low/imaginary modes, and preserve original source mode numbers.
    stride = companion.natom * 3
    keep = [index for index, frequency in enumerate(frequencies)
            if not (abs(frequency) <= 0.01 and all(
                value == 0.0 for value in companion.displacements[index * stride:(index + 1) * stride]
            ))]
    data = VibrationData(
        source_program="xtb",
        spectrum_kind="ir",
        intensity_unit="km/mol",
        atoms=companion.atoms,
        frequencies=[frequencies[index] for index in keep],
        intensities=[intensities[index] for index in keep],
        displacements=[value for index in keep
                       for value in companion.displacements[index * stride:(index + 1) * stride]],
        mode_indices=[index + 1 for index in keep],
    )
    return validate_vibration_data(data)


def load_vibration_input(path, g98_out=None) -> VibrationData:
    program = detect_program(path)
    if program == "gaussian":
        return parse_gaussian_output(path)
    if program == "orca":
        return parse_orca_output(path)
    if program == "cp2k":
        return parse_cp2k_output(path)
    if program == "xtb":
        return parse_xtb_output(path, g98_out)
    raise UnsupportedFormatError(program)  # pragma: no cover - detect_program is exhaustive


# ---------------------------------------------------------------------------
# Session files: manifest.json + structure.json
# ---------------------------------------------------------------------------

MANIFEST_FORMAT = "multiwfn-matterviz-vibration"
MANIFEST_VERSION = 1
GENERATED_BY = "multiwfn_vibration_viewer.py"
DISPLACEMENT_CONVENTION = "normalized Cartesian (not mass weighted), as printed by the source program"
DATASET_ID = 1


def build_manifest(data: VibrationData, dataset_id: int = DATASET_ID) -> dict:
    modes = []
    for index, frequency in enumerate(data.frequencies):
        intensity = data.intensities[index] if data.intensities is not None else None
        mode_number = data.mode_indices[index] if data.mode_indices is not None else index + 1
        modes.append({"index": mode_number, "frequency": frequency, "intensity": intensity})
    return {
        "format": MANIFEST_FORMAT,
        "version": MANIFEST_VERSION,
        "generatedBy": GENERATED_BY,
        "structure": {"path": "structure.json", "format": "json"},
        "vibrations": {
            "sourceProgram": data.source_program,
            "spectrumKind": data.spectrum_kind,
            "atomCount": data.natom,
            "modeCount": data.nmode,
            "coordinateUnit": "angstrom",
            "frequencyUnit": "cm^-1",
            "intensityUnit": data.intensity_unit,
            "displacementConvention": DISPLACEMENT_CONVENTION,
            "modes": modes,
            "displacements": {
                "datasetId": dataset_id,
                "format": "mwfn-plot-data-v1",
                "role": "u",
                "layout": "mode-major-atom-xyz",
                "shape": [data.nmode, data.natom, 3],
            },
        },
    }


def build_structure(data: VibrationData) -> dict:
    sites = []
    for index, site in enumerate(data.atoms):
        properties = {"multiwfnGhost": True} if site.z == 0 else {}
        sites.append({
            "species": [{"element": site.element, "occu": 1, "oxidation_state": 0}],
            "abc": [0, 0, 0],
            "xyz": [site.x, site.y, site.z_coord],
            "label": f"{site.element}{index + 1}",
            "properties": properties,
        })
    # Output files carry no connectivity; an empty bond list is dropped by the
    # viewer so the renderer auto-detects bonds.
    return {"sites": sites, "charge": 0, "properties": {"bonds": []}}


def write_session(data: VibrationData, session_dir: Path, dataset_id: int = DATASET_ID) -> dict:
    session_dir = Path(session_dir)
    session_dir.mkdir(parents=True, exist_ok=True)
    manifest = build_manifest(data, dataset_id)
    (session_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    (session_dir / "structure.json").write_text(
        json.dumps(build_structure(data), indent=2) + "\n", encoding="utf-8"
    )
    return manifest


# ---------------------------------------------------------------------------
# Loopback HTTP service for the session
# ---------------------------------------------------------------------------

STOP_FLAG_NAME = "gui_stop.flag"
STARTUP_STATUS_NAME = "gui_startup.status"
STARTUP_STATUS_ENV = "MULTIWFN_MATTERVIZ_STARTUP_STATUS"
STARTUP_TOKEN_ENV = "MULTIWFN_MATTERVIZ_STARTUP_TOKEN"
STOP_FILE_ENV = "MULTIWFN_MATTERVIZ_STOP_FILE"
STARTUP_TIMEOUT_ENV = "MULTIWFN_MATTERVIZ_STARTUP_TIMEOUT"
DEFAULT_STARTUP_TIMEOUT = 15.0
STARTUP_POLL_INTERVAL = 0.02
SHELL_STOP_GRACE_SECONDS = 2.0
MAX_SAVE_FILE_BYTES = 64 * 1024 * 1024
HTTP_READ_TIMEOUT = 10.0


def sanitize_save_file_name(filename: str | None) -> str:
    """Mirror sanitize_save_file_name in frontend/matterviz-viewer/src/vibration.ts."""
    name = re.split(r"[\\/]", filename or "")[-1].strip()
    cleaned = "".join(
        character for character in name
        if ord(character) >= 0x20 and ord(character) != 0x7F and character != ":"
    )
    return cleaned if cleaned not in ("", ".", "..") else "export.bin"


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = False
    allow_reuse_port = False

    def server_bind(self) -> None:
        # On Windows SO_REUSEADDR permits multiple live servers to bind the
        # same address; exclusive use keeps session URLs unambiguous.
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def bind_vibration_server(host: str, preferred_port: int, handler) -> http.server.HTTPServer:
    """Bind once, falling back to an OS-assigned port when preferred is busy."""
    try:
        return ThreadingHTTPServer((host, preferred_port), handler)
    except OSError:
        if preferred_port == 0:
            raise
        return ThreadingHTTPServer((host, 0), handler)


def make_vibration_handler(session_dir: Path, datasets: dict[int, bytes], export_dir: Path, frontend_dir: Path | None = None):
    session_dir = Path(session_dir).resolve()
    export_dir = Path(export_dir).resolve()
    if frontend_dir is not None:
        frontend_dir = Path(frontend_dir).resolve()
    session_capability = secrets.token_urlsafe(32)

    def send_json(handler, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(body)))
        handler.send_header("Cache-Control", "no-store")
        handler.end_headers()
        handler.wfile.write(body)

    def send_bytes(handler, body: bytes, content_type: str) -> None:
        handler.send_response(200)
        handler.send_header("Content-Type", content_type)
        handler.send_header("Content-Length", str(len(body)))
        handler.send_header("Cache-Control", "no-store")
        handler.end_headers()
        handler.wfile.write(body)

    def send_session_file(handler, request_path: str) -> None:
        rel = request_path[len("/session/"):]
        candidate = (session_dir / rel).resolve()
        try:
            candidate.relative_to(session_dir)
        except ValueError:
            handler.send_error(403, "Invalid session path")
            return
        if not candidate.is_file():
            handler.send_error(404, "File not found")
            return
        content_type = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
        send_bytes(handler, candidate.read_bytes(), content_type)

    def handle_return(handler) -> None:
        try:
            (session_dir / STOP_FLAG_NAME).write_text("return\n", encoding="utf-8")
        except OSError:
            pass
        send_json(handler, {"ok": True})
        threading.Thread(target=handler.server.shutdown, daemon=True).start()

    class VibrationSessionHandler(http.server.BaseHTTPRequestHandler):
        capability = session_capability

        def setup(self) -> None:
            super().setup()
            self.connection.settimeout(HTTP_READ_TIMEOUT)

        def log_message(self, fmt: str, *args) -> None:
            # Request targets contain the bearer capability: do not log them.
            sys.stderr.write("[multiwfn-vibration] HTTP request handled\n")

        def authorize(self) -> bool:
            authority = f"127.0.0.1:{self.server.server_address[1]}"
            origin = f"http://{authority}"
            hosts = self.headers.get_all("Host", [])
            origins = self.headers.get_all("Origin", [])
            try:
                parsed = urllib.parse.urlsplit(self.path)
                query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True, max_num_fields=32)
            except ValueError:
                send_json(self, {"ok": False, "message": "Forbidden"}, status=403)
                return False
            supplied = query.get("cap", [])
            valid = (
                not parsed.scheme and not parsed.netloc
                and hosts == [authority]
                and (origins == [origin] or (not origins and self.command == "GET"))
                and len(supplied) == 1
                and secrets.compare_digest(supplied[0].encode("utf-8"), session_capability.encode("ascii"))
            )
            if not valid:
                send_json(self, {"ok": False, "message": "Forbidden"}, status=403)
            return valid

        def check_loopback_host(self) -> bool:
            authority = f"127.0.0.1:{self.server.server_address[1]}"
            if self.headers.get_all("Host", []) != [authority]:
                send_json(self, {"ok": False, "message": "Forbidden"}, status=403)
                return False
            return True

        def serve_frontend_file(self, request_path: str) -> None:
            # The entry document and its assets are public package content; the
            # bearer capability still guards /session/* and /api/*.
            if not self.check_loopback_host():
                return
            if frontend_dir is None:
                self.send_error(404, "Not found")
                return
            rel = request_path.lstrip("/")
            if rel in ("", "."):
                rel = "vibration.html"
            candidate = (frontend_dir / rel).resolve()
            try:
                candidate.relative_to(frontend_dir)
            except ValueError:
                self.send_error(403, "Invalid frontend path")
                return
            if not candidate.is_file():
                self.send_error(404, "File not found")
                return
            content_type = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
            send_bytes(self, candidate.read_bytes(), content_type)

        def read_request_body(self) -> bytes | None:
            lengths = self.headers.get_all("Content-Length", [])
            # No ambiguous framing, negative sizes or unbounded chunked streams.
            if self.headers.get_all("Transfer-Encoding") or len(lengths) > 1:
                send_json(self, {"ok": False, "message": "Invalid request framing"}, status=400)
                return None
            raw = lengths[0] if lengths else "0"
            if not re.fullmatch(r"[0-9]{1,10}", raw):
                send_json(self, {"ok": False, "message": "Invalid Content-Length"}, status=400)
                return None
            length = int(raw)
            if length > MAX_SAVE_FILE_BYTES:
                send_json(self, {"ok": False, "message": "Request body too large"}, status=413)
                return None
            try:
                body = self.rfile.read(length)
            except (OSError, TimeoutError):
                send_json(self, {"ok": False, "message": "Request body timed out"}, status=408)
                return None
            if len(body) != length:
                send_json(self, {"ok": False, "message": "Truncated request body"}, status=400)
                return None
            return body

        def do_GET(self) -> None:  # noqa: N802 - http.server naming
            request_path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
            if not request_path.startswith(("/session/", "/api/")):
                self.serve_frontend_file(request_path)
                return
            if not self.authorize():
                return
            if request_path.startswith("/session/"):
                send_session_file(self, request_path)
                return
            if request_path.startswith("/api/plot-data/"):
                raw_id = request_path[len("/api/plot-data/"):]
                try:
                    dataset_id = int(raw_id)
                except ValueError:
                    self.send_error(404, "Unknown plot dataset")
                    return
                frame = datasets.get(dataset_id)
                if frame is None:
                    self.send_error(404, "Unknown plot dataset")
                    return
                send_bytes(self, frame, PLOT_DATA_MIME)
                return
            if request_path == "/api/return":
                handle_return(self)
                return
            if request_path == "/api/ready":
                send_json(self, {"ok": True})
                return
            self.send_error(404, "Not found")

        def do_POST(self) -> None:  # noqa: N802 - http.server naming
            if not self.authorize():
                return
            body = self.read_request_body()
            if body is None:
                return
            parsed = urllib.parse.urlparse(self.path)
            request_path = urllib.parse.unquote(parsed.path)
            if request_path == "/api/ready":
                send_json(self, {"ok": True})
                return
            if request_path == "/api/return":
                handle_return(self)
                return
            if request_path == "/api/save-file":
                query = urllib.parse.parse_qs(parsed.query)
                name = sanitize_save_file_name(query.get("name", [None])[0])
                try:
                    export_dir.mkdir(parents=True, exist_ok=True)
                    target = export_dir / name
                    target.write_bytes(body)
                except OSError as exc:
                    send_json(self, {"ok": False, "message": str(exc)}, status=500)
                    return
                send_json(self, {"ok": True, "path": str(target)})
                return
            self.send_error(404, "Not found")

    return VibrationSessionHandler


# ---------------------------------------------------------------------------
# Desktop shell resolution and startup (patterns from multiwfn_matterviz_webview.py)
# ---------------------------------------------------------------------------

def resolve_desktop() -> Path | None:
    configured = os.environ.get("MULTIWFN_MATTERVIZ_WEBVIEW")
    if configured:
        candidate = Path(configured).expanduser().resolve()
        return candidate if candidate.is_file() else None
    suffix = ".exe" if os.name == "nt" else ""
    candidates: list[Path] = []
    if getattr(sys, "frozen", False):
        # PyInstaller onefile unpacks modules into a temporary directory, so
        # __file__ cannot locate the bundled tools; the packaged layout places
        # this launcher beside matterviz-desktop in resources/tools/.
        candidates.append(Path(sys.executable).resolve().parent / f"matterviz-desktop{suffix}")
    here = Path(__file__).resolve()
    candidates.extend((
        here.parent / f"matterviz-desktop{suffix}",
        here.parents[1] / "frontend" / "matterviz-desktop" / "target" / "release" / f"matterviz-desktop{suffix}",
        here.parents[1] / "build-matterviz-gui" / "resources" / "tools" / f"matterviz-desktop{suffix}",
    ))
    return next((candidate for candidate in candidates if candidate.is_file()), None)


def resolve_frontend_dist() -> Path | None:
    """Locate the built MatterViz frontend dist that carries vibration.html.

    The frozen package layout places the launcher at
    resources/tools/multiwfn-vibration with the frontend at
    resources/frontend/matterviz-viewer/dist.
    """
    candidates: list[Path] = []
    if getattr(sys, "frozen", False):
        candidates.append(
            Path(sys.executable).resolve().parent.parent
            / "frontend" / "matterviz-viewer" / "dist"
        )
    here = Path(__file__).resolve()
    candidates.extend((
        here.parents[1] / "frontend" / "matterviz-viewer" / "dist",
        here.parents[1] / "build-matterviz-gui" / "resources" / "frontend" / "matterviz-viewer" / "dist",
    ))
    return next((candidate for candidate in candidates if (candidate / "vibration.html").is_file()), None)


def startup_timeout() -> float:
    configured = os.environ.get(STARTUP_TIMEOUT_ENV)
    timeout = float(configured) if configured is not None else DEFAULT_STARTUP_TIMEOUT
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("startup timeout must be a finite positive number")
    return timeout


def wait_for_desktop_startup(process, status_path: Path, token: str, timeout: float) -> tuple[str, str | None]:
    """Wait until the desktop shell reports ready/error, exits or times out."""
    deadline = time.monotonic() + timeout
    while True:
        try:
            text = status_path.read_text(encoding="utf-8").strip()
        except (FileNotFoundError, OSError, UnicodeDecodeError):
            text = ""
        if text:
            state = None
            message = None
            try:
                payload = json.loads(text)
            except json.JSONDecodeError:
                payload = None
            if isinstance(payload, dict):
                candidate = payload.get("status") or payload.get("state")
                if isinstance(candidate, str) and payload.get("token") == token:
                    state = candidate.lower()
                    detail = payload.get("message")
                    message = detail if isinstance(detail, str) else None
            else:
                fields = text.split(maxsplit=2)
                if fields and fields[0].rstrip(":").lower() in {"ready", "error", "failed"}:
                    state = fields[0].rstrip(":").lower()
                    message = fields[-1] if len(fields) >= 2 else None
            if state is not None:
                return state, message
        returncode = process.poll()
        if returncode is not None:
            return "early_exit", str(returncode)
        if time.monotonic() >= deadline:
            return "timeout", None
        time.sleep(STARTUP_POLL_INTERVAL)


# ---------------------------------------------------------------------------
# Native file-dialog input collection (matterviz-desktop --select-file)
# ---------------------------------------------------------------------------

def desktop_session_available() -> bool:
    """Cheap headless pre-check; the dialog itself still fails closed (rc 2)."""
    if os.name == "nt" or sys.platform == "darwin":
        return True
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def run_file_dialog(desktop: Path, output: Path) -> Path | None:
    """One `matterviz-desktop --select-file --output <output>` round.

    Contract (frontend/matterviz-desktop/src/main.rs): exit 0 with `output`
    written -> the first line is the selected path; exit 0 without `output`
    -> the user cancelled; exit 2 -> the dialog failed (e.g. no desktop
    session). Returns the selected path, or None on cancellation.
    """
    try:
        output.unlink()
    except OSError:
        pass
    try:
        result = subprocess.run(
            [str(desktop), "--select-file", "--output", str(output)],
            capture_output=True, text=True,
        )
    except OSError as exc:
        raise VibrationError(f"Could not start the MatterViz file dialog: {exc}") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        message = (
            "The MatterViz native file dialog failed "
            f"(exit code {result.returncode}); a desktop session is required. "
            "Pass the input file(s) as arguments instead, or use --no-pick."
        )
        if detail:
            message = f"{message}\n{detail}"
        raise VibrationError(message)
    try:
        selected = output.read_text(encoding="utf-8").splitlines()[0].strip()
    except (OSError, IndexError):
        return None
    return Path(selected) if selected else None


def pick_input_files(desktop: Path, *, g98_out: str | None) -> tuple[list[Path], str | None]:
    """Collect the batch queue through repeated native file-dialog rounds.

    Every picked file is queued and the dialog reopens; Cancel ends the
    collection. Right after an xTB spectrum is picked (and no g98.out
    companion was supplied yet), one extra dialog round offers to pick the
    companion, so a following queue pick is never mistaken for g98.out.
    """
    picked: list[Path] = []
    with tempfile.TemporaryDirectory(prefix="multiwfn-vibration-pick-") as scratch:
        output = Path(scratch) / "selected_file.txt"
        while True:
            selected = run_file_dialog(desktop, output)
            if selected is None:
                break
            picked.append(selected)
            print(f"Queued input {len(picked)}: {selected}")
            if g98_out is not None:
                continue
            try:
                program = detect_program(selected)
            except VibrationError:
                program = None
            if program == "xtb":
                print(
                    "An xTB spectrum was selected; its normal-mode vectors live in the "
                    "companion g98.out (xtb --g98). Pick it in the next dialog, or Cancel "
                    "to keep it unset (the xTB session will then fail with the --g98-out hint)."
                )
                companion = run_file_dialog(desktop, output)
                if companion is not None:
                    g98_out = str(companion)
                    print(f"Using g98.out companion: {companion}")
    return picked, g98_out


def serve_vibration_session(
    data: VibrationData,
    *,
    session_dir: Path,
    export_dir: Path,
    port: int,
    launch: bool,
    desktop: Path | None = None,
    frontend_dir: Path | None = None,
) -> int:
    """Build the session, serve it and (unless launch=False) open the desktop shell."""
    session_dir = Path(session_dir).resolve()
    write_session(data, session_dir)
    frame = encode_plot_dataset(DATASET_ID, data.displacements)
    if frontend_dir is None:
        frontend_dir = resolve_frontend_dist()
    handler = make_vibration_handler(session_dir, {DATASET_ID: frame}, export_dir, frontend_dir)
    try:
        server = bind_vibration_server("127.0.0.1", port, handler)
    except OSError as exc:
        print(f"Could not bind the MatterViz vibration service: {exc}", file=sys.stderr)
        return 2
    actual_port = int(server.server_address[1])
    query = urllib.parse.urlencode({
        "manifest": "/session/manifest.json", "cap": handler.capability,
    })
    url = f"http://127.0.0.1:{actual_port}/vibration.html?{query}"

    if not launch:
        print(f"Vibration session : {session_dir}")
        print(f"Manifest          : {session_dir / 'manifest.json'}")
        print(f"Session URL       : {url}")
        server.server_close()
        return 0

    if frontend_dir is None:
        print(
            "Warning: the MatterViz frontend dist was not found; the desktop shell cannot "
            "display vibration.html from this service.",
            file=sys.stderr,
        )
    if desktop is None:
        desktop = resolve_desktop()
    if desktop is None:
        server.server_close()
        print(
            "MatterViz desktop executable not found; set MULTIWFN_MATTERVIZ_WEBVIEW to its path.",
            file=sys.stderr,
        )
        return 2

    status_path = session_dir / STARTUP_STATUS_NAME
    try:
        status_path.unlink()
    except OSError:
        pass
    token = secrets.token_hex(16)
    try:
        timeout = startup_timeout()
    except ValueError as exc:
        server.server_close()
        print(f"MatterViz desktop startup failed: {exc}", file=sys.stderr)
        return 2

    service_thread = threading.Thread(target=server.serve_forever, daemon=True)
    service_thread.start()
    env = os.environ.copy()
    env[STARTUP_STATUS_ENV] = str(status_path)
    env[STARTUP_TOKEN_ENV] = token
    env[STOP_FILE_ENV] = str(session_dir / STOP_FLAG_NAME)
    try:
        process = subprocess.Popen([str(desktop), "--url", url], env=env)
    except OSError as exc:
        server.shutdown()
        server.server_close()
        print(f"Could not launch MatterViz desktop: {exc}", file=sys.stderr)
        return 2

    print(f"MatterViz vibration session: {url}", flush=True)
    exit_code = 0
    try:
        state, detail = wait_for_desktop_startup(process, status_path, token, timeout)
        if state == "ready":
            while process.poll() is None:
                if (session_dir / STOP_FLAG_NAME).is_file():
                    try:
                        process.wait(timeout=SHELL_STOP_GRACE_SECONDS)
                    except subprocess.TimeoutExpired:
                        pass
                    break
                time.sleep(0.05)
        elif state == "early_exit":
            print(f"MatterViz desktop exited before startup readiness (status {detail}).", file=sys.stderr)
            exit_code = 2
        elif state == "timeout":
            print(f"MatterViz desktop startup timed out after {timeout:g} seconds.", file=sys.stderr)
            exit_code = 2
        else:
            print(f"MatterViz desktop startup error: {detail or state}", file=sys.stderr)
            exit_code = 2
    except KeyboardInterrupt:
        print("MatterViz vibration session interrupted.", file=sys.stderr)
        exit_code = 2
    finally:
        try:
            (session_dir / STOP_FLAG_NAME).write_text("return\n", encoding="utf-8")
        except OSError:
            pass
        try:
            server.shutdown()
        except (OSError, RuntimeError):
            pass
        server.server_close()
        if process.poll() is None:
            try:
                process.terminate()
                process.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    process.kill()
                except OSError:
                    pass
    return exit_code


# ---------------------------------------------------------------------------
# External batch engine: drive the existing GUI-enabled Multiwfn via stdin
# ---------------------------------------------------------------------------

SPECTRUM_CODES = {"ir": "1", "raman": "2"}
DEFAULT_COMPUTE_MENU = "11,{spectrum},-2,0,q"
MULTIWFN_TASK_TIMEOUT = 300.0
STOCK_ENGINE_HINT = (
    "Stock Multiwfn menus (including the default 11,-2 transition export, which only "
    "writes transinfo.txt with frequencies and intensities) do not write normal-mode "
    "displacement vectors to any file; point --multiwfn at a wrapper that produces a "
    "complete quantum-chemistry output and declare its product with --compute-artifact "
    "(see docs/matterviz-vibration-protocol.md)"
)


@dataclass
class MultiwfnTask:
    """One external engine run: input, stdin menu lines, declared file artifacts.

    `artifacts` are paths or globs relative to the task's own working directory
    (e.g. ["transinfo.txt"] for a stock menu run, ["g98.out"] for a wrapper that
    reruns xTB). They are the only payload a task may pass back; stdout is kept
    purely as a diagnostic log.
    """
    input_file: Path | str
    menu_lines: list[str]
    artifacts: list[str] = field(default_factory=list)


@dataclass
class MultiwfnTaskResult:
    input_file: Path
    menu_lines: list[str]
    returncode: int
    output: str
    artifacts: list[Path] = field(default_factory=list)
    work_dir: Path | None = None


def _normalize_task(task) -> MultiwfnTask:
    if isinstance(task, MultiwfnTask):
        return task
    input_file, menu_lines = task[0], task[1]
    artifacts = list(task[2]) if len(task) > 2 else []
    return MultiwfnTask(input_file=input_file, menu_lines=list(menu_lines), artifacts=artifacts)


def _validate_artifact_patterns(task: MultiwfnTask) -> None:
    for pattern in task.artifacts:
        parts = Path(pattern)
        if parts.is_absolute() or ".." in parts.parts or not str(pattern).strip():
            raise VibrationError(
                f"Compute task for {task.input_file} declares an invalid artifact path: {pattern!r}"
            )


def _collect_artifacts(task: MultiwfnTask, task_dir: Path) -> list[Path]:
    collected: list[Path] = []
    for pattern in task.artifacts:
        matches = sorted(candidate for candidate in task_dir.glob(str(pattern)) if candidate.is_file())
        if not matches:
            listing = sorted(entry.name for entry in task_dir.iterdir()) or ["(empty)"]
            raise MissingArtifactError(
                f"Compute task for {task.input_file} did not produce the declared artifact "
                f"'{pattern}' in {task_dir}; directory contains: {', '.join(listing)}"
            )
        collected.extend(matches)
    return collected


def run_multiwfn_tasks(exe, tasks, *, work_root=None) -> list[MultiwfnTaskResult]:
    """Run MultiwfnTask items sequentially against `exe` and collect their artifacts.

    Each task starts `<exe> <input_file>` in its own task directory, feeds the
    numeric menu lines over stdin and captures the combined stdout/stderr as a
    diagnostic log. Declared artifacts are collected from the task directory
    afterwards; a missing artifact raises MissingArtifactError naming the input
    file, the expected pattern and the actual directory contents. Plain
    (input_file, menu_lines[, artifacts]) tuples are accepted for compatibility.
    No engine behavior is modified; the executable is driven entirely from the
    outside.
    """
    if work_root is None:
        # The caller owns cleanup of the per-task directories it is handed back.
        work_root = Path(tempfile.mkdtemp(prefix="multiwfn-compute-"))
    else:
        work_root = Path(work_root)
        work_root.mkdir(parents=True, exist_ok=True)
    results = []
    for index, task in enumerate(_normalize_task(item) for item in tasks):
        _validate_artifact_patterns(task)
        input_path = Path(task.input_file)
        task_dir = work_root / f"task-{index + 1:02d}-{input_path.stem}"
        task_dir.mkdir(parents=True, exist_ok=True)
        stdin_text = "".join(f"{line}\n" for line in task.menu_lines)
        process = subprocess.Popen(
            [str(exe), str(input_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=task_dir,
        )
        try:
            try:
                output, _ = process.communicate(stdin_text, timeout=MULTIWFN_TASK_TIMEOUT)
            except BrokenPipeError:
                process.wait(timeout=MULTIWFN_TASK_TIMEOUT)
                output = ""
        except subprocess.TimeoutExpired:
            process.kill()
            # Wait for the child, not for EOF on pipes inherited by another process.
            process.wait(timeout=SHELL_STOP_GRACE_SECONDS)
            raise VibrationError(
                f"The external engine did not finish within {MULTIWFN_TASK_TIMEOUT:g} seconds: {input_path}"
            ) from None
        finally:
            for pipe in (process.stdin, process.stdout):
                if pipe is not None:
                    pipe.close()
        results.append(
            MultiwfnTaskResult(
                input_file=input_path,
                menu_lines=list(task.menu_lines),
                returncode=process.returncode or 0,
                output=output or "",
                artifacts=_collect_artifacts(task, task_dir),
                work_dir=task_dir,
            )
        )
    return results


def resolve_multiwfn(requested: str | None) -> Path:
    candidates: list[Path] = []
    if requested:
        candidates.append(Path(requested))
    for env_name in ("MULTIWFN", "Multiwfnpath"):
        value = os.environ.get(env_name)
        if not value:
            continue
        base = Path(value)
        candidates.extend((base, base / "Multiwfn_MatterVizGUI", base / "Multiwfn"))
    for name in ("Multiwfn_MatterVizGUI", "Multiwfn"):
        found = shutil.which(name)
        if found:
            candidates.append(Path(found))
    here = Path(__file__).resolve()
    candidates.extend(
        (
            Path("Multiwfn_MatterVizGUI"),
            Path("Multiwfn"),
            here.parents[1] / "build-matterviz-gui" / "Multiwfn_MatterVizGUI",
            Path("build-matterviz-webview/Multiwfn_MatterVizGUI"),
            Path("build-matterviz-gui/Multiwfn_MatterVizGUI"),
        )
    )
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate.resolve()
    searched = "\n  ".join(str(candidate) for candidate in candidates)
    raise VibrationError(f"No executable Multiwfn binary found; searched:\n  {searched}")


def compute_menu_lines(template: str, spectrum: str) -> list[str]:
    code = SPECTRUM_CODES[spectrum]
    return [part.strip() for part in template.format(spectrum=code).split(",") if part.strip()]


def _has_animatable_mode(data: VibrationData) -> bool:
    stride = data.natom * 3
    return any(
        sum(value * value for value in data.displacements[imode * stride:(imode + 1) * stride]) > 0.0
        for imode in range(data.nmode)
    )


def prepare_vibration_data(
    input_path: Path,
    *,
    g98_out: str | None,
    compute: bool,
    multiwfn: str | None,
    spectrum: str,
    compute_menu: str,
    work_root: Path,
    compute_artifact: str | None = None,
) -> VibrationData:
    """Parse one input, optionally recovering displacement data via an external engine.

    --compute only engages when frequencies parsed but the normal-mode
    displacement data is missing. The engine task must declare a real file
    artifact (compute_artifact) that carries the vectors; the collected
    artifact is verified by parsing it and requiring at least one mode with a
    nonzero displacement vector before it is used. The engine's stdout is kept
    as a diagnostic log only and is never parsed as quantum-chemistry output.
    """
    try:
        return load_vibration_input(input_path, g98_out)
    except MissingDisplacementError as direct_error:
        if not compute:
            raise
        if not compute_artifact:
            raise VibrationError(
                f"{input_path}: displacement data is missing and --compute cannot regenerate it "
                f"without a declared artifact. {STOCK_ENGINE_HINT}."
            ) from direct_error
        exe = resolve_multiwfn(multiwfn)
        work_dir = Path(work_root) / "compute"
        work_dir.mkdir(parents=True, exist_ok=True)
        menu = compute_menu_lines(compute_menu, spectrum)
        task = MultiwfnTask(input_file=input_path, menu_lines=menu, artifacts=[compute_artifact])
        print(f"Displacement data missing ({direct_error}); running external engine:")
        print(f"  {exe} {input_path}  < {' '.join(menu)}  -> {compute_artifact}")
        result = run_multiwfn_tasks(exe, [task], work_root=work_dir)[0]
        log_path = work_dir / f"{Path(input_path).stem}.compute.log"
        log_path.write_text(result.output, encoding="utf-8")
        print(f"  engine exit code {result.returncode}; diagnostics captured to {log_path}")

        loaders = []
        try:
            input_program = detect_program(input_path)
        except VibrationError:
            input_program = None
        for artifact in result.artifacts:
            # Prefer the cross-checked xTB pairing when the original input is an
            # xTB spectrum and the artifact is its regenerated g98.out companion.
            if input_program == "xtb":
                loaders.append(("xtb companion", artifact, lambda a=artifact: parse_xtb_output(input_path, a)))
            loaders.append(("artifact", artifact, lambda a=artifact: load_vibration_input(a, g98_out)))
        failures: list[str] = []
        for role, artifact, loader in loaders:
            try:
                data = loader()
            except VibrationError as exc:
                failures.append(f"  - {artifact} ({role}): {exc}")
                continue
            if not _has_animatable_mode(data):
                failures.append(f"  - {artifact} ({role}): no mode carries a nonzero displacement vector")
                continue
            print(f"  displacement data recovered from {artifact}")
            return data
        detail = "\n".join(failures) if failures else "  - no artifacts were collected"
        raise VibrationError(
            f"{input_path}: the declared compute artifact did not yield vibrational "
            f"displacement data:\n{detail}\n{STOCK_ENGINE_HINT}."
        ) from direct_error


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "inputs",
        nargs="*",
        help="Frequency output file(s): Gaussian/ORCA/CP2K output, or xTB output with --g98-out. "
        "Multiple inputs are shown one session at a time in order. When omitted and a desktop "
        "session is available, the native file dialog collects the queue instead (see --no-pick).",
    )
    parser.add_argument("--g98-out", help="Companion g98.out produced by xTB (required for xTB output)")
    parser.add_argument(
        "--multiwfn",
        help="Path to the external engine executable used by --compute (a wrapper producing "
        "a complete QC output; stock Multiwfn menus write no normal-mode vectors)",
    )
    parser.add_argument(
        "--compute",
        action="store_true",
        help="When displacement data is missing, drive the executable given by --multiwfn "
        "as an external batch engine and parse the artifact it produces",
    )
    parser.add_argument(
        "--compute-artifact",
        metavar="PATH",
        help="File (relative to the engine's task directory, glob allowed) that the external "
        "engine must produce and that carries the normal-mode data, e.g. g98.out. Required "
        "for --compute: stock Multiwfn menus write no normal-mode vectors, so --multiwfn "
        "must be a wrapper producing a complete QC output",
    )
    parser.add_argument(
        "--compute-menu",
        default=DEFAULT_COMPUTE_MENU,
        help="Comma-separated stdin menu lines for --compute; '{spectrum}' expands to the "
        "spectrum selector (default: %(default)s)",
    )
    parser.add_argument(
        "--spectrum",
        choices=sorted(SPECTRUM_CODES),
        default="ir",
        help="Spectrum context used in the --compute menu sequence (default: ir)",
    )
    parser.add_argument(
        "--no-launch",
        action="store_true",
        help="Only build the session(s) and print their paths; do not start the desktop shell",
    )
    parser.add_argument(
        "--no-pick",
        action="store_true",
        help="Never open the native file dialog to collect inputs; with no INPUT argument "
        "the launcher prints the usage and exits 2 (headless/CI mode)",
    )
    parser.add_argument("--session-dir", help="Directory for the session files (default: temporary directory)")
    parser.add_argument(
        "--export-dir",
        default=".",
        help="Directory for files exported from the viewer via /api/save-file (default: current directory)",
    )
    parser.add_argument("--port", type=int, default=0, help="Preferred HTTP port (default: OS-assigned)")
    args = parser.parse_args(argv)

    inputs = [Path(item) for item in args.inputs]
    g98_out = args.g98_out
    if not inputs:
        if args.no_pick:
            parser.print_usage(sys.stderr)
            print("Error: no input files given and --no-pick disables the file dialog.", file=sys.stderr)
            return 2
        if not desktop_session_available():
            parser.print_usage(sys.stderr)
            print(
                "Error: no input files given and no desktop session is available for the "
                "native file dialog; pass the input file(s) as arguments.",
                file=sys.stderr,
            )
            return 2
        desktop = resolve_desktop()
        if desktop is None:
            print(
                "Error: no input files given and the MatterViz desktop executable was not "
                "found; set MULTIWFN_MATTERVIZ_WEBVIEW to its path or pass input files.",
                file=sys.stderr,
            )
            return 2
        try:
            inputs, g98_out = pick_input_files(desktop, g98_out=g98_out)
        except VibrationError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 2
        if not inputs:
            parser.print_usage(sys.stderr)
            print("Error: no input files were selected.", file=sys.stderr)
            return 2
    for input_path in inputs:
        if not input_path.is_file():
            print(f"Error: cannot find the input file: {input_path}", file=sys.stderr)
            return 2
    if g98_out and not Path(g98_out).is_file():
        print(f"Error: cannot find the g98.out file: {g98_out}", file=sys.stderr)
        return 2

    session_root = Path(args.session_dir).resolve() if args.session_dir else None
    if session_root is not None:
        session_root.mkdir(parents=True, exist_ok=True)

    for index, input_path in enumerate(inputs):
        try:
            with tempfile.TemporaryDirectory(prefix="multiwfn-vibration-") as scratch:
                work_root = session_root if session_root is not None else Path(scratch)
                try:
                    data = prepare_vibration_data(
                        input_path,
                        g98_out=g98_out,
                        compute=args.compute,
                        multiwfn=args.multiwfn,
                        spectrum=args.spectrum,
                        compute_menu=args.compute_menu,
                        work_root=work_root,
                        compute_artifact=args.compute_artifact,
                    )
                except VibrationError as exc:
                    hint = "" if args.compute else " (retry with --compute to regenerate it externally)"
                    message = str(exc)
                    prefix = "" if str(input_path) in message else f"{input_path}: "
                    print(f"Error: {prefix}{message}{hint}", file=sys.stderr)
                    return 2
                print(
                    f"Parsed {data.source_program} output: {data.natom} atoms, "
                    f"{data.nmode} vibrational modes ({input_path})"
                )
                if session_root is not None:
                    session_dir = session_root if len(inputs) == 1 else session_root / f"{index + 1:02d}-{input_path.stem}"
                else:
                    session_dir = Path(scratch) / "session"
                code = serve_vibration_session(
                    data,
                    session_dir=session_dir,
                    export_dir=Path(args.export_dir),
                    port=args.port,
                    launch=not args.no_launch,
                )
                if code != 0:
                    return code
        except KeyboardInterrupt:
            print("Interrupted.", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
