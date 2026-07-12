#!/usr/bin/env python3
"""Session-scoped analysis datasets for the Multiwfn web and Qt frontends."""

from __future__ import annotations

from collections import defaultdict
import json
import math
from pathlib import Path
import re
import secrets
import shutil
import threading
import time
from typing import BinaryIO, Iterable


ANALYSIS_KINDS = ("dos", "band", "ir", "nmr")
MAX_ANALYSIS_FILE_BYTES = 512 * 1024 * 1024
MAX_ANALYSIS_SESSION_BYTES = 1024 * 1024 * 1024
MAX_ANALYSIS_FILES = 8
HARTREE_TO_EV = 27.211386245988


def unavailable_capabilities() -> dict[str, dict]:
    labels = {
        "dos": "No orbital energies, DOSCAR, or supported DOS data were detected",
        "band": "No CP2K .bs or VASP EIGENVAL with line-mode KPOINTS was detected",
        "ir": "No supported vibrational frequencies and IR intensities were detected",
        "nmr": "No supported isotropic magnetic shielding data were detected",
    }
    return {kind: {"available": False, "reason": labels[kind]} for kind in ANALYSIS_KINDS}


def _safe_name(name: str) -> str:
    base = Path(str(name or "analysis-output.txt")).name
    cleaned = re.sub(r"[^A-Za-z0-9_.+-]", "_", base).strip("._")
    return (cleaned or "analysis-output.txt")[:160]


def _safe_dataset_id(value: str) -> bool:
    return re.fullmatch(r"[A-Za-z0-9_-]{1,64}", str(value or "")) is not None


def _read_text(path: Path, limit: int = 96 * 1024 * 1024) -> str:
    size = path.stat().st_size
    with path.open("rb") as handle:
        if size <= limit:
            raw = handle.read()
        else:
            half = limit // 2
            raw = handle.read(half)
            handle.seek(max(0, size - half))
            raw += b"\n" + handle.read(half)
    if b"\x00" in raw[:65536]:
        raise ValueError(f"{path.name} is not a text output file")
    return raw.decode("utf-8", errors="replace")


def _is_binary_sample(raw: bytes) -> bool:
    if not raw:
        return False
    binary_magic = (b"%PDF-", b"PK\x03\x04", b"\x1f\x8b", b"\x89PNG", b"\xff\xd8\xff", b"\x7fELF")
    if b"\x00" in raw or raw.startswith(binary_magic):
        return True
    controls = sum(byte < 32 and byte not in (9, 10, 12, 13) for byte in raw)
    return controls / len(raw) > 0.05


def _atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=True, separators=(",", ":")), encoding="utf-8")
    temporary.replace(path)


def _float_tokens(text: str) -> list[float]:
    values = []
    for token in text.replace("D", "E").replace("d", "e").split():
        try:
            values.append(float(token))
        except ValueError:
            continue
    return values


def _descriptor(dataset_id: str, label: str, source: str, capabilities: dict, files: list[str]) -> dict:
    return {
        "id": dataset_id,
        "label": label,
        "source": source,
        "files": files,
        "capabilities": capabilities,
    }


def _analysis_file_role(path: Path, text: str) -> str:
    canonical = path.name.upper()
    if canonical in {"EIGENVAL", "KPOINTS", "OUTCAR", "DOSCAR", "POSCAR", "CONTCAR"}:
        return "poscar" if canonical == "CONTCAR" else canonical.lower()
    lines = text.splitlines()
    lower = text.lower()
    if re.search(r"(?im)^\s*line[- ]?mode\s*$", text):
        return "kpoints"
    if "e-fermi" in lower and any(marker in lower for marker in ("vasp", "free  energy", "toten")):
        return "outcar"
    if len(lines) >= 7:
        dos_header = _float_tokens(lines[5])
        if len(dos_header) >= 4:
            try:
                nedos = int(dos_header[2])
            except (ValueError, OverflowError):
                nedos = 0
            if nedos >= 3 and len(_float_tokens(lines[6])) >= 3:
                return "doscar"
        try:
            float(lines[1].split()[0])
            vectors = all(len(_float_tokens(lines[index])) >= 3 for index in (2, 3, 4))
            elements = all(re.fullmatch(r"[A-Za-z]{1,3}", token) for token in lines[5].split())
            counts = all(int(token) >= 0 for token in lines[6].split())
            if vectors and lines[5].split() and lines[6].split() and elements and counts:
                return "poscar"
        except (ValueError, IndexError):
            pass
        eigen_header = _float_tokens(lines[5])
        if len(eigen_header) >= 3:
            try:
                nkpoints = int(eigen_header[-2])
                nbands = int(eigen_header[-1])
            except (ValueError, OverflowError):
                nkpoints = nbands = 0
            probe = 6
            while probe < len(lines) and not lines[probe].strip():
                probe += 1
            if nkpoints > 0 and nbands > 0 and probe + 1 < len(lines):
                if len(_float_tokens(lines[probe])) >= 4 and len(_float_tokens(lines[probe + 1])) >= 3:
                    return "eigenval"
    return ""


def detect_output_capabilities(files: Iterable[Path], manifest: dict | None = None) -> tuple[dict, dict]:
    paths = [Path(path) for path in files if Path(path).is_file()]
    capabilities = unavailable_capabilities()
    metadata: dict[str, object] = {"format": "unknown"}
    contents: dict[Path, str] = {}
    roles: dict[str, Path] = {}
    for path in paths:
        try:
            contents[path] = _read_text(path)
        except (OSError, ValueError):
            continue
        role = _analysis_file_role(path, contents[path])
        if role and role not in roles:
            roles[role] = path

    manifest_payload = manifest or {}
    orbital_items = manifest_payload.get("orbitals", {}).get("items", [])
    periodic = bool(manifest_payload.get("periodic", {}).get("enabled"))
    finite_orbitals = False
    for item in orbital_items:
        if not isinstance(item, dict):
            continue
        try:
            finite_orbitals = finite_orbitals or math.isfinite(float(item.get("energy", math.nan)))
        except (TypeError, ValueError):
            continue
    if finite_orbitals and not periodic:
        capabilities["dos"] = {
            "available": True,
            "format": "multiwfn-orbitals",
            "features": {"tdos": True, "pdos": bool(manifest_payload.get("analysis", {}).get("primaryDos"))},
        }
    elif finite_orbitals and periodic:
        capabilities["dos"]["reason"] = "Periodic DOS requires complete k-point levels and weights or a VASP DOSCAR"

    if "eigenval" in roles:
        if "kpoints" in roles:
            kpoints = contents.get(roles["kpoints"], "")
            if re.search(r"(?im)^\s*line[- ]?mode\s*$", kpoints):
                capabilities["band"] = {
                    "available": True,
                    "format": "vasp-eigenval",
                    "features": {"fermi": "outcar" in roles, "spin": "auto"},
                }
                metadata["format"] = "vasp"
            else:
                capabilities["band"]["reason"] = "VASP KPOINTS is missing line-mode path data"
        else:
            capabilities["band"]["reason"] = "VASP EIGENVAL requires KPOINTS"
    if "doscar" in roles:
        capabilities["dos"] = {
            "available": True,
            "format": "vasp-doscar",
            "features": {"tdos": True, "pdos": "poscar" in roles},
        }
        metadata["format"] = "vasp"

    for path in paths:
        text = contents.get(path)
        if text is None:
            continue
        upper_name = path.name.upper()
        lower = text.lower()
        if "# set" in lower and "#   band" in lower:
            capabilities["band"] = {
                "available": True,
                "format": "cp2k-bs",
                "features": {"spin": "spin 2" in lower},
            }
            metadata["format"] = "cp2k"
        if "list of kpoints" in lower and "eigenvalues and occupation numbers for k point" in lower:
            capabilities["dos"] = {
                "available": True,
                "format": "cp2k-kpoint-levels",
                "features": {"tdos": True, "pdos": False},
            }
            metadata["format"] = "cp2k"
        if upper_name in {"DOS.TXT", "TDOS.TXT"} and _looks_like_xy(text):
            capabilities["dos"] = {
                "available": True,
                "format": "xy-dos",
                "features": {"tdos": True, "pdos": False},
            }
        gaussian = "gaussian, inc" in lower or "entering gaussian system" in lower
        orca = "o   r   c   a" in lower
        if (gaussian and "frequencies --" in lower and "ir inten" in lower) or (
            orca and "ir spectrum" in lower
        ):
            capabilities["ir"] = {
                "available": True,
                "format": "gaussian" if gaussian else "orca",
                "features": {
                    "harmonic": True,
                    "anharmonic": "anharmonic infrared spectroscopy" in lower,
                },
            }
            metadata["format"] = "gaussian" if gaussian else "orca"
        nmr_detected = any(marker in lower for marker in (
            "magnetic shielding tensor (ppm)",
            "chemical shielding summary",
            "nuclear magnetic shielding result in ppm",
            "shielding atom at atomic positions",
            "isotropic/anisotropic constant by atom order",
        ))
        if nmr_detected:
            program = "gaussian" if gaussian else "orca" if orca else "text"
            capabilities["nmr"] = {
                "available": True,
                "format": program,
                "features": {"shielding": True},
            }
            metadata["format"] = program
    return capabilities, metadata


def _looks_like_xy(text: str) -> bool:
    rows = 0
    for line in text.splitlines()[:200]:
        values = _float_tokens(line)
        if len(values) >= 2:
            rows += 1
    return rows >= 3


def parse_gaussian_ir(text: str) -> dict:
    lines = text.splitlines()
    groups: list[list[dict]] = []
    current: list[dict] = []
    last_index = -1000
    mode_index = 1
    for index, line in enumerate(lines):
        if "Frequencies --" not in line:
            continue
        frequencies = _float_tokens(line.split("--", 1)[1])
        intensities: list[float] = []
        for probe in lines[index + 1:index + 18]:
            if "IR Inten" in probe and "--" in probe:
                intensities = _float_tokens(probe.split("--", 1)[1])
                break
        if not frequencies or len(intensities) < len(frequencies):
            continue
        if index - last_index > 180 and current:
            groups.append(current)
            current = []
            mode_index = 1
        for frequency, intensity in zip(frequencies, intensities):
            current.append({
                "mode": mode_index,
                "frequency": frequency,
                "intensity": intensity,
                "bandType": "harmonic",
            })
            mode_index += 1
        last_index = index
    if current:
        groups.append(current)
    harmonic = max(groups, key=len, default=[])

    anharmonic: list[dict] = []
    section_indices = [i for i, line in enumerate(lines) if "Anharmonic Infrared Spectroscopy" in line]
    if section_indices:
        start = section_indices[-1]
        end = next((i for i in range(start + 1, len(lines)) if i > start + 3 and
                    "Anharmonic " in lines[i] and "Spectroscopy" in lines[i]), len(lines))
        section = lines[start:end]
        headings = (("Fundamental Bands", "fundamental"), ("Overtones", "overtone"),
                    ("Combination Bands", "combination"))
        for heading, band_type in headings:
            try:
                heading_index = next(i for i, line in enumerate(section) if heading in line)
            except StopIteration:
                continue
            row_start = heading_index + 1
            while row_start < len(section) and "Mode(n)" not in section[row_start]:
                row_start += 1
            row_start += 1
            for row in section[row_start:]:
                if not row.strip():
                    break
                tokens = row.split()
                mode_tokens = 2 if band_type == "combination" else 1
                if len(tokens) < mode_tokens + 3 or "(" not in tokens[0]:
                    continue
                numbers = _float_tokens(" ".join(tokens[mode_tokens:]))
                if len(numbers) < 3:
                    continue
                modes = tokens[:mode_tokens]
                anharmonic.append({
                    "mode": "+".join(modes),
                    "frequency": numbers[1],
                    "harmonicFrequency": numbers[0],
                    "intensity": numbers[-1],
                    "bandType": band_type,
                })
    return {
        "format": "multiwfn-analysis-data",
        "version": 1,
        "kind": "ir",
        "axes": {"x": {"label": "Wavenumber", "unit": "cm^-1", "reversed": True},
                 "y": {"label": "IR intensity", "unit": "km/mol"}},
        "series": {"harmonic": harmonic, "anharmonic": anharmonic},
        "metadata": {
            "program": "Gaussian",
            "counts": {
                "harmonic": len(harmonic),
                "fundamental": sum(row["bandType"] == "fundamental" for row in anharmonic),
                "overtone": sum(row["bandType"] == "overtone" for row in anharmonic),
                "combination": sum(row["bandType"] == "combination" for row in anharmonic),
            },
        },
        "controls": {"defaultMode": "anharmonic" if anharmonic else "harmonic", "defaultFwhm": 8.0},
    }


def parse_orca_ir(text: str) -> dict:
    lines = text.splitlines()
    starts = [i for i, line in enumerate(lines) if "IR SPECTRUM" in line.upper()]
    transitions: list[dict] = []
    if starts:
        for line in lines[starts[-1] + 1:]:
            if transitions and not line.strip():
                break
            match = re.match(r"\s*(\d+)\s*[: ]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)(?:\s+.*)?$", line)
            if not match:
                continue
            transitions.append({
                "mode": int(match.group(1)),
                "frequency": float(match.group(2)),
                "intensity": float(match.group(3)),
                "bandType": "harmonic",
            })
    return {
        "format": "multiwfn-analysis-data", "version": 1, "kind": "ir",
        "axes": {"x": {"label": "Wavenumber", "unit": "cm^-1", "reversed": True},
                 "y": {"label": "IR intensity", "unit": "km/mol"}},
        "series": {"harmonic": transitions, "anharmonic": []},
        "metadata": {"program": "ORCA", "counts": {"harmonic": len(transitions)}},
        "controls": {"defaultMode": "harmonic", "defaultFwhm": 8.0},
    }


def parse_ir(path: Path) -> dict:
    text = _read_text(path)
    lower = text.lower()
    if "gaussian, inc" in lower or "entering gaussian system" in lower:
        result = parse_gaussian_ir(text)
    elif "o   r   c   a" in lower:
        result = parse_orca_ir(text)
    else:
        raise ValueError("Unsupported IR output format")
    if not result["series"]["harmonic"] and not result["series"]["anharmonic"]:
        raise ValueError("No IR transitions could be parsed")
    return result


def parse_nmr(path: Path) -> dict:
    text = _read_text(path)
    lines = text.splitlines()
    atoms: list[dict] = []
    seen: dict[int, dict] = {}
    gaussian_pattern = re.compile(
        r"^\s*(\d+)\s+([A-Za-z]{1,3})\s+Isotropic\s*=\s*(-?\d+(?:\.\d+)?(?:[DEde][+-]?\d+)?)",
        re.IGNORECASE,
    )
    for line in lines:
        match = gaussian_pattern.search(line)
        if match:
            seen[int(match.group(1))] = {
                "index": int(match.group(1)), "element": match.group(2).title(),
                "shielding": float(match.group(3).replace("D", "E").replace("d", "e")),
            }
    program = "Gaussian" if seen else "Unknown"
    if not seen:
        summary_starts = [i for i, line in enumerate(lines) if any(marker in line.upper() for marker in (
            "CHEMICAL SHIELDING SUMMARY", "NUCLEUS  ELEMENT"
        ))]
        if summary_starts:
            program = "ORCA"
            summary_rows = []
            for line in lines[summary_starts[-1] + 1:]:
                match = re.match(r"\s*(\d+)\s+([A-Za-z]{1,3})\s+(-?\d+(?:\.\d+)?)", line)
                if match:
                    summary_rows.append((int(match.group(1)), match.group(2).title(), float(match.group(3))))
                elif summary_rows and not line.strip():
                    break
            index_offset = 1 if any(index == 0 for index, _element, _shielding in summary_rows) else 0
            for raw_index, element, shielding in summary_rows:
                index = raw_index + index_offset
                seen[index] = {"index": index, "element": element, "shielding": shielding}
    if not seen and "Nuclear Magnetic shielding result in PPM" in text:
        program = "BDF"
        elements: list[str] = []
        for index, line in enumerate(lines):
            if "NMR shielding tensor and constant of nucleus" not in line:
                continue
            probe = " ".join(lines[index:index + 4])
            match = re.search(r"\batom\s+([A-Za-z]{1,3})\b", probe, re.IGNORECASE)
            if match:
                elements.append(match.group(1).title())
        summary = next((index for index, line in enumerate(lines)
                        if "Isotropic/anisotropic constant by atom order" in line), -1)
        if summary >= 0:
            values = []
            for line in lines[summary + 1:]:
                row = _float_tokens(line)
                if len(row) >= 2:
                    values.append(row[0])
                elif values:
                    break
            for index, shielding in enumerate(values, 1):
                element = elements[index - 1] if index <= len(elements) else "X"
                seen[index] = {"index": index, "element": element, "shielding": shielding}
    if not seen and "ISOTROPY =" in text and "Shielding atom at atomic positions" in text:
        program = "CP2K"
        starts = [index for index, line in enumerate(lines) if "Shielding atom at atomic positions" in line]
        for atom_index, start in enumerate(starts, 1):
            end = starts[atom_index] if atom_index < len(starts) else min(len(lines), start + 30)
            block = lines[start:end]
            element = "X"
            for line in block[:5]:
                candidates = [token.title() for token in line.split()
                              if re.fullmatch(r"[A-Z][a-z]?", token)]
                if candidates:
                    element = candidates[-1]
                    break
            isotropy = next((re.search(r"ISOTROPY\s*=\s*(-?\d+(?:\.\d+)?)", line)
                             for line in block if "ISOTROPY" in line), None)
            if isotropy:
                seen[atom_index] = {"index": atom_index, "element": element,
                                    "shielding": float(isotropy.group(1))}
    atoms = [seen[index] for index in sorted(seen)]
    if not atoms:
        raise ValueError("No isotropic NMR shielding values could be parsed")
    elements = sorted({atom["element"] for atom in atoms})
    return {
        "format": "multiwfn-analysis-data", "version": 1, "kind": "nmr",
        "axes": {"x": {"label": "Isotropic shielding", "unit": "ppm", "reversed": False},
                 "y": {"label": "Signal", "unit": "a.u."}},
        "series": {"atoms": atoms},
        "metadata": {"program": program, "elements": elements, "count": len(atoms)},
        "controls": {"defaultFwhmHydrogen": 0.02, "defaultFwhmHeavy": 0.2},
    }


def parse_xy_dos(path: Path) -> dict:
    energies: list[float] = []
    values: list[float] = []
    for line in _read_text(path).splitlines():
        row = _float_tokens(line)
        if len(row) >= 2:
            energies.append(row[0])
            values.append(row[1])
    if len(energies) < 3:
        raise ValueError("DOS text file needs at least three X-Y rows")
    return {
        "format": "multiwfn-analysis-data", "version": 1, "kind": "dos",
        "axes": {"x": {"label": "Energy", "unit": "eV"},
                 "y": {"label": "Density of states", "unit": "states/eV"}},
        "series": {"sampled": [{"id": "tdos", "label": "TDOS", "energy": energies, "value": values}]},
        "markers": [], "metadata": {"program": "Text DOS", "sampled": True},
        "controls": {"projectionModes": []},
    }


def _parse_poscar_elements(path: Path | None) -> list[str]:
    if not path or not path.is_file():
        return []
    lines = _read_text(path, 8 * 1024 * 1024).splitlines()
    if len(lines) < 7:
        return []
    names = lines[5].split()
    try:
        counts = [int(value) for value in lines[6].split()]
    except ValueError:
        return []
    if len(names) != len(counts):
        return []
    result: list[str] = []
    for name, count in zip(names, counts):
        result.extend([name] * max(0, count))
    return result


def _projection_families(count: int) -> list[str]:
    if count in (3, 6):
        return ["s", "p", "d"]
    if count in (4, 8):
        return ["s", "p", "d", "f"]
    if count in (9, 18):
        return ["s", "p", "p", "p", "d", "d", "d", "d", "d"]
    if count in (16, 32):
        return ["s", "p", "p", "p", "d", "d", "d", "d", "d"] + ["f"] * 7
    return [f"orbital-{index + 1}" for index in range(count)]


def parse_vasp_doscar(doscar: Path, poscar: Path | None = None) -> dict:
    lines = _read_text(doscar).splitlines()
    if len(lines) < 7:
        raise ValueError("DOSCAR is incomplete")
    header = _float_tokens(lines[5])
    if len(header) < 4:
        raise ValueError("DOSCAR energy header is malformed")
    nedos = int(header[2])
    efermi = header[3]
    total_rows = [_float_tokens(line) for line in lines[6:6 + nedos]]
    if len(total_rows) != nedos or any(len(row) < 3 for row in total_rows):
        raise ValueError("DOSCAR total DOS block is incomplete")
    spin = len(total_rows[0]) >= 5
    energy = [row[0] - efermi for row in total_rows]
    sampled = [{"id": "tdos-up" if spin else "tdos", "label": "TDOS up" if spin else "TDOS",
                "energy": energy, "value": [row[1] for row in total_rows], "spin": "alpha" if spin else "total"}]
    if spin:
        sampled.append({"id": "tdos-down", "label": "TDOS down", "energy": energy,
                        "value": [-row[2] for row in total_rows], "spin": "beta"})

    atom_elements = _parse_poscar_elements(poscar)
    projections: dict[tuple[str, str, str], list[float]] = {}
    cursor = 6 + nedos
    atom_index = 0
    while cursor < len(lines):
        descriptor = _float_tokens(lines[cursor])
        if len(descriptor) < 3 or cursor + nedos >= len(lines):
            break
        cursor += 1
        rows = [_float_tokens(line) for line in lines[cursor:cursor + nedos]]
        cursor += nedos
        if not rows or any(len(row) < 2 for row in rows):
            break
        atom_index += 1
        element = atom_elements[atom_index - 1] if atom_index <= len(atom_elements) else f"Atom {atom_index}"
        raw_count = len(rows[0]) - 1
        channel_count = raw_count // 2 if spin else raw_count
        families = _projection_families(channel_count)
        for family_index, family in enumerate(families):
            for spin_name, offset, sign in (("alpha", 1 + 2 * family_index, 1.0),
                                            ("beta", 2 + 2 * family_index, -1.0)) if spin else (("total", 1 + family_index, 1.0),):
                key = (element, family, spin_name)
                values = projections.setdefault(key, [0.0] * nedos)
                for point, row in enumerate(rows):
                    if offset < len(row):
                        values[point] += sign * row[offset]
    projection_series = [
        {"id": f"{element}-{family}-{spin_name}", "label": f"{element} {family} {spin_name}" if spin else f"{element} {family}",
         "element": element, "orbital": family, "spin": spin_name, "energy": energy, "value": values}
        for (element, family, spin_name), values in sorted(projections.items())
    ]
    return {
        "format": "multiwfn-analysis-data", "version": 1, "kind": "dos",
        "axes": {"x": {"label": "Energy - Efermi", "unit": "eV"},
                 "y": {"label": "Density of states", "unit": "states/eV"}},
        "series": {"sampled": sampled, "projections": projection_series},
        "markers": [{"x": 0.0, "label": "Efermi", "kind": "fermi"}],
        "metadata": {"program": "VASP", "sampled": True, "spin": spin, "efermi": efermi,
                     "pdos": bool(projection_series)},
        "controls": {"projectionModes": ["element", "orbital", "element-orbital"] if projection_series else []},
    }


def parse_vasp_band(eigenval: Path, kpoints_path: Path, outcar: Path | None = None) -> dict:
    lines = _read_text(eigenval).splitlines()
    if len(lines) < 8:
        raise ValueError("EIGENVAL is incomplete")
    header_index = 5
    header = _float_tokens(lines[header_index])
    if len(header) < 3:
        raise ValueError("EIGENVAL count header is malformed")
    nkpoints = int(header[-2])
    nbands = int(header[-1])
    cursor = header_index + 1
    kcoords: list[list[float]] = []
    alpha: list[list[float]] = []
    beta: list[list[float]] = []
    occupations: list[list[float]] = []
    occupations_beta: list[list[float]] = []
    for _ in range(nkpoints):
        while cursor < len(lines) and not lines[cursor].strip():
            cursor += 1
        if cursor >= len(lines):
            break
        krow = _float_tokens(lines[cursor])
        cursor += 1
        if len(krow) < 3:
            raise ValueError("EIGENVAL k-point row is malformed")
        kcoords.append(krow[:3])
        energies_a: list[float] = []
        energies_b: list[float] = []
        occ_a: list[float] = []
        occ_b: list[float] = []
        for _band in range(nbands):
            if cursor >= len(lines):
                raise ValueError("EIGENVAL band block is incomplete")
            row = _float_tokens(lines[cursor])
            cursor += 1
            if len(row) >= 5:
                energies_a.append(row[1]); energies_b.append(row[2]); occ_a.append(row[3]); occ_b.append(row[4])
            elif len(row) >= 3:
                energies_a.append(row[1]); occ_a.append(row[2])
            else:
                raise ValueError("EIGENVAL band row is malformed")
        alpha.append(energies_a); occupations.append(occ_a)
        if energies_b:
            beta.append(energies_b); occupations_beta.append(occ_b)
    if len(kcoords) != nkpoints:
        raise ValueError("EIGENVAL contains fewer k-points than declared")

    kpoints_text = _read_text(kpoints_path, 4 * 1024 * 1024)
    break_indices = _vasp_line_mode_break_indices(kpoints_text, nkpoints)
    x = [0.0]
    for index, (previous, current) in enumerate(zip(kcoords, kcoords[1:]), 1):
        if index in break_indices:
            x.append(x[-1])
        else:
            x.append(x[-1] + math.sqrt(sum((a - b) ** 2 for a, b in zip(current, previous))))
    ticks = _vasp_kpoint_ticks(kpoints_text, kcoords, x)
    efermi = None
    if outcar and outcar.is_file():
        matches = re.findall(r"E-fermi\s*:\s*(-?\d+(?:\.\d+)?)", _read_text(outcar))
        if matches:
            efermi = float(matches[-1])
    occupied_values = [energy for row, occrow in zip(alpha, occupations) for energy, occ in zip(row, occrow) if occ > 1e-6]
    virtual_values = [energy for row, occrow in zip(alpha, occupations) for energy, occ in zip(row, occrow) if occ <= 1e-6]
    vbm = max(occupied_values, default=min((min(row) for row in alpha), default=0.0))
    cbm = min(virtual_values, default=max((max(row) for row in alpha), default=vbm))
    reference = efermi if efermi is not None else vbm
    alpha_shifted = [[value - reference for value in row] for row in alpha]
    beta_shifted = [[value - reference for value in row] for row in beta]
    return {
        "format": "multiwfn-analysis-data", "version": 1, "kind": "band",
        "axes": {"x": {"label": "k-path", "unit": ""},
                 "y": {"label": "Energy", "unit": "eV"}},
        "series": {"x": x, "alpha": alpha_shifted, "beta": beta_shifted},
        "markers": {"ticks": ticks, "breakIndices": break_indices,
                    "reference": 0.0, "vbm": vbm - reference, "cbm": cbm - reference},
        "metadata": {"program": "VASP", "spin": bool(beta), "efermi": efermi,
                     "reference": "fermi" if efermi is not None else "vbm", "nbands": nbands, "nkpoints": nkpoints},
        "controls": {"energyReferences": ["fermi", "vbm", "absolute", "custom"]},
    }


def _vasp_kpoint_ticks(text: str, kcoords: list[list[float]], xpos: list[float]) -> list[dict]:
    lines = text.splitlines()
    endpoints: list[tuple[list[float], str]] = []
    for line in lines[4:]:
        if not line.strip():
            continue
        coordinate_text, _, label_text = line.partition("!")
        values = _float_tokens(coordinate_text)
        if len(values) >= 3:
            endpoints.append((values[:3], label_text.strip() or ""))
    ticks: list[dict] = []
    for coordinate, label in endpoints:
        index = min(range(len(kcoords)), key=lambda idx: sum((kcoords[idx][axis] - coordinate[axis]) ** 2 for axis in range(3)))
        normalized_label = label.replace("GAMMA", "Γ").replace("Gamma", "Γ").replace("G", "G")
        if ticks and abs(ticks[-1]["x"] - xpos[index]) < 1e-10:
            if normalized_label and normalized_label not in ticks[-1]["label"].split("|"):
                ticks[-1]["label"] = f"{ticks[-1]['label']}|{normalized_label}".strip("|")
        else:
            ticks.append({"x": xpos[index], "label": normalized_label or str(len(ticks) + 1)})
    return ticks


def _vasp_line_mode_break_indices(text: str, nkpoints: int) -> list[int]:
    lines = text.splitlines()
    if len(lines) < 5:
        return []
    try:
        points_per_segment = int(lines[1].split()[0])
    except (ValueError, IndexError):
        return []
    endpoints = sum(1 for line in lines[4:] if len(_float_tokens(line.partition("!")[0])) >= 3)
    segments = endpoints // 2
    if points_per_segment <= 0 or segments <= 1 or points_per_segment * segments != nkpoints:
        return []
    return [points_per_segment * segment for segment in range(1, segments)]


def parse_cp2k_bs(path: Path) -> dict:
    lines = _read_text(path).splitlines()
    kcoords: list[list[float]] = []
    alpha: list[list[float]] = []
    beta: list[list[float]] = []
    occupations: list[list[float]] = []
    ticks_raw: list[tuple[list[float], str]] = []
    break_indices: list[int] = []
    open_shell = any("Spin 2" in line for line in lines)
    cursor = 0
    while cursor < len(lines):
        line = lines[cursor]
        if "# Set" not in line:
            cursor += 1
            continue
        integers = [int(value) for value in re.findall(r"\d+", line)]
        if len(integers) < 4:
            cursor += 1
            continue
        _, n_special, n_kpoints, n_levels = integers[:4]
        cursor += 1
        for _ in range(n_special):
            if cursor >= len(lines):
                break
            values = _float_tokens(lines[cursor][23:] if len(lines[cursor]) > 23 else lines[cursor])
            label_match = re.findall(r"([A-Za-zΓ][A-Za-z0-9_+-]*)\s*$", lines[cursor])
            if len(values) >= 3:
                ticks_raw.append((values[:3], label_match[-1] if label_match else ""))
            cursor += 1
        for point_index in range(n_kpoints):
            while cursor < len(lines) and not lines[cursor].strip():
                cursor += 1
            if cursor >= len(lines):
                break
            point_line = lines[cursor]
            point_values = _float_tokens(point_line[24:] if len(point_line) > 24 else point_line)
            cursor += 1
            if len(point_values) < 3:
                raise ValueError("CP2K .bs k-point row is malformed")
            while cursor < len(lines) and "#   Band" not in lines[cursor]:
                cursor += 1
            if cursor >= len(lines):
                raise ValueError("CP2K .bs band header is missing")
            cursor += 1
            energies: list[float] = []
            occs: list[float] = []
            while cursor < len(lines) and len(energies) < n_levels:
                row = _float_tokens(lines[cursor])
                cursor += 1
                if len(row) >= 3:
                    energies.append(row[1])
                    occs.append(row[2])
            if len(energies) != n_levels:
                raise ValueError("CP2K .bs alpha band block is incomplete")

            beta_energies: list[float] = []
            if open_shell:
                while cursor < len(lines) and not lines[cursor].strip():
                    cursor += 1
                if cursor < len(lines) and ("Spin 2" in lines[cursor] or "# Point" in lines[cursor]):
                    cursor += 1
                    while cursor < len(lines) and "#   Band" not in lines[cursor]:
                        cursor += 1
                    if cursor >= len(lines):
                        raise ValueError("CP2K .bs beta band header is missing")
                    cursor += 1
                    while cursor < len(lines) and len(beta_energies) < n_levels:
                        row = _float_tokens(lines[cursor])
                        cursor += 1
                        if len(row) >= 3:
                            beta_energies.append(row[1])
                    if len(beta_energies) != n_levels:
                        raise ValueError("CP2K .bs beta band block is incomplete")

            coordinate = point_values[:3]
            duplicate = bool(kcoords and all(abs(left - right) < 1e-12
                                             for left, right in zip(coordinate, kcoords[-1])))
            if duplicate:
                continue
            if point_index == 0 and kcoords:
                break_indices.append(len(kcoords))
            kcoords.append(coordinate)
            alpha.append(energies)
            occupations.append(occs)
            if beta_energies:
                beta.append(beta_energies)
    if not kcoords or not alpha:
        raise ValueError("CP2K .bs band data could not be parsed")
    x = [0.0]
    for index, (previous, current) in enumerate(zip(kcoords, kcoords[1:]), 1):
        if index in break_indices:
            x.append(x[-1])
        else:
            x.append(x[-1] + math.sqrt(sum((a - b) ** 2 for a, b in zip(current, previous))))
    ticks = []
    for coordinate, label in ticks_raw:
        index = min(range(len(kcoords)), key=lambda idx: sum((kcoords[idx][axis] - coordinate[axis]) ** 2 for axis in range(3)))
        if not ticks or abs(ticks[-1]["x"] - x[index]) > 1e-10:
            ticks.append({"x": x[index], "label": label or str(len(ticks) + 1)})
    occupied = [energy for row, occrow in zip(alpha, occupations) for energy, occ in zip(row, occrow) if occ > 1e-8]
    virtual = [energy for row, occrow in zip(alpha, occupations) for energy, occ in zip(row, occrow) if occ <= 1e-8]
    vbm = max(occupied, default=0.0); cbm = min(virtual, default=vbm)
    return {
        "format": "multiwfn-analysis-data", "version": 1, "kind": "band",
        "axes": {"x": {"label": "k-path", "unit": ""}, "y": {"label": "Energy - VBM", "unit": "eV"}},
        "series": {"x": x, "alpha": [[value - vbm for value in row] for row in alpha],
                   "beta": [[value - vbm for value in row] for row in beta]},
        "markers": {"ticks": ticks, "breakIndices": break_indices,
                    "reference": 0.0, "vbm": 0.0, "cbm": cbm - vbm},
        "metadata": {"program": "CP2K", "spin": bool(beta), "reference": "vbm",
                     "nbands": len(alpha[0]), "nkpoints": len(kcoords)},
        "controls": {"energyReferences": ["vbm", "absolute", "custom"]},
    }


class AnalysisStore:
    def __init__(self, session_dir: Path, manifest: dict, primary_source: Path | None = None):
        self._lock = threading.RLock()
        self.session_dir = Path(session_dir).resolve()
        self.manifest = manifest or {}
        self.primary_source = Path(primary_source).expanduser().resolve() if primary_source else None
        self.inputs_dir = self.session_dir / "analysis_inputs"
        self.data_dir = self.session_dir / "analysis_data"
        self.registry_path = self.session_dir / "analysis_registry.json"
        self.inputs_dir.mkdir(parents=True, exist_ok=True)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.registry = self._load_registry()
        self.primary = self._build_primary_descriptor()

    def _load_registry(self) -> dict:
        try:
            payload = json.loads(self.registry_path.read_text(encoding="utf-8"))
            if isinstance(payload, dict) and isinstance(payload.get("datasets"), dict):
                return payload
        except (OSError, json.JSONDecodeError):
            pass
        return {"version": 1, "datasets": {}}

    def _save_registry(self) -> None:
        _atomic_json(self.registry_path, self.registry)

    def _build_primary_descriptor(self) -> dict:
        files = [self.primary_source] if self.primary_source and self.primary_source.is_file() else []
        capabilities, metadata = detect_output_capabilities(files, self.manifest)
        manifest_analysis = self.manifest.get("analysis", {})
        for kind, incoming in manifest_analysis.get("capabilities", {}).items():
            if kind == "dos" and self.manifest.get("periodic", {}).get("enabled"):
                continue
            if kind in capabilities and isinstance(incoming, dict) and incoming.get("available"):
                capabilities[kind] = incoming
        label = self.primary_source.name if self.primary_source else "Current Multiwfn input"
        descriptor = _descriptor("primary", label, "primary", capabilities,
                                 [self.primary_source.name] if self.primary_source else [])
        descriptor["metadata"] = metadata
        descriptor["removable"] = False
        return descriptor

    def list_datasets(self) -> list[dict]:
        with self._lock:
            imported = []
            for value in self.registry["datasets"].values():
                descriptor = dict(value)
                descriptor["removable"] = True
                imported.append(descriptor)
            return [self.primary, *sorted(imported, key=lambda item: item.get("createdAt", 0))]

    def create_dataset(self, label: str = "Imported analysis") -> dict:
        with self._lock:
            dataset_id = f"analysis-{secrets.token_hex(8)}"
            descriptor = _descriptor(dataset_id, str(label or "Imported analysis")[:160], "imported",
                                     unavailable_capabilities(), [])
            descriptor["createdAt"] = time.time()
            descriptor["metadata"] = {"format": "pending"}
            self.registry["datasets"][dataset_id] = descriptor
            (self.inputs_dir / dataset_id).mkdir(parents=True, exist_ok=False)
            self._save_registry()
            return {**descriptor, "removable": True}

    def _dataset(self, dataset_id: str) -> dict:
        if dataset_id == "primary":
            return self.primary
        if not _safe_dataset_id(dataset_id) or dataset_id not in self.registry["datasets"]:
            raise ValueError("Unknown analysis dataset")
        return self.registry["datasets"][dataset_id]

    def upload_file(self, dataset_id: str, name: str, stream: BinaryIO, length: int) -> dict:
        with self._lock:
            dataset = self._dataset(dataset_id)
            if dataset_id == "primary":
                raise ValueError("The primary dataset cannot receive uploaded files")
            if length < 0 or length > MAX_ANALYSIS_FILE_BYTES:
                raise ValueError("Analysis file exceeds the 512 MiB limit")
            if len(dataset.get("files", [])) >= MAX_ANALYSIS_FILES:
                raise ValueError("An analysis dataset can contain at most 8 files")
            total = sum(path.stat().st_size for path in self.inputs_dir.glob("*/*") if path.is_file())
            if total + length > MAX_ANALYSIS_SESSION_BYTES:
                raise ValueError("Analysis files exceed the 1 GiB session limit")
            safe_name = _safe_name(name)
            target_dir = (self.inputs_dir / dataset_id).resolve()
            target = (target_dir / safe_name).resolve()
            target.relative_to(target_dir)
            if target.exists():
                stem, suffix = target.stem, target.suffix
                target = target_dir / f"{stem}-{secrets.token_hex(3)}{suffix}"
            try:
                remaining = length
                with target.open("wb") as handle:
                    while remaining:
                        chunk = stream.read(min(1024 * 1024, remaining))
                        if not chunk:
                            raise ValueError("Analysis upload ended before Content-Length bytes were received")
                        handle.write(chunk)
                        remaining -= len(chunk)
                with target.open("rb") as handle:
                    if _is_binary_sample(handle.read(65536)):
                        raise ValueError("Only text analysis outputs are supported")
            except Exception:
                target.unlink(missing_ok=True)
                raise
            dataset.setdefault("files", []).append(target.name)
            dataset["capabilities"] = unavailable_capabilities()
            dataset["metadata"] = {"format": "pending"}
            self._save_registry()
            return {"ok": True, "dataset": dataset_id, "name": target.name, "size": length}

    def inspect(self, dataset_id: str) -> dict:
        with self._lock:
            dataset = self._dataset(dataset_id)
            paths = self._paths(dataset_id)
            capabilities, metadata = detect_output_capabilities(paths)
            dataset["capabilities"] = capabilities
            dataset["metadata"] = metadata
            for artifact in self.data_dir.glob(f"{dataset_id}_*.json"):
                artifact.unlink(missing_ok=True)
            self._save_registry()
            return {"ok": True, "dataset": {**dataset, "removable": dataset_id != "primary"}}

    def delete(self, dataset_id: str) -> dict:
        with self._lock:
            if dataset_id == "primary":
                raise ValueError("The primary dataset cannot be removed")
            self._dataset(dataset_id)
            shutil.rmtree(self.inputs_dir / dataset_id, ignore_errors=True)
            for artifact in self.data_dir.glob(f"{dataset_id}_*.json"):
                artifact.unlink(missing_ok=True)
            del self.registry["datasets"][dataset_id]
            self._save_registry()
            return {"ok": True, "dataset": dataset_id}

    def _paths(self, dataset_id: str) -> list[Path]:
        if dataset_id == "primary":
            return [self.primary_source] if self.primary_source and self.primary_source.is_file() else []
        dataset = self._dataset(dataset_id)
        base = (self.inputs_dir / dataset_id).resolve()
        result = []
        for name in dataset.get("files", []):
            path = (base / name).resolve()
            path.relative_to(base)
            if path.is_file(): result.append(path)
        return result

    def extract(self, dataset_id: str, kind: str) -> dict:
        with self._lock:
            if kind not in ANALYSIS_KINDS:
                raise ValueError("Unsupported analysis kind")
            dataset = self._dataset(dataset_id)
            capability = dataset.get("capabilities", {}).get(kind, {})
            if not capability.get("available"):
                raise ValueError(capability.get("reason") or f"{kind.upper()} data are unavailable")
            artifact = self.data_dir / f"{dataset_id}_{kind}.json"
            if artifact.is_file():
                return {"ok": True, "dataset": dataset_id, "kind": kind,
                        "path": f"analysis_data/{artifact.name}", "cached": True}
            paths = self._paths(dataset_id)
            result = self._extract_payload(dataset_id, kind, capability, paths)
            result["datasetId"] = dataset_id
            result.setdefault("metadata", {})["sourceLabel"] = dataset.get("label", dataset_id)
            _atomic_json(artifact, result)
            return {"ok": True, "dataset": dataset_id, "kind": kind,
                    "path": f"analysis_data/{artifact.name}", "cached": False}

    def _extract_payload(self, dataset_id: str, kind: str, capability: dict, paths: list[Path]) -> dict:
        role_map = {}
        for path in paths:
            role = _analysis_file_role(path, _read_text(path))
            if role and role not in role_map:
                role_map[role] = path
        data_format = capability.get("format")
        if dataset_id == "primary" and kind == "dos" and data_format == "multiwfn-orbitals":
            primary_path = self.manifest.get("analysis", {}).get("primaryDos", {}).get("path")
            if primary_path:
                resolved = (self.session_dir / primary_path).resolve()
                resolved.relative_to(self.session_dir)
                return json.loads(resolved.read_text(encoding="utf-8"))
            return molecular_dos_from_manifest(self.manifest)
        if kind == "ir":
            return parse_ir(paths[0])
        if kind == "nmr":
            return parse_nmr(paths[0])
        if kind == "band" and data_format == "vasp-eigenval":
            return parse_vasp_band(role_map["eigenval"], role_map["kpoints"], role_map.get("outcar"))
        if kind == "band" and data_format == "cp2k-bs":
            return parse_cp2k_bs(next(path for path in paths if path.suffix.lower() == ".bs" or "# Set" in _read_text(path, 1024 * 1024)))
        if kind == "dos" and data_format == "vasp-doscar":
            return parse_vasp_doscar(role_map["doscar"], role_map.get("poscar"))
        if kind == "dos" and data_format == "xy-dos":
            return parse_xy_dos(paths[0])
        if kind == "dos" and data_format == "cp2k-kpoint-levels":
            return parse_cp2k_kpoint_dos(paths[0])
        raise ValueError(f"No parser is available for {kind} data in this dataset")


def molecular_dos_from_manifest(manifest: dict) -> dict:
    items = [item for item in manifest.get("orbitals", {}).get("items", []) if isinstance(item, dict)]
    levels = []
    for item in items:
        try:
            energy = float(item["energy"]) * HARTREE_TO_EV
        except (KeyError, TypeError, ValueError):
            continue
        if math.isfinite(energy):
            levels.append({"index": int(item.get("index", len(levels) + 1)), "energy": energy,
                           "occupation": float(item.get("occupation", 0.0)), "spin": item.get("spin", "total")})
    if not levels:
        raise ValueError("No finite molecular orbital energies were found")
    occupied = [level["energy"] for level in levels if level["occupation"] > 1e-8]
    homo = max(occupied, default=0.0)
    return {
        "format": "multiwfn-analysis-data", "version": 1, "kind": "dos",
        "axes": {"x": {"label": "Orbital energy", "unit": "eV"},
                 "y": {"label": "Density of states", "unit": "states/eV"}},
        "series": {"levels": levels, "projections": []},
        "markers": [{"x": homo, "label": "HOMO", "kind": "homo"}],
        "metadata": {"program": "Multiwfn", "sampled": False, "pdos": False, "homo": homo},
        "controls": {"defaultFwhm": 0.05 * HARTREE_TO_EV, "projectionModes": []},
    }


def parse_cp2k_kpoint_dos(path: Path) -> dict:
    text = _read_text(path)
    lines = text.splitlines()
    weights: list[float] = []
    for index, line in enumerate(lines):
        if "List of Kpoints" in line:
            started = False
            for row in lines[index + 1:]:
                values = _float_tokens(row)
                if len(values) >= 2:
                    weights.append(values[-1])
                    started = True
                elif started:
                    break
            break
    open_shell = "Spin 2" in text
    block_counts = defaultdict(int)
    levels: list[dict] = []
    block_index = 0
    for index, line in enumerate(lines):
        if "EIGENVALUES AND OCCUPATION NUMBERS FOR K POINT" not in line:
            continue
        context = "\n".join(lines[max(0, index - 5):index + 1])
        if "Spin 2" in context:
            spin = "beta"
        elif "Spin 1" in context:
            spin = "alpha"
        elif open_shell:
            spin = "alpha" if block_index % 2 == 0 else "beta"
        else:
            spin = "total"
        block_index += 1
        kpoint = block_counts[spin]
        block_counts[spin] += 1
        weight = weights[min(kpoint, len(weights) - 1)] if weights else 1.0
        cursor = index + 1
        started = False
        while cursor < len(lines):
            if "EIGENVALUES AND OCCUPATION NUMBERS FOR K POINT" in lines[cursor]:
                break
            row = _float_tokens(lines[cursor])
            cursor += 1
            if len(row) >= 3:
                levels.append({"energy": row[-1], "occupation": row[-2],
                               "weight": weight, "spin": spin})
                started = True
            elif started:
                break
    if not levels:
        raise ValueError("CP2K k-point orbital energies could not be parsed")
    spin_weight_totals = defaultdict(float)
    for spin, count in block_counts.items():
        spin_weight_totals[spin] = sum(weights[:count]) if weights else float(count)
    for level in levels:
        total = spin_weight_totals[level["spin"]] or 1.0
        level["weight"] /= total
    occupied = [level["energy"] for level in levels if level["occupation"] > 1e-8]
    reference = max(occupied, default=0.0)
    for level in levels:
        level["energy"] -= reference
    return {
        "format": "multiwfn-analysis-data", "version": 1, "kind": "dos",
        "axes": {"x": {"label": "Energy - HOCO", "unit": "eV"},
                 "y": {"label": "Density of states", "unit": "states/eV"}},
        "series": {"levels": levels, "projections": []},
        "markers": [{"x": 0.0, "label": "HOCO", "kind": "homo"}],
        "metadata": {"program": "CP2K", "sampled": False, "pdos": False,
                     "spin": open_shell, "hoco": reference},
        "controls": {"defaultFwhm": 0.35, "projectionModes": []},
    }


def cleanup_analysis_session(session_dir: Path) -> None:
    session = Path(session_dir)
    shutil.rmtree(session / "analysis_inputs", ignore_errors=True)
    shutil.rmtree(session / "analysis_data", ignore_errors=True)
    try:
        (session / "analysis_registry.json").unlink()
    except FileNotFoundError:
        pass
