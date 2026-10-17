#!/usr/bin/env bash
set -euo pipefail
project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$project_root"
tooling="$project_root/build/workflow-tooling"
if [[ -x "$tooling/cargo/bin/cargo" ]]; then
  export CARGO_HOME="$tooling/cargo" RUSTUP_HOME="$tooling/rustup"
  export PATH="$CARGO_HOME/bin:$PATH"
fi
if [[ -x "$tooling/node-v24.11.1-linux-x64/bin/node" ]]; then
  export PATH="$tooling/node-v24.11.1-linux-x64/bin:$PATH"
fi
runtime="$project_root/build/gui-sysroot"
if [[ -x "$runtime/usr/bin/pkgconf" ]]; then
  export PKG_CONFIG="$runtime/usr/bin/pkgconf"
  export PKG_CONFIG_SYSROOT_DIR="$runtime"
  export PKG_CONFIG_PATH="$runtime/usr/lib/x86_64-linux-gnu/pkgconfig:$runtime/usr/share/pkgconfig:/usr/lib/x86_64-linux-gnu/pkgconfig"
  export LD_LIBRARY_PATH="$runtime/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
export CARGO_TARGET_DIR="$project_root/build/matterviz-desktop"
npm --prefix frontend/matterviz-viewer run check
npm --prefix frontend/matterviz-viewer run build -- --outDir ../../build/matterviz-viewer
cmake -E copy_directory build/matterviz-viewer frontend/matterviz-viewer/dist
cargo build --locked --manifest-path frontend/matterviz-desktop/Cargo.toml --release -j4
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DMULTIWFN_GUI_BACKEND=matterviz \
  -DMULTIWFN_WITH_WORKFLOWS=ON \
  -DMULTIWFN_MATTERVIZ_DESKTOP_EXECUTABLE="$CARGO_TARGET_DIR/release/matterviz-desktop"
cmake --build build -j4
echo "BaneWfn GUI: $project_root/build/banewfn_gui [startup-file]"
echo "Application menu: $project_root/build/install-desktop-entry.sh"
