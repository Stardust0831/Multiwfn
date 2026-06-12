#!/usr/bin/env sh
set -eu

if [ "$#" -eq 0 ]; then
    printf '%s\n' "Usage: tools/vmd-scene-source-check.sh SCENE.tcl [SCENE.tcl ...]"
    exit 2
fi

tclsh_bin=${TCLSH:-}
if [ -z "$tclsh_bin" ]; then
    tclsh_bin=$(command -v tclsh || true)
fi

if [ -z "$tclsh_bin" ]; then
    printf '%s\n' "Skipping VMD scene source check because tclsh was not found."
    exit 0
fi

for scene_file
do
    case "$scene_file" in
        /*) scene_abs=$scene_file ;;
        *) scene_abs=$PWD/$scene_file ;;
    esac

    if [ ! -s "$scene_abs" ]; then
        printf '%s\n' "VMD scene file is missing or empty: $scene_file"
        exit 1
    fi

    SCENE_UNDER_TEST=$scene_abs "$tclsh_bin" <<'EOF'
proc mol {args} {}
proc display {args} {}
proc axes {args} {}

if {![file exists $env(SCENE_UNDER_TEST)]} {
    error "scene file does not exist: $env(SCENE_UNDER_TEST)"
}

source $env(SCENE_UNDER_TEST)

if {[llength [info procs multiwfn_resolve_path]] == 0} {
    error "multiwfn_resolve_path was not defined by scene"
}
EOF
done

printf '%s\n' "VMD scene source check passed."
