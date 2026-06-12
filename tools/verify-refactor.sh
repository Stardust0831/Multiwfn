#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

mode=${1:-quick}
case "$mode" in
    env|quick|full)
        ;;
    *)
        printf '%s\n' "Usage: tools/verify-refactor.sh [env|quick|full]"
        printf '%s\n' "  env:   read-only GNU build environment diagnostics"
        printf '%s\n' "  quick: env diagnostics + git diff check + ignore/helper/noGUI/VMD audits + VMD doctor/open/bridge smoke/residue checks"
        printf '%s\n' "  full:  quick checks + GNU noGUI smoke + settings/full residue checks"
        exit 2
        ;;
esac

run_step() {
    printf '\n%s\n' "==> $*"
    "$@"
}

run_default_vmd_bridge_smoke() {
    (
        unset VMD_SMOKE_DIR
        unset VMD_SMOKE_KEEP
        "$script_dir/gnu-build.sh" vmd-smoke
    )
}

run_gnu_smoke_preserving_settings() {
    settings_file="$repo_dir/settings.ini"
    settings_before=$(cksum "$settings_file")

    set +e
    "$script_dir/gnu-build.sh" smoke
    status=$?
    set -e

    settings_after=$(cksum "$settings_file")
    if [ "$settings_before" != "$settings_after" ]; then
        printf '%s\n' "settings.ini changed during GNU noGUI smoke test."
        exit 1
    fi

    return "$status"
}

cd "$repo_dir"

if [ "$mode" = "env" ]; then
    run_step "$script_dir/gnu-build.sh" doctor
    printf '\n%s\n' "Refactor verification passed ($mode)."
    exit 0
fi

run_step git diff --check
run_step "$script_dir/gnu-build.sh" doctor
run_step "$script_dir/audit-ignore-rules.sh"
run_step "$script_dir/audit-helper-scripts.sh"
run_step "$script_dir/audit-nogui-build.sh"
run_step "$script_dir/audit-vmd-exports.sh" check
run_step "$script_dir/audit-vmd-structure-exports.sh" check
run_step "$script_dir/audit-gnu-smoke-stderr-smoke.sh"
run_step "$script_dir/vmd-doctor-smoke.sh"
run_step "$script_dir/vmd-open-scene-smoke.sh"
run_step run_default_vmd_bridge_smoke
run_step "$script_dir/audit-smoke-residue.sh" quick

if [ "$mode" = "full" ]; then
    run_step run_gnu_smoke_preserving_settings
    run_step "$script_dir/audit-gnu-smoke-stderr.sh"
    run_step "$script_dir/audit-smoke-residue.sh" full
fi

printf '\n%s\n' "Refactor verification passed ($mode)."
