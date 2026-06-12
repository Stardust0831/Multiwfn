#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
gnu_prefix=${GNU_PREFIX:-"$repo_dir/.build-env/gnu"}
case "$gnu_prefix" in
    /*) ;;
    *) gnu_prefix="$repo_dir/$gnu_prefix" ;;
esac
fc=${FC_GNU:-"$gnu_prefix/bin/x86_64-conda-linux-gnu-gfortran"}
case "$fc" in
    /*) ;;
    *) fc="$repo_dir/$fc" ;;
esac
tclsh_bin=${TCLSH:-}
if [ -z "$tclsh_bin" ]; then
    tclsh_bin=$(command -v tclsh || true)
fi
if [ "${VMD_SMOKE_DIR:-}" ]; then
    smoke_dir=$VMD_SMOKE_DIR
    cleanup_default=0
else
    smoke_dir=".build-env/vmd-bridge-smoke.$$"
    cleanup_default=1
fi
case "$smoke_dir" in
    /*) build_dir="$smoke_dir" ;;
    *) build_dir="$repo_dir/$smoke_dir" ;;
esac
mod_dir="$build_dir/mod"
obj_dir="$build_dir/obj"
scene_file="$build_dir/test_scene.tcl"
structure_scene_file="$build_dir/test_structure_scene.tcl"
beta_structure_scene_file="$build_dir/test_beta_structure_scene.tcl"
pqr_structure_scene_file="$build_dir/test_pqr_structure_scene.tcl"
multi_structure_scene_file="$build_dir/test_multi_structure_scene.tcl"
gro_structure_scene_file="$build_dir/test_gro_structure_scene.tcl"
poscar_structure_scene_file="$build_dir/test_poscar_structure_scene.tcl"
auto_xyz_scene_file="$build_dir/auto_structure.xyz.vmd.tcl"
quoted_scene_file="$build_dir/test source \$[1]}.tcl"
multi_scene_file="$build_dir/test_multi_scene.tcl"
dataset_scene_file="$build_dir/test_dataset_scene.tcl"
vasp_grid_scene_file="$build_dir/test_vasp_grid_scene.tcl"
no_load_scene_file="$build_dir/no_load_scene.tcl"
out_file="$build_dir/vmd_bridge_smoke.out"
relative_path_note="# Relative data paths are first resolved beside this scene file, then from VMD's current working directory."

if [ ! -x "$fc" ]; then
    printf '%s\n' "GNU Fortran compiler was not found or is not executable at $fc"
    printf '%s\n' "Create or verify it with: tools/bootstrap-gnu-env.sh"
    printf '%s\n' "Or set FC_GNU to a compiler executable."
    exit 1
fi

cleanup() {
    status=$?
    if [ "$status" -eq 0 ] && [ "$cleanup_default" -eq 1 ] && [ "${VMD_SMOKE_KEEP:-0}" != "1" ]; then
        rm -rf "$build_dir"
    fi
}
trap cleanup EXIT

rm -rf "$build_dir"
mkdir -p "$mod_dir" "$obj_dir"
export VMD_SMOKE_DIR="$smoke_dir"

flags="-O0 -cpp -ffree-line-length-none -fallow-argument-mismatch -fallow-invalid-boz -std=legacy -J$mod_dir -I$mod_dir"

cd "$repo_dir"
"$fc" $flags -c define.f90 -o "$obj_dir/define.o"
"$fc" $flags -c vmd_bridge.f90 -o "$obj_dir/vmd_bridge.o"
"$fc" $flags -c tools/vmd_bridge_smoke.f90 -o "$obj_dir/vmd_bridge_smoke.o"
"$fc" "$obj_dir/define.o" "$obj_dir/vmd_bridge.o" "$obj_dir/vmd_bridge_smoke.o" -o "$build_dir/vmd_bridge_smoke"

LD_LIBRARY_PATH="$gnu_prefix/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" "$build_dir/vmd_bridge_smoke" > "$out_file"

grep -Fq "VMD scene script has been written to $smoke_dir/test_structure_scene.tcl" "$out_file"
grep -Fq "VMD scene script has been written to $smoke_dir/test_beta_structure_scene.tcl" "$out_file"
grep -Fq "VMD scene script has been written to $smoke_dir/test_pqr_structure_scene.tcl" "$out_file"
grep -Fq "VMD scene script has been written to $smoke_dir/test_multi_structure_scene.tcl" "$out_file"
grep -Fq "VMD scene script has been written to $smoke_dir/test_gro_structure_scene.tcl" "$out_file"
grep -Fq "VMD scene script has been written to $smoke_dir/test_poscar_structure_scene.tcl" "$out_file"
grep -Fq "VMD scene script has been written to $smoke_dir/auto_structure.xyz.vmd.tcl" "$out_file"
grep -Fq "VMD scene script has been written to $smoke_dir/test_scene.tcl" "$out_file"
grep -Fq "VMD scene script has been written to $smoke_dir/test_vasp_grid_scene.tcl" "$out_file"
grep -Fq "VMD scene script was not written because the file could not be opened: $smoke_dir/missing-dir/test_scene.tcl" "$out_file"
grep -Fq "POSIX command: '/opt/VMD app/vmd\$bin' -e 'scene dir/a'\\''b\$[x].tcl'" "$out_file"
grep -Fq 'Windows command: "C:\Program Files\VMD\vmd.exe" -e "scene dir\test scene.tcl"' "$out_file"
grep -Fq 'VMD was not launched because vmdpath is empty or none' "$out_file"
grep -Fq '# Structure file: structure dir/a$b[1]}.pdb' "$structure_scene_file"
grep -Fq "$relative_path_note" "$structure_scene_file"
grep -Fq 'proc multiwfn_resolve_path {path} {' "$structure_scene_file"
grep -Fq 'if {[file exists $from_scene]} { return $from_scene }' "$structure_scene_file"
grep -Fq 'mol new [multiwfn_resolve_path "structure dir/a\$b\[1\]}.pdb"] type "pdb" waitfor all' "$structure_scene_file"
grep -Fq 'mol rename top "structure dir/a\$b\[1\]}.pdb"' "$structure_scene_file"
grep -Fq 'mol representation CPK 1.000000 0.300000 16 16' "$structure_scene_file"
grep -Fq 'mol color Element' "$structure_scene_file"
grep -Fq 'mol new [multiwfn_resolve_path "structure dir/beta values.pdb"] type "pdb" waitfor all' "$beta_structure_scene_file"
grep -Fq 'mol color Beta' "$beta_structure_scene_file"
grep -Fq 'mol new [multiwfn_resolve_path "charge dir/a\$b\[1\]}.pqr"] type "pqr" waitfor all' "$pqr_structure_scene_file"
grep -Fq 'mol rename top "charge dir/a\$b\[1\]}.pqr"' "$pqr_structure_scene_file"
grep -Fq 'mol color Charge' "$pqr_structure_scene_file"
grep -Fq '# Structure file: charge dir/a$b[1]}.pqr' "$multi_structure_scene_file"
grep -Fq '# Structure file: charge dir/batch second.pqr' "$multi_structure_scene_file"
grep -Fq '# Structure file: charge dir/batch_third.pqr' "$multi_structure_scene_file"
grep -Fq 'mol new [multiwfn_resolve_path "charge dir/a\$b\[1\]}.pqr"] type "pqr" waitfor all' "$multi_structure_scene_file"
grep -Fq 'mol new [multiwfn_resolve_path "charge dir/batch second.pqr"] type "pqr" waitfor all' "$multi_structure_scene_file"
grep -Fq 'mol new [multiwfn_resolve_path "charge dir/batch_third.pqr"] type "pqr" waitfor all' "$multi_structure_scene_file"
grep -Fq 'mol new [multiwfn_resolve_path "traj dir/a\$b\[1\]}.gro"] type "gro" waitfor all' "$gro_structure_scene_file"
grep -Fq 'mol new [multiwfn_resolve_path "vasp dir/POS\$\[1\]}.vasp"] type "POSCAR" waitfor all' "$poscar_structure_scene_file"
grep -Fq 'mol color Element' "$poscar_structure_scene_file"
grep -Fq 'mol new [multiwfn_resolve_path "auto_structure.xyz"] type "xyz" waitfor all' "$auto_xyz_scene_file"
grep -Fq '# Cube file: win path C:\tmp\a$b[1]}.cub' "$scene_file"
grep -Fq "$relative_path_note" "$scene_file"
grep -Fq "# Load this script in VMD by: source \"${smoke_dir}/test source \\\$\\[1\\]}.tcl\"" "$quoted_scene_file"
grep -Fq 'mol new [multiwfn_resolve_path "sample.cub"] type cube waitfor all' "$quoted_scene_file"
grep -Fq '# Volumetric dataset index: 0' "$scene_file"
grep -Fq 'mol new [multiwfn_resolve_path "win path C:\\tmp\\a\$b\[1\]}.cub"] type cube waitfor all' "$scene_file"
grep -Fq 'mol rename top "win path C:\\tmp\\a\$b\[1\]}.cub"' "$scene_file"
grep -Fq 'mol material "Opaque"' "$scene_file"
grep -Fq 'mol material "Glass \$1\[x\]"' "$scene_file"
grep -Fq 'mol representation Isosurface 0.05000000 0 0 0 1 1' "$scene_file"
grep -Fq 'mol representation Isosurface -0.05000000 0 0 0 1 1' "$scene_file"
grep -Fq 'mol new [multiwfn_resolve_path "sample.cub"] type cube waitfor all' "$multi_scene_file"
grep -Fq 'mol new [multiwfn_resolve_path "sample dir/a\$b\[1\]}.cub"] type cube waitfor all' "$multi_scene_file"
grep -Fq '# Multi-dataset cube file: multi dataset $[x]}.cub' "$dataset_scene_file"
grep -Fq '# Number of volumetric datasets: 3' "$dataset_scene_file"
grep -Fq '# Dataset 3, VMD volume index 2' "$dataset_scene_file"
grep -Fq 'mol new [multiwfn_resolve_path "multi dataset \$\[x\]}.cub"] type cube waitfor all' "$dataset_scene_file"
grep -Fq 'mol rename top "multi dataset \$\[x\]}.cub"' "$dataset_scene_file"
grep -Fq 'mol representation Isosurface 0.05000000 0 0 0 1 1' "$dataset_scene_file"
grep -Fq 'mol representation Isosurface 0.05000000 1 0 0 1 1' "$dataset_scene_file"
grep -Fq 'mol representation Isosurface 0.05000000 2 0 0 1 1' "$dataset_scene_file"
grep -Fq 'mol representation Isosurface -0.05000000 2 0 0 1 1' "$dataset_scene_file"
grep -Fq '# Volumetric map file: vasp grid/CHG$[1]}.vasp' "$vasp_grid_scene_file"
grep -Fq '# VMD file type: CHGCAR' "$vasp_grid_scene_file"
grep -Fq 'mol new [multiwfn_resolve_path "vasp grid/CHG\$\[1\]}.vasp"] type "CHGCAR" waitfor all' "$vasp_grid_scene_file"
grep -Fq 'mol rename top "vasp grid/CHG\$\[1\]}.vasp"' "$vasp_grid_scene_file"
grep -Fq 'mol representation Isosurface 0.05000000 0 0 0 1 1' "$vasp_grid_scene_file"

mkdir -p "$build_dir/structure dir" "$build_dir/charge dir" "$build_dir/traj dir" "$build_dir/vasp dir" "$build_dir/sample dir" "$build_dir/vasp grid"
: > "$build_dir/structure dir/a\$b[1]}.pdb"
: > "$build_dir/structure dir/beta values.pdb"
: > "$build_dir/charge dir/a\$b[1]}.pqr"
: > "$build_dir/charge dir/batch second.pqr"
: > "$build_dir/charge dir/batch_third.pqr"
: > "$build_dir/traj dir/a\$b[1]}.gro"
: > "$build_dir/vasp dir/POS\$[1]}.vasp"
: > "$build_dir/auto_structure.xyz"
: > "$build_dir/win path C:\\tmp\\a\$b[1]}.cub"
: > "$build_dir/sample.cub"
: > "$build_dir/sample dir/a\$b[1]}.cub"
: > "$build_dir/multi dataset \$[x]}.cub"
: > "$build_dir/vasp grid/CHG\$[1]}.vasp"

"$script_dir/vmd-scene-source-check.sh" \
    "$structure_scene_file" \
    "$beta_structure_scene_file" \
    "$pqr_structure_scene_file" \
    "$multi_structure_scene_file" \
    "$gro_structure_scene_file" \
    "$poscar_structure_scene_file" \
    "$auto_xyz_scene_file" \
    "$scene_file" \
    "$quoted_scene_file" \
    "$multi_scene_file" \
    "$dataset_scene_file" \
    "$vasp_grid_scene_file"

if [ -n "$tclsh_bin" ]; then
    cat > "$no_load_scene_file" <<'EOF'
proc multiwfn_resolve_path {path} {
    return $path
}
display resetview
EOF
    set +e
    no_load_output=$("$script_dir/vmd-scene-source-check.sh" "$no_load_scene_file" 2>&1)
    no_load_status=$?
    set -e
    if [ "$no_load_status" -eq 0 ]; then
        printf '%s\n' "VMD scene source check unexpectedly accepted a scene without mol new"
        exit 1
    fi
    printf '%s\n' "$no_load_output" | grep -Fq "scene did not issue any mol new data load commands"

    SCENE_UNDER_TEST="$quoted_scene_file" \
    EXPECTED_SCENE_SAMPLE="$build_dir/sample.cub" \
    "$tclsh_bin" <<'EOF'
proc mol {args} {}
proc display {args} {}
proc axes {args} {}

source $env(SCENE_UNDER_TEST)

set resolved [file normalize [multiwfn_resolve_path "sample.cub"]]
set expected [file normalize $env(EXPECTED_SCENE_SAMPLE)]
if {$resolved ne $expected} {
    error "scene-relative path resolution failed: $resolved != $expected"
}

set fallback [multiwfn_resolve_path "missing-sample.cub"]
if {$fallback ne "missing-sample.cub"} {
    error "missing relative path should fall back unchanged: $fallback"
}

set absolute [file normalize $env(EXPECTED_SCENE_SAMPLE)]
if {[multiwfn_resolve_path $absolute] ne $absolute} {
    error "absolute path should be passed through unchanged"
}
EOF
else
    printf '%s\n' "Skipping Tcl source check because tclsh was not found."
fi

if [ "$cleanup_default" -eq 1 ] && [ "${VMD_SMOKE_KEEP:-0}" != "1" ]; then
    printf '%s\n' "VMD bridge smoke test passed; temporary directory will be cleaned."
else
    printf '%s\n' "VMD bridge smoke test passed: $scene_file"
fi
