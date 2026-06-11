#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

mode=${1:-quick}
case "$mode" in
    quick|full)
        ;;
    *)
        printf '%s\n' "Usage: tools/verify-refactor.sh [quick|full]"
        printf '%s\n' "  quick: git diff check + VMD export audits + VMD bridge smoke"
        printf '%s\n' "  full:  quick checks + GNU noGUI smoke + object residue check"
        exit 2
        ;;
esac

run_step() {
    printf '\n%s\n' "==> $*"
    "$@"
}

check_no_object_residue() {
    root_residue=$(find "$repo_dir" -maxdepth 1 \( -name '*.o' -o -name '*.mod' \) -print)
    nogui_residue=$(find "$repo_dir/noGUI" -maxdepth 1 -name '*.o' -print)

    if [ -n "$root_residue$nogui_residue" ]; then
        printf '%s\n' "Unexpected build residue:"
        if [ -n "$root_residue" ]; then
            printf '%s\n' "$root_residue"
        fi
        if [ -n "$nogui_residue" ]; then
            printf '%s\n' "$nogui_residue"
        fi
        exit 1
    fi
}

cd "$repo_dir"

run_step git diff --check
run_step "$script_dir/audit-vmd-exports.sh" check
run_step "$script_dir/audit-vmd-structure-exports.sh" check
run_step "$script_dir/gnu-build.sh" vmd-smoke

if [ "$mode" = "full" ]; then
    run_step "$script_dir/gnu-build.sh" smoke
    run_step check_no_object_residue
fi

printf '\n%s\n' "Refactor verification passed ($mode)."
