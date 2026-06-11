#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
audit_dir="$repo_dir/.build-env/nogui-build-audit.$$"
dry_run_out="$audit_dir/make-noGUI.dry-run"

cleanup() {
    status=$?
    if [ "$status" -eq 0 ]; then
        rm -rf "$audit_dir"
    else
        printf '%s\n' "noGUI build audit output kept at: $dry_run_out"
    fi
}
trap cleanup EXIT

mkdir -p "$audit_dir"
cd "$repo_dir"

${MAKE:-make} -n noGUI > "$dry_run_out"

require_present() {
    pattern=$1
    if ! grep -Fq "$pattern" "$dry_run_out"; then
        printf '%s\n' "Expected noGUI dry-run entry was not found: $pattern"
        exit 1
    fi
}

require_absent() {
    pattern=$1
    if grep -Eq "$pattern" "$dry_run_out"; then
        printf '%s\n' "Unexpected GUI build entry found in noGUI dry-run: $pattern"
        exit 1
    fi
}

require_present "noGUI/dislin_mod_empty.f90"
require_present "noGUI/GUI_empty.f90"
require_present "noGUI/plot_external_empty.f90"
require_present "noGUI/dislin_d_empty.f90"
require_present "noGUI/mouse_rotate_empty.f90"

require_absent '[[:space:]]-c[[:space:]]+GUI\.f90([[:space:]]|$)'
require_absent '[[:space:]]-c[[:space:]]+mouse_rotate\.f90([[:space:]]|$)'
require_absent '[[:space:]]-c[[:space:]]+ext/xlib\.f90([[:space:]]|$)'
require_absent '[[:space:]]-c[[:space:]]+dislin_d\.f90([[:space:]]|$)'
require_absent '(^|[[:space:]])GUI\.o([[:space:]]|$)'
require_absent '(^|[[:space:]])mouse_rotate\.o([[:space:]]|$)'
require_absent '(^|[[:space:]])xlib\.o([[:space:]]|$)'
require_absent 'dislin_d-11\.0\.a'
require_absent '(^|[[:space:]])-lXm([[:space:]]|$)'
require_absent '(^|[[:space:]])-lXt([[:space:]]|$)'
require_absent '(^|[[:space:]])-lX11([[:space:]]|$)'
require_absent '(^|[[:space:]])-lGL([[:space:]]|$)'

printf '%s\n' "noGUI dry-run audit passed."
