#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
smoke_dir=${1:-"$repo_dir/.build-env/smoke"}
allowed_stderr='Note: The following floating-point exceptions are signalling: IEEE_INVALID_FLAG'

case "$smoke_dir" in
    /*) ;;
    *) smoke_dir="$repo_dir/$smoke_dir" ;;
esac

if [ ! -d "$smoke_dir" ]; then
    printf '%s\n' "GNU noGUI smoke stderr directory was not found: $smoke_dir"
    exit 1
fi

err_files=$(find "$smoke_dir" -type f -name '*.err' | sort)
if [ -z "$err_files" ]; then
    printf '%s\n' "No GNU noGUI smoke stderr files were found under: $smoke_dir"
    exit 1
fi

status=0
empty_count=0
known_count=0
unexpected_count=0

printf '%s\n' "GNU noGUI smoke stderr audit"
printf '%s\n' "  smoke dir: $smoke_dir"

for err_file in $err_files
do
    rel=${err_file#"$smoke_dir"/}
    if [ ! -s "$err_file" ]; then
        empty_count=$((empty_count + 1))
        printf '%s\n' "  EMPTY   $rel"
    elif grep -Fvx "$allowed_stderr" "$err_file" >/dev/null; then
        unexpected_count=$((unexpected_count + 1))
        status=1
        printf '%s\n' "  BAD     $rel"
        sed 's/^/          /' "$err_file"
    else
        known_count=$((known_count + 1))
        printf '%s\n' "  KNOWN   $rel"
    fi
done

printf '%s\n' "  empty stderr files: $empty_count"
printf '%s\n' "  known IEEE_INVALID_FLAG stderr files: $known_count"
printf '%s\n' "  unexpected stderr files: $unexpected_count"

if [ "$status" -ne 0 ]; then
    exit "$status"
fi

printf '%s\n' "GNU noGUI smoke stderr audit passed."
