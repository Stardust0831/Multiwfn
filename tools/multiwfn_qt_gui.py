#!/usr/bin/env python3
"""Launch the experimental Qt GUI shell from packaged Multiwfn resources."""

from __future__ import annotations

import runpy
from pathlib import Path
import sys


def main() -> int:
    here = Path(__file__).resolve()
    roots = [
        here.parents[1],
        here.parents[1] / "resources",
    ]
    for root in roots:
        candidate = root / "frontend" / "qt-multiwfn-gui" / "qt_multiwfn_gui.py"
        if candidate.is_file():
            sys.argv[0] = str(candidate)
            runpy.run_path(str(candidate), run_name="__main__")
            return 0
    print("Qt GUI frontend not found.", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
