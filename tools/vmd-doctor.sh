#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

usage() {
    printf '%s\n' "Usage: tools/vmd-doctor.sh [VMD_PATH]"
    printf '%s\n' "Checks whether the configured VMD executable path can be resolved."
    printf '%s\n' "This script does not launch VMD and does not modify the system environment."
}

strip_quotes() {
    value=$1
    case "$value" in
        \"*\")
            value=${value#\"}
            value=${value%\"}
            ;;
        \'*\')
            value=${value#\'}
            value=${value%\'}
            ;;
    esac
    printf '%s\n' "$value"
}

settings_vmdpath() {
    sed -n 's/^[[:space:]]*vmdpath=[[:space:]]*//p' "$repo_dir/settings.ini" |
        sed -n '1p' |
        sed 's/[[:space:]]*\/\/.*$//' |
        sed 's/[[:space:]]*$//'
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
fi

if [ "$#" -gt 1 ]; then
    usage
    exit 2
fi

if [ "$#" -eq 1 ]; then
    raw_vmdpath=$1
    source_desc="command line"
else
    raw_vmdpath=$(settings_vmdpath)
    source_desc="settings.ini"
fi

vmdpath=$(strip_quotes "$raw_vmdpath")

printf '%s\n' "VMD path doctor"
printf '%s\n' "  repo: $repo_dir"
printf '%s\n' "  source: $source_desc"
printf '%s\n' "  configured path: ${vmdpath:-<empty>}"

if [ -z "$vmdpath" ] || [ "$vmdpath" = "none" ]; then
    printf '%s\n' "MISSING VMD executable path is empty or none."
    printf '%s\n' "Set settings.ini vmdpath or pass -vmdpath when running Multiwfn."
    exit 1
fi

case "$vmdpath" in
    */*|*\\*)
        if [ -x "$vmdpath" ]; then
            printf '%s\n' "OK      executable file exists: $vmdpath"
            exit 0
        fi
        if [ -e "$vmdpath" ]; then
            printf '%s\n' "MISSING path exists but is not executable: $vmdpath"
            exit 1
        fi
        printf '%s\n' "MISSING executable file was not found: $vmdpath"
        exit 1
        ;;
    *)
        resolved=$(command -v "$vmdpath" 2>/dev/null || true)
        if [ -n "$resolved" ]; then
            printf '%s\n' "OK      executable found on PATH: $resolved"
            exit 0
        fi
        printf '%s\n' "MISSING executable was not found on PATH: $vmdpath"
        printf '%s\n' "Install VMD separately and set settings.ini vmdpath or use -vmdpath."
        exit 1
        ;;
esac
