#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
smoke_dir="$repo_dir/.build-env/vmd-open-scene-smoke.$$"

cleanup() {
    status=$?
    if [ "$status" -eq 0 ]; then
        rm -rf "$smoke_dir"
    else
        printf '%s\n' "VMD open-scene smoke output kept at: $smoke_dir"
    fi
}
trap cleanup EXIT

mkdir -p "$smoke_dir"
cd "$repo_dir"

scene_file="$smoke_dir/test scene.vmd.tcl"
fake_vmd="$smoke_dir/fake vmd"
fake_log="$smoke_dir/fake-vmd.log"
help_out="$smoke_dir/help.out"
dry_out="$smoke_dir/dry.out"
run_out="$smoke_dir/run.out"
none_out="$smoke_dir/none.out"
missing_scene_out="$smoke_dir/missing-scene.out"
missing_vmd_out="$smoke_dir/missing-vmd.out"

printf '%s\n' '# smoke scene' > "$scene_file"

cat > "$fake_vmd" <<'EOF'
#!/usr/bin/env sh
printf '%s\n' "$*" > "$FAKE_VMD_LOG"
EOF
chmod +x "$fake_vmd"

"$script_dir/vmd-open-scene.sh" --help > "$help_out"
grep -Fq "Usage: tools/vmd-open-scene.sh [--dry-run] [--vmdpath VMD_PATH] SCENE.vmd.tcl" "$help_out"

"$script_dir/vmd-open-scene.sh" --dry-run --vmdpath "$fake_vmd" "$scene_file" > "$dry_out"
grep -Fq "VMD executable: $fake_vmd" "$dry_out"
grep -Fq "VMD scene: $scene_file" "$dry_out"
grep -Fq "Dry run: would execute VMD with -e scene." "$dry_out"

FAKE_VMD_LOG="$fake_log" "$script_dir/vmd-open-scene.sh" --vmdpath "$fake_vmd" "$scene_file" > "$run_out"
grep -Fq "VMD executable: $fake_vmd" "$run_out"
grep -Fq -- "-e $scene_file" "$fake_log"

if "$script_dir/vmd-open-scene.sh" --vmdpath none "$scene_file" > "$none_out" 2>&1; then
    printf '%s\n' "Expected vmd-open-scene to fail for vmdpath none."
    exit 1
fi
grep -Fq "VMD executable path is empty or none" "$none_out"

if "$script_dir/vmd-open-scene.sh" --vmdpath "$fake_vmd" "$smoke_dir/missing.vmd.tcl" > "$missing_scene_out" 2>&1; then
    printf '%s\n' "Expected vmd-open-scene to fail for a missing scene."
    exit 1
fi
grep -Fq "VMD scene file was not found: $smoke_dir/missing.vmd.tcl" "$missing_scene_out"

if "$script_dir/vmd-open-scene.sh" --vmdpath "$smoke_dir/missing-vmd" "$scene_file" > "$missing_vmd_out" 2>&1; then
    printf '%s\n' "Expected vmd-open-scene to fail for a missing VMD executable."
    exit 1
fi
grep -Fq "VMD executable file was not found or is not executable: $smoke_dir/missing-vmd" "$missing_vmd_out"

printf '%s\n' "VMD open-scene smoke test passed."
