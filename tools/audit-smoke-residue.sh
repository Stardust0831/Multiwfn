#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

mode=${1:-all}
case "$mode" in
    quick|full|all)
        ;;
    *)
        printf '%s\n' "Usage: tools/audit-smoke-residue.sh [quick|full|all]"
        printf '%s\n' "  quick: check temporary quick-verification directories"
        printf '%s\n' "  full:  check object/module and known GNU smoke export residue"
        printf '%s\n' "  all:   run both quick and full residue checks"
        exit 2
        ;;
esac

status=0

check_quick_temp_residue() {
    residue=
    if [ -d "$repo_dir/.build-env" ]; then
        residue=$(find "$repo_dir/.build-env" -maxdepth 1 -type d \( \
            -name 'nogui-build-audit.*' -o \
            -name 'vmd-bridge-smoke.*' -o \
            -name 'vmd-doctor-smoke.*' \
        \) -print)
    fi

    if [ -n "$residue" ]; then
        printf '%s\n' "Unexpected quick verification temporary directory residue:"
        printf '%s\n' "$residue"
        status=1
    fi
}

check_object_residue() {
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
        status=1
    fi
}

check_smoke_export_residue() {
    export_residue=0
    for file in he_minimal.chg atmpopdcp.txt density.cub density.cub.vmd.tcl CHGCAR CHGCAR.vmd.tcl POSCAR POSCAR.vmd.tcl exported.pdb exported.pdb.vmd.tcl exported.CHGCAR exported.CHGCAR.vmd.tcl exported.POSCAR exported.POSCAR.vmd.tcl
    do
        if [ -e "$repo_dir/$file" ]; then
            if [ "$export_residue" -eq 0 ]; then
                printf '%s\n' "Unexpected GNU noGUI smoke export residue:"
            fi
            printf '%s\n' "$repo_dir/$file"
            export_residue=1
            status=1
        fi
    done
}

case "$mode" in
    quick)
        check_quick_temp_residue
        ;;
    full)
        check_object_residue
        check_smoke_export_residue
        ;;
    all)
        check_quick_temp_residue
        check_object_residue
        check_smoke_export_residue
        ;;
esac

if [ "$status" -ne 0 ]; then
    exit "$status"
fi

printf '%s\n' "Smoke residue audit passed ($mode)."
