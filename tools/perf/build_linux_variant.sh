#!/usr/bin/env bash
set -euo pipefail

variant="${VARIANT:?VARIANT is required}"
setup_script="${SETUP_SCRIPT:?SETUP_SCRIPT is required}"
enable_script="${ENABLE_SCRIPT:-:}"
cmake_extra="${CMAKE_EXTRA:-}"
compat_check="${COMPAT_CHECK:-true}"
bench_grid="${BENCH_GRID:-300,300,300}"

build_dir="build-${variant}"
result_dir="perf-results/${variant}"
official_dir="/tmp/multiwfn-official"
official_zip="/tmp/Multiwfn_2026.6.2_bin_Linux_noGUI.zip"

mkdir -p "$result_dir"

{
  echo "## System"
  cat /etc/os-release || true
  echo
  echo "## Setup"
  echo "$setup_script"
} | tee "$result_dir/environment.md"

eval "$setup_script"

curl --retry 3 -fsSL -o /tmp/ninja-linux.zip https://github.com/ninja-build/ninja/releases/download/v1.13.2/ninja-linux.zip
unzip -oq /tmp/ninja-linux.zip -d /usr/local/bin
chmod +x /usr/local/bin/ninja

eval "$enable_script"

{
  echo
  echo "## Toolchain"
  command -v gcc || true
  command -v gfortran || true
  gcc --version | head -3 || true
  gfortran --version | head -3 || true
  cmake --version | head -3
  ninja --version
} | tee -a "$result_dir/environment.md"

curl --retry 3 -fsSL -o "$official_zip" \
  http://sobereva.com/multiwfn/misc/Multiwfn_2026.6.2_bin_Linux_noGUI.zip
rm -rf "$official_dir"
mkdir -p "$official_dir"
unzip -oq "$official_zip" -d "$official_dir"
example_input="$(find "$official_dir" -path '*/examples/phenanthrene.fch' -type f | head -n 1)"
if [[ -z "$example_input" ]]; then
  echo "Could not find phenanthrene.fch in official example package" >&2
  exit 1
fi

rm -rf "$build_dir"
cmake -S . -B "$build_dir" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_BUILD_RPATH="\$ORIGIN/lib" \
  ${cmake_extra} 2>&1 | tee "$result_dir/configure.log"
cmake --build "$build_dir" --parallel 2 2>&1 | tee "$result_dir/build.log"

bash tests/functional/run_nogui_tests.sh "$PWD/$build_dir/Multiwfn_noGUI" 2>&1 | tee "$result_dir/functional.log"

ldd "$build_dir/Multiwfn_noGUI" | tee "$result_dir/ldd.txt"
readelf --version-info "$build_dir/Multiwfn_noGUI" > "$result_dir/version-info.txt" || true
objdump -T "$build_dir/Multiwfn_noGUI" > "$result_dir/dynamic-symbols.txt" || true

if [[ "$compat_check" == "true" ]]; then
  if readelf --version-info "$build_dir/Multiwfn_noGUI" 2>/dev/null | grep -E "GLIBC_2\\.(29|[3-9][0-9])"; then
    echo "Found GLIBC symbols newer than 2.28 in ${variant}" >&2
    exit 1
  fi
fi

python3 tools/perf/run_grid_benchmark.py \
  --exe "$PWD/$build_dir/Multiwfn_noGUI" \
  --settings "$PWD/settings.ini" \
  --input "$example_input" \
  --property-menu 9 \
  --grid "$bench_grid" \
  --threads 4 \
  --work-dir "$PWD/$result_dir/work" \
  --summary-out "$PWD/$result_dir/benchmark-summary.md" \
  --json-out "$PWD/$result_dir/benchmark.json"

{
  echo "# Linux Optimization Variant"
  echo
  echo "- Variant: \`${variant}\`"
  echo "- CMake extra: \`${cmake_extra:-none}\`"
  echo "- glibc 2.28 compatibility check: \`${compat_check}\`"
  echo
  cat "$result_dir/benchmark-summary.md"
} > "$result_dir/summary.md"

cat "$result_dir/summary.md"
