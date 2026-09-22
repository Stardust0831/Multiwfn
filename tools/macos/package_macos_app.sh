#!/usr/bin/env bash
set -euo pipefail

# Multiwfn macOS Application Bundle & DMG Packaging Script
# Creates a standard Multiwfn.app bundle, relocates dependencies,
# applies ad-hoc code signature, and optionally builds a distributable DMG.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

VERSION=""
BINARY=""
DESKTOP=""
VIEWER_DIST=""
UPDATER=""
VIBRATION_LAUNCHER=""
SETTINGS="$ROOT_DIR/settings.ini"
OUTPUT_DIR="$ROOT_DIR/build/macos-app"
LIB_DIR=""
CREATE_DMG=0
DMG_NAME=""

usage() {
  cat << USAGE
Usage: $0 [options]

Options:
  --binary <path>        Path to Multiwfn_MatterVizGUI binary (required)
  --desktop <path>       Path to matterviz-desktop host binary (required)
  --viewer-dist <path>   Path to frontend/matterviz-viewer/dist directory (required)
  --updater <path>       Path to multiwfn-matterviz-updater binary (optional)
  --vibration-launcher <path>  Path to frozen multiwfn-vibration launcher (optional)
  --settings <path>      Path to settings.ini (default: root settings.ini)
  --lib-dir <path>       Path to existing bundled libraries (optional)
  --output-dir <path>    Output directory for Multiwfn.app (default: build/macos-app)
  --version <string>     Application version (default: version in Multiwfn.f90)
  --create-dmg           Create a distributable DMG package
  --dmg-name <name>      Name of DMG file (default: Multiwfn_<version>_macOS.dmg)
  -h, --help             Show this help message
USAGE
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --binary)
      BINARY="$2"; shift 2 ;;
    --desktop)
      DESKTOP="$2"; shift 2 ;;
    --viewer-dist)
      VIEWER_DIST="$2"; shift 2 ;;
    --updater)
      UPDATER="$2"; shift 2 ;;
    --vibration-launcher)
      VIBRATION_LAUNCHER="$2"; shift 2 ;;
    --settings)
      SETTINGS="$2"; shift 2 ;;
    --lib-dir)
      LIB_DIR="$2"; shift 2 ;;
    --output-dir)
      OUTPUT_DIR="$2"; shift 2 ;;
    --version)
      VERSION="$2"; shift 2 ;;
    --create-dmg)
      CREATE_DMG=1; shift 1 ;;
    --dmg-name)
      DMG_NAME="$2"; shift 2 ;;
    -h|--help)
      usage ;;
    *)
      echo "Unknown option: $1" >&2
      usage ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  VERSION="$(sed -nE 's/.*"Version ([0-9]+\.[0-9]+\.[0-9]+) .*/\1/p' "$ROOT_DIR/Multiwfn.f90")"
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Expected a numeric Multiwfn version (YYYY.M.D), got: $VERSION" >&2
  exit 1
fi

if [[ -z "$BINARY" || ! -f "$BINARY" ]]; then
  echo "Error: Valid Multiwfn binary required (--binary <path>)" >&2
  exit 1
fi
if [[ -z "$DESKTOP" || ! -f "$DESKTOP" ]]; then
  echo "Error: Valid matterviz-desktop binary required (--desktop <path>)" >&2
  exit 1
fi
if [[ -z "$VIEWER_DIST" || ! -d "$VIEWER_DIST" ]]; then
  echo "Error: Valid viewer dist directory required (--viewer-dist <path>)" >&2
  exit 1
fi

APP_BUNDLE="$OUTPUT_DIR/Multiwfn.app"
CONTENTS="$APP_BUNDLE/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"

echo "==> Preparing Multiwfn.app bundle structure at $APP_BUNDLE..."
rm -rf "$APP_BUNDLE"
mkdir -p "$MACOS"
mkdir -p "$RESOURCES/lib"
mkdir -p "$RESOURCES/tools"
mkdir -p "$RESOURCES/frontend/matterviz-viewer"

# 1. Copy main binary and launcher
echo "==> Staging binaries and launcher..."
cp "$BINARY" "$MACOS/Multiwfn_MatterVizGUI"
if command -v clang >/dev/null 2>&1 && [[ -f "$SCRIPT_DIR/launcher.m" ]]; then
  echo "==> Compiling native Cocoa LaunchServices event launcher..."
  clang -O2 -fobjc-arc -framework Cocoa "$SCRIPT_DIR/launcher.m" -o "$MACOS/Multiwfn"
  cp "$SCRIPT_DIR/multiwfn_macos_launcher.sh" "$MACOS/multiwfn_macos_launcher.sh"
  chmod +x "$MACOS/multiwfn_macos_launcher.sh" "$MACOS/Multiwfn"
else
  cp "$SCRIPT_DIR/multiwfn_macos_launcher.sh" "$MACOS/Multiwfn"
  chmod +x "$MACOS/Multiwfn"
fi
chmod +x "$MACOS/Multiwfn_MatterVizGUI"
# Link resources in MacOS directory so @executable_path/resources resolves to Contents/Resources
ln -sf ../Resources "$MACOS/resources"

# 2. Copy tools & frontend
cp "$DESKTOP" "$RESOURCES/tools/matterviz-desktop"
chmod +x "$RESOURCES/tools/matterviz-desktop"
if [[ -n "$UPDATER" && -f "$UPDATER" ]]; then
  cp "$UPDATER" "$RESOURCES/tools/multiwfn-matterviz-updater"
  chmod +x "$RESOURCES/tools/multiwfn-matterviz-updater"
fi
if [[ -n "$VIBRATION_LAUNCHER" && -f "$VIBRATION_LAUNCHER" ]]; then
  cp "$VIBRATION_LAUNCHER" "$RESOURCES/tools/multiwfn-vibration"
  chmod +x "$RESOURCES/tools/multiwfn-vibration"
fi

cp -R "$VIEWER_DIST" "$RESOURCES/frontend/matterviz-viewer/dist"
cp "$ROOT_DIR/LICENSE.txt" "$ROOT_DIR/ATTRIBUTION.txt" "$RESOURCES/"
if [[ -f "$SETTINGS" ]]; then
  cp "$SETTINGS" "$RESOURCES/settings.ini"
fi

# 3. Generate icon if needed
ICON_FILE="$SCRIPT_DIR/Multiwfn.icns"
if [[ ! -f "$ICON_FILE" ]]; then
  echo "==> Generating Multiwfn.icns..."
  bash "$SCRIPT_DIR/build_macos_icon.sh" "$ROOT_DIR/frontend/matterviz-desktop/icons/icon.png" "$ICON_FILE"
fi
cp "$ICON_FILE" "$RESOURCES/Multiwfn.icns"

# 4. Configure Info.plist and PkgInfo
echo "==> Generating Info.plist and PkgInfo..."
sed "s/@MULTIWFN_VERSION@/$VERSION/g" "$SCRIPT_DIR/Info.plist.in" > "$CONTENTS/Info.plist"
echo -n "APPL????" > "$CONTENTS/PkgInfo"

# 5. Dependency bundling & RPATH relocation
echo "==> Relocating dynamic libraries..."
# Delete existing rpaths
RPATH_FILE="$(mktemp -t multiwfn-app-rpaths.XXXXXX)"
otool -l "$MACOS/Multiwfn_MatterVizGUI" | awk '/cmd LC_RPATH/ { getline; getline; print $2 }' > "$RPATH_FILE" || true
while IFS= read -r rpath; do
  [[ -z "$rpath" ]] || install_name_tool -delete_rpath "$rpath" "$MACOS/Multiwfn_MatterVizGUI" 2>/dev/null || true
done < "$RPATH_FILE"
rm -f "$RPATH_FILE"

if [[ -n "$LIB_DIR" && -d "$LIB_DIR" && -n "$(ls -A "$LIB_DIR" 2>/dev/null)" ]]; then
  echo "==> Staging pre-bundled libraries from $LIB_DIR..."
  cp -R "$LIB_DIR"/* "$RESOURCES/lib/" 2>/dev/null || true
  for dylib in "$RESOURCES/lib"/*.dylib; do
    [[ -f "$dylib" ]] || continue
    name="$(basename "$dylib")"
    install_name_tool -change "@executable_path/resources/lib/$name" "@executable_path/../Resources/lib/$name" "$MACOS/Multiwfn_MatterVizGUI" 2>/dev/null || true
    for dep in "$RESOURCES/lib"/*.dylib; do
      [[ -f "$dep" ]] || continue
      install_name_tool -change "@executable_path/resources/lib/$name" "@executable_path/../Resources/lib/$name" "$dep" 2>/dev/null || true
    done
  done
  install_name_tool -add_rpath "@executable_path/../Resources/lib" "$MACOS/Multiwfn_MatterVizGUI" 2>/dev/null || true
elif command -v dylibbundler >/dev/null 2>&1; then
  echo "==> Running dylibbundler..."
  dylibbundler -od -b \
    -x "$MACOS/Multiwfn_MatterVizGUI" \
    -d "$RESOURCES/lib" \
    -p "@executable_path/../Resources/lib"
else
  echo "==> dylibbundler not available; checking fallback lib directory..."
  if [[ -n "$LIB_DIR" && -d "$LIB_DIR" ]]; then
    cp -R "$LIB_DIR"/* "$RESOURCES/lib/" 2>/dev/null || true
  fi
  install_name_tool -add_rpath "@executable_path/../Resources/lib" "$MACOS/Multiwfn_MatterVizGUI" 2>/dev/null || true
  if [[ -z "$(ls -A "$RESOURCES/lib" 2>/dev/null)" ]]; then
    echo "Error: no dynamic libraries were staged into $RESOURCES/lib." >&2
    echo "       Install dylibbundler or pass --lib-dir <path>; the original rpaths were removed," >&2
    echo "       so the bundled binary cannot resolve its dependencies." >&2
    exit 1
  fi
fi

# Clean up pycache or unwanted files
find "$APP_BUNDLE" -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete
find "$APP_BUNDLE" -depth -type d -name __pycache__ -empty -delete

# 6. Apply ad-hoc code signature
echo "==> Applying ad-hoc code signature..."
xattr -cr "$APP_BUNDLE" 2>/dev/null || true
if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep -s - "$APP_BUNDLE"
  echo "==> Code signature verified:"
  codesign -vvv --deep "$APP_BUNDLE"
fi

echo "==> Successfully created Multiwfn.app at: $APP_BUNDLE"

# 7. Optionally create DMG
if [[ "$CREATE_DMG" -eq 1 ]]; then
  if [[ -z "$DMG_NAME" ]]; then
    DMG_NAME="Multiwfn_${VERSION}_macOS.dmg"
  fi
  DMG_PATH="$OUTPUT_DIR/$DMG_NAME"
  echo "==> Creating DMG disk image: $DMG_PATH..."

  DMG_STAGING="$(mktemp -d -t multiwfn_dmg_stage.XXXXXX)"
  cleanup_dmg() {
    rm -rf "$DMG_STAGING"
  }
  trap cleanup_dmg EXIT

  cp -R "$APP_BUNDLE" "$DMG_STAGING/Multiwfn.app"
  cp "$ROOT_DIR/LICENSE.txt" "$ROOT_DIR/ATTRIBUTION.txt" "$DMG_STAGING/"
  ln -s /Applications "$DMG_STAGING/Applications"
  cp "$SCRIPT_DIR/Install_Multiwfn.command" "$DMG_STAGING/Install_Multiwfn.command"
  chmod +x "$DMG_STAGING/Install_Multiwfn.command"

  rm -f "$DMG_PATH"
  if hdiutil create -volname "Multiwfn $VERSION" -srcfolder "$DMG_STAGING" -ov -format UDZO "$DMG_PATH"; then
    echo "==> Successfully created DMG installer at: $DMG_PATH"
  else
    echo "Warning: hdiutil create failed (likely restricted environment or permissions). Multiwfn.app is intact." >&2
    exit 1
  fi
fi
