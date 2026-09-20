#!/usr/bin/env bash
set -euo pipefail

# Generates Multiwfn.icns from a source PNG image using macOS native sips and iconutil.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

SOURCE_PNG="${1:-"$ROOT_DIR/frontend/matterviz-desktop/icons/icon.png"}"
OUTPUT_ICNS="${2:-"$SCRIPT_DIR/Multiwfn.icns"}"

if [[ ! -f "$SOURCE_PNG" ]]; then
  echo "Error: Source image not found: $SOURCE_PNG" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d -t multiwfn_iconset.XXXXXX)"
ICONSET_DIR="$TMP_DIR/Multiwfn.iconset"
mkdir -p "$ICONSET_DIR"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# Generate iconset images
sips -z 16 16     "$SOURCE_PNG" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32     "$SOURCE_PNG" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32     "$SOURCE_PNG" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64     "$SOURCE_PNG" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128   "$SOURCE_PNG" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256   "$SOURCE_PNG" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256   "$SOURCE_PNG" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512   "$SOURCE_PNG" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 512 512   "$SOURCE_PNG" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$SOURCE_PNG" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null

mkdir -p "$(dirname "$OUTPUT_ICNS")"
iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_ICNS"

echo "Generated macOS icon: $OUTPUT_ICNS"
