#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
gnu_prefix="$repo_dir/.build-env/gnu"
fc="$gnu_prefix/bin/x86_64-conda-linux-gnu-gfortran"
build_dir="$repo_dir/.build-env/vmd-bridge-smoke"
mod_dir="$build_dir/mod"
obj_dir="$build_dir/obj"
scene_file="$build_dir/test_scene.tcl"
quoted_scene_file="$build_dir/test source \$[1]}.tcl"
multi_scene_file="$build_dir/test_multi_scene.tcl"
dataset_scene_file="$build_dir/test_dataset_scene.tcl"
out_file="$build_dir/vmd_bridge_smoke.out"

if [ ! -x "$fc" ]; then
    printf '%s\n' "GNU Fortran compiler was not found at .build-env/gnu"
    printf '%s\n' "Create or verify it with: tools/bootstrap-gnu-env.sh"
    exit 1
fi

rm -rf "$build_dir"
mkdir -p "$mod_dir" "$obj_dir"

flags="-O0 -cpp -ffree-line-length-none -fallow-argument-mismatch -fallow-invalid-boz -std=legacy -J$mod_dir -I$mod_dir"

cd "$repo_dir"
"$fc" $flags -c define.f90 -o "$obj_dir/define.o"
"$fc" $flags -c vmd_bridge.f90 -o "$obj_dir/vmd_bridge.o"
"$fc" $flags -c tools/vmd_bridge_smoke.f90 -o "$obj_dir/vmd_bridge_smoke.o"
"$fc" "$obj_dir/define.o" "$obj_dir/vmd_bridge.o" "$obj_dir/vmd_bridge_smoke.o" -o "$build_dir/vmd_bridge_smoke"

LD_LIBRARY_PATH="$gnu_prefix/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" "$build_dir/vmd_bridge_smoke" > "$out_file"

grep -Fq 'VMD scene script has been written to .build-env/vmd-bridge-smoke/test_scene.tcl' "$out_file"
grep -Fq 'VMD scene script was not written because the file could not be opened: .build-env/vmd-bridge-smoke/missing-dir/test_scene.tcl' "$out_file"
grep -Fq "POSIX command: '/opt/VMD app/vmd\$bin' -e 'scene dir/a'\\''b\$[x].tcl'" "$out_file"
grep -Fq 'Windows command: "C:\Program Files\VMD\vmd.exe" -e "scene dir\test scene.tcl"' "$out_file"
grep -Fq '# Cube file: win path C:\tmp\a$b[1]}.cub' "$scene_file"
grep -Fq '# Load this script in VMD by: source ".build-env/vmd-bridge-smoke/test source \$\[1\]}.tcl"' "$quoted_scene_file"
grep -Fq 'mol new "sample.cub" type cube waitfor all' "$quoted_scene_file"
grep -Fq '# Volumetric dataset index: 0' "$scene_file"
grep -Fq 'mol new "win path C:\\tmp\\a\$b\[1\]}.cub" type cube waitfor all' "$scene_file"
grep -Fq 'mol material Glass1' "$scene_file"
grep -Fq 'mol representation Isosurface 0.05000000 0 0 0 1 1' "$scene_file"
grep -Fq 'mol representation Isosurface -0.05000000 0 0 0 1 1' "$scene_file"
grep -Fq 'mol new "sample.cub" type cube waitfor all' "$multi_scene_file"
grep -Fq 'mol new "sample dir/a\$b\[1\]}.cub" type cube waitfor all' "$multi_scene_file"
grep -Fq '# Multi-dataset cube file: multi dataset $[x]}.cub' "$dataset_scene_file"
grep -Fq '# Number of volumetric datasets: 3' "$dataset_scene_file"
grep -Fq '# Dataset 3, VMD volume index 2' "$dataset_scene_file"
grep -Fq 'mol new "multi dataset \$\[x\]}.cub" type cube waitfor all' "$dataset_scene_file"
grep -Fq 'mol representation Isosurface 0.05000000 0 0 0 1 1' "$dataset_scene_file"
grep -Fq 'mol representation Isosurface 0.05000000 1 0 0 1 1' "$dataset_scene_file"
grep -Fq 'mol representation Isosurface 0.05000000 2 0 0 1 1' "$dataset_scene_file"
grep -Fq 'mol representation Isosurface -0.05000000 2 0 0 1 1' "$dataset_scene_file"

printf '%s\n' "VMD bridge smoke test passed: $scene_file"
