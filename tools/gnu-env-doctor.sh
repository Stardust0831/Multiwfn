#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
gnu_prefix=${GNU_PREFIX:-"$repo_dir/.build-env/gnu"}
pkg_dir=${CONDA_PKGS_DIRS:-"$repo_dir/.build-env/pkgs"}

case "$gnu_prefix" in
    /*) ;;
    *) gnu_prefix="$repo_dir/$gnu_prefix" ;;
esac
case "$pkg_dir" in
    /*) ;;
    *) pkg_dir="$repo_dir/$pkg_dir" ;;
esac
fc_gnu=${FC_GNU:-"$gnu_prefix/bin/x86_64-conda-linux-gnu-gfortran"}
cc_gnu=${CC_GNU:-"$gnu_prefix/bin/x86_64-conda-linux-gnu-gcc"}
make_gnu=${MAKE_GNU:-"$gnu_prefix/bin/make"}
lib_nogui_gnu=${LIB_noGUI_GNU:-"-L$gnu_prefix/lib -lopenblas"}
case "$fc_gnu" in
    /*) ;;
    *) fc_gnu="$repo_dir/$fc_gnu" ;;
esac
case "$cc_gnu" in
    /*) ;;
    *) cc_gnu="$repo_dir/$cc_gnu" ;;
esac
case "$make_gnu" in
    /*) ;;
    *) make_gnu="$repo_dir/$make_gnu" ;;
esac

status=0

print_tool() {
    label=$1
    path=$2
    if [ -x "$path" ]; then
        printf '%s\n' "OK      $label: $path"
        "$path" --version 2>/dev/null | sed -n '1p'
    else
        printf '%s\n' "MISSING $label: $path"
        status=1
    fi
}

print_env_tool() {
    label=$1
    if command -v "$label" >/dev/null 2>&1; then
        printf '%s\n' "OK      env tool: $(command -v "$label")"
    else
        printf '%s\n' "MISSING env tool: $label"
    fi
}

printf '%s\n' "GNU build environment doctor"
printf '%s\n' "  repo: $repo_dir"
printf '%s\n' "  prefix: $gnu_prefix"
printf '%s\n' "  package cache: $pkg_dir"
printf '%s\n' "  LIB_noGUI_GNU: $lib_nogui_gnu"
printf '%s\n' ""

print_tool "Fortran compiler" "$fc_gnu"
print_tool "C compiler" "$cc_gnu"
print_tool "make" "$make_gnu"

if [ "${LIB_noGUI_GNU+x}" ]; then
    printf '%s\n' "SKIP    OpenBLAS prefix check because LIB_noGUI_GNU is overridden"
elif [ -r "$gnu_prefix/lib/libopenblas.so" ] || [ -r "$gnu_prefix/lib/libopenblas.a" ]; then
    printf '%s\n' "OK      OpenBLAS library under $gnu_prefix/lib"
else
    printf '%s\n' "MISSING OpenBLAS library under $gnu_prefix/lib"
    status=1
fi

printf '%s\n' ""
print_env_tool mamba
print_env_tool micromamba
print_env_tool conda

printf '%s\n' ""
if [ "$status" -eq 0 ]; then
    printf '%s\n' "GNU build environment looks ready."
else
    printf '%s\n' "GNU build environment is incomplete."
    printf '%s\n' "Create or repair it with: tools/bootstrap-gnu-env.sh"
fi

exit "$status"
