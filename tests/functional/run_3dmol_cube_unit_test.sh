#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /path/to/Multiwfn_MatterVizGUI" >&2
  exit 2
fi

exe="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
if [ ! -x "$exe" ]; then
  echo "Executable is not runnable: $exe" >&2
  exit 2
fi

workdir="$(mktemp -d)"
cleanup() {
  rm -rf "$workdir"
}
trap cleanup EXIT

cat > "$workdir/tiny.cube" <<'EOF'
Cube coordinate unit regression test
Coordinates are in Bohr because voxel counts are positive
    1    2.000000   -1.000000    0.500000
    2    0.400000    0.000000    0.000000
    2    0.000000    0.500000    0.000000
    2    0.000000    0.000000    0.600000
    8    0.000000    1.250000   -0.750000    0.500000
  1.000000E-01  2.000000E-01  3.000000E-01  4.000000E-01
  5.000000E-01  6.000000E-01  7.000000E-01  8.000000E-01
EOF

mkdir -p "$workdir/session"
(
  cd "$workdir"
  MULTIWFN_MATTERVIZ_SESSION="$workdir/session" \
  MULTIWFN_MATTERVIZ_SHELL=browser \
  MULTIWFN_MATTERVIZ_PYTHON="$(command -v true)" \
    "$exe" tiny.cube <<'EOF' > multiwfn.out
13
-2
-1
q
EOF
)

cube="$workdir/session/cubmat.cube"
structure="$workdir/session/structure.json"
test -f "$cube"
test -f "$structure"

awk '
  NR == 3 && ($1 != 1 || $2 != 2.0 || $3 != -1.0 || $4 != 0.5) { exit 1 }
  NR == 4 && ($1 != 2 || $2 != 0.4 || $3 != 0.0 || $4 != 0.0) { exit 1 }
  NR == 5 && ($1 != 2 || $2 != 0.0 || $3 != 0.5 || $4 != 0.0) { exit 1 }
  NR == 6 && ($1 != 2 || $2 != 0.0 || $3 != 0.0 || $4 != 0.6) { exit 1 }
  NR == 7 && ($1 != 8 || $3 != 1.25 || $4 != -0.75 || $5 != 0.5) { exit 1 }
' "$cube"

python3 - "$structure" <<'PY'
import json
import math
import sys

structure = json.load(open(sys.argv[1], encoding="utf-8"))
assert len(structure["sites"]) == 1
site = structure["sites"][0]
assert site["species"][0]["element"] == "O"
expected = (0.6614715, -0.3968829, 0.2645886)
assert all(math.isclose(actual, target, abs_tol=1e-6) for actual, target in zip(site["xyz"], expected))
assert structure["properties"]["bonds"] == []
PY

echo "MatterViz cube and structure JSON unit test passed"
