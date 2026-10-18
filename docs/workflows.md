# BaneWfn GUI workflows

## Independent BaneWfn application

Open `banewfn_gui.exe` on Windows, `BaneWfn GUI.app` on macOS, or `banewfn_gui` on Linux.
The workbench opens immediately. Choose a startup file and a `.bw` or `.bwc`
script, configure its parameters, then run. The bundled Multiwfn engine starts
when needed; no existing molecular session is required. The original Multiwfn
entry remains available. On Linux, `install-desktop-entry.sh` also installs a
BaneWfn application-menu entry. The macOS tar package includes a `banewfn_gui` entry.

Open a `.bw` or `.bwc` file with BaneWfn GUI, or drag the script onto its Windows
icon, to load that script and its parameter form. Files outside the bundled
library use their own folder for companion conf files. Directly opening a script
shows that file in the list and carries the script and its conf files into the
job. For workflows that need other files at relative paths, choose the complete
script folder with the adjacent folder button. Opening a script waits for you
to choose a startup file and click Run.
The script button beside the library heading also opens a single workflow file.

## Build a script

Click **Generate script / 生成脚本** beside Open workflow script. The modal has
the installed conf library on the left, ordered steps in the middle and a live
BWC or Multiwfn-input preview on the right. Select a conf and its process
sections, then add an analysis block. `main` and `quit` are included automatically.
Change section order, add repeated sections and set parameters with the same
bilingual controls used by the workbench. Defaults come from the conf; the
builder does not choose new scientific settings. Conf notes show the original
comments, including restrictions such as putting grid ESP last.

Each analysis block can have ordered output renames and custom `%command`
post-processing. Choose Bash/Git Bash or Windows cmd explicitly. Bash workflows
on Windows require Git for Windows. For example, the **Density + ESP example**
uses the bundled grid conf, renames `density.cub` to `${input}_den.cub` and
`totesp.cub` to `${input}_kcal_esp.cub`, then collects the files. The bundled
`grid/esp` section already converts ESP to kcal/mol; renaming alone never
converts units. The final `_esp` suffix stays compatible with vcube.

Insert **Collect outputs** (`collect(...)`), **Switch startup file**
(`wfn_rebase=...`) or a standalone shell command between analysis blocks.
An empty rebase value restores the original startup file. A rebase target must
be produced before the next analysis; collect it after its last consumer,
because collect moves newly generated files. `${output}` is available in an
analysis block's post-processing, rather than a standalone command.
Custom variables accept the existing BaneWfn syntax, for example `state=(1 2)`.
Use `${input}` and `${state}` in filename templates. Literal parameter paths
with spaces are carried by generated scalar variables. Expressions containing
spaces must instead be expressed through a scalar variable; nested placeholder
expansion follows the existing driver's rules. Reset a field to restore its
conf default. Custom command text excludes BaneWfn block delimiters and shebangs;
choose the shell with the dropdown.

Preview and validation use the shared BaneWfn parser and do not run commands or
Multiwfn. **Save and load** opens the native Save dialog and writes a
self-contained `.bwc`, embedding the used conf files, their GUI metadata and
the citation catalog. The workbench selects the saved script without running
it. Cancelling Save keeps the modal and its draft open. The builder creates new
scripts; existing scripts still open through the normal script picker.

## Run and inspect workflows

You can supply both files from a terminal:

```text
banewfn_gui analysis.bwc -w molecule.fch
banewfn_gui --script analysis.bw --wfn molecule.fch
```

A molecular file passed alone loads the startup file. A workflow script passed
alone loads the script. On Windows, run `Register-BaneWfn-GUI.cmd` from the package
to add the GUI to **Open with** for `.bw` and `.bwc`; choose the default application
through Windows. Run registration again after moving the package. Linux's desktop
installer registers the workflow MIME type; the macOS BaneWfn app declares these
script extensions. The CLI executable remains available separately as `banewfn`.

The startup file and script list occupy the left column. Parameters, script
preview and results occupy the right column. Results default to a folder beside
the startup file; selecting a results folder explicitly keeps that choice when
the startup file changes. Windows paths are displayed without extended prefixes.

The default library includes the BaneWfn `.bwc` collection, grouped into ELF/LOL,
ESP, frontier orbitals, excited-state analysis, reactivity and weak interactions,
alongside density and Mayer examples. Select a script in the left column to see
its fields. Required `?` values must be filled before running. Plane plots need
three atom indices; IGMH needs two fragment selections; Ehb needs CP indices.
IFCT needs a fragment-definition file from the calculation's actual partition.
Excited-state workflows may also require the corresponding calculation output
file; select it in the parameter form. NICS generates Gaussian input files and a
follow-up script; it does not perform the Gaussian calculation.

The GUI copies retain the recipes' scientific defaults and inline configs. Paths
are quoted for filenames with spaces, terminal prompts become fields, and VMD
helpers are generated without opening VMD automatically. Cube results can be
sent to MatterViz from Results; existing vcube helper files remain available.
On Windows, recipes with Bash commands require Git for Windows; the runner
discovers Git Bash automatically. The original BaneWfn icon identifies the GUI
entry and workbench window independently of Multiwfn.

Parameter forms are generated by BaneWfn's C++ parser. Each module/step has its
own fields, including repeated steps. Conf authors describe fields with comments:

```ini
#@gui grid
# label.zh = 网格精度
# label.en = Grid quality
# type = select
# options.zh = 1:低精度 | 2:中等精度 | 3:高精度
# options.en = 1:Low | 2:Medium | 3:High
# help.zh = 控制生成三维网格的精细程度
# help.en = Controls the resolution of the generated 3D grid
#@end
```

Annotations before the first section apply to the module; section annotations
override individual properties. Types are `text`, `number`, `select`, `boolean`,
`file` and `directory`. Boolean fields declare exactly two value/label pairs.
`unit` adds a displayed unit. Defaults come from the script and conf, not the
annotation. Unannotated fields use their variable names and text inputs.
Labels, hover explanations and option captions follow the interface language.
Use `.zh` and `.en` suffixes for translations; plain `label`, `help` and `options`
provide fallback text. All translated option lists must use the same actual
values. Switching language preserves parameter values and selections.
Hover over labels for explanations. Reset removes a field override. Additional
variables remain available in a collapsed editor. This version edits parameters
of existing scripts, not their step sequence.

The preview switches between original source and generated native input for
conf/raw steps. Builtin commands and runtime file changes are not fully simulated;
array sweeps preview their first value. Inspection never executes shell commands
or Multiwfn. Execution retains the original script, conf snapshot and explicit
overrides (`parameters.json`) in a separate job directory, alongside the request,
logs and results. Existing scripts and scientific defaults are not rewritten.

## Batch inputs and results

Choose **Batch files / 批量文件** in the left column. Add individual files or
folder rules with filename patterns such as `*.fch;*.mwfn`. Enable subfolders
when needed. Empty patterns use the script's `wfn=` pattern. Click **Refresh
matches**, review the full paths and uncheck unwanted files. Duplicate paths
are removed; files with the same name in different folders remain separate.
**Use selected files** freezes this list. Later additions to a source folder
are included only after refreshing and applying the selection again.

File parameters can use a fixed file or **Match per input**. For example,
`${input}.log` matches a calculation output beside each startup file;
`${input}_fragments.txt` matches a fragment definition. `${input}` is the
startup filename without its extension, and `${wfn}` is its complete path.
A companion pattern must match exactly one file. Missing or ambiguous matches
appear in the input list; **Preview input** shows the resolved parameters and
native commands for one selected input. Companion bindings do not vary across
array values.

**Run batch** processes inputs sequentially with the chosen core count. Array
variables such as `state=(1 2)` still run inside each input. The batch freezes
the workflow, conf files and settings. Each input and retry has a separate
directory, so fixed output names and same-named inputs do not overwrite each
other. A failed input does not stop the remaining queue. **Pause queue** waits
for the current input to finish; **Cancel batch** stops it and cancels queued
inputs. **Retry unfinished** retries failed, cancelled, interrupted and waiting
inputs while retaining successful results and earlier attempts.

The Results tab shows a batch overview with progress, status filtering and
search. Open an input to inspect its logs, files and run attempts. A completed
input can be sent to MatterViz while other inputs are still running. Rendering
stays scoped to that input's selected attempt.

Batch history is saved in `batch.json` under the batch directory. **Open batch**
reopens that directory after restarting the GUI. Previously running records
become interrupted and do not resume automatically. Retrying still needs the
original startup and companion files. History stores paths, rather than copies
of those source files.

## Step DAG and logs

Open an input's **Results → Log** to see its step DAG. Nodes show analysis
modules and conf sections, shell commands, output collection and startup-file
changes in execution order. Running steps are blue, completed steps green and
failed steps red. A failure records its phase, such as Multiwfn, text extraction
or Shell command. Later steps retain their own execution status. Array workflows
have a variable-combination selector; batch inputs and retry attempts each keep
their own graph.

Click a node or **Locate failed step** to show that step's log range. The source
selector switches between the workflow log and its Multiwfn output. **All logs**
returns to the combined log view. Native `collect(...)` moves retain log links.
The graph can be collapsed to give the log more space. Long step logs display
their last 256 KiB; the complete file remains available from Result files.

Node states reflect the driver's execution result. Conf sections in one
Multiwfn invocation share that invocation's return status. Runs without a step
record show their ordinary logs. Large histories display recent execution
groups; the event file retains the full record.

## Rendering Cube results

In **Results → Result files**, **Open** beside any file uses its system default
application. **Open folder** opens the current workflow's result directory in
the file manager. Both actions are available while a workflow is running, so
logs and intermediate files can be inspected without waiting for completion.

In **Results → Result files**, use **Render** beside a `.cub` or `.cube` file.
This opens the existing MatterViz viewer in its own window, with the molecule
read from the Cube. View controls, representations and image export remain
available. No Multiwfn calculation is needed to display an existing result.

Check multiple Cube rows and choose **Render selected** to open them together in
one MatterViz window, with the same automatic presets as individual rendering.
**One-click render** selects all Cube results and opens the complete selection;
it does not export images. Non-Cube logs/configurations are not selected. ESP
automatically includes its paired density even if that row is unchecked. A
selected density used for ESP is not duplicated as an unmapped surface. Matching
filenames from different output folders remain distinct. Choose any unresolved
ESP units first; a missing pair or invalid selection blocks the whole request.
Each window receives its own temporary bundle of file links/copies and preserves
the original outputs. Up to 64 selected Cubes can be sent per window.

Scripts can rename fixed-name Multiwfn outputs in `%command`. Keep the type
suffix last to remain compatible with vcube:

| Filename ending | Initial view |
| --- | --- |
| `_den.cub` | Electron-density surface |
| `_elf.cub`, `_lol.cub` | ELF / LOL surface |
| `_ole.cub`, `_ele.cub` | Hole / electron scalar fields |
| `_oH.cub`, `_oH1.cub` | HOMO / HOMO−1, both signs |
| `_oL.cub`, `_oL1.cub` | LUMO / LUMO+1, both signs |
| `_au_esp.cub`, `_kcal_esp.cub` | ESP mapped onto the matching density |

For example, `benzene_au_esp.cub` or `benzene_kcal_esp.cub` pairs with
`benzene_den.cub` in the same directory. Units precede `_esp`; **do not use
`benzene_esp_au.cub`**, which no longer has vcube's terminal type suffix.
`au` means atomic units and `kcal` means kcal/mol. Select the suffix according
to the actual values written by the script: BaneWfn recipes that multiply ESP
by 627.51 already produce kcal/mol values. The handoff records the declared
unit in the viewer manifest. Display-unit normalization belongs to the separate
Cube/ESP viewer fix. With the unmodified upstream viewer, use ESP data in atomic
units; a filename suffix does not convert the stored values. Original files are
never converted or renamed by the GUI.

For a legacy `benzene_esp.cub`, select the data unit in the result row. This
choice is saved per file in `.banewfn-view-settings.json` within that job and
can be changed later. Filename-declared units take precedence. Pairing requires
exact common stems and one density file in the same directory; ambiguous or
missing pairs are not guessed. The existing viewer rejects incompatible grids
without interpolation. Unknown Cube names open as ordinary scalar fields.
Display isovalues are adjustable and do not change computational parameters.
Long aliases `_hole` / `_electron` and orbital offsets above 1 are also accepted
by the GUI; use the short suffixes when a vcube script requires them.

The workbench uses the installed viewer's existing colors, labels and grid
compatibility checks. Blue/green hole/electron grouping, compact source filenames,
Cube loading improvements and cross-resolution ESP coloring are maintained in
the separate Cube/ESP viewer fix, outside the workflow integration.

Each window owns a temporary view session, removed on normal close. Source
outputs stay in the workflow directory; same-filesystem hard links avoid copying
large grids, with copying as a fallback. Rendering is disabled during execution
and for preflight-only jobs. Result listing includes subfolders, excludes hidden
files, `conf` and symlinks, and is bounded to eight directory levels / 2048 entries.

## Application boundaries

Workflow selection, parameter editing, execution and cancellation belong to
`banewfn_gui`. The MatterViz rendering window has no workflow button, embedded
panel or workflow API. Render selected / One-click render opens a separate viewer
with the existing scientific output; closing that viewer does not close BaneWfn.

The runner reuses BaneWfn's parser, module expansion, raw input, variables,
builtins, text extraction, postprocessing, collection and citations. Each job
uses its own directory and invokes the bundled Multiwfn as an external process.
It does not attach to an already running Multiwfn or retain its calculation state.

The normal Multiwfn entry and its native visualization transport remain
available independently. The workflow build compiles the original Multiwfn entry
without menu substitutions. Windows engine/runner builds retain UTF-8 process
manifests. Canonical Windows paths are normalized when written to legacy rc
files or batch command lines, preserving Git Bash and external conf support.

## Build and install

The runner is optional. Ordinary noGUI and GUI builds keep their current language
and runtime requirements when `MULTIWFN_WITH_WORKFLOWS=OFF`, the default.
For a complete Linux desktop build with the frontend and Rust host:

```sh
bash tools/build_workflows_gui.sh
./build/banewfn_gui /absolute/path/to/startup.fchk
```

Linux builds also generate `build/BaneWfn.desktop`. Run
`./build/install-desktop-entry.sh` once to add **BaneWfn GUI** to your application
menu. In a downloaded Linux package, run `./install-desktop-entry.sh` from the
unpacked package instead. This registers the current absolute location for the
current user; rerun it after moving the package. No root privileges are needed.
The application icon opens the workbench. The workbench and its result windows
use the `BaneWfn` desktop identity for taskbar grouping. The compiled
`banewfn_gui` entry locates its own directory even through a symbolic link,
then starts the existing runtime wrapper and desktop host. File managers may require marking a
`.desktop` file as trusted before launching it outside the application menu.

For `banewfn_gui`, omit the startup argument to choose a file in the workbench. The launcher's engine,
host and runner are all under `build/`; an HTML file alone is not the application.
The helper uses existing toolchains and dependencies; normal Linux requirements
include GTK3/WebKitGTK 4.1 development packages. This WSL development build also
supports extracted Ubuntu dependencies under `build/gui-sysroot`. When the system
has no WebKit helpers, `bwrap` exposes those local helpers in a private mount
namespace without installing files into `/usr`. This local runtime is specific
to the Ubuntu 24.04 x86-64 build, not a universal Linux bundle.
When GTK3 development files are available, CMake also stages the small
`matterviz-file-dialog` helper. Linux file/folder selection uses this separate
process so WSL does not need an XDG desktop portal and GTK thread ownership does
not conflict with Tauri. Packages without the helper retain the existing portal
picker. The helper also ships in the optional workflows install component.

To enable just the C++17 runner in an existing build:

```sh
cmake -S . -B build-matterviz-gui -DMULTIWFN_GUI_BACKEND=matterviz \
  -DMULTIWFN_WITH_WORKFLOWS=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build-matterviz-gui --parallel 4
```

The frontend must be rebuilt and the existing Rust host must be rebuilt as
described in `docs/build.md`. The workflow feature introduces no Python, Qt,
JavaScript server or additional Rust package at runtime. The optional runner uses
the C++ standard library. Python3 is used for developer checks and dependency
updates, and is not required to configure the workflow runner. Existing native
file dialogs select local paths.

The default staging layout is:

```text
Multiwfn_MatterVizGUI
banewfn_gui                      # independent workflow application
install-desktop-entry.sh         # Linux application-menu registration
run-workflows-gui
settings.ini
resources/
  banewfn.png                   # Linux application icon
  tools/matterviz-desktop
  tools/multiwfn-workflow
  workflows/conf/*.conf
  workflows/scripts/*.bw
  workflows/scripts/*.bwc
  workflows/LICENSE
  workflows/NOTICE.md
```

The host discovers the runner beside itself and uses the Multiwfn engine in the
same installation. There is no engine picker or process-ID attachment.
Without the optional runner, the panel explains that it must be installed.
If the bundled engine cannot be found,
workflow execution stays unavailable and the panel reports that error.

To build the runner alone without a Fortran compiler or math libraries:

```sh
cmake -S frontend/workflows -B build/workflow-runner -DCMAKE_BUILD_TYPE=Release
cmake --build build/workflow-runner --parallel 4
cmake --install build/workflow-runner --component workflows --prefix /chosen/prefix
```

This installs into `bin/resources/tools` and `bin/resources/workflows`. Keep the
runner and workflow resources together when relocating them. The Actions packages
include these resources, and the macOS app packager stages them when supplied
its workflow options. Ordinary builds without workflows retain their existing
engine-first launch behavior.

For source-tree development, the host supports explicit absolute paths through
`MULTIWFN_WORKFLOW_RUNNER`, `MULTIWFN_WORKFLOW_LIBRARY`,
`MULTIWFN_WORKFLOW_CONF`. These select local
resources; they are not web request parameters.

## Run a workflow

1. Open **BaneWfn GUI**. Use the bundled density/Mayer examples or choose a script
   folder. Select a script to review its source.
2. Choose a **Startup file**, or pass it to `banewfn_gui` when launching.
   This file is used by the next workflow execution.
3. **Results folder** defaults to `<input directory>/<input stem>_workflows`.
   It follows startup-file changes until a results folder is chosen explicitly;
   an explicit choice is preserved. The automatic directory is created only
   when preflight or execution starts. Set CPU cores
   and any variable overrides, one `key=value` per line. For example, `grid=1`
   selects the bundled density workflow's coarse grid.
4. Click **Preflight** to expand the script and generate menu-input files without
   starting Multiwfn or executing `%command`. Review the log and generated files.
5. Click **Run workflow**. Each click creates a new `workflow-<time>-<sequence>`
   directory. **Cancel workflow** terminates the job process tree and preserves
   files already written in that directory.

Closing the BaneWfn workbench cancels its active job and terminates the owned
process tree. One workflow may run per workbench at a time.
The core count defaults to one and can be changed explicitly.

The workbench invokes the shared BaneWfn CLI with `--batch` and uses `end`.
This mode rejects terminal `wait`, debug pauses and
interactive builtins before handing control to a terminal. Unresolved `?`
variables need values supplied in the GUI overrides; no terminal is attached.
Platform shells and any tools used by `%command` must be available separately.

On Windows, start a `%command` block with `#!/bin/bash` (or
`#!/usr/bin/env bash`) to run it with Git Bash. Leading blank lines are allowed.
The runner finds Git for Windows in standard machine/user installation folders
or through `git.exe` on PATH; it does not select Windows' WSL `bash.exe`.
For a portable/custom installation, set the Windows environment variable
`BANEWFN_GIT_BASH` to the full path of `Git/bin/bash.exe` before starting the GUI.
The runner also honors an explicit `gitbash_exec` in its `banewfn.rc`, with
precedence over the environment override. An invalid explicit path is an error.
Git Bash is external to the package. When a Bash block cannot find it, the job
reports the missing interpreter instead of sending Bash syntax to cmd.exe.
Blocks without a Bash shebang continue to use cmd.exe. Bash runs synchronously
in the job directory, inherits the workflow log streams and PATH, and returns
its exit code to the workflow. It does not load interactive/login profiles;
tools such as vcube must be installed and available on PATH.

Each task supplies its complete menu input to a fresh external Multiwfn process.
Normal generated quit commands are retained. Literal `%raw` input is preserved;
the script must supply enough input to finish its chosen menu workflow. No
terminal input console is attached. Cancel stops the runner and its descendant
processes, including a task waiting for unexpected input.

## Inputs, logs and results

When selecting a library folder, the script's folder and companion files are
copied into the fresh job directory. Opening one script stages only that script
and adjacent configuration files; other companion paths must be supplied
explicitly. A wavefunction chosen
as the startup file is passed by absolute path and is not copied separately. Keep large wavefunction
collections outside the script library. Companion inputs are bounded to 64 MiB,
1024 files and eight directory levels; symlinks are rejected, and hidden files,
`build`, `target` and `node_modules` directories are excluded.
Result directories marked with `.workflow-results.json` are excluded from script
discovery and input staging, including earlier runs for other startup files.
Results may be a child of the script folder, but cannot be the script folder
itself. This keeps automatic results beside inputs without recursively copying
generated workflows and their outputs.

Bundled modules are copied into `.workflow-conf`, then adjacent `.conf` files and
`conf/*.conf` from the script folder override them. Inline `.bwc` configurations
retain BaneWfn's precedence. A job-specific `banewfn.rc` selects the requested
engine, module directory, cores and `references.bib`; a script folder's rc is not
used to redirect execution. An adjacent engine `settings.ini` is copied when
available. References and module citations retain BaneWfn's existing behavior.

`workflow-run.json` records the runner, engine, original script, wavefunction,
resources and variable overrides. `workflow.log` holds runner stdout/stderr, and
Multiwfn keeps its normal per-task `.out` files so `%grep` and `${output}` continue
to work. The panel shows a bounded log tail, including the most recent `.out`.
`workflow-status.json` records terminal state and exit code. Existing results are
never reused or removed.

**Preflight complete** indicates successful script expansion. **Completed**
indicates that the runner and the workflow's required checks returned success.
Scientific correctness still depends on the workflow and its expected artifacts;
use required `%grep` checks when the presence of a result alone is insufficient.

## Review scope

Related discussion: [BaneWfn stdin control, issue #58](https://github.com/Stardust0831/Multiwfn/issues/58),
[GUI integration principles, PR #27](https://github.com/Stardust0831/Multiwfn/pull/27)
and [native host architecture, PR #26](https://github.com/Stardust0831/Multiwfn/pull/26).
The contribution is limited to frontend, host orchestration, optional build
integration, tests and documentation. Root Fortran, `ext/` and `libreta_hybrid/`
stay unchanged. BaneWfn workflows use external batch processes, with no generated
replacement entry, added scientific menu or in-process batch protocol. The
optional dependency adds a C++17 runner; it uses the existing Rust/WebView shell
and Svelte frontend. Missing workflow resources disable the workbench runner
without changing ordinary Multiwfn execution.

The BaneWfn revision and hashes are recorded in `frontend/workflows/banewfn.lock.json`.
Maintain executor changes, conf and `scripts/gui/` recipes in the BaneWfn repository,
then run `python3 tools/sync_banewfn.py --source ../banewfn --revision COMMIT`.
`python3 tools/sync_banewfn.py --check` verifies the offline snapshot and runs in CI.
The synchronization refuses to overwrite local edits to locked files. Source
ownership and the update procedure are recorded in `frontend/workflows/NOTICE.md`.
Redistribute its Apache license with the runner
and preserve this repository's Multiwfn license and attribution separately.
