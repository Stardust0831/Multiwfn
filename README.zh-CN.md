# Multiwfn 跨平台构建与 GUI 实验

[English](README.md)

本项目跟进官方 Multiwfn 源码，并围绕它补充标准化的跨平台构建、
GitHub Actions 自动编译测试、发布包打包、性能/结果一致性检查，以及
新的可视化 GUI 实验。

Multiwfn 本体由 Tian Lu 开发。本仓库保留官方源码许可证
`LICENSE.txt`；源码分发和 release 包都必须包含这份许可证。凡是使用了
`LICENSE.txt` 补充条款所涵盖的本仓库特有材料的再分发版本或衍生项目，
还必须保留该补充署名条款，并在 README、文档、About/致谢界面或同等
显著位置注明
https://github.com/Stardust0831/Multiwfn。
本仓库生成的发布包也会携带同样内容的 `ATTRIBUTION.txt`。

## 项目目标

- 为 Linux、macOS、Windows 提供可复现的 CMake/Ninja 构建流程。
- 每次提交或 PR 都通过 GitHub Actions 自动编译并运行必要检查。
- 发布包携带运行所需的设置文件、许可证和平台运行库依赖。
- Linux 包使用较保守的 glibc 2.28 基线，并在干净容器中测试运行。
- Windows 包收集 MSYS2/UCRT 运行时 DLL，并在非开发 shell 环境中测试。
- 保留官方 Multiwfn 计算行为，并用功能测试/性能测试检查结果一致性。
- 在现有基准测试中，当前构建产物相对官方发布包观察到一定计算效率提升。
- 维护一个可选的官方源码跟踪流程，用于检查上游源码压缩包更新。
- 构建用 MatterViz 替代旧 DISLIN GUI 的跨平台可视化方案。旧版（legacy）
  3Dmol.js/Plotly 原型仅作为行为参考，不作为兼容目标。

## 开发原则

本项目原则上前后端分离：Multiwfn 的计算核心应尽量保持官方源码状态，
GUI、构建系统、CI、打包、测试和文档作为独立工程层维护。

通常可以改动：

- `CMakeLists.txt`、CMake 模块和平台构建脚本。
- `.github/workflows/` 下的 CI、测试和发布流程。
- `frontend/`、`tools/`、`docs/`、`tests/` 中的工程化代码。
- GUI adapter 相关文件，例如 `noGUI/GUI_matterviz.f90`。

通常不应改动计算核心源码。确实需要修改时，应说明原因、影响范围、测试方法，
并尽量提供和官方版本的数值输出对比。

## GUI 实验

当前 GUI 工作仍是实验性原型，目标不是做一个普通 cube 查看器，而是尽量兼容
Multiwfn 原有 `GUI.f90` 的交互模型。新的前端应接手显示层和交互控件，
计算仍由 Multiwfn 后端完成。

当前方向包括：

- `frontend/matterviz-viewer`：MatterViz 可视化前端。
- `frontend/matterviz-desktop`：原生 Rust session 服务和 WebView host。
- `noGUI/`：实验性 GUI backend adapter 层。

当前 demo 支持结构显示、多 cube 层、cube 染色、周期性显示控制、cube 切片、
简单二维图、PNG 导出和 manifest 导出。`Periodic ESP` 例子只是 UI 测试数据，
不是物理 Multiwfn 计算结果。

构建 MatterViz GUI backend：

```sh
cd frontend/matterviz-desktop && cargo build --release --locked && cd ../..
cmake -S . -B build-matterviz-gui -DCMAKE_BUILD_TYPE=Release -DMULTIWFN_GUI_BACKEND=matterviz
cmake --build build-matterviz-gui --parallel
```

仅当原生 host 构建在非默认路径时才需要设置
`MULTIWFN_MATTERVIZ_DESKTOP_EXECUTABLE`：

```sh
cmake -S . -B build-matterviz-webview -DCMAKE_BUILD_TYPE=Release \
  -DMULTIWFN_GUI_BACKEND=matterviz \
  -DMULTIWFN_MATTERVIZ_DESKTOP_EXECUTABLE="$PWD/frontend/matterviz-desktop/target/release/matterviz-desktop"
cmake --build build-matterviz-webview --parallel
```

MatterViz 构建产物为 `Multiwfn_MatterVizGUI`，只会 stage MatterViz 前端和
launcher 资源；不会 stage 旧版 3Dmol 或 Qt 资源。

## BaneWfn 工作流

可选的 [BaneWfn](https://github.com/bane-dysta/banewfn) 工作台提供独立入口
`banewfn_gui`（Windows 为 `banewfn_gui.exe`，macOS 为 `BaneWfn GUI.app`）。
选择启动文件与 `.bw` / `.bwc` 脚本后，可通过中英双语表单设置参数，也可从
内置 conf 库构造脚本。通配符匹配的多个输入文件可加入顺序执行的批量队列，
每个输入分别保留结果、重试记录、步骤图和日志。选中的 Cube 产物可一起
送入 MatterViz 渲染界面。

工作流在独立工作目录中，通过 stdin 驱动随包提供的 Multiwfn 引擎，科学计算
仍由 Multiwfn 完成。工作流解析器、执行器和配方以独立的 BaneWfn 命令行项目
为维护源。

启用工作流支持的发布包包含入口和脚本库。从源码构建时，在上述 MatterViz
构建选项之外加入 `-DMULTIWFN_WITH_WORKFLOWS=ON`；此选项默认关闭，启用时
需要 C++17 编译器。Windows 执行 Bash 步骤需要 Git for Windows。
启动方式、脚本构造、批量输入及 Cube 文件名和单位约定见
[工作流使用文档](docs/workflows.md)。

## 普通构建

当前 CMake 默认构建 `Multiwfn_noGUI`：

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
```

官方原始 `Makefile` 保留用于传统构建路径。CMake 路径主要服务于 CI、
跨平台打包和可复现构建。

## 参与贡献

欢迎外部测试、issue 和 pull request。尤其欢迎：

- 在干净系统中测试 release 包。
- 报告跨平台构建、运行、打包、性能和结果一致性问题。
- 提供小型公开测试体系和复现实例。
- 改进 CMake、CI、release packaging、文档和 GUI adapter。
- 帮助新 GUI 更接近原版 DISLIN GUI 的按钮和交互逻辑。

请阅读 `CONTRIBUTING.md` 了解 issue、PR、许可证和贡献者记录方式。
