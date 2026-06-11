#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
env_file="$repo_dir/docs/refactor/gnu-build-env.yml"
prefix="${GNU_PREFIX:-$repo_dir/.build-env/gnu}"
pkg_dir="${CONDA_PKGS_DIRS:-$repo_dir/.build-env/pkgs}"

find_env_tool() {
    if command -v mamba >/dev/null 2>&1; then
        printf '%s\n' mamba
    elif command -v micromamba >/dev/null 2>&1; then
        printf '%s\n' micromamba
    elif command -v conda >/dev/null 2>&1; then
        printf '%s\n' conda
    else
        return 1
    fi
}

check_prefix() {
    missing=0
    for tool in \
        "$prefix/bin/x86_64-conda-linux-gnu-gfortran" \
        "$prefix/bin/x86_64-conda-linux-gnu-gcc" \
        "$prefix/bin/make"
    do
        if [ ! -x "$tool" ]; then
            printf '%s\n' "Missing expected tool: $tool"
            missing=1
        fi
    done
    return "$missing"
}

cd "$repo_dir"

if check_prefix >/dev/null 2>&1; then
    printf '%s\n' "GNU build environment already exists: $prefix"
    check_prefix
    exit 0
fi

env_tool=$(find_env_tool) || {
    printf '%s\n' "Could not find mamba, micromamba, or conda on PATH."
    printf '%s\n' "Install one of them outside this repository, then rerun this script."
    exit 1
}

mkdir -p "$pkg_dir" "$(dirname "$prefix")"

printf '%s\n' "Creating GNU build environment with $env_tool"
printf '%s\n' "  prefix: $prefix"
printf '%s\n' "  package cache: $pkg_dir"

if [ "$env_tool" = "micromamba" ]; then
    CONDA_PKGS_DIRS="$pkg_dir" "$env_tool" create -y -p "$prefix" -f "$env_file"
else
    CONDA_PKGS_DIRS="$pkg_dir" "$env_tool" env create -p "$prefix" -f "$env_file"
fi

check_prefix

printf '%s\n' "GNU build environment is ready."
