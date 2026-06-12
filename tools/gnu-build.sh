#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
gnu_prefix=${GNU_PREFIX:-"$repo_dir/.build-env/gnu"}
case "$gnu_prefix" in
    /*) ;;
    *) gnu_prefix="$repo_dir/$gnu_prefix" ;;
esac
make_bin=${MAKE_GNU:-"$gnu_prefix/bin/make"}
case "$make_bin" in
    /*) ;;
    *) make_bin="$repo_dir/$make_bin" ;;
esac

target=${1:-smoke}
shift || true

if [ "$target" = "doctor" ]; then
    exec "$script_dir/gnu-env-doctor.sh" "$@"
fi

if [ ! -x "$make_bin" ]; then
    printf '%s\n' "GNU make was not found or is not executable at $make_bin"
    printf '%s\n' "Create or verify the local prefix with: tools/bootstrap-gnu-env.sh"
    printf '%s\n' "Or set MAKE_GNU to a make executable inside this source tree."
    exit 1
fi

export GNU_PREFIX="$gnu_prefix"

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
    noGUI-incremental|nogui-incremental|incremental)
        set -- gnu-noGUI-incremental "$@"
        ;;
    clean)
        set -- gnu-clean "$@"
        ;;
    *)
        printf '%s\n' "Usage: tools/gnu-build.sh [doctor|smoke|vmd-smoke|noGUI|noGUI-incremental|clean] [make-args...]"
        exit 2
        ;;
esac

cd "$repo_dir"
exec "$make_bin" "$@"
