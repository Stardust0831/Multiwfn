#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
ignore_file="$repo_dir/.gitignore"

if [ ! -r "$ignore_file" ]; then
    printf '%s\n' ".gitignore is missing or unreadable."
    exit 1
fi

status=0

require_ignore() {
    pattern=$1
    if ! grep -Fxq "$pattern" "$ignore_file"; then
        printf '%s\n' "Required ignore pattern is missing: $pattern"
        status=1
    fi
}

require_ignore "*.mod"
require_ignore "*.o"
require_ignore "*.obj"
require_ignore "Multiwfn"
require_ignore "Multiwfn_noGUI"
require_ignore "*.exe"
require_ignore "*.dll"
require_ignore "*.so"
require_ignore "*.dylib"
require_ignore "tmplib/"
require_ignore "wfntmp*/"
require_ignore "*.cub"
require_ignore "*.cube"
require_ignore "*.pdb"
require_ignore "*.xyz"
require_ignore "*.tcl"
require_ignore ".build-env/"
require_ignore "Makefile.local"

if [ "$status" -ne 0 ]; then
    exit "$status"
fi

printf '%s\n' "Ignore rule audit passed."
