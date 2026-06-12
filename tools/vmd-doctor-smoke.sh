#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
smoke_dir="$repo_dir/.build-env/vmd-doctor-smoke.$$"

cleanup() {
    status=$?
    if [ "$status" -eq 0 ]; then
        rm -rf "$smoke_dir"
    else
        printf '%s\n' "VMD doctor smoke output kept at: $smoke_dir"
    fi
}
trap cleanup EXIT

mkdir -p "$smoke_dir"
cd "$repo_dir"

help_out="$smoke_dir/help.out"
path_out="$smoke_dir/path.out"
absolute_out="$smoke_dir/absolute.out"
missing_out="$smoke_dir/missing.out"
none_out="$smoke_dir/none.out"
settings_out="$smoke_dir/settings.out"

"$script_dir/vmd-doctor.sh" --help > "$help_out"
grep -Fq "Usage: tools/vmd-doctor.sh [VMD_PATH]" "$help_out"

"$script_dir/vmd-doctor.sh" sh > "$path_out"
grep -Fq "source: command line" "$path_out"
grep -Fq "configured path: sh" "$path_out"
grep -Fq "OK      executable found on PATH:" "$path_out"

sh_path=$(command -v sh)
"$script_dir/vmd-doctor.sh" "$sh_path" > "$absolute_out"
grep -Fq "configured path: $sh_path" "$absolute_out"
grep -Fq "OK      executable file exists: $sh_path" "$absolute_out"

if "$script_dir/vmd-doctor.sh" "$smoke_dir/missing-vmd" > "$missing_out" 2>&1; then
    printf '%s\n' "Expected vmd-doctor to fail for a missing executable path."
    exit 1
fi
grep -Fq "MISSING executable file was not found: $smoke_dir/missing-vmd" "$missing_out"

if "$script_dir/vmd-doctor.sh" NONE > "$none_out" 2>&1; then
    printf '%s\n' "Expected vmd-doctor to fail for NONE."
    exit 1
fi
grep -Fq "configured path: NONE" "$none_out"
grep -Fq "MISSING VMD executable path is empty or none." "$none_out"

if "$script_dir/vmd-doctor.sh" > "$settings_out" 2>&1; then
    grep -Fq "source: settings.ini" "$settings_out"
else
    grep -Fq "source: settings.ini" "$settings_out"
    grep -Eq "MISSING executable (was not found on PATH|file was not found):" "$settings_out"
fi

printf '%s\n' "VMD doctor smoke test passed."
