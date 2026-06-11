#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

cd "$repo_dir"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf '%s\n' "Helper script audit requires a Git work tree."
    exit 1
fi

status=0
scripts=$(git ls-files 'tools/*.sh')

if [ -z "$scripts" ]; then
    printf '%s\n' "No tracked helper shell scripts found under tools/."
    exit 1
fi

for script in $scripts
do
    mode=$(git ls-files -s -- "$script" | awk '{print $1}')
    if [ "$mode" != "100755" ]; then
        printf '%s\n' "Helper script is not executable in Git index: $script ($mode)"
        status=1
    fi

    first_line=$(sed -n '1p' "$script")
    if [ "$first_line" != "#!/usr/bin/env sh" ]; then
        printf '%s\n' "Helper script does not use the expected POSIX sh shebang: $script"
        status=1
    fi
done

if [ "$status" -ne 0 ]; then
    exit "$status"
fi

printf '%s\n' "Helper shell script audit passed."
