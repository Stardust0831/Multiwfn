#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
dry_run=0
explicit_vmdpath=

usage() {
    printf '%s\n' "Usage: tools/vmd-open-scene.sh [--dry-run] [--vmdpath VMD_PATH] SCENE.vmd.tcl"
    printf '%s\n' "Opens an existing Multiwfn-generated VMD Tcl scene with a user-installed VMD."
    printf '%s\n' "The script reads settings.ini vmdpath when --vmdpath is not supplied."
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

resolve_executable() {
    vmdpath=$1
    case "$vmdpath" in
        ""|[Nn][Oo][Nn][Ee])
            printf '%s\n' "VMD executable path is empty or none; set settings.ini vmdpath or pass --vmdpath." >&2
            return 1
            ;;
        */*|*\\*)
            if [ -x "$vmdpath" ]; then
                printf '%s\n' "$vmdpath"
                return 0
            fi
            printf '%s\n' "VMD executable file was not found or is not executable: $vmdpath" >&2
            return 1
            ;;
        *)
            resolved=$(command -v "$vmdpath" 2>/dev/null || true)
            if [ -n "$resolved" ]; then
                printf '%s\n' "$resolved"
                return 0
            fi
            printf '%s\n' "VMD executable was not found on PATH: $vmdpath" >&2
            return 1
            ;;
    esac
}

while [ "$#" -gt 0 ]
do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        --dry-run)
            dry_run=1
            shift
            ;;
        --vmdpath)
            if [ "$#" -lt 2 ]; then
                usage
                exit 2
            fi
            explicit_vmdpath=$2
            shift 2
            ;;
        --)
            shift
            break
            ;;
        -*)
            usage
            exit 2
            ;;
        *)
            break
            ;;
    esac
done

if [ "$#" -ne 1 ]; then
    usage
    exit 2
fi

scene=$1
if [ ! -f "$scene" ]; then
    printf '%s\n' "VMD scene file was not found: $scene" >&2
    exit 1
fi

if [ -n "$explicit_vmdpath" ]; then
    raw_vmdpath=$explicit_vmdpath
else
    raw_vmdpath=$(settings_vmdpath)
fi
vmdpath=$(strip_quotes "$raw_vmdpath")
vmdexe=$(resolve_executable "$vmdpath")

printf '%s\n' "VMD executable: $vmdexe"
printf '%s\n' "VMD scene: $scene"

if [ "$dry_run" -eq 1 ]; then
    printf '%s\n' "Dry run: would execute VMD with -e scene."
    exit 0
fi

exec "$vmdexe" -e "$scene"
