#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

if ! command -v rg >/dev/null 2>&1; then
    printf '%s\n' "ripgrep (rg) is required for this audit script."
    exit 1
fi

cd "$repo_dir"

outcube_pattern='call outcube\('
bridge_pattern='call maybe_write_vmd_cube_scene|call maybe_write_vmd_cube_scene_list|call maybe_write_vmd_cube_dataset_scene'

outcube_count=$(rg -n "$outcube_pattern" --glob '*.f90' --glob '*.F' | wc -l | tr -d ' ')
bridge_count=$(rg -n "$bridge_pattern" --glob '*.f90' --glob '*.F' | wc -l | tr -d ' ')

printf '%s\n' "# VMD cube export audit"
printf '%s\n\n' ""
printf '%s %s\n' "outcube call sites:" "$outcube_count"
printf '%s %s\n\n' "VMD bridge calls:" "$bridge_count"

printf '%s\n' "## Per-file counts"
printf '%s\n' ""

rg -l "$outcube_pattern" --glob '*.f90' --glob '*.F' | sort | while IFS= read -r file
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
