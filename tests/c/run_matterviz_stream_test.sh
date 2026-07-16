#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
binary="$(mktemp "${TMPDIR:-/tmp}/matterviz-stream-test.XXXXXX")"
control_binary="$(mktemp "${TMPDIR:-/tmp}/matterviz-control-test.XXXXXX")"
picker_binary="$(mktemp "${TMPDIR:-/tmp}/matterviz-picker-test.XXXXXX")"
trap 'rm -f "$binary" "$control_binary" "$picker_binary"' EXIT

cc -std=c11 -Wall -Wextra -Werror -pedantic -pthread \
  "$root/tests/c/test_matterviz_stream.c" "$root/noGUI/matterviz_spawn.c" \
  -lm -o "$binary"
"$binary"

cc -std=c11 -Wall -Wextra -Werror -pedantic -pthread \
  "$root/tests/c/test_matterviz_control.c" "$root/noGUI/matterviz_spawn.c" \
  -lm -o "$control_binary"
"$control_binary"

cc -std=c11 -Wall -Wextra -Werror -pedantic -pthread \
  "$root/tests/c/test_matterviz_picker.c" "$root/noGUI/matterviz_spawn.c" \
  -lm -o "$picker_binary"
"$picker_binary"

start="$(grep -nE '^int multiwfn_matterviz_publish_volume_stream\(' "$root/noGUI/matterviz_spawn.c" | cut -d: -f1)"
end="$(tail -n +"$start" "$root/noGUI/matterviz_spawn.c" | grep -nE '^void multiwfn_matterviz_transport_close\(' | cut -d: -f1)"
end_line=$((start + end - 1))
if sed -n "${start},${end_line}p" "$root/noGUI/matterviz_spawn.c" \
    | grep -nE '(malloc|calloc|realloc)[[:space:]]*\(' >/dev/null; then
  echo "stream publisher must not allocate body-sized storage" >&2
  exit 1
fi
