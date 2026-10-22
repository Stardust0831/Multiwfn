#!/usr/bin/env bash
set -euo pipefail

# Multiwfn macOS Application Launcher
# Resolves application bundle paths, strips quarantine attributes from bundled dependencies,
# configures environment, and routes input to Multiwfn MatterViz GUI.

MACOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTENTS_DIR="$(cd "$MACOS_DIR/.." && pwd)"
APP_DIR="$(cd "$CONTENTS_DIR/.." && pwd)"
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

INPUT_FILE=""
# Handle arguments passed by LaunchServices or CLI
for arg in "$@"; do
  # Skip macOS process serial number argument (-psn_...)
  if [[ "$arg" =~ ^-psn_ ]]; then
    continue
  fi
  if [[ -f "$arg" ]]; then
    INPUT_FILE="$arg"
    break
  fi
done

# Launch Multiwfn
if [[ -n "$INPUT_FILE" ]]; then
  # When MULTIWFN_DIRECT_GUI=1 is set (e.g. by native Cocoa launcher on Finder open):
  # Workflow-enabled bundles use a desktop-owned persistent engine.
  if [[ "${MULTIWFN_DIRECT_GUI:-0}" == "1" ]]; then
    if [[ -x "$RESOURCES_DIR/tools/multiwfn-workflow" ]]; then
      exec "$RESOURCES_DIR/tools/matterviz-desktop" --launch "$INPUT_FILE"
    fi
    printf "0\n" | exec "$BINARY" "$INPUT_FILE"
  else
    exec "$BINARY" "$@"
  fi
else
  if [[ $# -eq 0 && -x "$RESOURCES_DIR/tools/multiwfn-workflow" ]]; then
    exec "$RESOURCES_DIR/tools/matterviz-desktop" --launch
  else
    exec "$BINARY" "$@"
  fi
fi
