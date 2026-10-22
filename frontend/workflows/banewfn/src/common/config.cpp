#include "common/config.h"
#include "common/gui.h"
#include "common/utils.h"
#include <iostream>
#include <fstream>
#include <sstream>
#include <cstdlib>
#include <unistd.h>
#include <libgen.h>
#include <limits.h>
#include <cctype>
#include <algorithm>
#include <set>

#ifdef PLATFORM_WINDOWS
#include <windows.h>
#include <direct.h>
#ifndef PATH_MAX
#define PATH_MAX MAX_PATH
#endif
#endif

namespace {

std::vector<std::string> parseListLiteral(const std::string& rawValue) {
    const std::string trimmedValue = Utils::trim(rawValue);
    if (trimmedValue.empty()) {
        return {};
    }
    return Utils::parseBashArray(trimmedValue);
}

std::vector<std::string> collectListValues(const std::map<std::string, std::string>& params,
                                           const std::string& baseName) {
    const auto directIt = params.find(baseName + "*");
    if (directIt != params.end()) {
        const std::vector<std::string> directValues = parseListLiteral(directIt->second);
        if (!directValues.empty()) {
            return directValues;
        }
    }

    std::vector<std::pair<int, std::string>> indexedValues;
    for (const auto& kv : params) {
        std::string indexedBase;
        int index = 0;
        if (VariableSyntax::parseIndexedVariableName(kv.first, &indexedBase, &index) &&
            indexedBase == baseName) {
            indexedValues.push_back({index, kv.second});
        }
    }

    std::sort(indexedValues.begin(), indexedValues.end(),
              [](const auto& lhs, const auto& rhs) { return lhs.first < rhs.first; });

    std::vector<std::string> values;
    values.reserve(indexedValues.size());
    for (const auto& item : indexedValues) {
        values.push_back(item.second);
    }
    return values;
}

std::string resolveScalarPlaceholderValue(const std::string& varName,
                                          const std::string& defaultValue,
                                          const std::map<std::string, std::string>& params) {
    const auto it = params.find(varName);
    if (it != params.end() && !it->second.empty()) {
        if (VariableSyntax::isListVariableName(varName)) {
            const std::string baseName = varName.substr(0, varName.size() - 1);
            const std::vector<std::string> values = collectListValues(params, baseName);
            if (!values.empty()) {
                return VariableSyntax::serializeListValues(values);
            }
        }
        return it->second;
    }

    std::string baseName;
    if (VariableSyntax::isLengthVariableName(varName, &baseName)) {
        const std::vector<std::string> values = collectListValues(params, baseName);
        if (!values.empty()) {
            return std::to_string(values.size());
        }
    }

    if (VariableSyntax::isListVariableName(varName, &baseName)) {
        const std::vector<std::string> values = collectListValues(params, baseName);
        if (!values.empty()) {
            return VariableSyntax::serializeListValues(values);
        }
    }

    if (!defaultValue.empty()) {
        if (VariableSyntax::isListVariableName(varName)) {
            return VariableSyntax::serializeListValues(parseListLiteral(defaultValue));
        }
        return defaultValue;
    }

    return "";
}

bool tokenizeCitationBinding(const std::string& line,
                             std::vector<std::string>& tokens,
                             std::string& error) {
    tokens.clear();
    error.clear();

    std::string current;
    bool inSingleQuote = false;
    bool inDoubleQuote = false;
    bool escaping = false;

    for (char c : line) {
        if (escaping) {
            current.push_back(c);
            escaping = false;
            continue;
        }

        if (c == '\\') {
            escaping = true;
            continue;
        }

        if (!inDoubleQuote && c == '\'') {
            inSingleQuote = !inSingleQuote;
            continue;
        }
        if (!inSingleQuote && c == '"') {
            inDoubleQuote = !inDoubleQuote;
            continue;
        }

        if (!inSingleQuote && !inDoubleQuote &&
            std::isspace(static_cast<unsigned char>(c))) {
            if (!current.empty()) {
                tokens.push_back(current);
                current.clear();
            }
            continue;
        }

        current.push_back(c);
    }

    if (escaping) {
        current.push_back('\\');
    }
    if (inSingleQuote || inDoubleQuote) {
        error = "unterminated quoted value";
        return false;
    }
    if (!current.empty()) {
        tokens.push_back(current);
    }
    return true;
}

bool parseCitationBinding(const std::string& line,
                          std::size_t lineNumber,
                          ConfigCitationBinding& binding,
                          std::string& error) {
    binding = ConfigCitationBinding();
    binding.lineNumber = lineNumber;

    std::vector<std::string> tokens;
    if (!tokenizeCitationBinding(line, tokens, error)) {
        return false;
    }
    if (tokens.empty()) {
        error = "empty citation binding";
        return false;
    }

    binding.id = Utils::trim(tokens.front());
    if (binding.id.empty() || binding.id.front() == '@' ||
        binding.id.find('=') != std::string::npos) {
        error = "the first field must be a citation id";
        return false;
    }
    if (binding.id.find('$') != std::string::npos) {
        error = "citation ids must be static";
        return false;
    }

    std::set<std::string> seenTargets;
    bool seenReason = false;
    for (std::size_t i = 1; i < tokens.size(); ++i) {
        const std::string token = Utils::trim(tokens[i]);
        if (token.empty()) {
            continue;
        }

        if (token.front() == '@') {
            if (seenReason) {
                error = "section selectors must appear before reason=";
                return false;
            }
            const std::string target = Utils::trim(token.substr(1));
            if (target.empty()) {
                error = "empty section selector";
                return false;
            }
            if (target.find('$') != std::string::npos) {
                error = "section selectors must be static";
                return false;
            }
            if (target == "quit" || target == "citations") {
                error = "citation bindings may target executable sections only";
                return false;
            }
            if (seenTargets.insert(target).second) {
                binding.targets.push_back(target);
            }
            continue;
        }

        const std::size_t eqPos = token.find('=');
        if (eqPos == std::string::npos) {
            error = "expected @section or reason=<text>";
            return false;
        }

        const std::string key = Utils::toLowerAscii(Utils::trim(token.substr(0, eqPos)));
        if (key != "reason") {
            error = "unknown citation binding field '" + key + "'";
            return false;
        }
        if (seenReason) {
            error = "reason= may be specified only once";
            return false;
        }
        binding.reason = token.substr(eqPos + 1);
        seenReason = true;
    }

    if (binding.targets.empty()) {
        error = "at least one @section selector is required";
        return false;
    }
    return true;
}

} // namespace

// Utility function: trim whitespace from string (deprecated - use Utils::trim instead)
std::string trim(const std::string& str) {
    return Utils::trim(str);
}

// Utility function: expand ~ and $HOME/${HOME}
std::string expandPath(const std::string& path) {
    if (path.empty()) {
        return path;
    }

    // Resolve HOME directory
    const char* homeEnv = getenv("HOME");
#ifdef PLATFORM_WINDOWS
    if (!homeEnv) {
        homeEnv = getenv("USERPROFILE");
    }
#endif
    const std::string homeDir = homeEnv ? std::string(homeEnv) : std::string("");

    std::string result = path;

    // Expand leading ~ (e.g., ~/foo or ~)
    if (!homeDir.empty() && result[0] == '~') {
        // Replace only the first character '~'
        result = homeDir + result.substr(1);
    }

    // Expand $HOME occurrences
    if (!homeDir.empty()) {
        // Replace ${HOME}
        std::string keyBraced = "${HOME}";
        size_t pos = 0;
        while ((pos = result.find(keyBraced, pos)) != std::string::npos) {
            result.replace(pos, keyBraced.size(), homeDir);
            pos += homeDir.size();
        }
        // Replace $HOME (avoid overlapping with ${HOME} which is already handled)
        std::string keySimple = "$HOME";
        pos = 0;
        while ((pos = result.find(keySimple, pos)) != std::string::npos) {
            result.replace(pos, keySimple.size(), homeDir);
            pos += homeDir.size();
        }
    }

    return result;
}

// Utility function: get executable directory path
std::string getExecutableDir() {
#ifdef PLATFORM_WINDOWS
    char result[MAX_PATH] = {};
    DWORD count = GetModuleFileNameA(NULL, result, MAX_PATH);
    if (count != 0 && count < MAX_PATH) {
        // Extract directory from full path
        char drive[_MAX_DRIVE];
        char dir[_MAX_DIR];
        char fname[_MAX_FNAME];
        char ext[_MAX_EXT];
        _splitpath_s(result, drive, _MAX_DRIVE, dir, _MAX_DIR, fname, _MAX_FNAME, ext, _MAX_EXT);

        std::string fullPath = std::string(drive) + std::string(dir);
        // Remove trailing backslash
        if (!fullPath.empty() && (fullPath.back() == '\\' || fullPath.back() == '/')) {
            fullPath.pop_back();
        }
        return fullPath;
    }
    return "";
#else
    char result[PATH_MAX + 1] = {};
    const ssize_t count = readlink("/proc/self/exe", result, PATH_MAX);

    if (count > 0 && count <= PATH_MAX) {
        result[count] = '\0';
        char* dir = dirname(result);
        return std::string(dir);
    }

    // The caller can fall back to the argv[0] path when this lookup fails.
    return "";
#endif
}

// Utility function: check if file exists (deprecated - use Utils::fileExists instead)
bool fileExists(const std::string& filepath) {
    return Utils::fileExists(filepath);
}

// Utility function: find config file with priority
std::string findConfigFile(const std::string& executablePath, bool verbose) {
    std::vector<std::string> searchPaths;

    // Priority 1: Current directory
    searchPaths.push_back("./banewfn.rc");

    // Priority 2: Executable directory. Platform APIs are preferred; argv[0]
    // remains a useful fallback on systems without /proc/self/exe.
    std::string execDir = getExecutableDir();
    if (execDir.empty()) {
        const std::size_t lastSlash = executablePath.find_last_of("/\\");
        if (lastSlash != std::string::npos) {
            execDir = executablePath.substr(0, lastSlash);
        }
    }
    if (!execDir.empty()) {
        searchPaths.push_back(execDir + "/banewfn.rc");
    }

    // Priority 3: ~/.bane/wfn
    searchPaths.push_back(expandPath("~/.bane/wfn/banewfn.rc"));

#ifndef PLATFORM_WINDOWS
    // Priority 4: system config installed by CMake, plus prefix-relative
    // fallbacks for staged installs and non-default prefixes.
#ifdef BANEWFN_SYSTEM_RC_PATH
    searchPaths.push_back(BANEWFN_SYSTEM_RC_PATH);
#endif
#ifdef BANEWFN_SYSTEM_SHARE_RC_PATH
    searchPaths.push_back(BANEWFN_SYSTEM_SHARE_RC_PATH);
#endif
    if (!execDir.empty()) {
        searchPaths.push_back(execDir + "/../etc/banewfn/banewfn.rc");
        searchPaths.push_back(execDir + "/../share/banewfn/conf/banewfn.rc");
    }
#endif

    if (verbose) {
        std::cout << "Searching for banewfn.rc in the following locations:" << std::endl;
        for (const auto& path : searchPaths) {
            std::cout << "  - " << path << std::endl;
        }
        std::cout << std::endl;
    }

    for (const auto& path : searchPaths) {
        if (Utils::fileExists(path)) {
            if (verbose) {
                std::cout << "Found: " << path << std::endl;
            }
            return path;
        }
    }

    return "";
}

// Compatibility shim; new code should use Utils::getBaseName directly.
std::string getBaseName(const std::string& filepath) {
    return Utils::getBaseName(filepath);
}

// Load banewfn.rc configuration file
bool ConfigManager::loadBaneWfnConfig(const std::string& configFile, bool requireMultiwfnExec) {
    std::ifstream file(expandPath(configFile));
    if (!file.is_open()) {
        std::cerr << "Error: Cannot open config file: " << configFile << std::endl;
        return false;
    }

    std::string line;
    while (std::getline(file, line)) {
        line = Utils::trim(line);

        // 去除行内注释
        line = Utils::removeInlineComment(line);

        if (line.empty()) continue;

        size_t pos = line.find('=');
        if (pos != std::string::npos) {
            std::string key = Utils::trim(line.substr(0, pos));
            std::string value = Utils::trim(line.substr(pos + 1));

            if (key == "Multiwfn_exec") {
                config.multiwfnExec = expandPath(Utils::trimQuotes(value));
            } else if (key == "confpath") {
                config.confPath = expandPath(Utils::trimQuotes(value));
            } else if (key == "cores") {
                int parsedCores = 0;
                if (Utils::tryParseNonNegativeInt(value, parsedCores)) {
                    config.cores = parsedCores;
                } else {
                    std::cerr << "Warning: Invalid cores value in config file: "
                              << value << ". Keeping default: " << config.cores << std::endl;
                }
            } else if (key == "citations_output") {
                config.citationsOutput = expandPath(Utils::trimQuotes(value));
            } else if (key == "gitbash_exec") {
#ifdef PLATFORM_WINDOWS
                config.gitbashExec = expandPath(Utils::trimQuotes(value));
#else
                // Ignore on non-Windows platforms
#endif
            }
        }
    }

    file.close();

    if (requireMultiwfnExec && config.multiwfnExec.empty()) {
        std::cerr << "Error: Multiwfn_exec not specified in config file" << std::endl;
        return false;
    }

    if (config.confPath.empty()) {
        config.confPath = expandPath("~/.bane/wfn");
    }

    return true;
}

// Shared parser for module config (from file or inline text)
bool ConfigManager::parseModuleConfigStream(std::istream& in, const std::string& moduleName, const std::string& origin) {
    ModuleConfig modConfig;
    modConfig.origin = origin;
    const std::string source((std::istreambuf_iterator<char>(in)), {});
    Gui::parseMetadata(source, modConfig);
    std::istringstream commandsStream(source);
    std::string line;
    std::string currentSection;
    bool inDefaultBlock = false;
    bool inQuitSection = false;
    bool inCitationSection = false;
    std::size_t lineNumber = 0;
    bool ok = true;

    while (std::getline(commandsStream, line)) {
        ++lineNumber;
        line = Utils::trim(line);

        // 去除行内注释
        line = Utils::removeInlineComment(line);

        if (line.empty()) continue;

        // Section header [section_name]
        if (line[0] == '[' && line[line.length()-1] == ']') {
            currentSection = Utils::trim(line.substr(1, line.length() - 2));

            // Special handling for quit section
            if (currentSection == "quit") {
                inQuitSection = true;
                inCitationSection = false;
                inDefaultBlock = false;
            } else if (currentSection == "citations") {
                inQuitSection = false;
                inCitationSection = true;
                inDefaultBlock = false;
            } else {
                modConfig.sections[currentSection] = Section();
                inQuitSection = false;
                inCitationSection = false;
                inDefaultBlock = false;
            }
            continue;
        }

        if (inCitationSection) {
            if (line == "-default-") {
                std::cerr << "Error: [citations] does not support -default- at "
                          << origin << ":" << lineNumber << std::endl;
                ok = false;
                continue;
            }

            ConfigCitationBinding binding;
            std::string error;
            if (!parseCitationBinding(line, lineNumber, binding, error)) {
                std::cerr << "Error: Invalid citation binding at " << origin << ":"
                          << lineNumber << ": " << error << std::endl;
                ok = false;
                continue;
            }

            const bool duplicate = std::any_of(
                modConfig.citationBindings.begin(), modConfig.citationBindings.end(),
                [&](const ConfigCitationBinding& existing) {
                    return Utils::toLowerAscii(Utils::trim(existing.id)) ==
                               Utils::toLowerAscii(Utils::trim(binding.id)) &&
                           existing.targets == binding.targets &&
                           Utils::trim(existing.reason) == Utils::trim(binding.reason);
                });
            if (!duplicate) {
                modConfig.citationBindings.push_back(binding);
            }
            continue;
        }

        // Default value block
        if (line == "-default-") {
            if (!inQuitSection) {
                inDefaultBlock = true;
            }
            continue;
        }

        // Handle quit section commands
        if (inQuitSection) {
            modConfig.quitCommands.push_back(line);
            continue;
        }

        // Handle regular sections
        if (!currentSection.empty()) {
            if (inDefaultBlock) {
                size_t pos = line.find('=');
                if (pos != std::string::npos) {
                    std::string key = Utils::trim(line.substr(0, pos));
                    std::string value = Utils::trim(line.substr(pos + 1));
                    if (value.length() >= 2 && value[0] == '"' && value[value.length()-1] == '"') {
                        value = value.substr(1, value.length() - 2);
                    }
                    modConfig.sections[currentSection].defaults[key] = value;
                }
            } else {
                modConfig.sections[currentSection].commands.push_back(line);
            }
        }
    }

    // If no quit section defined, use default value
    if (modConfig.quitCommands.empty()) {
        std::cout << "Warning: Module " << moduleName << " does not define [quit] section (" << origin << ")." << std::endl;
        modConfig.quitCommands.push_back("q");
    }

    for (const auto& binding : modConfig.citationBindings) {
        for (const auto& target : binding.targets) {
            if (modConfig.sections.find(target) == modConfig.sections.end()) {
                std::cerr << "Error: Citation '" << binding.id << "' at " << origin
                          << ":" << binding.lineNumber << " targets unknown section ["
                          << target << "]" << std::endl;
                ok = false;
            }
        }
    }

    if (ok) {
        moduleConfigs[moduleName] = modConfig;
    }
    return ok;
}

// Load module-specific conf file
bool ConfigManager::loadModuleConfig(const std::string& moduleName) {
    // If already loaded, return directly
    if (moduleConfigs.find(moduleName) != moduleConfigs.end()) {
        return true;
    }

    std::string confFile = config.confPath + "/" + moduleName + ".conf";
    std::ifstream file(confFile);
    if (!file.is_open()) {
        std::cerr << "Error: Cannot open module config file: " << confFile << std::endl;
        return false;
    }

    std::cout << "Loading module configuration: " << confFile << std::endl;

    bool ok = parseModuleConfigStream(file, moduleName, confFile);
    file.close();
    return ok;
}

bool ConfigManager::loadModuleConfigFromText(const std::string& moduleName, const std::string& confText, const std::string& origin) {
    // If already loaded, return directly
    if (moduleConfigs.find(moduleName) != moduleConfigs.end()) {
        return true;
    }

    std::istringstream iss(confText);
    std::cout << "Loading module configuration for " << moduleName << " from " << origin << std::endl;
    return parseModuleConfigStream(iss, moduleName, origin);
}

// Get module configuration
const ModuleConfig& ConfigManager::getModuleConfig(const std::string& moduleName) const {
    static ModuleConfig emptyConfig;
    auto it = moduleConfigs.find(moduleName);
    if (it != moduleConfigs.end()) {
        return it->second;
    }
    return emptyConfig;
}

// Check if module configuration exists
bool ConfigManager::hasModuleConfig(const std::string& moduleName) const {
    return moduleConfigs.find(moduleName) != moduleConfigs.end();
}

// Replace placeholders in command string
std::string replacePlaceholders(const std::string& cmd,
                               const std::map<std::string, std::string>& params) {
    std::string result = cmd;

    VariableSyntax::Placeholder placeholder;
    size_t searchPos = 0;
    while (VariableSyntax::parseNextPlaceholder(result, searchPos, placeholder)) {
        const std::string value = resolveScalarPlaceholderValue(
            placeholder.name, placeholder.defaultValue, params);
        result.replace(placeholder.begin, placeholder.end - placeholder.begin, value);
        searchPos = placeholder.begin + value.length();
    }

    return result;
}

std::vector<std::string> replacePlaceholdersExpanded(const std::string& cmd,
                                                     const std::map<std::string, std::string>& params) {
    std::vector<std::string> expandedLines = {""};

    size_t cursor = 0;
    VariableSyntax::Placeholder placeholder;
    while (VariableSyntax::parseNextPlaceholder(cmd, cursor, placeholder)) {
        const std::string literal = cmd.substr(cursor, placeholder.begin - cursor);
        for (auto& line : expandedLines) {
            line += literal;
        }

        std::string baseName;
        if (VariableSyntax::isListVariableName(placeholder.name, &baseName)) {
            std::vector<std::string> values = collectListValues(params, baseName);
            if (values.empty() && !placeholder.defaultValue.empty()) {
                values = parseListLiteral(placeholder.defaultValue);
            }

            if (values.empty()) {
                return {};
            }

            std::vector<std::string> nextLines;
            nextLines.reserve(expandedLines.size() * values.size());
            for (const auto& prefix : expandedLines) {
                for (const auto& value : values) {
                    nextLines.push_back(prefix + value);
                }
            }
            expandedLines.swap(nextLines);
        } else {
            const std::string replacement = resolveScalarPlaceholderValue(
                placeholder.name, placeholder.defaultValue, params);
            for (auto& line : expandedLines) {
                line += replacement;
            }
        }

        cursor = placeholder.end;
    }

    const std::string tail = cmd.substr(cursor);
    for (auto& line : expandedLines) {
        line += tail;
    }

    return expandedLines;
}
