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

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/vmd-scene-source-check.XXXXXX")
cleanup() {
    rm -rf "$tmp_dir"
}
trap cleanup EXIT

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

    SCENE_UNDER_TEST=$scene_abs SCENE_SOURCE_CWD=$tmp_dir "$tclsh_bin" <<'EOF'
if {[catch {
set multiwfn_mol_new_paths {}

proc mol {args} {
    global multiwfn_mol_new_paths
    if {[llength $args] >= 2 && [lindex $args 0] eq "new"} {
        lappend multiwfn_mol_new_paths [lindex $args 1]
    }
}
proc display {args} {}
proc axes {args} {}

if {![file exists $env(SCENE_UNDER_TEST)]} {
    error "scene file does not exist: $env(SCENE_UNDER_TEST)"
}

cd $env(SCENE_SOURCE_CWD)
source $env(SCENE_UNDER_TEST)

if {[llength [info procs multiwfn_resolve_path]] == 0} {
    error "multiwfn_resolve_path was not defined by scene"
}

if {[llength $multiwfn_mol_new_paths] == 0} {
    error "scene did not issue any mol new data load commands"
}

foreach data_path $multiwfn_mol_new_paths {
    if {![file exists $data_path]} {
        error "resolved VMD data path does not exist when sourced from another CWD: $data_path"
    }
}
} multiwfn_scene_source_error]} {
    puts stderr $multiwfn_scene_source_error
    exit 1
}
EOF
done

printf '%s\n' "VMD scene source check passed."
