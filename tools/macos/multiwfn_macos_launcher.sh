#!/usr/bin/env bash
set -euo pipefail

# Multiwfn macOS Application Launcher
# Resolves bundle paths and routes Cocoa document opens or terminal CLI input.

MACOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTENTS_DIR="$(cd "$MACOS_DIR/.." && pwd)"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

# Set up runtime environment
export MULTIWFN_MATTERVIZ_HOME="$RESOURCES_DIR"
if [[ -d "$RESOURCES_DIR/lib" ]]; then
  export DYLD_LIBRARY_PATH="$RESOURCES_DIR/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
fi
export OMP_STACKSIZE="${OMP_STACKSIZE:-64M}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

BINARY="$MACOS_DIR/Multiwfn_MatterVizGUI"
if [[ ! -x "$BINARY" ]]; then
  echo "Error: Multiwfn executable not found at $BINARY" >&2
  exit 1
fi

if [[ -f "$RESOURCES_DIR/banewfn-workbench" ]]; then
  exec "$RESOURCES_DIR/tools/matterviz-desktop" --workbench "$@"
fi

# Cocoa selects a document before invoking this script. The core owns loading
# that document and starting its managed viewer; the host has no --launch mode.
# Keep all core arguments, and exit gracefully after the user returns/closes
# the viewer instead of leaving the core to read EOF at its main menu.
if [[ "${MULTIWFN_DIRECT_GUI:-0}" == "1" && $# -gt 0 && -f "$1" ]]; then
  printf '0\nq\n' | "$BINARY" "$@"
else
  # Includes no-argument terminal/batch entry: preserve the core's own prompt.
  exec "$BINARY" "$@"
fi
