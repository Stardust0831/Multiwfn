#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
audit_doc="$repo_dir/docs/refactor/VMD_STRUCTURE_EXPORT_AUDIT.md"
mode=${1:-report}

case "$mode" in
    report|check)
        ;;
    *)
        printf '%s\n' "Usage: tools/audit-vmd-structure-exports.sh [report|check]"
        printf '%s\n' "  report: print current structure export/VMD bridge counts"
        printf '%s\n' "  check:  verify docs/refactor/VMD_STRUCTURE_EXPORT_AUDIT.md counts"
        exit 2
        ;;
esac

if ! command -v rg >/dev/null 2>&1; then
    printf '%s\n' "ripgrep (rg) is required for this audit script."
    exit 1
fi

cd "$repo_dir"

wrapper_pattern='subroutine out(pdb|pqr|xyz|gro)_wrapper'
wrapper_bridge_pattern='call maybe_write_vmd_structure_scene\(outname,"(pdb|pqr|xyz|gro)"\)'
explicit_bridge_pattern='call maybe_write_vmd_structure_scene\("mol\.pdb","pdb"\)'
bridge_pattern='call maybe_write_vmd_structure_scene'

rg_src() {
    rg "$@" --glob '*.f90' --glob '*.F' --glob '!tools/**' --glob '!noGUI/**'
}

count_pattern() {
    rg_src -n "$1" | wc -l | tr -d ' '
}

wrapper_count=$(count_pattern "$wrapper_pattern")
wrapper_bridge_count=$(count_pattern "$wrapper_bridge_pattern")
explicit_bridge_count=$(count_pattern "$explicit_bridge_pattern")
bridge_count=$(count_pattern "$bridge_pattern")

if [ "$mode" = "check" ]; then
    expected_wrappers=$(sed -n 's/^- Structure wrapper definitions in production Fortran sources: \([0-9][0-9]*\)$/\1/p' "$audit_doc" | sed -n '1p')
    expected_wrapper_bridges=$(sed -n 's/^- Wrapper-level VMD structure bridge calls in production Fortran sources: \([0-9][0-9]*\)$/\1/p' "$audit_doc" | sed -n '1p')
    expected_explicit_bridges=$(sed -n 's/^- Explicit non-wrapper VMD structure bridge calls in production Fortran sources: \([0-9][0-9]*\)$/\1/p' "$audit_doc" | sed -n '1p')
    expected_bridges=$(sed -n 's/^- Total VMD structure bridge calls in production Fortran sources: \([0-9][0-9]*\)$/\1/p' "$audit_doc" | sed -n '1p')

    if [ -z "$expected_wrappers" ] || [ -z "$expected_wrapper_bridges" ] || [ -z "$expected_explicit_bridges" ] || [ -z "$expected_bridges" ]; then
        printf '%s\n' "Could not read expected counts from $audit_doc"
        exit 1
    fi

    if [ "$wrapper_count" != "$expected_wrappers" ] || \
       [ "$wrapper_bridge_count" != "$expected_wrapper_bridges" ] || \
       [ "$explicit_bridge_count" != "$expected_explicit_bridges" ] || \
       [ "$bridge_count" != "$expected_bridges" ]; then
        printf '%s\n' "VMD structure export audit count mismatch:"
        printf '%s %s %s\n' "  wrappers current/expected:" "$wrapper_count" "$expected_wrappers"
        printf '%s %s %s\n' "  wrapper bridges current/expected:" "$wrapper_bridge_count" "$expected_wrapper_bridges"
        printf '%s %s %s\n' "  explicit bridges current/expected:" "$explicit_bridge_count" "$expected_explicit_bridges"
        printf '%s %s %s\n' "  total bridges current/expected:" "$bridge_count" "$expected_bridges"
        printf '%s\n' "Update $audit_doc or inspect changed export coverage."
        exit 1
    fi

    printf '%s\n' "VMD structure export audit counts match documentation."
    exit 0
fi

printf '%s\n' "# VMD structure export audit"
printf '%s\n\n' ""
printf '%s %s\n' "structure wrapper definitions:" "$wrapper_count"
printf '%s %s\n' "wrapper-level VMD bridge calls:" "$wrapper_bridge_count"
printf '%s %s\n' "explicit non-wrapper bridge calls:" "$explicit_bridge_count"
printf '%s %s\n\n' "total VMD structure bridge calls:" "$bridge_count"

printf '%s\n' "## Bridge call sites"
printf '%s\n' ""
rg_src -n "$bridge_pattern" | sort

printf '%s\n' ""
printf '%s\n' "## Wrapper definitions"
printf '%s\n' ""
rg_src -n "$wrapper_pattern" | sort

printf '%s\n' ""
printf '%s\n' "## Maintained audit notes"
printf '%s\n' ""
printf '%s\n' "- See docs/refactor/VMD_STRUCTURE_EXPORT_AUDIT.md for the maintained coverage boundary."
