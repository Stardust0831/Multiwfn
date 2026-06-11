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
out_file="$build_dir/vmd_bridge_smoke.out"

if [ ! -x "$fc" ]; then
    printf '%s\n' "GNU Fortran compiler was not found at .build-env/gnu"
    printf '%s\n' "Create it with: mamba env create -p \"\$PWD/.build-env/gnu\" -f docs/refactor/gnu-build-env.yml"
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
grep -Fq 'mol new {sample.cub} type cube waitfor all' "$scene_file"
grep -Fq 'mol material Glass1' "$scene_file"
grep -Fq 'mol representation Isosurface 0.05000000 0 0 0 1 1' "$scene_file"
grep -Fq 'mol representation Isosurface -0.05000000 0 0 0 1 1' "$scene_file"

printf '%s\n' "VMD bridge smoke test passed: $scene_file"
