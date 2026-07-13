#!/usr/bin/env python3
"""Native file picker helper for the Multiwfn MatterViz GUI backend."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Open a native file dialog for Multiwfn")
    parser.add_argument("--output", required=True, help="File that receives the selected path")
    parser.add_argument("--title", default="Choose a Multiwfn input file", help="Dialog title")
    args = parser.parse_args()

    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.update()
        selected = filedialog.askopenfilename(
            title=args.title,
            filetypes=[
                ("Multiwfn inputs", "*.wfn *.wfx *.fch *.fchk *.molden *.mwfn *.chg *.pdb *.xyz *.mol *.mol2 *.cif *.cub *.cube"),
                ("All files", "*.*"),
            ],
        )
        root.destroy()
    except Exception as exc:
        output.write_text("", encoding="utf-8")
        print(f"File dialog unavailable: {exc}", file=sys.stderr)
        return 2

    output.write_text(f"{selected}\n" if selected else "", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
