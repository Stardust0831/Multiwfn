#!/usr/bin/env bash
set -euo pipefail
root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export DYLD_LIBRARY_PATH="$root/resources/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
export OMP_STACKSIZE="${OMP_STACKSIZE:-64M}"
exec "$root/resources/tools/matterviz-desktop" --workbench "$@"
