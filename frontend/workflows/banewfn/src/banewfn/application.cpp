#include "banewfn/application.h"
#include "common/gui.h"
#include "common/execution_trace.h"

#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <map>
#include <vector>
#include <set>
#include <algorithm>
#include <filesystem>
#include <iomanip>
#include <cstdlib>
#include <cstring>
#include <cstdio>
#include <cctype>
#include <system_error>
#include <unistd.h>
#include <sys/stat.h>
#ifndef _WIN32
#include <termios.h>
#endif
#include "common/citation.h"
#include "common/config.h"
#include "banewfn/grep_engine.h"
#include "banewfn/promolecule.h"
#include "common/input.h"
#include "common/inline_conf.h"
#include "common/ui.h"
#include "common/utils.h"

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <io.h>
#include <conio.h>
#include "common/git_bash.h"
#endif

namespace {

struct TerminalColorState {
    bool enabled = false;
};

TerminalColorState& terminalColorState() {
    static TerminalColorState state;
    return state;
}

bool isNonEmptyEnvEnabled(const char* name) {
    const char* value = std::getenv(name);
    return value != nullptr && value[0] != '\0';
}

bool isStdStreamTerminal(FILE* stream) {
#ifdef _WIN32
    return _isatty(_fileno(stream)) != 0;
#else
    return isatty(fileno(stream)) != 0;
#endif
}

#ifdef _WIN32
void enableVirtualTerminalForHandle(DWORD stdHandleId) {
    HANDLE handle = GetStdHandle(stdHandleId);
    if (handle == INVALID_HANDLE_VALUE || handle == nullptr) {
        return;
    }

    DWORD mode = 0;
    if (!GetConsoleMode(handle, &mode)) {
        return;
    }

    SetConsoleMode(handle, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
}
#endif

void initializeColorOutput(const ExecutionOptions& options) {
    bool enabled = !options.noColor && !isNonEmptyEnvEnabled("NO_COLOR");

    // Disable colors whenever output is redirected, so logs/files stay clean.
    if (enabled) {
        enabled = isStdStreamTerminal(stdout) && isStdStreamTerminal(stderr);
    }

#ifdef _WIN32
    if (enabled) {
        enableVirtualTerminalForHandle(STD_OUTPUT_HANDLE);
        enableVirtualTerminalForHandle(STD_ERROR_HANDLE);
    }
#endif

    terminalColorState().enabled = enabled;
}

std::string colorizeText(const std::string& text, const char* ansiCode) {
    if (!terminalColorState().enabled) {
        return text;
    }
    return std::string(ansiCode) + text + "\033[0m";
}

void printSuccessLine(const std::string& text) {
    std::cout << colorizeText(text, "\033[32m") << std::endl;
}

void printFailureLine(const std::string& text) {
    std::cerr << colorizeText(text, "\033[31m") << std::endl;
}

} // namespace

// Replace only the specified placeholder variable in a string.
// Supported forms: $var, ${var}, ${var:-default}
// Any other placeholders are left untouched.
static std::string replaceOnePlaceholderVar(const std::string& text,
                                           const std::string& var,
                                           const std::string& value) {
    std::string result = text;
    std::size_t searchPos = 0;
    VariableSyntax::Placeholder placeholder;

    while (VariableSyntax::parseNextPlaceholder(result, searchPos, placeholder)) {
        if (placeholder.name == var) {
            const std::string replacement =
                value.empty() && !placeholder.defaultValue.empty() ? placeholder.defaultValue : value;
            result.replace(placeholder.begin, placeholder.end - placeholder.begin, replacement);
            searchPos = placeholder.begin + replacement.size();
        } else {
            searchPos = placeholder.end;
        }
    }

    return result;
}

static void collectPlaceholderNames(const std::string& text, std::set<std::string>& names) {
    std::size_t searchPos = 0;
    VariableSyntax::Placeholder placeholder;
    while (VariableSyntax::parseNextPlaceholder(text, searchPos, placeholder)) {
        std::string name = placeholder.name;
        // The list view historically recognized ${name:default} in addition to
        // the runtime ${name:-default} syntax. Preserve that display-only behavior.
        if (placeholder.braced && placeholder.defaultValue.empty()) {
            const std::size_t colon = name.find(':');
            if (colon != std::string::npos) {
                name = name.substr(0, colon);
            }
        }
        if (!name.empty()) {
            names.insert(name);
        }
        searchPos = placeholder.end;
    }
}

// Paths selected by the desktop host can contain spaces and shell metacharacters.
static std::string quoteWorkflowArgument(const std::string& value) {
#ifdef _WIN32
    // cmd.exe expansion is not disabled by quotes. Reject these path characters.
    if (value.find_first_of("\"%\r\n") != std::string::npos) {
        throw std::runtime_error("Unsupported character in workflow path");
    }
    return "\"" + value + "\"";
#else
    std::string result = "'";
    for (const char c : value) result += c == '\'' ? "'\"'\"'" : std::string(1, c);
    return result + "'";
#endif
}

static std::string buildMultiwfnInvocation(const std::string& multiwfnExec,
                                           const std::string& wfnFile,
                                           int cores,
                                           const ExecutionOptions& options) {
    std::stringstream cmd;
    cmd << quoteWorkflowArgument(Utils::trimQuotes(multiwfnExec))
        << " " << quoteWorkflowArgument(wfnFile);

    if (cores > 0) {
        cmd << " -nt " << cores;
    }

    if (options.nogui) {
        cmd << " -silent";
    }

    for (const auto& arg : options.extargs) {
        cmd << " " << quoteWorkflowArgument(arg);
    }

    return cmd.str();
}

static int runWorkflowInvocation(const std::string& command) {
#ifdef _WIN32
    // system() invokes cmd.exe /c, which otherwise removes the first and last
    // quotes from a command containing a quoted executable and redirections.
    return std::system(("\"" + command + "\"").c_str());
#else
    return std::system(command.c_str());
#endif
}

static void waitForAnyKeyToExit() {
    std::cout << "\nDebug mode: Press any key to exit..." << std::flush;

#ifdef _WIN32
    HANDLE inputHandle = GetStdHandle(STD_INPUT_HANDLE);
    if (inputHandle != INVALID_HANDLE_VALUE && inputHandle != nullptr) {
        FlushConsoleInputBuffer(inputHandle);
    }
    _getch();
#else
    if (isatty(STDIN_FILENO)) {
        termios originalMode{};
        if (tcgetattr(STDIN_FILENO, &originalMode) == 0) {
            termios singleKeyMode = originalMode;
            singleKeyMode.c_lflag &= static_cast<tcflag_t>(~(ICANON | ECHO));
            tcflush(STDIN_FILENO, TCIFLUSH);
            if (tcsetattr(STDIN_FILENO, TCSANOW, &singleKeyMode) == 0) {
                char key = '\0';
                const ssize_t ignored = read(STDIN_FILENO, &key, 1);
                (void)ignored;
                tcsetattr(STDIN_FILENO, TCSANOW, &originalMode);
                std::cout << std::endl;
                return;
            }
        }
    }

    std::cin.get();
#endif

    std::cout << std::endl;
}

static void pauseBeforeExit(const ExecutionOptions& options) {
    if (options.debug) {
        waitForAnyKeyToExit();
        return;
    }

#ifdef _WIN32
    if (options.dryrun) {
        std::cout << std::flush;
        system("pause");
    }
#else
    (void)options;
#endif
}

static void cleanUpExecutionTempFile(const std::string& fileName,
                                     const ExecutionOptions& options) {
    if (options.debug) {
        std::cout << "Debug mode: Keeping temporary file: " << fileName << std::endl;
        return;
    }

    remove(fileName.c_str());
}

static bool taskHasMultiwfnScript(const ModuleTask& task) {
    return !task.moduleName.empty() || !task.preRawCommands.empty() || !task.rawCommands.empty();
}

static bool tasksRequireWavefunction(const std::vector<ModuleTask>& tasks) {
    for (const auto& task : tasks) {
        if (task.isBuiltin() || taskHasMultiwfnScript(task)) {
            return true;
        }
    }
    return false;
}

static std::string getTaskDisplayName(const ModuleTask& task) {
    if (task.isCitation()) {
        return "bane.cite " + task.citationId;
    }
    if (task.isCitationOutput()) {
        std::string name = "bane.citations.write";
        if (!task.citationOutputName.empty()) {
            name += " " + task.citationOutputName;
        }
        return name;
    }
    if (task.isBuiltin()) {
        std::string name = "bane." + task.builtinName;
        if (!task.builtinId.empty()) {
            name += " " + task.builtinId;
        }
        return name;
    }
    if (!task.moduleName.empty()) {
        return task.moduleName;
    }
    if (!task.preRawCommands.empty()) {
        return "%preraw";
    }
    if (!task.rawCommands.empty()) {
        return "%raw";
    }
    if (!task.grepRules.empty() || !task.grepErrors.empty()) {
        return "%grep";
    }
    if (!task.commands.empty()) {
        return "%command";
    }
    return "<empty>";
}

static bool reportGrepSyntaxErrors(const std::vector<ModuleTask>& tasks) {
    bool found = false;
    for (const auto& task : tasks) {
        for (const auto& error : task.grepErrors) {
            if (!found) {
                std::cerr << "Error: invalid %grep syntax" << std::endl;
            }
            found = true;
            std::cerr << "  [" << getTaskDisplayName(task) << "] " << error << std::endl;
        }
    }
    return found;
}

static std::string getMultiwfnFileStem(const ModuleTask& task, const std::string& wfnFile) {
    std::string stem = task.moduleName;
    if (stem.empty()) {
        stem = task.preRawCommands.empty() ? "raw" : "preraw";
    }

    std::string wfnBaseName = Utils::getBaseName(wfnFile);
    if (!wfnBaseName.empty()) {
        stem += "_" + wfnBaseName;
    }

    if (task.blockIndex > 0) {
        stem += "_" + std::to_string(task.blockIndex);
    }

    return stem;
}

static std::string getCommandScriptStem(const ModuleTask& task) {
    std::string stem;

    if (!task.moduleName.empty()) {
        stem = task.moduleName + "_commands";
    } else if (!task.rawCommands.empty()) {
        stem = "raw_commands";
    } else {
        stem = "commands";
    }

    if (task.blockIndex > 0) {
        stem += "_" + std::to_string(task.blockIndex);
    }

    return stem;
}

static bool parseBoolLike(const std::string& rawValue, bool defaultValue = false) {
    const std::string value = Utils::toLowerAscii(Utils::trim(rawValue));
    if (value.empty()) {
        return defaultValue;
    }
    return value == "1" || value == "true" || value == "yes" || value == "on" || value == "y";
}

static std::string sanitizeFileStem(const std::string& raw) {
    std::string out;
    out.reserve(raw.size());
    for (char c : raw) {
        const unsigned char uc = static_cast<unsigned char>(c);
        if (std::isalnum(uc) || c == '_' || c == '-' || c == '.') {
            out.push_back(c);
        } else {
            out.push_back('_');
        }
    }
    return out.empty() ? std::string("builtin") : out;
}

static std::string getBuiltinFileStem(const ModuleTask& task, const std::string& wfnFile) {
    std::string stem = "builtin_" + sanitizeFileStem(task.builtinName);
    if (!task.builtinId.empty()) {
        stem += "_" + sanitizeFileStem(task.builtinId);
    }
    const std::string wfnBase = Utils::getBaseName(wfnFile);
    if (!wfnBase.empty()) {
        stem += "_" + sanitizeFileStem(wfnBase);
    }
    if (task.blockIndex > 0) {
        stem += "_" + std::to_string(task.blockIndex);
    }
    return stem;
}

static bool getParamCI(const ModuleTask& task, const std::string& key, std::string& value) {
    const std::string wanted = Utils::toLowerAscii(key);
    for (const auto& kv : task.params) {
        if (Utils::toLowerAscii(kv.first) == wanted) {
            value = kv.second;
            return true;
        }
    }
    return false;
}

static std::string getParamCIOr(const ModuleTask& task, const std::vector<std::string>& keys,
                                const std::string& defaultValue = "") {
    for (const auto& key : keys) {
        std::string value;
        if (getParamCI(task, key, value)) {
            return value;
        }
    }
    return defaultValue;
}

static bool validateBuiltinKeys(const ModuleTask& task, const std::set<std::string>& allowedKeys) {
    bool ok = true;
    for (const auto& kv : task.params) {
        const std::string key = Utils::toLowerAscii(kv.first);
        if (allowedKeys.find(key) == allowedKeys.end()) {
            std::cerr << "Error: Unknown key '" << kv.first << "' in " << getTaskDisplayName(task)
                      << ". This builtin uses strict key checking." << std::endl;
            ok = false;
        }
    }
    return ok;
}

static std::string resolveArtifactOrPath(const std::string& raw,
                                         const std::map<std::string, std::string>& artifacts) {
    std::string value = Utils::trimQuotes(Utils::trim(raw));
    const auto it = artifacts.find(value);
    if (it != artifacts.end()) {
        return it->second;
    }
    return value;
}

struct RealSpaceFieldInfo {
    std::string code;
    std::string canonical;
    std::string defaultCubeFile;
    bool needsOrbitalIndex = false;
};

static bool resolveRealSpaceField(const std::string& rawField, RealSpaceFieldInfo& info,
                                  std::string& errorMessage) {
    std::string field = Utils::toLowerAscii(Utils::trim(rawField));
    field.erase(std::remove(field.begin(), field.end(), '-'), field.end());
    for (char& c : field) {
        if (c == ' ') c = '_';
    }

    if (field.empty()) {
        field = "electron_density";
    }

    auto numeric = [](const std::string& text) {
        if (text.empty()) return false;
        size_t pos = 0;
        if (text[0] == '-' || text[0] == '+') pos = 1;
        if (pos >= text.size()) return false;
        for (; pos < text.size(); ++pos) {
            if (!std::isdigit(static_cast<unsigned char>(text[pos]))) return false;
        }
        return true;
    };

    if (numeric(field)) {
        info = {field, field, "", field == "4" || field == "44"};
        return true;
    }

    static const std::map<std::string, RealSpaceFieldInfo> fields = {
        {"rho", {"1", "electron_density", "density.cub", false}},
        {"density", {"1", "electron_density", "density.cub", false}},
        {"electron", {"1", "electron_density", "density.cub", false}},
        {"electron_density", {"1", "electron_density", "density.cub", false}},
        {"laplacian", {"3", "density_laplacian", "", false}},
        {"density_laplacian", {"3", "density_laplacian", "", false}},
        {"laplacian_density", {"3", "density_laplacian", "", false}},
        {"orbital", {"4", "orbital", "", true}},
        {"mo", {"4", "orbital", "", true}},
        {"orbital_density", {"44", "orbital_density", "", true}},
        {"mo_density", {"44", "orbital_density", "", true}},
        {"spin", {"5", "spin_density", "spindensity.cub", false}},
        {"spin_density", {"5", "spin_density", "spindensity.cub", false}},
        {"esp", {"12", "esp", "totesp.cub", false}},
        {"mep", {"12", "esp", "totesp.cub", false}},
        {"electrostatic_potential", {"12", "esp", "totesp.cub", false}},
        {"elf", {"9", "elf", "ELF.cub", false}},
        {"lol", {"10", "lol", "LOL.cub", false}},
        {"alie", {"18", "alie", "", false}},
        {"average_local_ionization_energy", {"18", "alie", "", false}},
    };

    const auto it = fields.find(field);
    if (it == fields.end()) {
        errorMessage = "unsupported real-space field: " + rawField;
        return false;
    }

    info = it->second;
    return true;
}

static void appendFieldSelection(std::vector<std::string>& commands, const RealSpaceFieldInfo& field,
                                 const ModuleTask& task) {
    commands.push_back(field.code);
    if (field.needsOrbitalIndex) {
        const std::string index = getParamCIOr(task, {"orbital", "orbital_index", "index", "mo"}, "h");
        commands.push_back(index);
    }
}

static std::string normalizeGridQuality(const std::string& rawGrid) {
    std::string grid = Utils::toLowerAscii(Utils::trim(rawGrid));
    if (grid.empty()) return "2";
    if (grid == "low" || grid == "coarse" || grid == "preview") return "1";
    if (grid == "medium" || grid == "med" || grid == "normal") return "2";
    if (grid == "high" || grid == "fine") return "3";
    return Utils::trim(rawGrid);
}

static bool appendCubeGridSpec(std::vector<std::string>& commands, const std::string& rawGrid,
                               const std::map<std::string, std::string>& artifacts,
                               std::string& errorMessage) {
    std::string grid = Utils::trim(rawGrid.empty() ? std::string("medium") : rawGrid);
    const std::string lower = Utils::toLowerAscii(grid);
    if (lower.rfind("like(", 0) == 0 && lower.back() == ')') {
        const size_t open = grid.find('(');
        const size_t close = grid.find_last_of(')');
        std::string ref = Utils::trim(grid.substr(open + 1, close - open - 1));
        ref = resolveArtifactOrPath(ref, artifacts);
        if (ref.empty()) {
            errorMessage = "grid=like(...) needs a previous artifact id or cube file path";
            return false;
        }
        commands.push_back("8");
        commands.push_back(ref);
        return true;
    }

    commands.push_back(normalizeGridQuality(grid));
    return true;
}

static std::string normalizeOperationSpec(const std::string& rawOp, std::string& errorMessage) {
    std::string op = Utils::trimQuotes(Utils::trim(rawOp));
    if (op.empty()) {
        errorMessage = "empty wavefunction operation";
        return "";
    }

    if (op.find(',') != std::string::npos) {
        return op;
    }

    std::istringstream iss(op);
    std::string symbol;
    std::string path;
    iss >> symbol;
    std::getline(iss, path);
    path = Utils::trim(path);

    if (symbol.size() == 1 && std::string("+-*/").find(symbol[0]) != std::string::npos && !path.empty()) {
        return symbol + "," + path;
    }

    if (!op.empty() && std::string("+-*/").find(op[0]) != std::string::npos && op.size() > 1) {
        return std::string(1, op[0]) + "," + Utils::trim(op.substr(1));
    }

    errorMessage = "invalid wavefunction operation '" + rawOp + "' (expected e.g. -,fragA.fchk or - fragA.fchk)";
    return "";
}

static std::vector<std::string> parseBuiltinOperations(const ModuleTask& task, std::string& errorMessage) {
    std::vector<std::string> ops;
    for (const auto& bodyLine : task.builtinBody) {
        const size_t eqPos = bodyLine.find('=');
        if (eqPos == std::string::npos) continue;
        std::string value = Utils::trim(bodyLine.substr(eqPos + 1));
        if (value.empty()) continue;

        std::vector<std::string> values;
        const std::string lowerKey = Utils::toLowerAscii(Utils::trim(bodyLine.substr(0, eqPos)));
        if (lowerKey == "ops" || lowerKey == "operators" || lowerKey == "combines") {
            values = Utils::parseBashArray(value);
        } else {
            values = {value};
        }

        for (const auto& rawOp : values) {
            const std::string normalized = normalizeOperationSpec(rawOp, errorMessage);
            if (normalized.empty()) {
                return {};
            }
            ops.push_back(normalized);
        }
    }
    return ops;
}


static std::vector<std::string> parseBuiltinListValues(const ModuleTask& task,
                                                       const std::set<std::string>& acceptedKeys) {
    std::vector<std::string> values;
    for (const auto& bodyLine : task.builtinBody) {
        const std::size_t eqPos = bodyLine.find('=');
        if (eqPos == std::string::npos) continue;
        const std::string key = Utils::toLowerAscii(Utils::trim(bodyLine.substr(0, eqPos)));
        if (acceptedKeys.find(key) == acceptedKeys.end()) continue;
        const std::string raw = Utils::trim(bodyLine.substr(eqPos + 1));
        if (raw.empty()) continue;
        if (key.size() > 1 && key.back() == 's') {
            const auto expanded = Utils::parseBashArray(raw);
            values.insert(values.end(), expanded.begin(), expanded.end());
        } else {
            values.push_back(Utils::trimQuotes(raw));
        }
    }
    return values;
}

static bool parsePositiveInt(const std::string& raw, int& value) {
    const std::string text = Utils::trim(raw);
    if (text.empty()) return false;
    try {
        std::size_t consumed = 0;
        const int parsed = std::stoi(text, &consumed);
        if (consumed != text.size() || parsed < 1) return false;
        value = parsed;
        return true;
    } catch (...) {
        return false;
    }
}

static bool parseFragmentIndexList(const std::vector<std::string>& rawValues,
                                   std::vector<std::size_t>& indices,
                                   std::string& errorMessage) {
    indices.clear();
    for (const auto& rawValue : rawValues) {
        std::string normalized = rawValue;
        std::replace(normalized.begin(), normalized.end(), ',', ' ');
        const auto tokens = Utils::parseBashArray(
            normalized.size() >= 2 && normalized.front() == '(' && normalized.back() == ')'
                ? normalized
                : "(" + normalized + ")");
        for (const auto& token : tokens) {
            int value = 0;
            if (!parsePositiveInt(token, value)) {
                errorMessage = "invalid fragment index in flip: " + token;
                return false;
            }
            indices.push_back(static_cast<std::size_t>(value));
        }
    }
    return true;
}

static bool appendRealSpaceModePrefix(std::vector<std::string>& commands, const ModuleTask& task,
                                      std::string& errorMessage) {
    const std::vector<std::string> ops = parseBuiltinOperations(task, errorMessage);
    if (!errorMessage.empty()) {
        return false;
    }

    std::string mode = Utils::toLowerAscii(getParamCIOr(task, {"mode"}, ""));
    if (mode == "promol" || mode == "promolecular") {
        if (!ops.empty()) {
            errorMessage = "mode=promolecular cannot be combined with op/operator/combine";
            return false;
        }
        commands.push_back("-1");
        return true;
    }
    if (mode == "def" || mode == "deformation" || mode == "deformation_density") {
        if (!ops.empty()) {
            errorMessage = "mode=deformation cannot be combined with op/operator/combine";
            return false;
        }
        commands.push_back("-2");
        return true;
    }

    if (!ops.empty()) {
        commands.push_back("0");
        commands.push_back(std::to_string(ops.size()));
        for (const auto& op : ops) {
            commands.push_back(op);
        }
    }
    return true;
}

static std::vector<std::string> splitSemicolonList(const std::string& raw) {
    std::vector<std::string> parts;
    std::string current;
    for (char c : raw) {
        if (c == ';') {
            parts.push_back(Utils::trim(current));
            current.clear();
        } else {
            current.push_back(c);
        }
    }
    if (!current.empty() || raw.find(';') != std::string::npos) {
        parts.push_back(Utils::trim(current));
    }
    return parts;
}

static bool extractFunctionLikeArg(const std::string& raw, const std::string& funcName, std::string& inside) {
    const std::string trimmed = Utils::trim(raw);
    const std::string lower = Utils::toLowerAscii(trimmed);
    const std::string prefix = funcName + "(";
    if (lower.rfind(prefix, 0) != 0 || trimmed.empty() || trimmed.back() != ')') {
        return false;
    }
    inside = Utils::trim(trimmed.substr(prefix.size(), trimmed.size() - prefix.size() - 1));
    return true;
}

static bool appendLineSpec(std::vector<std::string>& commands, const std::string& rawLine,
                           std::string& errorMessage) {
    std::string spec = Utils::trim(rawLine);
    std::string inside;
    if (extractFunctionLikeArg(spec, "atoms", inside) || extractFunctionLikeArg(spec, "atom", inside)) {
        commands.push_back("1");
        commands.push_back(inside);
        return true;
    }
    if (extractFunctionLikeArg(spec, "points", inside) || extractFunctionLikeArg(spec, "point", inside)) {
        const auto pts = splitSemicolonList(inside);
        if (pts.size() != 2 || pts[0].empty() || pts[1].empty()) {
            errorMessage = "line=points(...) expects two semicolon-separated coordinates";
            return false;
        }
        commands.push_back("2");
        commands.push_back(pts[0]);
        commands.push_back(pts[1]);
        return true;
    }

    if (!spec.empty()) {
        // Compatible shorthand: "1,6" means atoms(1,6).
        commands.push_back("1");
        commands.push_back(spec);
        return true;
    }

    errorMessage = "line.profile needs line=atoms(i,j) or line=points(x,y,z;x,y,z)";
    return false;
}

static std::string normalizePlaneGraphType(const std::string& rawGraph) {
    std::string graph = Utils::toLowerAscii(Utils::trim(rawGraph));
    if (graph.empty() || graph == "color" || graph == "filled" || graph == "color_filled" || graph == "map") return "1";
    if (graph == "contour" || graph == "contour_line") return "2";
    if (graph == "relief") return "3";
    if (graph == "shaded" || graph == "shaded_relief") return "4";
    if (graph == "projection" || graph == "shaded_projection") return "5";
    if (graph == "gradient" || graph == "gradient_line") return "6";
    if (graph == "vector" || graph == "vector_field") return "7";
    return Utils::trim(rawGraph);
}

static bool appendPlaneSpec(std::vector<std::string>& commands, const std::string& rawPlane,
                            std::string& errorMessage) {
    std::string spec = Utils::trim(rawPlane);
    std::string inside;
    if (extractFunctionLikeArg(spec, "atoms", inside) || extractFunctionLikeArg(spec, "atom", inside)) {
        commands.push_back("4");
        commands.push_back(inside);
        return true;
    }
    if (extractFunctionLikeArg(spec, "points", inside) || extractFunctionLikeArg(spec, "point", inside)) {
        const auto pts = splitSemicolonList(inside);
        if (pts.size() != 3 || pts[0].empty() || pts[1].empty() || pts[2].empty()) {
            errorMessage = "plane=points(...) expects three semicolon-separated coordinates";
            return false;
        }
        commands.push_back("5");
        commands.push_back(pts[0]);
        commands.push_back(pts[1]);
        commands.push_back(pts[2]);
        return true;
    }
    if (extractFunctionLikeArg(spec, "xy", inside)) {
        commands.push_back("1");
        commands.push_back(inside);
        return true;
    }
    if (extractFunctionLikeArg(spec, "xz", inside)) {
        commands.push_back("2");
        commands.push_back(inside);
        return true;
    }
    if (extractFunctionLikeArg(spec, "yz", inside)) {
        commands.push_back("3");
        commands.push_back(inside);
        return true;
    }

    if (!spec.empty()) {
        // Compatible shorthand: "1,2,3" means atoms(1,2,3).
        commands.push_back("4");
        commands.push_back(spec);
        return true;
    }

    errorMessage = "plane.map needs plane=atoms(i,j,k), plane=points(...), xy(z), xz(y), or yz(x)";
    return false;
}

static bool moveGeneratedFile(const std::string& source, const std::string& destination,
                              bool overwrite, std::string& errorMessage) {
    namespace fs = std::filesystem;
    if (Utils::trim(destination).empty() || source == destination) {
        return true;
    }

    std::error_code ec;
    const fs::path src(source);
    const fs::path dst(destination);
    if (!fs::exists(src, ec) || !fs::is_regular_file(src, ec)) {
        errorMessage = "expected output file not found: " + source;
        return false;
    }

    if (fs::exists(dst, ec)) {
        if (!overwrite) {
            errorMessage = "destination already exists: " + destination + " (set overwrite=true to replace it)";
            return false;
        }
        fs::remove(dst, ec);
        if (ec) {
            errorMessage = "failed to remove existing destination " + destination + ": " + ec.message();
            return false;
        }
    }

    if (!dst.parent_path().empty()) {
        fs::create_directories(dst.parent_path(), ec);
        if (ec) {
            errorMessage = "failed to create output directory for " + destination + ": " + ec.message();
            return false;
        }
    }

    fs::rename(src, dst, ec);
    if (!ec) {
        return true;
    }

    const std::string renameMessage = ec.message();
    ec.clear();
    fs::copy_file(src, dst, fs::copy_options::overwrite_existing, ec);
    if (ec) {
        errorMessage = renameMessage + "; copy fallback failed: " + ec.message();
        return false;
    }

    fs::remove(src, ec);
    if (ec) {
        errorMessage = "copied but failed to remove original: " + ec.message();
        return false;
    }
    return true;
}

struct BuiltinExecutionPlan {
    std::vector<std::string> commands;
    bool interactive = false;
    std::string primaryDefaultOutput;
    std::string primaryRequestedOutput;
    std::string secondaryDefaultOutput;
    std::string secondaryRequestedOutput;
    std::string artifactPath;
};

class NewFileCollector {
public:
    using Snapshot = std::set<std::string>;

    bool captureSnapshot(Snapshot& files) const {
        files.clear();

        namespace fs = std::filesystem;
        std::error_code ec;
        const fs::path cwd = fs::current_path(ec);
        if (ec) {
            std::cerr << "Warning: collect cannot read current directory: " << ec.message() << std::endl;
            return false;
        }

        fs::directory_iterator it(cwd, fs::directory_options::skip_permission_denied, ec);
        const fs::directory_iterator end;
        if (ec) {
            std::cerr << "Warning: collect cannot scan current directory: " << ec.message() << std::endl;
            return false;
        }

        for (; it != end; it.increment(ec)) {
            if (ec) {
                std::cerr << "Warning: collect stopped scanning current directory: "
                          << ec.message() << std::endl;
                return false;
            }

            std::error_code typeEc;
            if (it->is_regular_file(typeEc)) {
                files.insert(it->path().filename().string());
            }
        }

        return true;
    }

    bool rememberNewFilesSince(const Snapshot& before,
                               const std::string& taskName,
                               bool replaceExistingOnCollect = false) {
        Snapshot after;
        if (!captureSnapshot(after)) {
            return false;
        }

        size_t addedCount = 0;
        for (const auto& fileName : after) {
            if (before.find(fileName) == before.end()) {
                if (pendingFiles.insert(fileName).second) {
                    ++addedCount;
                }
                if (replaceExistingOnCollect) {
                    replaceExistingFiles.insert(fileName);
                }
            }
        }

        if (addedCount > 0) {
            std::cout << "collect: remembered " << addedCount << " new file(s) after "
                      << taskName << "." << std::endl;
        }

        return true;
    }

    bool flushToDirectory(const std::string& rawTargetDir, bool dryrun, ExecutionTrace* trace = nullptr) {
        namespace fs = std::filesystem;

        const std::string targetDir = Utils::trim(rawTargetDir);
        if (targetDir.empty()) {
            std::cerr << "Error: collect target directory is empty" << std::endl;
            return false;
        }

        if (dryrun) {
            std::cout << "Dry-run mode: collect(" << targetDir
                      << ") skipped; no files were moved." << std::endl;
            pendingFiles.clear();
            replaceExistingFiles.clear();
            return true;
        }

        if (pendingFiles.empty()) {
            std::cout << "collect(" << targetDir << "): no new files to move." << std::endl;
            return true;
        }

        std::error_code ec;
        const fs::path cwd = fs::current_path(ec);
        if (ec) {
            std::cerr << "Error: collect cannot read current directory: " << ec.message() << std::endl;
            return false;
        }

        const fs::path targetPath(targetDir);
        ec.clear();
        const bool targetExists = fs::exists(targetPath, ec);
        if (ec) {
            std::cerr << "Error: collect cannot inspect target path " << targetDir
                      << ": " << ec.message() << std::endl;
            return false;
        }

        if (targetExists) {
            if (!fs::is_directory(targetPath, ec)) {
                std::cerr << "Error: collect target exists but is not a directory: "
                          << targetDir << std::endl;
                return false;
            }
        } else {
            fs::create_directories(targetPath, ec);
            if (ec) {
                std::cerr << "Error: collect cannot create target directory " << targetDir
                          << ": " << ec.message() << std::endl;
                return false;
            }
        }

        bool ok = true;
        size_t movedCount = 0;
        std::set<std::string> remaining;

        for (const auto& fileName : pendingFiles) {
            const fs::path sourcePath = cwd / fileName;
            const fs::path destPath = targetPath / sourcePath.filename();

            std::error_code fileEc;
            if (!fs::exists(sourcePath, fileEc) || !fs::is_regular_file(sourcePath, fileEc)) {
                std::cerr << "Warning: collect source file disappeared, skipping: "
                          << fileName << std::endl;
                continue;
            }

            fileEc.clear();
            if (fs::equivalent(sourcePath, destPath, fileEc)) {
                std::cerr << "Warning: collect source and destination are the same, skipping: "
                          << fileName << std::endl;
                continue;
            }

            const bool mayReplace = replaceExistingFiles.find(fileName) != replaceExistingFiles.end();
            fileEc.clear();
            const bool destinationExists = fs::exists(destPath, fileEc);
            if (fileEc) {
                std::cerr << "Warning: collect cannot inspect destination "
                          << destPath.string() << ": " << fileEc.message() << std::endl;
                remaining.insert(fileName);
                ok = false;
                continue;
            }
            if (destinationExists && !mayReplace) {
                std::cerr << "Warning: collect destination already exists, keeping source file: "
                          << destPath.string() << std::endl;
                remaining.insert(fileName);
                ok = false;
                continue;
            }

            std::string errorMessage;
            const bool moved = destinationExists
                ? replaceFile(sourcePath, destPath, errorMessage)
                : moveFile(sourcePath, destPath, errorMessage);
            if (moved) {
                ++movedCount;
                if (trace) trace->moved(fileName, destPath.generic_u8string());
            } else {
                std::cerr << "Warning: collect failed to "
                          << (destinationExists ? "replace " : "move ") << fileName << " at "
                          << destPath.string() << ": " << errorMessage << std::endl;
                remaining.insert(fileName);
                ok = false;
            }
        }

        pendingFiles.swap(remaining);
        std::set<std::string> remainingReplaceable;
        for (const auto& fileName : replaceExistingFiles) {
            if (pendingFiles.find(fileName) != pendingFiles.end()) {
                remainingReplaceable.insert(fileName);
            }
        }
        replaceExistingFiles.swap(remainingReplaceable);

        if (movedCount > 0) {
            printSuccessLine("collect(" + targetDir + "): moved " +
                             std::to_string(movedCount) + " file(s).");
        } else if (ok) {
            std::cout << "collect(" << targetDir << "): no files moved." << std::endl;
        }

        return ok;
    }

private:
    static bool replaceFile(const std::filesystem::path& sourcePath,
                            const std::filesystem::path& destPath,
                            std::string& errorMessage) {
        namespace fs = std::filesystem;

        fs::path tempPath = destPath;
        tempPath += ".banewfn-citation-tmp";
        std::error_code ec;
        for (int suffix = 1; fs::exists(tempPath, ec) && !ec; ++suffix) {
            tempPath = fs::path(destPath.string() + ".banewfn-citation-tmp-" +
                                std::to_string(suffix));
        }
        if (ec) {
            errorMessage = "cannot inspect temporary replacement path: " + ec.message();
            return false;
        }

        fs::copy_file(sourcePath, tempPath, fs::copy_options::none, ec);
        if (ec) {
            errorMessage = "cannot stage replacement: " + ec.message();
            return false;
        }

        ec.clear();
        fs::rename(tempPath, destPath, ec);
        if (ec) {
            std::error_code copyEc;
            fs::copy_file(tempPath, destPath, fs::copy_options::overwrite_existing, copyEc);
            if (copyEc) {
                std::error_code cleanupEc;
                fs::remove(tempPath, cleanupEc);
                errorMessage = "cannot replace destination: " + copyEc.message();
                return false;
            }
            std::error_code cleanupEc;
            fs::remove(tempPath, cleanupEc);
            if (cleanupEc) {
                errorMessage = "destination replaced but temporary file could not be removed: " +
                               cleanupEc.message();
                return false;
            }
        }

        ec.clear();
        fs::remove(sourcePath, ec);
        if (ec) {
            errorMessage = "destination replaced but source file could not be removed: " + ec.message();
            return false;
        }
        return true;
    }

    static bool moveFile(const std::filesystem::path& sourcePath,
                         const std::filesystem::path& destPath,
                         std::string& errorMessage) {
        namespace fs = std::filesystem;

        std::error_code renameEc;
        fs::rename(sourcePath, destPath, renameEc);
        if (!renameEc) {
            return true;
        }

        std::error_code copyEc;
        fs::copy_file(sourcePath, destPath, fs::copy_options::none, copyEc);
        if (copyEc) {
            errorMessage = renameEc.message() + "; copy fallback failed: " + copyEc.message();
            return false;
        }

        std::error_code removeEc;
        fs::remove(sourcePath, removeEc);
        if (removeEc) {
            errorMessage = "copied but failed to remove original: " + removeEc.message();
            return false;
        }

        return true;
    }

    std::set<std::string> pendingFiles;
    std::set<std::string> replaceExistingFiles;
};

class WorkflowRunner {
private:
    ConfigManager configManager;
    CitationManager citationManager;
    ExecutionTrace trace;

public:
    // Load banewfn.rc configuration file
    bool loadBaneWfnConfig(const std::string& configFile, bool requireMultiwfnExec = true) {
        if (!configManager.loadBaneWfnConfig(configFile, requireMultiwfnExec)) {
            return false;
        }

        const std::string catalogPath = configManager.getConfig().confPath + "/citations.conf";
        if (Utils::fileExists(catalogPath) && !citationManager.loadCatalog(catalogPath)) {
            return false;
        }
        return true;
    }

private:
    static std::vector<std::string> parseCitationAuthors(const std::string& rawAuthors) {
        std::vector<std::string> authors;
        for (const auto& author : Utils::split(rawAuthors, ';')) {
            const std::string cleaned = Utils::trim(author);
            if (!cleaned.empty()) {
                authors.push_back(cleaned);
            }
        }
        return authors;
    }

    static bool buildCitationRecord(const ModuleTask& task,
                                    CitationRecord& record,
                                    std::string& reason) {
        static const std::set<std::string> allowedFields = {
            "reason", "authors", "title", "journal", "year", "volume",
            "issue", "pages", "doi", "url", "text"
        };

        record = CitationRecord();
        record.id = Utils::trim(task.citationId);
        reason.clear();

        if (record.id.empty()) {
            std::cerr << "Error: " << getTaskDisplayName(task)
                      << " requires a citation id" << std::endl;
            return false;
        }

        for (const auto& param : task.params) {
            const std::string key = Utils::toLowerAscii(Utils::trim(param.first));
            const std::string value = Utils::trim(param.second);
            if (allowedFields.find(key) == allowedFields.end()) {
                std::cerr << "Error: Unknown field '" << param.first << "' in "
                          << getTaskDisplayName(task) << std::endl;
                return false;
            }

            if (key == "reason") reason = value;
            else if (key == "authors") record.authors = parseCitationAuthors(value);
            else if (key == "title") record.title = value;
            else if (key == "journal") record.journal = value;
            else if (key == "year") record.year = value;
            else if (key == "volume") record.volume = value;
            else if (key == "issue") record.issue = value;
            else if (key == "pages") record.pages = value;
            else if (key == "doi") record.doi = value;
            else if (key == "url") record.url = value;
            else if (key == "text") record.text = value;
        }
        return true;
    }

    bool executeCitationTask(const ModuleTask& task) {
        CitationRecord record;
        std::string reason;
        if (!buildCitationRecord(task, record, reason)) {
            return false;
        }
        const std::string origin = task.origin.empty()
            ? "input:" + record.id
            : task.origin;

        const bool hasInlineRecord = !record.authors.empty() || !record.title.empty() ||
            !record.journal.empty() || !record.year.empty() || !record.volume.empty() ||
            !record.issue.empty() || !record.pages.empty() || !record.doi.empty() ||
            !record.url.empty() || !record.text.empty();
        if (hasInlineRecord) {
            if (!citationManager.addOrOverride(record, origin)) {
                return false;
            }
        } else if (!citationManager.hasRecord(record.id)) {
            std::cerr << "Error: " << getTaskDisplayName(task)
                      << " defines no bibliographic fields and the id is not present in the catalog"
                      << std::endl;
            return false;
        }
        return citationManager.use(record.id, reason, origin);
    }

    bool executeCitationOutputTask(const ModuleTask& task) {
        static const std::set<std::string> allowedFields = {"output", "format"};
        std::string output;
        std::string format = "plain";
        for (const auto& param : task.params) {
            const std::string key = Utils::toLowerAscii(Utils::trim(param.first));
            if (allowedFields.find(key) == allowedFields.end()) {
                std::cerr << "Error: Unknown field '" << param.first << "' in "
                          << getTaskDisplayName(task) << std::endl;
                return false;
            }
            if (key == "output") {
                output = Utils::trim(param.second);
            } else if (key == "format") {
                format = Utils::toLowerAscii(Utils::trim(param.second));
            }
        }

        if (output.empty()) {
            std::cerr << "Error: " << getTaskDisplayName(task)
                      << " requires output=<path>" << std::endl;
            return false;
        }

        bool ok = false;
        if (format == "plain") {
            ok = citationManager.writePlain(output);
        } else if (format == "bibtex") {
            ok = citationManager.writeBibTeX(output);
        } else {
            std::cerr << "Error: Unsupported citation output format '" << format
                      << "' (expected plain or bibtex)" << std::endl;
            return false;
        }

        if (ok) {
            printSuccessLine("Citation file written: " + output);
        }
        return ok;
    }

    bool registerSuccessfulSoftwareCitations(const ModuleTask& task) {
        if ((task.isBuiltin() || taskHasMultiwfnScript(task)) &&
            citationManager.hasRecord("multiwfn")) {
            return citationManager.use("multiwfn", "Wavefunction analysis engine",
                                       "software:multiwfn");
        }
        return true;
    }

    static std::map<std::string, std::string> mergeSectionParams(
        const Section& section,
        const std::map<std::string, std::string>& suppliedParams) {
        std::map<std::string, std::string> result = section.defaults;
        for (const auto& param : suppliedParams) {
            if (!param.second.empty()) {
                result[param.first] = param.second;
            }
        }
        return result;
    }

    static bool citationTargetsSection(const ConfigCitationBinding& binding,
                                       const std::string& sectionName) {
        return std::find(binding.targets.begin(), binding.targets.end(), sectionName) !=
               binding.targets.end();
    }

    bool validateConfigCitationsForSection(const std::string& moduleName,
                                           const std::string& sectionName) const {
        if (!configManager.hasModuleConfig(moduleName)) {
            return false;
        }

        const ModuleConfig& module = configManager.getModuleConfig(moduleName);
        bool ok = true;
        for (const auto& binding : module.citationBindings) {
            if (!citationTargetsSection(binding, sectionName)) {
                continue;
            }
            if (!citationManager.hasRecord(binding.id)) {
                std::cerr << "Error: Citation id '" << binding.id
                          << "' required by module " << moduleName << " section ["
                          << sectionName << "] is not defined (" << module.origin << ":"
                          << binding.lineNumber << ")" << std::endl;
                ok = false;
            }
        }
        return ok;
    }

    bool validateConfiguredCitationsForTask(const ModuleTask& task) const {
        if (!task.isWorkflow() || task.moduleName.empty()) {
            return true;
        }

        bool ok = validateConfigCitationsForSection(task.moduleName, "main");
        for (const auto& step : task.postProcessSteps) {
            if (!validateConfigCitationsForSection(task.moduleName, step.first)) {
                ok = false;
            }
        }
        return ok;
    }

    bool registerConfigCitationsForSection(
        const std::string& moduleName,
        const std::string& sectionName,
        const std::map<std::string, std::string>& suppliedParams) {
        if (!configManager.hasModuleConfig(moduleName)) {
            return false;
        }

        const ModuleConfig& module = configManager.getModuleConfig(moduleName);
        const auto sectionIt = module.sections.find(sectionName);
        if (sectionIt == module.sections.end()) {
            return true;
        }

        const std::map<std::string, std::string> finalParams =
            mergeSectionParams(sectionIt->second, suppliedParams);
        bool ok = true;
        for (const auto& binding : module.citationBindings) {
            if (!citationTargetsSection(binding, sectionName)) {
                continue;
            }

            std::string reason = Utils::trim(
                replacePlaceholders(binding.reason, finalParams));
            if (reason.empty()) {
                reason = moduleName + " section [" + sectionName + "]";
            }

            const std::string origin = "config:" + module.origin + ":" +
                std::to_string(binding.lineNumber) + " @" + sectionName;
            if (!citationManager.use(binding.id, reason, origin)) {
                ok = false;
            }
        }
        return ok;
    }

    bool registerSuccessfulConfigCitations(const ModuleTask& task) {
        if (!task.isWorkflow() || task.moduleName.empty()) {
            return true;
        }

        bool ok = registerConfigCitationsForSection(
            task.moduleName, "main", task.params);
        for (const auto& step : task.postProcessSteps) {
            if (!registerConfigCitationsForSection(
                    task.moduleName, step.first, step.second)) {
                ok = false;
            }
        }
        return ok;
    }

    // Load module-specific conf file
    bool loadModuleConfig(const std::string& moduleName) {
        return configManager.loadModuleConfig(moduleName);
    }

    // Generate command sequence
    std::vector<std::string> generateCommands(const std::string& moduleName,
                                             const std::string& sectionName,
                                             const std::map<std::string, std::string>& params) {
        std::vector<std::string> result;

        if (!configManager.hasModuleConfig(moduleName)) {
            std::cerr << "Warning: Module config [" << moduleName << "] not loaded" << std::endl;
            return result;
        }

        const ModuleConfig& modConfig = configManager.getModuleConfig(moduleName);

        if (modConfig.sections.find(sectionName) == modConfig.sections.end()) {
            std::cerr << "Warning: Section [" << sectionName << "] not found in module " << moduleName << std::endl;
            return result;
        }

        const Section& section = modConfig.sections.at(sectionName);

        return Gui::commands(section, params);
    }

    // Generate Multiwfn input script for a single task.
    // For normal module tasks, this includes optional %preraw + [main] + %process sections + optional %raw.
    // For raw-only tasks, this is simply the literal %preraw/%raw content.
    std::string generateModuleScript(const ModuleTask& task, bool includeQuit) {
        std::stringstream output;

        bool hasContent = false;
        const ModuleConfig* modConfig = nullptr;

        // Insert literal pre-raw Multiwfn commands before generated module commands.
        for (const auto& preRawCmd : task.preRawCommands) {
            output << preRawCmd << "\n";
            hasContent = true;
        }

        if (!task.moduleName.empty()) {
            if (!configManager.hasModuleConfig(task.moduleName)) {
                std::cerr << "Error: Module config not loaded for " << task.moduleName << std::endl;
                return "";
            }

            modConfig = &configManager.getModuleConfig(task.moduleName);

            // Generate main module commands (pre-processing)
            auto commands = generateCommands(task.moduleName, "main", task.params);
            for (const auto& cmd : commands) {
                output << cmd << "\n";
                hasContent = true;
            }

            // Generate post-processing commands
            for (const auto& step : task.postProcessSteps) {
                auto stepCommands = generateCommands(task.moduleName, step.first, step.second);
                for (const auto& cmd : stepCommands) {
                    output << cmd << "\n";
                    hasContent = true;
                }
            }
        }

        // Append literal raw Multiwfn commands after generated module commands.
        for (const auto& rawCmd : task.rawCommands) {
            output << rawCmd << "\n";
            hasContent = true;
        }

        if (!hasContent) {
            return "";
        }

        // Add module-specific quit commands only if requested.
        // Raw-only tasks are treated as already-finalized literal command sequences.
        if (includeQuit && modConfig != nullptr) {
            for (const auto& quitCmd : modConfig->quitCommands) {
                output << quitCmd << "\n";
            }
        }

        return output.str();
    }

    // Execute single module Multiwfn task (file-based mode)
    bool executeModuleTaskFile(const ModuleTask& task, const std::string& wfnFile,
                               int cores, const ExecutionOptions& options) {
        std::cout << "\n>>> Processing Multiwfn task: " << getTaskDisplayName(task) << std::endl;

        // Generate command script with quit commands
        std::string commands = generateModuleScript(task, true);
        if (commands.empty()) {
            return false;
        }

        // Create command file
        std::string cmdFileName = getMultiwfnFileStem(task, wfnFile) + ".txt";

        std::ofstream cmdFile(cmdFileName);
        if (!cmdFile.is_open()) {
            std::cerr << "Error: Cannot create command file: " << cmdFileName << std::endl;
            return false;
        }
        cmdFile << commands;
        cmdFile.close();

        // In dryrun mode, only generate the file
        if (options.dryrun) {
            std::cout << "Dry-run mode: Command file generated, skipping execution." << std::endl;
            return true;
        }

        // Generate output filename or screen output
        std::string outFile;
        if (!options.screen) {
            outFile = getMultiwfnFileStem(task, wfnFile) + ".out";

            std::ofstream outFileStream(outFile);
            if (outFileStream.is_open()) {
                outFileStream << UI::getLogoString();
                outFileStream.close();
            }
        }

        std::stringstream cmd;
        cmd << buildMultiwfnInvocation(configManager.getConfig().multiwfnExec, wfnFile, cores, options)
            << " < " << quoteWorkflowArgument(cmdFileName);

        if (!options.screen) {
            cmd << " >> " << quoteWorkflowArgument(outFile);
        }

        std::cout << "Executing command: " << cmd.str() << std::endl;
        std::cout << "Starting Multiwfn process..." << std::endl;

        // Execute command
        int result = runWorkflowInvocation(cmd.str());

        // Clean up command file only if not in dryrun mode
        if (!options.dryrun) {
            cleanUpExecutionTempFile(cmdFileName, options);
        }

        if (result == 0) {
            printSuccessLine("Module " + task.moduleName + " execution completed.");
            return true;
        } else {
            printFailureLine("Error: Module " + task.moduleName +
                             " execution failed with error code " + std::to_string(result));
            return false;
        }
    }

    // Execute single module Multiwfn task (pipe/interactive mode)
    bool executeModuleTaskPipe(const ModuleTask& task, const std::string& wfnFile,
                               int cores, const ExecutionOptions& options) {
        std::cout << "\nProcessing Multiwfn task: " << getTaskDisplayName(task)
                  << " (interactive mode)" << std::endl;

        // Generate command script without quit commands
        std::string commands = generateModuleScript(task, false);
        if (commands.empty()) {
            return false;
        }

        // Parse commands into individual lines (preserve empty lines!)
        std::vector<std::string> cmdLines;
        std::stringstream ss(commands);
        std::string line;
        while (std::getline(ss, line)) {
            // Don't trim or skip empty lines - they are meaningful inputs
            cmdLines.push_back(line);
        }

        std::string multiwfnCmd = buildMultiwfnInvocation(
            configManager.getConfig().multiwfnExec, wfnFile, cores, options);

        // In dryrun mode, show the manual Multiwfn invocation for wait blocks.
        if (options.dryrun) {
            std::cout << "Dry-run mode: wait block will not be executed automatically." << std::endl;
            std::cout << "Please launch Multiwfn with:" << std::endl;
            std::cout << "  " << multiwfnCmd << std::endl;
            if (!cmdLines.empty()) {
                std::cout << "Then enter the following inputs manually:" << std::endl;
                for (const auto& cmdLine : cmdLines) {
                    if (cmdLine.empty()) {
                        std::cout << "  [empty line]" << std::endl;
                    } else {
                        std::cout << "  " << cmdLine << std::endl;
                    }
                }
            }
            return true;
        }

        // Build pipe command: cross-platform compatible
        std::stringstream cmd;

#ifdef PLATFORM_WINDOWS
        // Windows style: cmd /c "(echo cmd1; echo cmd2; ...; type con) | Multiwfn file"
        cmd << "cmd /c \"(";

        for (const auto& cmdLine : cmdLines) {
            std::string trimmedLine = Utils::trim(cmdLine);
            if (trimmedLine.empty()) {
                // For empty lines, use echo. to produce empty input
                cmd << "echo. & ";
            } else {
                // For non-empty lines, escape quotes and use echo
                std::string escaped = cmdLine;
                // Escape any existing quotes in the command for Windows
                size_t pos = 0;
                while ((pos = escaped.find('"', pos)) != std::string::npos) {
                    escaped.replace(pos, 1, "\"\"");
                    pos += 2;
                }
                cmd << "echo " << escaped << " & ";
            }
        }

        cmd << "type con) | " << multiwfnCmd << "\"";
#else
        // Linux style: (echo cmd1; echo cmd2; ...; cat) | Multiwfn file
        cmd << "(";

        for (const auto& cmdLine : cmdLines) {
            std::string trimmedLine = Utils::trim(cmdLine);
            if (trimmedLine.empty()) {
                // For empty lines, use echo without arguments to produce empty input
                cmd << "echo; ";
            } else {
                // For non-empty lines, escape quotes and use echo
                std::string escaped = cmdLine;
                // Escape any existing quotes in the command
                size_t pos = 0;
                while ((pos = escaped.find('"', pos)) != std::string::npos) {
                    escaped.replace(pos, 1, "\\\"");
                    pos += 2;
                }
                cmd << "echo \"" << escaped << "\"; ";
            }
        }

        cmd << "cat) | " << multiwfnCmd;
#endif

        std::cout << "Executing command: " << cmd.str() << std::endl;
        std::cout << "Starting Multiwfn in interactive mode...\n" << std::endl;

        // Execute command
        int result = system(cmd.str().c_str());

        if (result == 0) {
            printSuccessLine("Module " + task.moduleName + " session ended.");
            return true;
        } else {
            printFailureLine("Error: Module " + task.moduleName +
                             " execution failed with error code " + std::to_string(result));
            return false;
        }
    }

    // Execute command block (shell commands)
    // outFile: the Multiwfn output file produced by the preceding module task.
    //          Computed centrally in executeModuleTask and passed in explicitly
    //          so that ${output} is always resolved correctly.
    bool executeCommandBlock(const ModuleTask& task, const std::string& wfnFile,
                             const ExecutionOptions& options,
                             const std::string& outFile = "") {
        if (task.commands.empty()) {
            return true; // No commands to execute
        }

        (void)wfnFile;

        std::cout << "\nExecuting command block for task: " << getTaskDisplayName(task) << std::endl;

        // Replace reserved placeholders in command lines (currently: ${output})
        std::vector<std::string> processedCmds;
        processedCmds.reserve(task.commands.size());
        for (const auto& cmdLine : task.commands) {
            processedCmds.push_back(replaceOnePlaceholderVar(cmdLine, "output", outFile));
            // A CRLF-authored workflow must also run in Bash on POSIX.
            if (!processedCmds.back().empty() && processedCmds.back().back() == '\r')
                processedCmds.back().pop_back();
        }

        // In dryrun mode, only show what would be executed (after placeholder replacement)
        if (options.dryrun) {
            std::cout << "Dry-run mode: Would execute the following commands:" << std::endl;
            for (const auto& cmd : processedCmds) {
                std::cout << "  " << cmd << std::endl;
            }
            return true;
        }

        // Create temporary script file
        std::string scriptFileName = getCommandScriptStem(task);

#ifdef PLATFORM_WINDOWS
        int result = 0;

        if (WorkflowShell::requestsBash(processedCmds)) {
            const auto bash = WorkflowShell::findGitBash(configManager.getConfig().gitbashExec);
            if (bash.empty()) {
                std::cerr << "Error: This %command requests Bash, but Git Bash was not found. "
                          << "Install Git for Windows, or set BANEWFN_GIT_BASH to its bin/bash.exe "
                          << "(gitbash_exec in banewfn.rc is also supported).\n";
                return false;
            }
            scriptFileName += ".sh";
            // Binary mode keeps Bash input LF-only, including
            // scripts originally saved with Windows line endings.
            std::ofstream scriptFile(scriptFileName, std::ios::binary);
            if (!scriptFile.is_open()) {
                std::cerr << "Error: Cannot create shell script: " << scriptFileName << std::endl;
                return false;
            }
            for (const auto& cmd : processedCmds) {
                scriptFile << cmd << '\n';
            }
            scriptFile.close();
            result = WorkflowShell::runGitBash(bash, scriptFileName);

            // Clean up shell script unless debug mode keeps execution artifacts.
            cleanUpExecutionTempFile(scriptFileName, options);
        } else {
            // Use default batch script
            scriptFileName += ".bat";
            std::ofstream scriptFile(scriptFileName);
            if (!scriptFile.is_open()) {
                std::cerr << "Error: Cannot create batch file: " << scriptFileName << std::endl;
                return false;
            }

            // Write batch commands
            for (const auto& cmd : processedCmds) {
                scriptFile << cmd << std::endl;
            }
            scriptFile.close();

            // Execute batch file
            std::stringstream cmd;
            cmd << "cmd /c \"" << scriptFileName << "\"";
            std::cout << "Running script: " << cmd.str() << " ..." << std::endl;

            result = system(cmd.str().c_str());

            // Clean up batch file unless debug mode keeps execution artifacts.
            cleanUpExecutionTempFile(scriptFileName, options);
        }

#else
        scriptFileName += ".sh";
        std::ofstream scriptFile(scriptFileName);
        if (!scriptFile.is_open()) {
            std::cerr << "Error: Cannot create shell script: " << scriptFileName << std::endl;
            return false;
        }

        // Write shell script header
        scriptFile << "#!/bin/bash" << std::endl;
        // scriptFile << "set -e" << std::endl; // Exit on error is not necessary

        // Write shell commands
        for (const auto& cmd : processedCmds) {
            scriptFile << cmd << std::endl;
        }
        scriptFile.close();

        // Make script executable
        chmod(scriptFileName.c_str(), 0755);

        // Execute shell script
        std::stringstream cmd;
        cmd << "./" << scriptFileName;
        std::cout << "Running script: " << cmd.str() << " ..." << std::endl;

        int result = system(cmd.str().c_str());

        // Clean up shell script unless debug mode keeps execution artifacts.
        cleanUpExecutionTempFile(scriptFileName, options);
#endif

        if (result == 0) {
            printSuccessLine("Command block execution completed.");
            return true;
        } else {
            printFailureLine("Error: Command block execution failed with error code " + std::to_string(result));
            return false;
        }
    }

    bool executeGrepBlock(const ModuleTask& task, const std::string& outFile,
                          const ExecutionOptions& options) {
        if (!task.grepErrors.empty()) {
            for (const auto& error : task.grepErrors) {
                std::cerr << "Error: %grep syntax error: " << error << std::endl;
            }
            return false;
        }
        if (task.grepRules.empty()) {
            return true;
        }

        GrepExecutionContext context;
        context.defaultSource = outFile;
        context.outputFile = outFile;
        context.dryrun = options.dryrun;
        return GrepEngine::execute(task.grepRules, context).success;
    }

    bool buildBuiltinExecutionPlan(const ModuleTask& task,
                                   const std::string& sourceWfn,
                                   const std::map<std::string, std::string>& artifacts,
                                   BuiltinExecutionPlan& plan) {
        plan = BuiltinExecutionPlan();

        const std::string builtinName = Utils::toLowerAscii(Utils::trim(task.builtinName));
        std::string errorMessage;

        if (builtinName == "wfn.promolecule") {
            const std::set<std::string> allowed = {
                "from", "wfn", "multiplicity", "output", "overwrite"
            };
            if (!validateBuiltinKeys(task, allowed)) {
                return false;
            }

            const std::vector<std::string> rawFragments =
                parseBuiltinListValues(task, {"fragment", "fragments"});
            if (rawFragments.empty()) {
                std::cerr << "Error: " << getTaskDisplayName(task)
                          << " requires at least one fragment= entry in addition to the current wavefunction" << std::endl;
                return false;
            }

            Promolecule::BuildRequest request;
            request.fragmentPaths.push_back(sourceWfn);
            for (const auto& rawFragment : rawFragments) {
                const std::string fragment = resolveArtifactOrPath(rawFragment, artifacts);
                if (fragment.empty()) {
                    std::cerr << "Error: empty fragment wavefunction in " << getTaskDisplayName(task) << std::endl;
                    return false;
                }
                request.fragmentPaths.push_back(fragment);
            }

            std::string multiplicityValue;
            if (getParamCI(task, "multiplicity", multiplicityValue)) {
                int multiplicity = 0;
                if (!parsePositiveInt(multiplicityValue, multiplicity)) {
                    std::cerr << "Error: multiplicity must be a positive integer in "
                              << getTaskDisplayName(task) << std::endl;
                    return false;
                }
                request.targetMultiplicity = multiplicity;
            }

            if (!parseFragmentIndexList(parseBuiltinListValues(task, {"flip", "flips"}),
                                        request.explicitFlipFragments, errorMessage)) {
                std::cerr << "Error: " << errorMessage << " in " << getTaskDisplayName(task) << std::endl;
                return false;
            }

            Promolecule::BuildPlan promoleculePlan;
            if (!Promolecule::makeBuildPlan(request, promoleculePlan, errorMessage)) {
                std::cerr << "Error: " << errorMessage << " in " << getTaskDisplayName(task) << std::endl;
                return false;
            }

            plan.commands.push_back("100");
            plan.commands.push_back("19");
            plan.commands.push_back("3");
            const int fragmentCount = static_cast<int>(promoleculePlan.fragments.size());
            plan.commands.push_back(std::to_string(promoleculePlan.sharedBasis ? -fragmentCount : fragmentCount));
            for (std::size_t i = 1; i < promoleculePlan.fragments.size(); ++i) {
                plan.commands.push_back(promoleculePlan.fragments[i].path);
            }
            for (std::size_t i = 0; i < promoleculePlan.fragments.size(); ++i) {
                if (promoleculePlan.fragments[i].unrestricted) {
                    plan.commands.push_back(promoleculePlan.flipSpin[i] ? "y" : "n");
                }
            }
            plan.commands.push_back("0");
            plan.commands.push_back("q");

            plan.primaryDefaultOutput = "combine.fch";
            plan.primaryRequestedOutput = getParamCIOr(task, {"output"}, "");
            if (plan.primaryRequestedOutput.empty()) {
                plan.primaryRequestedOutput = task.builtinId.empty()
                    ? std::string("promol.fch")
                    : sanitizeFileStem(task.builtinId) + ".fch";
            }
            plan.artifactPath = plan.primaryRequestedOutput;
            return true;
        }

        RealSpaceFieldInfo field;
        if (!resolveRealSpaceField(getParamCIOr(task, {"field", "type"}, "electron_density"), field, errorMessage)) {
            std::cerr << "Error: " << errorMessage << " in " << getTaskDisplayName(task) << std::endl;
            return false;
        }

        if (builtinName == "cube.make") {
            const std::set<std::string> allowed = {
                "from", "wfn", "field", "type", "grid", "output", "overwrite", "mode",
                "orbital", "orbital_index", "index", "mo", "wait", "interactive"
            };
            if (!validateBuiltinKeys(task, allowed)) {
                return false;
            }

            const bool forcedInteractive = parseBoolLike(getParamCIOr(task, {"wait", "interactive"}, "false"), false);
            if (forcedInteractive) {
                std::cerr << "Error: bane.cube.make is a batch builtin; use legacy %raw/wait for manual sessions." << std::endl;
                return false;
            }

            plan.commands.push_back("5");
            if (!appendRealSpaceModePrefix(plan.commands, task, errorMessage)) {
                std::cerr << "Error: " << errorMessage << " in " << getTaskDisplayName(task) << std::endl;
                return false;
            }
            appendFieldSelection(plan.commands, field, task);
            if (!appendCubeGridSpec(plan.commands, getParamCIOr(task, {"grid"}, "medium"), artifacts, errorMessage)) {
                std::cerr << "Error: " << errorMessage << " in " << getTaskDisplayName(task) << std::endl;
                return false;
            }

            plan.primaryDefaultOutput = field.defaultCubeFile;
            plan.primaryRequestedOutput = getParamCIOr(task, {"output"}, "");
            if (plan.primaryDefaultOutput.empty() && !plan.primaryRequestedOutput.empty()) {
                std::cerr << "Error: field " << field.canonical
                          << " does not have a known default cube filename yet; omit output= or use a supported field alias." << std::endl;
                return false;
            }

            if (field.canonical == "esp") {
                // Match the existing grid.conf behaviour: after exporting total ESP cube, convert
                // the value from Hartree/e to kcal/mol via main function 13.
                plan.commands.push_back("2");
                plan.commands.push_back("0");
                plan.commands.push_back("r");
                plan.commands.push_back("totesp.cub");
                plan.commands.push_back("13");
                plan.commands.push_back("11");
                plan.commands.push_back("5");
                plan.commands.push_back("627.51");
                plan.commands.push_back("0");
                plan.commands.push_back("totesp.cub");
                plan.commands.push_back("-1");
                plan.commands.push_back("5");
                plan.commands.push_back("-10");
                plan.commands.push_back("q");
            } else {
                plan.commands.push_back("2");
                plan.commands.push_back("0");
                plan.commands.push_back("5");
                plan.commands.push_back("-10");
                plan.commands.push_back("q");
            }

            if (!plan.primaryRequestedOutput.empty()) {
                plan.artifactPath = plan.primaryRequestedOutput;
            } else if (!plan.primaryDefaultOutput.empty()) {
                plan.artifactPath = plan.primaryDefaultOutput;
            }
            return true;
        }

        if (builtinName == "line.profile") {
            const std::set<std::string> allowed = {
                "from", "wfn", "field", "type", "line", "output", "overwrite", "mode",
                "orbital", "orbital_index", "index", "mo", "wait", "interactive"
            };
            if (!validateBuiltinKeys(task, allowed)) {
                return false;
            }

            plan.commands.push_back("3");
            if (!appendRealSpaceModePrefix(plan.commands, task, errorMessage)) {
                std::cerr << "Error: " << errorMessage << " in " << getTaskDisplayName(task) << std::endl;
                return false;
            }
            appendFieldSelection(plan.commands, field, task);
            if (!appendLineSpec(plan.commands, getParamCIOr(task, {"line"}, ""), errorMessage)) {
                std::cerr << "Error: " << errorMessage << " in " << getTaskDisplayName(task) << std::endl;
                return false;
            }

            // Main function 3 enters a plotting GUI/menu after calculating the curve; Multiwfn
            // exports line.txt from the right-click/menu workflow. Keep it interactive by design,
            // then rename line.txt if the user exported it during the session.
            plan.interactive = true;
            plan.primaryDefaultOutput = "line.txt";
            plan.primaryRequestedOutput = getParamCIOr(task, {"output"}, "");
            if (!plan.primaryRequestedOutput.empty()) {
                plan.artifactPath = plan.primaryRequestedOutput;
            }
            return true;
        }

        if (builtinName == "plane.map") {
            const std::set<std::string> allowed = {
                "from", "wfn", "field", "type", "plane", "grid", "graph", "graph_type",
                "output", "image", "overwrite", "mode", "orbital", "orbital_index", "index", "mo",
                "wait", "interactive"
            };
            if (!validateBuiltinKeys(task, allowed)) {
                return false;
            }

            plan.commands.push_back("4");
            if (!appendRealSpaceModePrefix(plan.commands, task, errorMessage)) {
                std::cerr << "Error: " << errorMessage << " in " << getTaskDisplayName(task) << std::endl;
                return false;
            }
            appendFieldSelection(plan.commands, field, task);
            plan.commands.push_back(normalizePlaneGraphType(getParamCIOr(task, {"graph", "graph_type"}, "color")));
            plan.commands.push_back(getParamCIOr(task, {"grid"}, "200,200"));
            if (!appendPlaneSpec(plan.commands, getParamCIOr(task, {"plane"}, ""), errorMessage)) {
                std::cerr << "Error: " << errorMessage << " in " << getTaskDisplayName(task) << std::endl;
                return false;
            }

            plan.primaryDefaultOutput = "plane.txt";
            plan.primaryRequestedOutput = getParamCIOr(task, {"output"}, "");
            plan.secondaryDefaultOutput = "dislin.png";
            plan.secondaryRequestedOutput = getParamCIOr(task, {"image"}, "");

            const bool requestedInteractive = parseBoolLike(getParamCIOr(task, {"wait", "interactive"}, "false"), false);
            if (requestedInteractive || (plan.primaryRequestedOutput.empty() && plan.secondaryRequestedOutput.empty())) {
                plan.interactive = true;
            } else {
                if (!plan.primaryRequestedOutput.empty()) {
                    plan.commands.push_back("-6");
                }
                if (!plan.secondaryRequestedOutput.empty()) {
                    plan.commands.push_back("0");
                }
                plan.commands.push_back("-10");
                plan.commands.push_back("q");
            }

            if (!plan.primaryRequestedOutput.empty()) {
                plan.artifactPath = plan.primaryRequestedOutput;
            }
            return true;
        }

        std::cerr << "Error: Unknown builtin DSL block bane." << task.builtinName
                  << ". Supported: bane.wfn.promolecule, bane.cube.make, bane.line.profile, bane.plane.map" << std::endl;
        return false;
    }

    std::string generateBuiltinScript(const BuiltinExecutionPlan& plan) const {
        std::stringstream output;
        for (const auto& cmd : plan.commands) {
            output << cmd << "\n";
        }
        return output.str();
    }

    bool executeBuiltinTask(const ModuleTask& task, const std::string& currentWfnFile,
                            int cores, const ExecutionOptions& options,
                            std::map<std::string, std::string>& artifacts) {
        std::cout << "\n>>> Processing builtin task: " << getTaskDisplayName(task) << std::endl;

        std::string sourceWfn = getParamCIOr(task, {"from", "wfn"}, currentWfnFile);
        sourceWfn = resolveArtifactOrPath(sourceWfn, artifacts);
        if (Utils::trim(sourceWfn).empty()) {
            std::cerr << "Error: " << getTaskDisplayName(task)
                      << " has no wavefunction source. Set from=... or wfn=..." << std::endl;
            return false;
        }
        if (!options.dryrun && !Utils::fileExists(sourceWfn)) {
            std::cerr << "Warning: builtin source wavefunction file not found: " << sourceWfn << std::endl;
        }

        BuiltinExecutionPlan plan;
        if (!buildBuiltinExecutionPlan(task, sourceWfn, artifacts, plan)) {
            return false;
        }

        if (options.batch && plan.interactive) {
            std::cerr << "Error: Interactive builtins require a terminal; use a batch workflow.\n";
            return false;
        }
        const bool overwrite = parseBoolLike(getParamCIOr(task, {"overwrite"}, "false"), false);
        const std::string commandText = generateBuiltinScript(plan);
        if (commandText.empty()) {
            return false;
        }

        if (options.dryrun) {
            std::string cmdFileName = getBuiltinFileStem(task, sourceWfn) + ".txt";
            std::ofstream cmdFile(cmdFileName);
            if (!cmdFile.is_open()) {
                std::cerr << "Error: Cannot create builtin command file: " << cmdFileName << std::endl;
                return false;
            }
            cmdFile << commandText;
            cmdFile.close();

            std::cout << "Dry-run mode: builtin command file generated: " << cmdFileName << std::endl;
            std::cout << "Would run: "
                      << buildMultiwfnInvocation(configManager.getConfig().multiwfnExec, sourceWfn, cores, options)
                      << (plan.interactive ? "  (interactive pipe)" : " < " + cmdFileName) << std::endl;
            if (!task.builtinId.empty() && !plan.artifactPath.empty()) {
                artifacts[task.builtinId] = plan.artifactPath;
            }
            return true;
        }

        bool success = false;
        if (plan.interactive) {
            ModuleTask rawTask;
            rawTask.rawCommands = plan.commands;
            rawTask.useWait = true;
            rawTask.blockIndex = task.blockIndex;
            rawTask.kind = TaskKind::Builtin;
            rawTask.builtinName = task.builtinName;
            rawTask.builtinId = task.builtinId;
            success = executeModuleTaskPipe(rawTask, sourceWfn, cores, options);
        } else {
            std::string cmdFileName = getBuiltinFileStem(task, sourceWfn) + ".txt";
            std::ofstream cmdFile(cmdFileName);
            if (!cmdFile.is_open()) {
                std::cerr << "Error: Cannot create builtin command file: " << cmdFileName << std::endl;
                return false;
            }
            cmdFile << commandText;
            cmdFile.close();

            std::string outFile;
            if (!options.screen) {
                outFile = getBuiltinFileStem(task, sourceWfn) + ".out";
                std::ofstream outFileStream(outFile);
                if (outFileStream.is_open()) {
                    outFileStream << UI::getLogoString();
                    outFileStream.close();
                }
            }

            std::stringstream cmd;
            cmd << buildMultiwfnInvocation(configManager.getConfig().multiwfnExec, sourceWfn, cores, options)
                << " < " << quoteWorkflowArgument(cmdFileName);
            if (!options.screen) {
                cmd << " >> " << quoteWorkflowArgument(outFile);
            }

            std::cout << "Executing command: " << cmd.str() << std::endl;
            std::cout << "Starting Multiwfn process..." << std::endl;
            int result = runWorkflowInvocation(cmd.str());
            cleanUpExecutionTempFile(cmdFileName, options);
            success = (result == 0);
            if (success) {
                printSuccessLine("Builtin " + getTaskDisplayName(task) + " execution completed.");
            } else {
                printFailureLine("Error: Builtin " + getTaskDisplayName(task) +
                                 " execution failed with error code " + std::to_string(result));
            }
        }

        if (!success) {
            return false;
        }

        std::string moveError;
        if (!plan.primaryRequestedOutput.empty()) {
            if (!moveGeneratedFile(plan.primaryDefaultOutput, plan.primaryRequestedOutput, overwrite, moveError)) {
                std::cerr << "Error: " << moveError << std::endl;
                return false;
            }
            printSuccessLine("Output written: " + plan.primaryRequestedOutput);
        }
        if (!plan.secondaryRequestedOutput.empty()) {
            moveError.clear();
            if (!moveGeneratedFile(plan.secondaryDefaultOutput, plan.secondaryRequestedOutput, overwrite, moveError)) {
                std::cerr << "Error: " << moveError << std::endl;
                return false;
            }
            printSuccessLine("Output written: " + plan.secondaryRequestedOutput);
        }

        if (!task.builtinId.empty() && !plan.artifactPath.empty()) {
            artifacts[task.builtinId] = plan.artifactPath;
        }
        return true;
    }

    // Execute single module task (dispatch to appropriate method)
    bool executeModuleTask(const ModuleTask& task, const std::string& wfnFile,
                          int cores, const ExecutionOptions& options) {
        bool success = false;

        if (!task.grepErrors.empty()) {
            trace.phase("grep");
            const bool valid = executeGrepBlock(task, /*outFile=*/"", options);
            trace.phaseDone(valid);
            return valid;
        }

        // Support standalone %grep and command-only tasks. The execution order
        // remains grep -> command when there is no Multiwfn script.
        if (!taskHasMultiwfnScript(task)) {
            trace.phase("grep");
            success = executeGrepBlock(task, /*outFile=*/"", options);
            trace.phaseDone(success);
            if (success) {
                trace.phase("command");
                success = executeCommandBlock(task, wfnFile, options, /*outFile=*/"");
                trace.phaseDone(success);
            }
            return success;
        }

        // Compute outFile centrally so that ${output} in %command blocks is
        // always resolved to the same path that executeModuleTaskFile writes.
        // Rules mirror executeModuleTaskFile exactly:
        //   - screen mode  → no output file, outFile = ""
        //   - wait mode    → no output file, outFile = ""
        //   - otherwise    → "<task>_<wfnBase>[_<blockIndex>].out"
        std::string outFile;
        if (!options.screen && !task.useWait) {
            outFile = getMultiwfnFileStem(task, wfnFile) + ".out";
        }

        trace.phase("multiwfn", outFile);
        if (task.useWait) {
            success = executeModuleTaskPipe(task, wfnFile, cores, options);
        } else {
            success = executeModuleTaskFile(task, wfnFile, cores, options);
        }
        trace.phaseDone(success);

        // Fixed task order: Multiwfn -> %grep -> %command.
        if (success) {
            trace.phase("grep");
            success = executeGrepBlock(task, outFile, options);
            trace.phaseDone(success);
        }
        if (success) {
            trace.phase("command");
            success = executeCommandBlock(task, wfnFile, options, outFile);
            trace.phaseDone(success);
        }

        return success;
    }

    static bool citationOutputDisabled(const std::string& value) {
        const std::string normalized = Utils::toLowerAscii(Utils::trim(value));
        return normalized.empty() || normalized == "off" || normalized == "none" ||
               normalized == "false" || normalized == "0" || normalized == "disabled";
    }

    static bool hasExplicitCitationOutputTask(const std::vector<ModuleTask>& tasks) {
        return std::any_of(tasks.begin(), tasks.end(),
                           [](const ModuleTask& task) { return task.isCitationOutput(); });
    }

    static std::string resolveAutomaticCitationOutput(
        const std::string& outputTemplate,
        const std::string& wfnFile,
        const std::map<std::string, std::vector<std::string>>& vars) {
        ModuleTask outputTask;
        outputTask.kind = TaskKind::CitationOutput;
        outputTask.params["output"] = outputTemplate;
        std::vector<ModuleTask> resolvedTasks = {outputTask};
        InputParser::applyPlaceholderReplacement(resolvedTasks, wfnFile, vars);
        return Utils::trim(resolvedTasks.front().params["output"]);
    }

public:
    // Execute a fully resolved workflow. CLI/input/config precedence is handled once
    // by main; this class only expands and runs the resulting task plan.
    bool executeAllTasks(const std::vector<ModuleTask>& tasks, const std::string& inpFile,
                        const std::string& wfnPattern, int cores, const ExecutionOptions& options) {
        std::string steps = "[";
        for (const auto& task : tasks) {
            if (steps.size() > 1) steps += ',';
            const std::string kind = task.isCollect() ? "collect" : task.isWfnRebase() ? "rebase"
                : task.isBuiltin() ? "builtin" : (task.isCitation() || task.isCitationOutput()) ? "citations"
                : taskHasMultiwfnScript(task) ? "multiwfn" : task.commands.empty() ? "grep" : "command";
            std::string label = getTaskDisplayName(task);
            if (task.isCollect()) label = "collect(" + task.collectDir + ")";
            if (task.isWfnRebase()) label = "wfn_rebase=" + task.wfnRebaseFile;
            std::string sections = "[";
            for (const auto& process : task.postProcessSteps) {
                if (sections.size() > 1) sections += ',';
                sections += Gui::quote(process.first);
            }
            std::string command;
            for (const auto& line : task.commands) {
                const auto trimmed = Utils::trim(line);
                if (!trimmed.empty() && trimmed[0] != '#') { command = trimmed; break; }
            }
            steps += "{\"label\":" + Gui::quote(label) + ",\"kind\":" + Gui::quote(kind)
                + ",\"sections\":" + sections + "],\"command\":" + Gui::quote(command)
                + ",\"origin\":" + Gui::quote(task.origin) + "}";
        }
        trace.open(options.eventsJsonl, steps + "]");
        if (reportGrepSyntaxErrors(tasks)) {
            return false;
        }

        std::string automaticCitationOutput;
        if (!hasExplicitCitationOutputTask(tasks)) {
            automaticCitationOutput = options.citationsOutputSpecified
                ? options.citationsOutput
                : configManager.getConfig().citationsOutput;
            if (citationOutputDisabled(automaticCitationOutput)) {
                automaticCitationOutput.clear();
            }
        }
        std::set<std::string> automaticCitationOutputPaths;

        const bool requiresWavefunction = tasksRequireWavefunction(tasks);
        std::vector<std::string> wfnFiles;
        if (wfnPattern.empty()) {
            if (requiresWavefunction) {
                std::cerr << "Error: This workflow contains Multiwfn tasks but no wavefunction file was specified"
                          << std::endl;
                return false;
            }
            // Workflows without Multiwfn tasks deliberately execute once
            // with an empty wavefunction context.
            wfnFiles.push_back("");

        } else {
            // 展开通配符
            wfnFiles = Utils::expandWildcard(wfnPattern);
            if (wfnFiles.empty()) {
                std::cerr << "Error: No matching wavefunction files found for pattern: " << wfnPattern << std::endl;
                return false;
            }
        }

        if (wfnFiles.size() > 1) {
            std::cout << "Found " << wfnFiles.size() << " matching files:" << std::endl;
            for (const auto& f : wfnFiles) {
                std::cout << "  - " << f << std::endl;
            }
            std::cout << std::endl;
        }

        std::map<std::string, std::vector<std::string>> allCustomVars = options.customVars;
        const auto guiValues = Gui::readValues(options.parametersJson);
        Gui::variables(allCustomVars, guiValues);

        // Interactive variables: allow defining "var=?" at the top of input file
        // (or via -v/--var var=?) to request the value from user at runtime.
        //
        // Special handling:
        // - var*=?      -> collect var1, var2, ... and later expand ${var*} as multiple lines.
        // - len(var)=?  -> if paired with var*=?, prompt this count first and then ask exactly
        //                  that many varN values. Otherwise it behaves like a normal scalar prompt.
        if (options.batch) {
            for (const auto& variable : allCustomVars) {
                if (std::find(variable.second.begin(), variable.second.end(), "?") != variable.second.end()) {
                    std::cerr << "Error: --batch requires a value for " << variable.first << '\n';
                    return false;
                }
            }
        }
        if (!InputParser::resolveInteractiveCustomVars(allCustomVars)) {
            return false;
        }

        // Collect array variables and expand them as a Cartesian product.
        std::vector<std::string> arrayVarNames;
        for (const auto& var : allCustomVars) {
            if (var.second.size() > 1) {
                arrayVarNames.push_back(var.first);
            }
        }

        const auto variableCombinations = Utils::expandVariableCombinations(allCustomVars);
        const size_t combinationCount = variableCombinations.size();

        if (tasks.empty()) {
            std::cerr << "Error: No executable tasks found in inp file" << std::endl;
            return false;
        }

        // Collect all required modules and load configurations
        std::set<std::string> modules;
        for (const auto& task : tasks) {
            if (!task.moduleName.empty()) {
                modules.insert(task.moduleName);
            }
        }

        if (modules.empty()) {
            std::cout << "\nStandalone workflow: no module configuration required.\n";
        } else {
            std::cout << "\nRequired modules: ";
            for (const auto& mod : modules) {
                std::cout << mod << " ";
            }
            std::cout << "\n";
        }

        if (options.dryrun) {
            std::cout << "\n** DRY-RUN MODE: Only generating command files **\n" << std::endl;
        }
        if (options.screen) {
            std::cout << "\n** SCREEN MODE: Output to screen instead of files **\n" << std::endl;
        }

        const std::string inlineCitationCatalog =
            InlineConf::extractInlineCitationCatalog(inpFile);
        if (!inlineCitationCatalog.empty()) {
            if (!citationManager.loadCatalogFromText(
                    inlineCitationCatalog, inpFile + " (inline citations)")) {
                std::cerr << "Error: Failed to load inline citation catalog from "
                          << inpFile << std::endl;
                return false;
            }
            std::cout << "\nDetected inline citation catalog.\n";
        }

        // Try to load embedded inline conf blocks (if any)
        std::map<std::string, std::string> inlineConfs = InlineConf::extractInlineConfs(inpFile);
        if (!inlineConfs.empty()) {
            std::cout << "\nDetected inline conf blocks for modules: ";
            for (const auto& kv : inlineConfs) {
                if (!kv.first.empty()) {
                    std::cout << kv.first << " ";
                }
            }
            std::cout << "\n";
        }

        for (const auto& mod : modules) {
            auto it = inlineConfs.find(mod);
            if (it != inlineConfs.end() && !it->second.empty()) {
                // Inline conf has higher priority
                if (!configManager.loadModuleConfigFromText(mod, it->second, inpFile + " (inline)")) {
                    std::cerr << "Error: Failed to load inline module config for " << mod << std::endl;
                    return false;
                }
            } else {
                if (!loadModuleConfig(mod)) {
                    std::cerr << "Error: Failed to load module config for " << mod << std::endl;
                    return false;
                }
            }
        }

        if (citationManager.hasRecord("banewfn") &&
            !citationManager.use("banewfn", "Workflow execution and orchestration",
                                 "software:banewfn")) {
            return false;
        }

        // 对每个匹配的文件和每个变量组合执行任务
        bool allSuccess = true;
        for (size_t fileIdx = 0; fileIdx < wfnFiles.size(); fileIdx++) {
            std::string finalWfnFile = wfnFiles[fileIdx];

            // 对每个变量组合执行（多个数组变量时取笛卡尔积）
            for (size_t combinationIdx = 0; combinationIdx < combinationCount; combinationIdx++) {
                const auto& currentVars = variableCombinations[combinationIdx];

                // 显示当前执行信息
                if (wfnFiles.size() > 1 || combinationCount > 1) {
                    std::cout << "\n========================================" << std::endl;
                    if (wfnFiles.size() > 1) {
                        std::cout << "Processing file " << (fileIdx + 1) << "/" << wfnFiles.size()
                                  << ": " << finalWfnFile;
                    }
                    if (combinationCount > 1) {
                        if (wfnFiles.size() > 1) std::cout << " | ";
                        std::cout << "Combination " << (combinationIdx + 1) << "/" << combinationCount;
                        if (!arrayVarNames.empty()) {
                            std::cout << " (";
                            for (size_t i = 0; i < arrayVarNames.size(); i++) {
                                const auto& varName = arrayVarNames[i];
                                auto it = currentVars.find(varName);
                                if (i > 0) {
                                    std::cout << ", ";
                                }
                                std::cout << varName << "=";
                                if (it != currentVars.end() && !it->second.empty()) {
                                    std::cout << it->second[0];
                                }
                            }
                            std::cout << ")";
                        }
                    }
                    std::cout << std::endl;
                    std::cout << "========================================\n" << std::endl;
                }

                // 为当前文件和当前变量组合创建任务副本并应用占位符替换
                std::vector<ModuleTask> fileTasks = tasks;
                InputParser::applyPlaceholderReplacement(fileTasks, finalWfnFile, currentVars);
                Gui::apply(fileTasks, configManager, guiValues);
                std::string values = "{";
                for (const auto& variable : currentVars) {
                    if (values.size() > 1) values += ',';
                    values += Gui::quote(variable.first) + ":" + Gui::quote(variable.second.empty() ? "" : variable.second.front());
                }
                trace.iteration("\"file\":" + Gui::quote(finalWfnFile) + ",\"combination\":"
                    + std::to_string(combinationIdx + 1) + ",\"combinations\":" + std::to_string(combinationCount)
                    + ",\"variables\":" + values + "}", std::to_string(fileIdx + 1) + "-" + std::to_string(combinationIdx + 1));

                // Execute each module task in sequence, allowing wfn_rebase directives
                // to switch the file provided to subsequent Multiwfn invocations.
                std::string currentWfnFile = finalWfnFile;
                NewFileCollector collector;
                // Logical artifacts produced by builtin DSL blocks in this file/variable iteration.
                // They allow follow-up blocks such as grid=like(complex_den) to refer to earlier output.
                std::map<std::string, std::string> builtinArtifacts;
                bool iterationSuccess = true;

                // Track files only for tasks that have a later collect(...)
                // directive. This keeps workflows without collect unchanged and
                // avoids remembering files produced after the final collect.
                std::vector<bool> hasCollectAhead(fileTasks.size(), false);
                bool seenCollectAhead = false;
                for (size_t revIdx = fileTasks.size(); revIdx > 0; --revIdx) {
                    const size_t taskIdx = revIdx - 1;
                    hasCollectAhead[taskIdx] = seenCollectAhead;
                    if (fileTasks[taskIdx].isCollect()) {
                        seenCollectAhead = true;
                    }
                }

                for (size_t taskIdx = 0; taskIdx < fileTasks.size(); ++taskIdx) {
                    const auto& task = fileTasks[taskIdx];
                    trace.start(taskIdx);
                    if (task.isCollect()) {
                        trace.phase("collect");
                        const bool collected = collector.flushToDirectory(task.collectDir, options.dryrun, &trace);
                        trace.phaseDone(collected);
                        trace.finish(collected, options.dryrun);
                        if (!collected) {
                            allSuccess = false;
                            iterationSuccess = false;
                        }
                        continue;
                    }

                    if (task.isWfnRebase()) {
                        trace.phase("rebase");
                        std::string target = Utils::trim(task.wfnRebaseFile);
                        if (target.empty()) {
                            // Empty rebase target means reset to the original wfn of this iteration.
                            currentWfnFile = finalWfnFile;
                            std::cout << "\n>>> wfn_rebase: reset Multiwfn input to original: " << currentWfnFile << std::endl;
                        } else {
                            currentWfnFile = target;
                            std::cout << "\n>>> wfn_rebase: switch Multiwfn input to: " << currentWfnFile << std::endl;
                        }

                        // Warn if file does not exist (still continue; Multiwfn will report errors).
                        if (!options.dryrun && !Utils::fileExists(currentWfnFile)) {
                            std::cerr << "Warning: wfn_rebase target file not found: " << currentWfnFile << std::endl;
                        }
                        trace.phaseDone(true);
                        trace.finish(true, options.dryrun);
                        continue;
                    }

                    NewFileCollector::Snapshot beforeFiles;
                    bool shouldTrackNewFiles = hasCollectAhead[taskIdx] && !options.dryrun;
                    if (shouldTrackNewFiles) {
                        shouldTrackNewFiles = collector.captureSnapshot(beforeFiles);
                    }

                    bool taskSuccess = false;
                    if (task.isCitation()) {
                        trace.phase("citations");
                        taskSuccess = executeCitationTask(task);
                        trace.phaseDone(taskSuccess);
                    } else if (task.isCitationOutput()) {
                        trace.phase("citations");
                        taskSuccess = executeCitationOutputTask(task);
                        trace.phaseDone(taskSuccess);
                    } else if (task.isBuiltin()) {
                        trace.phase("builtin");
                        taskSuccess = executeBuiltinTask(task, currentWfnFile, cores, options, builtinArtifacts);
                        trace.phaseDone(taskSuccess);
                    } else {
                        trace.phase("validation");
                        const bool valid = validateConfiguredCitationsForTask(task);
                        trace.phaseDone(valid);
                        if (valid) {
                            taskSuccess = executeModuleTask(task, currentWfnFile, cores, options);
                        }
                    }

                    if (!taskSuccess) {
                        allSuccess = false;
                        iterationSuccess = false;
                    } else if (!task.isCitation() && !task.isCitationOutput()) {
                        trace.phase("citations");
                        const bool configCitationsOk =
                            registerSuccessfulConfigCitations(task);
                        const bool softwareCitationsOk =
                            registerSuccessfulSoftwareCitations(task);
                        if (!configCitationsOk || !softwareCitationsOk) {
                            allSuccess = false;
                            iterationSuccess = false;
                            taskSuccess = false;
                        }
                        trace.phaseDone(configCitationsOk && softwareCitationsOk);
                    }

                    if (shouldTrackNewFiles) {
                        trace.phase("tracking");
                        const bool remembered = collector.rememberNewFilesSince(beforeFiles, getTaskDisplayName(task),
                                                           task.isCitationOutput());
                        trace.phaseDone(remembered);
                        if (!remembered) {
                            allSuccess = false;
                            iterationSuccess = false;
                            taskSuccess = false;
                        }
                    }
                    trace.finish(taskSuccess, options.dryrun);
                }

                if (iterationSuccess && !automaticCitationOutput.empty()) {
                    const std::string outputPath = resolveAutomaticCitationOutput(
                        automaticCitationOutput, finalWfnFile, currentVars);
                    if (outputPath.empty()) {
                        std::cerr << "Error: citations_output resolved to an empty path" << std::endl;
                        allSuccess = false;
                    } else {
                        automaticCitationOutputPaths.insert(outputPath);
                    }
                }
            }
        }

        if (allSuccess && citationManager.usedCitationCount() > 0) {
            for (const auto& outputPath : automaticCitationOutputPaths) {
                if (!citationManager.writeBibTeX(outputPath)) {
                    allSuccess = false;
                    break;
                }
                printSuccessLine("Automatic BibTeX file written: " + outputPath);
            }
        }

        if (allSuccess) {
            std::cout << "\nAll done." << std::endl;
        } else {
            printFailureLine("Some modules execution failed");
        }

        if (citationManager.usedCitationCount() > 0) {
            std::cout << std::endl;
            citationManager.printSummary(std::cout);
        }

        return allSuccess;
    }

    int getCores() const { return configManager.getCores(); }
};

void printUsage(const char* progName) {
    std::cout << "Hmm... You need some advice? No problem, Bane will help you! :)\n";
    std::cout << "Usage: " << progName << " <input.inp> <molecule.fchk> [options]\n";
    std::cout << "       " << progName << " -w <molecule.fchk> <input.inp> [options]\n";
    std::cout << "       " << progName << " <input.inp> [options]  # standalone citation/%grep/%command\n";
    std::cout << "\nOptions:\n";
    std::cout << "  -l, --list          List available module conf names or show a conf summary\n";
    std::cout << "  -c, --cores <num>   Specify the number of CPU cores to use\n";
    std::cout << "  -d, --dryrun        Generate command files only, don't execute (skip wait tasks)\n";
    std::cout << "  -e, --extargs <args> Pass extra arguments to Multiwfn (use quotes for multiple args)\n";
    std::cout << "      --no-color     Disable colored status output\n";
    std::cout << "  -s, --screen        Display output on screen instead of redirecting to files\n";
    std::cout << "  -n, --nogui         Run Multiwfn in silent mode\n";
    std::cout << "  -w, --wfn <file>    Specify wavefunction file (.fchk/.wfn or other supported file)\n";
    std::cout << "  -v, --var <key=val> Set custom variable for placeholder replacement (can be used multiple times)\n";
    std::cout << "  --batch            Noninteractive execution; reject terminal-dependent workflows\n";
    std::cout << "  --inspect-json     Describe parameters and native input without executing commands\n";
    std::cout << "  --catalog-json     Describe conf modules and documentation without executing commands\n";
    std::cout << "  --plan-json        List input matches, file bindings and variable combination count\n";
    std::cout << "  --conf-dir <path>  Module directory for --inspect-json\n";
    std::cout << "  --parameters-json <file> Apply scoped GUI parameter values from a JSON object\n";
    std::cout << "  --events-jsonl <file> Write structured execution steps and log offsets\n";
    std::cout << "  -V, --version       Show version information\n";
    std::cout << "  -h, --help          Show this help message\n";
    std::cout << "\nInput header reserved words:\n";
    std::cout << "  wfn=..., core=..., dryrun=on/true, debug=false/true, nogui=on/true, wfn_rebase=...\n";
    std::cout << "\nInput block hints:\n";
    std::cout << "  %command ... end    Run shell/batch post-commands\n";
    std::cout << "  %preraw ... end/wait Send literal Multiwfn commands before [main]\n";
    std::cout << "  %raw ... end/wait   Send literal Multiwfn commands\n";
    std::cout << "  %grep ... end       Extract text/records from the current output or from <file>\n";
    std::cout << "  collect(dir);       Move files newly created by preceding blocks into dir\n";
    std::cout << "  bane.cite id { ... }             Declare a workflow citation\n";
    std::cout << "  bane.citations.write id { ... }  Write plain or BibTeX citations\n";
    std::cout << "  bane.wfn.promolecule id { ... }  Build a promolecular wavefunction from fragment FCHK files\n";
    std::cout << "  bane.cube.make id { ... }     Generate cube data via Multiwfn main function 5\n";
    std::cout << "  bane.line.profile id { ... }  Preload an interactive 1D line profile via main function 3\n";
    std::cout << "  bane.plane.map id { ... }     Generate/export a 2D plane map via main function 4\n";
    std::cout << "\nExamples:\n";
    std::cout << "  " << progName << " input.inp molecule.fchk\n";
    std::cout << "  " << progName << " -w molecule.fchk input.inp\n";
    std::cout << "  " << progName << " input.inp molecule.fchk -c 8\n";
    std::cout << "  " << progName << " input.inp -w molecule.fchk --dryrun\n";
    std::cout << "  " << progName << " input.inp molecule.fchk --screen\n";
    std::cout << "  " << progName << " -w molecule.fchk input.inp -d -s -c 8\n";
    std::cout << "  " << progName << " input.inp molecule.fchk -v myvar=value -v other=123\n";
    std::cout << "  " << progName << " input.inp molecule.fchk -e \"-silent -nt 4\"\n";
    std::cout << "  # input.inp header: dryrun=on, debug=true, nogui=on\n";
}

int BaneWfn::run(int argc, char* argv[]) try {
    for (int i = 1; i < argc; ++i)
        if (std::string(argv[i]) == "--catalog-json") return Gui::catalog(argc, argv);
    for (int i = 1; i < argc; ++i)
        if (std::string(argv[i]) == "--plan-json") return Gui::plan(argc, argv);
    for (int i = 1; i < argc; ++i)
        if (std::string(argv[i]) == "--inspect-json") return Gui::inspect(argc, argv);
#ifdef _WIN32
    // Ensure Windows console uses UTF-8 for input/output to avoid garbled ASCII art
    // and other UTF-8 text when double-click launching.
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);
#endif
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "-V" || arg == "--version") {
            std::cout << "banewfn " << UI::getVersionString() << std::endl;
            return 0;
        }
    }

    // Print ASCII logo on startup
    UI::printLogo();

    std::string inpFile;
    std::string wfnFile;
    std::string wfnParam;  // Store wfn parameter from -w/--wfn
    int cores = -1;
    ExecutionOptions options;

    // Parse command line arguments
    std::vector<std::string> positionalArgs;

    for (int i = 1; i < argc; i++) {
        std::string arg = argv[i];

        if (arg == "-h" || arg == "--help") {
            printUsage(argv[0]);
            return 0;
        } else if (arg == "-l" || arg == "--list") {
            // List available conf files or show a summary for a specific conf
            std::string moduleArg;
            if (i + 1 < argc && argv[i + 1][0] != '-') {
                moduleArg = argv[i + 1];
                i++;
            }

            // Find and load banewfn.rc to get confPath
            std::string configFile = findConfigFile(argv[0]);
            if (configFile.empty()) {
                std::cerr << "Error: Could not find banewfn.rc to determine conf path\n";
                return 1;
            }
            ConfigManager tmpCm;
            if (!tmpCm.loadBaneWfnConfig(configFile)) {
                return 1;
            }
            std::string confDir = tmpCm.getConfig().confPath;

            if (moduleArg.empty()) {
                // List all .conf names under confDir
                std::string pattern = confDir;
                if (!pattern.empty() && pattern.back() != '/') pattern += "/";
                pattern += "*.conf";
                std::vector<std::string> files = Utils::expandWildcard(pattern);
                if (files.empty()) {
                    std::cout << "No .conf files found in: " << confDir << std::endl;
                } else {
                    std::cout << "Available module configs in " << confDir << ":\n";
                    for (const auto &f : files) {
                        std::cout << "  " << Utils::getBaseName(f) << std::endl;
                    }
                }
                return 0;
            } else {
                // Show a compact summary for the specified conf
                if (!tmpCm.loadModuleConfig(moduleArg)) {
                    std::cerr << "Error: Failed to load module config for: " << moduleArg << std::endl;
                    return 1;
                }
                const ModuleConfig &mc = tmpCm.getModuleConfig(moduleArg);
                std::cout << "[" << moduleArg << ".conf] summary (section -> variables):\n";
                // Show defined sections and list variable names discovered from defaults and commands
                for (const auto &secPair : mc.sections) {
                    const std::string &sectionName = secPair.first;
                    const Section &section = secPair.second;
                    std::set<std::string> vars;
                    // add defaults keys
                    for (const auto &d : section.defaults) {
                        vars.insert(d.first);
                    }
                    // scan commands for $ placeholders
                    for (const auto &cmdLine : section.commands) {
                        collectPlaceholderNames(cmdLine, vars);
                    }
                    for (const auto& binding : mc.citationBindings) {
                        if (std::find(binding.targets.begin(), binding.targets.end(),
                                      sectionName) != binding.targets.end()) {
                            collectPlaceholderNames(binding.reason, vars);
                        }
                    }

                    // Print section and variables aligned in two columns (first column fixed width)
                    const size_t nameWidth = 12;
                    if (sectionName.length() >= nameWidth) {
                        std::cout << "  " << sectionName;
                        // ensure spacing before vars
                        std::cout << std::string(4, ' ');
                    } else {
                        std::cout << "  " << std::left << std::setw(static_cast<int>(nameWidth)) << sectionName << " ";
                        // reset formatting
                        std::cout << std::right;
                    }
                    if (!vars.empty()) {
                        size_t shown = 0;
                        for (const auto &v : vars) {
                            if (shown++) std::cout << "; ";
                            std::cout << v;
                        }
                    }
                    std::cout << "\n";
                }
                // Do not display quit commands in -l summary
                return 0;
            }
        } else if (arg == "-c" || arg == "--cores") {
            if (i + 1 < argc) {
                if (!Utils::tryParseNonNegativeInt(argv[i + 1], cores)) {
                    std::cerr << "Error: -c/--cores requires a non-negative integer, got: "
                              << argv[i + 1] << std::endl;
                    return 1;
                }
                i++;
            } else {
                std::cerr << "Error: -c/--cores requires an argument" << std::endl;
                return 1;
            }
        } else if (arg == "-d" || arg == "--dryrun") {
            options.dryrun = true;
        } else if (arg == "--no-color") {
            options.noColor = true;
        } else if (arg == "-s" || arg == "--screen") {
            options.screen = true;
        } else if (arg == "--batch") {
            options.batch = true;
            options.nogui = true;
        } else if (arg == "-n" || arg == "--nogui") {
            options.nogui = true;
        } else if (arg == "-e" || arg == "--extargs") {
            if (i + 1 < argc) {
                std::string extArgsStr = argv[i + 1];
                // Parse the extargs string, supporting quotes
                std::vector<std::string> parsedArgs = Utils::parseCommandLineArgs(extArgsStr);
                options.extargs.insert(options.extargs.end(), parsedArgs.begin(), parsedArgs.end());
                i++;
            } else {
                std::cerr << "Error: -e/--extargs requires an argument" << std::endl;
                return 1;
            }
        } else if (arg == "-w" || arg == "--wfn") {
            if (i + 1 < argc) {
                wfnParam = argv[i + 1];
                i++;
            } else {
                std::cerr << "Error: -w/--wfn requires an argument" << std::endl;
                return 1;
            }
        } else if (arg == "--parameters-json") {
            if (++i == argc) { std::cerr << "Missing parameters JSON file\n"; return 2; }
            options.parametersJson = argv[i];
        } else if (arg == "--events-jsonl") {
            if (++i == argc) { std::cerr << "Missing execution trace file\n"; return 2; }
            options.eventsJsonl = argv[i];
        } else if (arg == "-v" || arg == "--var") {
            if (i + 1 < argc) {
                std::string varArg = argv[i + 1];
                size_t eqPos = varArg.find('=');
                if (eqPos != std::string::npos && eqPos > 0 && eqPos < varArg.length() - 1) {
                    std::string key = Utils::trim(varArg.substr(0, eqPos));
                    std::string value = Utils::trim(varArg.substr(eqPos + 1));

                    if (VariableSyntax::isValidCustomVariableName(key)) {
                        if (VariableSyntax::isListVariableName(key)) {
                            options.customVars[key] = {value};
                        } else if (VariableSyntax::isLengthVariableName(key)) {
                            options.customVars[key] = {value};
                        } else {
                            // Parse value as bash array (supports both array and single value)
                            options.customVars[key] = Utils::parseBashArray(value);
                        }
                    } else {
                        std::cerr << "Warning: Invalid variable name: " << key << std::endl;
                    }
                } else {
                    std::cerr << "Error: -v/--var requires format key=value" << std::endl;
                    return 1;
                }
                i++;
            } else {
                std::cerr << "Error: -v/--var requires an argument" << std::endl;
                return 1;
            }
        } else if (!arg.empty() && arg[0] == '-') {
            std::cerr << "Error: Unknown option: " << arg << std::endl;
            return 1;
        } else {
            // This is a positional argument
            positionalArgs.push_back(arg);
        }
    }

    // Handle positional arguments
    if (positionalArgs.size() >= 1) {
        inpFile = positionalArgs[0];
    } else {
        if (options.batch) {
            std::cerr << "Error: --batch requires a workflow file\n";
            return 2;
        }
        inpFile = UI::requestInputFile();
        if (inpFile.empty()) {
            return 1;
        }
    }

    // Check if input file contains wfn definition, core setting, and custom variables
    ParsedInputFile parsedInput = InputParser::parseInpFileDetailed(inpFile);
    if (!parsedInput.loaded) {
        return 1;
    }
    options.debug = parsedInput.debug;
    if (options.batch) {
        if (parsedInput.debug) {
            std::cerr << "Error: debug mode requires a terminal; disable it for --batch.\n";
            return 2;
        }
        for (const auto& task : parsedInput.tasks) {
            if (task.useWait) {
                std::cerr << "Error: wait requires a terminal; use end for --batch.\n";
                return 2;
            }
        }
    }
    if (reportGrepSyntaxErrors(parsedInput.tasks)) {
        pauseBeforeExit(options);
        return 1;
    }

    const std::string& inputWfnFile = parsedInput.wfnFile;
    int inputCores = parsedInput.cores;
    const auto& inputVars = parsedInput.customVars;
    bool inputDryrun = parsedInput.dryrun;
    bool inputDebug = parsedInput.debug;
    bool inputNogui = parsedInput.nogui;
    options.citationsOutput = parsedInput.citationsOutput;
    options.citationsOutputSpecified = parsedInput.citationsOutputSpecified;
    const bool requiresWavefunction = tasksRequireWavefunction(parsedInput.tasks);

    if (inputDryrun) {
        options.dryrun = true;
        std::cout << "Dry-run mode enabled by input header." << std::endl;
    }
    if (inputDebug) {
        options.debug = true;
        std::cout << "Debug mode enabled by input header." << std::endl;
    }
    if (inputNogui) {
        options.nogui = true;
        std::cout << "No-GUI mode enabled by input header." << std::endl;
    }

    initializeColorOutput(options);

    // Merge input file variables with command line variables (command line takes precedence)
    for (const auto& var : inputVars) {
        if (options.customVars.find(var.first) == options.customVars.end()) {
            options.customVars[var.first] = var.second;
        }
    }

    // Priority order: 1) -w/--wfn parameter, 2) positional argument, 3) input file, 4) interactive input
    if (!wfnParam.empty()) {
        wfnFile = wfnParam;
        std::cout << "Using wavefunction file from -w/--wfn parameter: " << wfnFile << std::endl;
    } else if (positionalArgs.size() >= 2) {
        wfnFile = positionalArgs[1];
    } else if (inputWfnFile.empty()) {
        // Workflows without Multiwfn tasks do not need a wavefunction file.
        if (requiresWavefunction) {
            if (options.batch) {
                std::cerr << "Error: --batch requires a startup file; use --wfn or wfn=\n";
                return 2;
            }
            wfnFile = UI::requestWavefunctionFile();
            if (wfnFile.empty()) {
                return 1;
            }
        }
    } else {
        // Use wfn file from input file
        wfnFile = inputWfnFile;
        std::cout << "Using wavefunction file from input: " << wfnFile << std::endl;
    }

    WorkflowRunner runner;

    // Multiwfn/module workflows require banewfn.rc. Standalone workflows load
    // it opportunistically so that a global citations_output default can still
    // apply, while retaining the historical ability to run without an rc file.
    const std::string configFile = findConfigFile(argv[0], requiresWavefunction);
    if (configFile.empty()) {
        if (requiresWavefunction) {
            std::cerr << "Error: Could not find banewfn.rc in any of the search locations" << std::endl;
            std::cerr << "Please create the config file in one of the following locations:" << std::endl;
            std::cerr << "  - Current directory: ./banewfn.rc" << std::endl;
            std::cerr << "  - Executable directory: <exe_dir>/banewfn.rc" << std::endl;
            std::cerr << "  - Home directory: ~/.bane/wfn/banewfn.rc" << std::endl;
            pauseBeforeExit(options);
            return 1;
        }
    } else if (!runner.loadBaneWfnConfig(configFile, requiresWavefunction)) {
        pauseBeforeExit(options);
        return 1;
    }

    // If cores not specified, use input file setting or default value from banewfn.rc
    if (cores < 0) {
        if (inputCores > 0) {
            cores = inputCores;
            std::cout << "Using core count from input file: " << cores << std::endl;
        } else if (requiresWavefunction) {
            cores = runner.getCores();
        } else {
            cores = 1;
        }
    }

    // Execute all module tasks
    if (!runner.executeAllTasks(parsedInput.tasks, inpFile, wfnFile, cores, options)) {
        pauseBeforeExit(options);
        return 1;
    }

    pauseBeforeExit(options);
    return 0;
} catch (const std::exception& error) {
    std::cerr << "Error: " << error.what() << '\n';
    return 2;
}
