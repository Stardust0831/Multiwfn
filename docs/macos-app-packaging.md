# Multiwfn macOS Application Bundle Packaging and Distribution

This document describes the native macOS application bundle (`Multiwfn.app`) and disk image (`.dmg`) distribution architecture for Multiwfn with the MatterViz 3D GUI.

## Overview

Historically, Multiwfn releases on macOS were distributed as a directory of command-line binaries and dynamic libraries. While suitable for terminal environments, desktop chemistry users expect standard macOS conventions:

1. **Native Application Bundle (`Multiwfn.app`)**: Resides in `/Applications`, launches from Finder, Dock, or Launchpad with high-resolution app icons.
2. **LaunchServices File Associations ("Open With...")**: Registers Multiwfn as a viewer for common computational chemistry file formats (`.xyz`, `.fchk`, `.out`, `.log`, `.cub`, `.molden`, `.gbw`, `.cif`, etc.).
3. **Direct GUI Entry**: Bypasses interactive terminal prompts when launched via Finder or "Open With...", presenting the 3D molecular/orbital viewer directly.
4. **Proactive Gatekeeper & Quarantine De-escalation**: Eliminates "app is damaged" / secondary library crash loops caused by `com.apple.quarantine`.

## Bundle Structure

```text
Multiwfn.app/
└── Contents/
    ├── Info.plist                     # Bundle metadata, retina flags, document types
    ├── PkgInfo                        # APPL????
    ├── MacOS/
    │   ├── Multiwfn                   # Native Cocoa LaunchServices Apple Event launcher
    │   ├── multiwfn_macos_launcher.sh # Intelligent environment and pipe setup
    │   └── Multiwfn_MatterVizGUI      # Relocated binary with embedded RPATHs
    └── Resources/
        ├── Multiwfn.icns              # 10-layer multi-resolution icon (16x16 to 1024x1024)
        ├── settings.ini               # User settings configuration
        ├── tools/
        │   ├── matterviz-desktop      # Tauri / WebKit host
        │   ├── multiwfn-vibration     # PyInstaller-frozen vibration launcher (if present)
        │   └── multiwfn-matterviz-updater  # Prerelease updater (if present)
        ├── frontend/
        │   └── matterviz-viewer/dist/ # Svelte 5 / Three.js frontend assets
        └── lib/                       # Bundled libraries (@executable_path/../Resources/lib)
```

## Launch & Direct GUI Entry Mechanism

The bundle utilizes a dual launcher architecture:

1. **Native Cocoa Launcher (`Contents/MacOS/Multiwfn`)**:
   - Compiled from `tools/macos/launcher.m` using native Apple `clang` with zero external dependencies.
   - Implements `NSApplicationDelegate` (`application:openFiles:` and `application:openFile:`).
   - Correctly intercepts macOS LaunchServices Apple Events (`kAEOpenDocuments`) sent when a file is double-clicked or opened via "Open With...".
   - When double-clicked directly without documents, presents a native Cocoa `NSOpenPanel` file selection dialog.
   - If executed in a terminal, immediately invokes `execv` to pass control to interactive CLI sessions without starting a GUI runloop.

2. **Backend Setup & Direct GUI Pipe (`Contents/MacOS/multiwfn_macos_launcher.sh`)**:
   - **Environment Resolution**: Dynamically calculates `MULTIWFN_MATTERVIZ_HOME` and exports `DYLD_LIBRARY_PATH` to point to `Contents/Resources/lib`.
   - **Proactive Quarantine Removal**: Runs `xattr -cr` recursively across the bundle upon launch to prevent Gatekeeper from blocking nested `.dylib` libraries or the `matterviz-desktop` helper executable.
   - **Direct GUI Mode**: Passes the selected file path and main menu selection `0` via standard input pipe (`printf "%s\n0\n" "$INPUT_FILE" | exec "$BINARY"`), opening the MatterViz 3D viewer directly without requiring manual keystrokes.
   - **Terminal Compatibility**: Preserves standard CLI workflows when executed interactively or in batch pipelines.

## File Associations (`CFBundleDocumentTypes`)

`Info.plist` registers Multiwfn with `CFBundleTypeRole = "Viewer"` and `LSHandlerRank = "Alternate"` for the following file extensions:

| Type | Extensions |
| :--- | :--- |
| Gaussian Formatted Checkpoints | `.fchk`, `.fch` |
| Cartesian Molecular Structures | `.xyz` |
| Quantum Chemistry Output Logs | `.out`, `.log` |
| Gaussian Cube Grids | `.cub`, `.cube` |
| Molden Wavefunctions | `.molden`, `.mol` |
| Multiwfn Native Wavefunctions | `.mwfn` |
| Wavefunctions & Density | `.wfn`, `.wfx`, `.gbw` |
| Crystallographic Files | `.cif` |
| Protein Data Bank | `.pdb` |
| Quantum Chemistry Inputs (ORCA/CP2K/Gaussian) | `.gjf`, `.com`, `.inp`, `.cp2k` |

## Gatekeeper Resolution & Installation Security

When downloaded via web browsers, macOS attaches the `com.apple.quarantine` extended attribute. For community distributions without an Apple Developer ID signature:

1. **DMG Installer Script (`Install_Multiwfn.command`)**:
   The distributed DMG includes an English-named script `Install_Multiwfn.command`. Double-clicking this script performs a one-time installation step:
   - Copies `Multiwfn.app` to `/Applications/`
   - Strips the `com.apple.quarantine` attribute via `xattr -cr /Applications/Multiwfn.app`
   - Applies a local ad-hoc signature via `codesign --force --deep -s - /Applications/Multiwfn.app`
   - Reveals the installed app in Finder.
   To respect macOS Gatekeeper security boundaries, de-quarantine is performed explicitly at installation time rather than implicitly on every launch.
2. **Manual Terminal Fallback**:
   Users who manually drag `Multiwfn.app` into `/Applications` can de-quarantine the app with:
   ```bash
   xattr -cr /Applications/Multiwfn.app
   ```

## Direct GUI Format Support

The direct GUI pipeline routes single-state molecular and wavefunction inputs (`.xyz`, `.fchk`, `.fch`, `.cub`, `.cube`, `.molden`, `.wfn`, `.wfx`, `.mwfn`, `.pdb`, `.cif`, `.mol`, `.gbw`) directly into function 0 without intermediate prompts. For multi-frame trajectory or output logs (e.g. multi-step Gaussian `.out` / `.log`) where frame selection is required, users should use standard terminal CLI execution (`/Applications/Multiwfn.app/Contents/MacOS/Multiwfn file.out`).

## Packaging Pipeline

The packaging workflow is implemented in `tools/macos/package_macos_app.sh`:

```bash
bash tools/macos/package_macos_app.sh \
  --binary path/to/Multiwfn_MatterVizGUI \
  --desktop path/to/matterviz-desktop \
  --viewer-dist path/to/matterviz-viewer/dist \
  --output-dir build/macos-app \
  --create-dmg
```

Pass `--vibration-launcher path/to/multiwfn-vibration` to also bundle the
PyInstaller-frozen standalone vibrational-mode launcher into
`Contents/Resources/tools/` (same optional pattern as `--updater`; the
MatterViz workflow forwards it automatically when the freeze step produced
the binary, and the CMake `multiwfn_macos_app` target forwards it when
`MULTIWFN_VIBRATION_LAUNCHER_EXECUTABLE` is set). The frozen launcher is a
self-contained executable, so the bundle still ships no Python runtime.

If CMake is configured on macOS with `MULTIWFN_GUI_BACKEND=matterviz`, the package target can be invoked via:

```bash
cmake --build . --target multiwfn_macos_app
```

## Testing

Automated unit tests in `tests/test_macos_app_bundle.py` verify:
- XML syntax and schema compliance of `Info.plist.in`
- Complete coverage of all 19 registered chemical file extensions
- Syntax and contract compliance of `multiwfn_macos_launcher.sh` and `Install_Multiwfn.command`
- RPATH relocation rules and DMG creation logic
- High-resolution `Multiwfn.icns` integrity and magic header bytes
