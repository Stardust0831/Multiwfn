# Multiwfn Cross-Platform Build and GUI Experiments

## 中文说明

本项目跟进官方 Multiwfn 源码，并围绕它补充标准化的跨平台构建、
GitHub Actions 自动编译测试、发布包打包、性能/结果一致性检查，以及
新的可视化 GUI 实验。

Multiwfn 本体由 Tian Lu 开发。本仓库保留官方源码许可证
`LICENSE.txt`；源码分发和 release 包都必须包含这份许可证。

### 项目目标

- 为 Linux、macOS、Windows 提供可复现的 CMake/Ninja 构建流程。
- 每次提交或 PR 都通过 GitHub Actions 自动编译并运行必要检查。
- 发布包携带运行所需的设置文件、许可证和平台运行库依赖。
- Linux 包使用较保守的 glibc 2.28 基线，并在干净容器中测试运行。
- Windows 包收集 MSYS2/UCRT 运行时 DLL，并在非开发 shell 环境中测试。
- 保留官方 Multiwfn 计算行为，并用功能测试/性能测试检查结果一致性。
- 在现有基准测试中，当前构建产物相对官方发布包观察到一定计算效率提升。
- 维护一个可选的官方源码跟踪流程，用于检查上游源码压缩包更新。
- 探索用 3Dmol.js/Plotly/Qt 替代旧 DISLIN GUI 的跨平台可视化方案。

### 开发原则

本项目原则上前后端分离：Multiwfn 的计算核心应尽量保持官方源码状态，
GUI、构建系统、CI、打包、测试和文档作为独立工程层维护。

通常可以改动：

- `CMakeLists.txt`、CMake 模块和平台构建脚本。
- `.github/workflows/` 下的 CI、测试和发布流程。
- `frontend/`、`tools/`、`docs/`、`tests/` 中的工程化代码。
- GUI adapter 相关文件，例如 `noGUI/GUI_3dmol.f90`。

通常不应改动计算核心源码。确实需要修改时，应说明原因、影响范围、测试方法，
并尽量提供和官方版本的数值输出对比。

### GUI 实验

当前 GUI 工作仍是实验性原型，目标不是做一个普通 cube 查看器，而是尽量兼容
Multiwfn 原有 `GUI.f90` 的交互模型。新的前端应接手显示层和交互控件，
计算仍由 Multiwfn 后端完成。

当前方向包括：

- `frontend/3dmol-viewer`：基于 3Dmol.js/Plotly 的可视化前端。
- `frontend/qt-multiwfn-gui`：Qt shell 原型，用于替代外部浏览器窗口。
- `noGUI/GUI_3dmol.f90`：实验性 GUI backend adapter。
- `tools/multiwfn_3dmol_server.py`：本地 session 服务。

当前 demo 支持结构显示、多 cube 层、cube 染色、周期性显示控制、cube 切片、
简单二维图、PNG 导出和 manifest 导出。`Periodic ESP` 例子只是 UI 测试数据，
不是物理 Multiwfn 计算结果。

构建 3Dmol GUI backend：

```sh
cmake -S . -B build-3dmol-gui -DCMAKE_BUILD_TYPE=Release -DMULTIWFN_GUI_BACKEND=3dmol
cmake --build build-3dmol-gui --parallel
```

构建默认打开 Qt shell 的版本：

```sh
cmake -S . -B build-qt-gui -DCMAKE_BUILD_TYPE=Release -DMULTIWFN_GUI_BACKEND=3dmol -DMULTIWFN_3DMOL_DEFAULT_SHELL=qt
cmake --build build-qt-gui --parallel
```

### 普通构建

当前 CMake 默认构建 `Multiwfn_noGUI`：

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
```

官方原始 `Makefile` 保留用于传统构建路径。CMake 路径主要服务于 CI、
跨平台打包和可复现构建。

### 参与贡献

欢迎外部测试、issue 和 pull request。尤其欢迎：

- 在干净系统中测试 release 包。
- 报告跨平台构建、运行、打包、性能和结果一致性问题。
- 提供小型公开测试体系和复现实例。
- 改进 CMake、CI、release packaging、文档和 GUI adapter。
- 帮助新 GUI 更接近原版 DISLIN GUI 的按钮和交互逻辑。

请阅读 `CONTRIBUTING.md` 了解 issue、PR、许可证和贡献者记录方式。

## English

This repository tracks the official Multiwfn source code and adds standardized
cross-platform builds, GitHub Actions CI, release packaging, performance and
result-consistency checks, and experimental visualization GUI work.

Multiwfn itself is developed by Tian Lu. This repository preserves the upstream
source license in `LICENSE.txt`; redistributed source and release artifacts must
carry that license.

### Goals

- Provide reproducible CMake/Ninja builds for Linux, macOS, and Windows.
- Run GitHub Actions builds and required checks for commits and pull requests.
- Package releases with required settings, license files, and runtime
  dependencies.
- Build Linux packages against a conservative glibc 2.28 baseline and test them
  in clean containers.
- Collect MSYS2/UCRT runtime DLLs for Windows packages and test them outside the
  development shell.
- Preserve official Multiwfn computational behavior and check output
  consistency through functional and performance tests.
- In current benchmark cases, the packaged builds show some performance
  improvement over the official release packages.
- Maintain optional upstream-source tracking for official Multiwfn source
  archive updates.
- Explore a cross-platform 3Dmol.js/Plotly/Qt visualization frontend that can
  replace the legacy DISLIN GUI.

### Development Principles

The project follows a frontend/backend separation model. The Multiwfn
computational core should stay as close as possible to the official source. GUI,
build, CI, packaging, tests, and documentation are maintained as independent
engineering layers around it.

Changes are normally expected in:

- `CMakeLists.txt`, CMake modules, and platform build scripts.
- CI, test, and release workflows under `.github/workflows/`.
- Engineering code under `frontend/`, `tools/`, `docs/`, and `tests/`.
- GUI adapter files such as `noGUI/GUI_3dmol.f90`.

Computational core changes should be avoided unless necessary. When they are
needed, please describe the reason, scope, test method, and numerical comparison
against an official Multiwfn build.

### GUI Experiments

The GUI work is still experimental. The goal is not a generic cube viewer; the
new frontend should mirror the original `GUI.f90` interaction model as much as
possible while leaving calculations in the Multiwfn backend.

Current pieces:

- `frontend/3dmol-viewer`: 3Dmol.js/Plotly visualization frontend.
- `frontend/qt-multiwfn-gui`: Qt shell prototype for an application window.
- `noGUI/GUI_3dmol.f90`: experimental GUI backend adapter.
- `tools/multiwfn_3dmol_server.py`: local session service.

Current demo features include structure display, multiple cube layers,
cube-by-cube coloring, periodic display controls, cube slices, simple 2D plots,
PNG export, and manifest export. The `Periodic ESP` sample is synthetic UI test
data, not a physical Multiwfn calculation.

Build the 3Dmol GUI backend:

```sh
cmake -S . -B build-3dmol-gui -DCMAKE_BUILD_TYPE=Release -DMULTIWFN_GUI_BACKEND=3dmol
cmake --build build-3dmol-gui --parallel
```

Build the Qt-shell variant:

```sh
cmake -S . -B build-qt-gui -DCMAKE_BUILD_TYPE=Release -DMULTIWFN_GUI_BACKEND=3dmol -DMULTIWFN_3DMOL_DEFAULT_SHELL=qt
cmake --build build-qt-gui --parallel
```

### Build

The default CMake build currently targets `Multiwfn_noGUI`:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
```

The original upstream `Makefile` is kept for the traditional upstream build
path. The CMake path is focused on CI, cross-platform packaging, and
reproducible builds.

See `docs/build.md` and `docs/release.md` for platform details.

### Contributing

External testing, issues, and pull requests are welcome. Useful areas include:

- Testing release packages on clean systems.
- Reporting cross-platform build, runtime, packaging, performance, or output
  consistency issues.
- Adding compact public fixtures and reproducible examples.
- Improving CMake, CI, release packaging, documentation, and GUI adapters.
- Making the new GUI closer to the original DISLIN GUI buttons and workflows.

Please read `CONTRIBUTING.md` for issue, PR, license, and contributor
recognition guidelines.
