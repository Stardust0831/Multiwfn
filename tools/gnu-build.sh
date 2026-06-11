#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
make_bin="$repo_dir/.build-env/gnu/bin/make"

if [ ! -x "$make_bin" ]; then
    printf '%s\n' "GNU build prefix was not found at .build-env/gnu"
    printf '%s\n' "Create it with: mamba env create -p \"\$PWD/.build-env/gnu\" -f docs/refactor/gnu-build-env.yml"
    exit 1
fi

target=${1:-smoke}
shift || true

case "$target" in
    smoke)
        set -- gnu-noGUI-smoke "$@"
        ;;
    noGUI|nogui)
        set -- gnu-noGUI "$@"
        ;;
    clean)
        set -- clean "$@"
        ;;
    *)
        printf '%s\n' "Usage: tools/gnu-build.sh [smoke|noGUI|clean] [make-args...]"
        exit 2
        ;;
esac

cd "$repo_dir"
exec "$make_bin" "$@"
