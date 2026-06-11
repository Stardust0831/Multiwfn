#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
audit_doc="$repo_dir/docs/refactor/VMD_CUBE_EXPORT_AUDIT.md"
mode=${1:-report}

case "$mode" in
    report|check)
        ;;
    *)
        printf '%s\n' "Usage: tools/audit-vmd-exports.sh [report|check]"
        printf '%s\n' "  report: print current outcube/VMD bridge counts"
        printf '%s\n' "  check:  verify docs/refactor/VMD_CUBE_EXPORT_AUDIT.md counts"
        exit 2
        ;;
esac

if ! command -v rg >/dev/null 2>&1; then
    printf '%s\n' "ripgrep (rg) is required for this audit script."
    exit 1
fi

cd "$repo_dir"

outcube_pattern='call outcube\('
bridge_pattern='call maybe_write_vmd_cube_scene|call maybe_write_vmd_cube_scene_list|call maybe_write_vmd_cube_dataset_scene'

rg_src() {
    rg "$@" --glob '*.f90' --glob '*.F' --glob '!tools/**' --glob '!noGUI/**'
}

outcube_count=$(rg_src -n "$outcube_pattern" | wc -l | tr -d ' ')
bridge_count=$(rg_src -n "$bridge_pattern" | wc -l | tr -d ' ')

if [ "$mode" = "check" ]; then
    expected_outcube=$(sed -n 's/^- `outcube` call sites in production Fortran sources: \([0-9][0-9]*\)$/\1/p' "$audit_doc" | sed -n '1p')
    expected_bridge=$(sed -n 's/^- VMD bridge calls in production Fortran sources: \([0-9][0-9]*\)$/\1/p' "$audit_doc" | sed -n '1p')

    if [ -z "$expected_outcube" ] || [ -z "$expected_bridge" ]; then
        printf '%s\n' "Could not read expected counts from $audit_doc"
        exit 1
    fi
    if [ "$outcube_count" != "$expected_outcube" ] || [ "$bridge_count" != "$expected_bridge" ]; then
        printf '%s\n' "VMD cube export audit count mismatch:"
        printf '%s %s %s\n' "  outcube current/expected:" "$outcube_count" "$expected_outcube"
        printf '%s %s %s\n' "  bridge  current/expected:" "$bridge_count" "$expected_bridge"
        printf '%s\n' "Update $audit_doc or inspect changed export coverage."
        exit 1
    fi

    printf '%s\n' "VMD cube export audit counts match documentation."
    exit 0
fi

printf '%s\n' "# VMD cube export audit"
printf '%s\n\n' ""
printf '%s %s\n' "outcube call sites:" "$outcube_count"
printf '%s %s\n\n' "VMD bridge calls:" "$bridge_count"

printf '%s\n' "## Per-file counts"
printf '%s\n' ""

rg_src -l "$outcube_pattern" | sort | while IFS= read -r file
do
    outc=$(rg -c "$outcube_pattern" "$file" || true)
    brc=$(rg -c "$bridge_pattern" "$file" || true)
    printf '%-24s outcube=%-3s bridge=%s\n' "$file" "$outc" "$brc"
done

printf '%s\n' ""
printf '%s\n' "## Known intentional differences"
printf '%s\n' ""
printf '%s\n' "- Batch exports may write multiple cubes and then call maybe_write_vmd_cube_scene_list once."
printf '%s\n' "- surfana.f90 template.cub is a grid-alignment template, not a visualization result."
printf '%s\n' "- otherfunc2.f90 rho_*.cub files in orbital-fitting mode are intermediate cache files."
printf '%s\n' "- See docs/refactor/VMD_CUBE_EXPORT_AUDIT.md for the maintained audit notes."
