#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
binary="$(mktemp "${TMPDIR:-/tmp}/matterviz-stream-test.XXXXXX")"
trap 'rm -f "$binary"' EXIT

cc -std=c11 -Wall -Wextra -Werror -pedantic -pthread \
  "$root/tests/c/test_matterviz_stream.c" "$root/noGUI/matterviz_spawn.c" \
  -lm -o "$binary"
"$binary"

start="$(rg -n '^int multiwfn_matterviz_publish_volume_stream\(' "$root/noGUI/matterviz_spawn.c" | cut -d: -f1)"
end="$(tail -n +"$start" "$root/noGUI/matterviz_spawn.c" | rg -n '^void multiwfn_matterviz_transport_close\(' | cut -d: -f1)"
end_line=$((start + end - 1))
if sed -n "${start},${end_line}p" "$root/noGUI/matterviz_spawn.c" \
    | rg -n '\b(malloc|calloc|realloc)\s*\(' >/dev/null; then
  echo "stream publisher must not allocate body-sized storage" >&2
  exit 1
fi
