#!/usr/bin/env python3
"""Standalone vibrational mode animation entry for Multiwfn + MatterViz.

This launcher follows the external-orchestration model recorded in
docs/matterviz-control-protocol.md and issue #58: Multiwfn stays the scientific
engine and is driven entirely from the outside by feeding numeric menu inputs
into its stdin. No Multiwfn core behavior is changed by this program.

Pipeline:
  1. Start `Multiwfn <output-file>` (Gaussian/ORCA/CP2K frequency output).
  2. Feed the menu path to the vibrational mode animation entry:
       11            main function 11 (plot spectra)
       <spectrum>    1=IR, 2=Raman, 5=VCD, 6=ROA
       26            "Animate vibrational modes in MatterViz GUI"
  3. Multiwfn parses the normal modes, spawns the MatterViz host and opens the
     vibration page. The launcher waits until the user returns from the GUI.
  4. Feed `-3` (leave the spectrum menu) and `q` (exit Multiwfn gracefully).

xTB note: for xTB output files Multiwfn additionally asks for the companion
g98.out path; pass it with --g98-out and it is fed at the right prompt.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

SPECTRUM_CODES = {"ir": "1", "raman": "2", "vcd": "5", "roa": "6"}


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
    candidates.extend(
        (
            Path("Multiwfn_MatterVizGUI"),
            Path("Multiwfn"),
            Path("build-matterviz-webview/Multiwfn_MatterVizGUI"),
            Path("build-matterviz-gui/Multiwfn_MatterVizGUI"),
        )
    )
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate.resolve()
    searched = "\n  ".join(str(candidate) for candidate in candidates)
    sys.exit(f"Error: no executable Multiwfn binary found; searched:\n  {searched}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("input", help="Frequency output file (Gaussian/ORCA/CP2K output, or xTB output with --g98-out)")
    parser.add_argument(
        "--spectrum",
        choices=sorted(SPECTRUM_CODES),
        default="ir",
        help="Spectrum context for intensities shown in the viewer (default: ir)",
    )
    parser.add_argument("--multiwfn", help="Path to the Multiwfn(_MatterVizGUI) executable")
    parser.add_argument("--g98-out", help="Companion g98.out produced by xTB (fed when Multiwfn asks for it)")
    args = parser.parse_args()

    input_file = Path(args.input)
    if not input_file.is_file():
        sys.exit(f"Error: cannot find the input file: {input_file}")
    multiwfn = resolve_multiwfn(args.multiwfn)

    menu_inputs = ["11", SPECTRUM_CODES[args.spectrum], "26"]
    if args.g98_out:
        g98 = Path(args.g98_out)
        if not g98.is_file():
            sys.exit(f"Error: cannot find the g98.out file: {g98}")
        menu_inputs.append(str(g98))
    menu_inputs += ["-3", "q"]
    stdin_sequence = "\n".join(menu_inputs) + "\n"

    print(f"Multiwfn binary : {multiwfn}")
    print(f"Input file      : {input_file.resolve()}")
    print(f"Menu sequence   : {' -> '.join(menu_inputs[:-2])} (then -3, q)")
    print("Launching the vibrational mode viewer; close it or press Return to exit.")

    process = subprocess.Popen(
        [str(multiwfn), str(input_file.resolve())],
        stdin=subprocess.PIPE,
        text=True,
    )
    try:
        process.communicate(stdin_sequence)
    except BrokenPipeError:
        pass
    return process.returncode or 0


if __name__ == "__main__":
    sys.exit(main())
