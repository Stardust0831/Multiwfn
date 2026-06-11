#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
gnu_prefix=${GNU_PREFIX:-"$repo_dir/.build-env/gnu"}
case "$gnu_prefix" in
    /*) ;;
    *) gnu_prefix="$repo_dir/$gnu_prefix" ;;
esac
make_bin="$gnu_prefix/bin/make"

if [ ! -x "$make_bin" ]; then
    printf '%s\n' "GNU build prefix was not found at $gnu_prefix"
    printf '%s\n' "Create or verify it with: tools/bootstrap-gnu-env.sh"
    exit 1
fi

export GNU_PREFIX="$gnu_prefix"

target=${1:-smoke}
shift || true

case "$target" in
    smoke)
        set -- gnu-noGUI-smoke "$@"
        ;;
    vmd-smoke|vmd)
        exec "$script_dir/vmd-bridge-smoke.sh" "$@"
        ;;
    noGUI|nogui)
        set -- gnu-noGUI "$@"
        ;;
    clean)
        set -- clean "$@"
        ;;
    *)
        printf '%s\n' "Usage: tools/gnu-build.sh [smoke|vmd-smoke|noGUI|clean] [make-args...]"
        exit 2
        ;;
esac

cd "$repo_dir"
exec "$make_bin" "$@"
