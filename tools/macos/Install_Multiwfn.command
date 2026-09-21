#!/usr/bin/env bash
set -euo pipefail

# Multiwfn macOS Installer & Gatekeeper De-quarantine Tool
# Copies Multiwfn.app to /Applications, removes quarantine attributes,
# and applies local ad-hoc code signing.

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_APP="/Applications/Multiwfn.app"
SOURCE_APP="$SOURCE_DIR/Multiwfn.app"

echo "=================================================="
echo "    Multiwfn macOS One-Click Installer"
echo "=================================================="
echo

if [[ ! -d "$SOURCE_APP" ]]; then
  echo "Error: Multiwfn.app not found in $SOURCE_DIR" >&2
  read -n 1 -s -r -p "Press any key to exit..."
  echo
  exit 1
fi

echo "[1/3] Copying Multiwfn.app to /Applications/..."
if [[ -d "$TARGET_APP" ]]; then
  echo "      Existing installation found. Replacing..."
  rm -rf "$TARGET_APP"
fi
cp -R "$SOURCE_APP" /Applications/

echo "[2/3] Stripping Gatekeeper quarantine attributes..."
xattr -cr "$TARGET_APP" 2>/dev/null || true

echo "[3/3] Applying local ad-hoc code signature..."
if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep -s - "$TARGET_APP" 2>/dev/null || true
fi

echo
echo "=================================================="
echo "  Multiwfn was successfully installed!"
echo "  You can now open Multiwfn from Launchpad or"
echo "  right-click any quantum chemistry file in Finder"
echo "  and select 'Open With -> Multiwfn'."
echo "=================================================="
echo

if command -v open >/dev/null 2>&1; then
  open -R "$TARGET_APP" 2>/dev/null || true
fi

read -t 5 -n 1 -s -r -p "Window will close in 5 seconds (or press any key to close)..." || true
echo
