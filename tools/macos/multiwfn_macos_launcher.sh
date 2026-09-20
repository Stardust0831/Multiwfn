#!/usr/bin/env bash
set -euo pipefail

# Multiwfn macOS Application Launcher
# Resolves application bundle paths, strips quarantine attributes from bundled dependencies,
# configures environment, and routes input to Multiwfn MatterViz GUI.

MACOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTENTS_DIR="$(cd "$MACOS_DIR/.." && pwd)"
APP_DIR="$(cd "$CONTENTS_DIR/.." && pwd)"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

# Proactively de-quarantine internal libraries and tools to prevent Gatekeeper secondary crashes
xattr -cr "$CONTENTS_DIR" 2>/dev/null || true

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

# Detect whether running in a GUI environment (Finder / LaunchServices without terminal)
IS_GUI=0
if [[ ! -t 0 && ! -t 1 && ! -p /dev/fd/0 && ! -f /dev/fd/0 ]]; then
  IS_GUI=1
fi

# If no input file was provided and running in GUI context, prompt user with native Cocoa file dialog
if [[ -z "$INPUT_FILE" && "$IS_GUI" -eq 1 ]]; then
  if command -v osascript >/dev/null 2>&1; then
    CHOSEN="$(osascript -e '
      try
        set chosenFile to choose file with prompt "Select a quantum chemistry file for Multiwfn:" of type {"public.item", "public.data"}
        return POSIX path of chosenFile
      on error
        return ""
      end try
    ' 2>/dev/null || true)"
    if [[ -n "$CHOSEN" && -f "$CHOSEN" ]]; then
      INPUT_FILE="$CHOSEN"
    fi
  fi
fi

# Launch Multiwfn
if [[ -n "$INPUT_FILE" ]]; then
  # In GUI context or when MULTIWFN_DIRECT_GUI=1 is explicitly requested:
  # direct GUI mode pipes the input file path followed by main menu option 0 (View molecular structure & orbitals)
  if [[ "$IS_GUI" -eq 1 || "${MULTIWFN_DIRECT_GUI:-0}" == "1" ]]; then
    printf "%s\n0\n" "$INPUT_FILE" | exec "$BINARY"
  else
    exec "$BINARY" "$INPUT_FILE"
  fi
else
  # If running in GUI and user cancelled the file picker, exit gracefully
  if [[ "$IS_GUI" -eq 1 ]]; then
    exit 0
  else
    exec "$BINARY" "$@"
  fi
fi
