#include "common/input.h"
#include "common/utils.h"
#include <iostream>
#include <fstream>
#include <sstream>
#include <algorithm>
#include <cctype>

namespace {

bool tryParseInputBoolFlag(const std::string& rawValue, const std::string& flagName, bool& outValue) {
    std::string value = Utils::toLowerAscii(Utils::trim(rawValue));

    if (value == "on" || value == "true" || value == "yes" || value == "1") {
        outValue = true;
        return true;
    }

    if (value == "off" || value == "false" || value == "flase" || value == "no" || value == "0") {
        outValue = false;
        return true;
    }

    std::cerr << "Warning: Invalid " << flagName << " value in input header: " << value
              << " (expected on/true or off/false)" << std::endl;
    return false;
}

bool tryParseCollectDirective(const std::string& trimmedLine, std::string& collectDir) {
    const std::string line = Utils::trim(trimmedLine);
    const std::string keyword = "collect";

    if (line.rfind(keyword, 0) != 0) {
        return false;
    }

    size_t pos = keyword.size();
    while (pos < line.size() && std::isspace(static_cast<unsigned char>(line[pos]))) {
        ++pos;
    }

    if (pos >= line.size() || line[pos] != '(') {
        return false;
    }

    const size_t openParen = pos;
    const size_t closeParen = line.find_last_of(')');
    if (closeParen == std::string::npos || closeParen <= openParen) {
        return false;
    }

    pos = closeParen + 1;
    while (pos < line.size() && std::isspace(static_cast<unsigned char>(line[pos]))) {
        ++pos;
    }

    if (pos < line.size() && line[pos] == ';') {
        ++pos;
        while (pos < line.size() && std::isspace(static_cast<unsigned char>(line[pos]))) {
            ++pos;
        }
    }

    if (pos != line.size()) {
        return false;
    }

    collectDir = Utils::trimQuotes(Utils::trim(line.substr(openParen + 1, closeParen - openParen - 1)));
    return !collectDir.empty();
}

bool isBuiltinListParamKey(const std::string& key) {
    const std::string lowerKey = Utils::toLowerAscii(Utils::trim(key));
    return lowerKey == "op" || lowerKey == "ops" || lowerKey == "operator" || lowerKey == "operators" ||
           lowerKey == "combine" || lowerKey == "combines" ||
           lowerKey == "fragment" || lowerKey == "fragments" ||
           lowerKey == "flip" || lowerKey == "flips";
}

bool tryParseBuiltinStart(const std::string& trimmedLine, std::string& builtinName, std::string& builtinId) {
    std::string line = Utils::trim(trimmedLine);
    if (line.rfind("bane.", 0) != 0) {
        return false;
    }

    // Use the final opening brace so placeholders such as ${name} remain
    // valid in the optional block id.
    const size_t openBrace = line.find_last_of('{');
    if (openBrace == std::string::npos) {
        return false;
    }

    const std::string tail = Utils::trim(line.substr(openBrace + 1));
    if (!tail.empty()) {
        // Keep the DSL line-oriented for now. A closing brace on the same line is easy to add
        // later, but rejecting it avoids ambiguous half-parsed blocks.
        return false;
    }

    std::string head = Utils::trim(line.substr(0, openBrace));
    if (head.rfind("bane.", 0) != 0) {
        return false;
    }
    head = Utils::trim(head.substr(5));
    if (head.empty()) {
        return false;
    }

    std::istringstream iss(head);
    std::vector<std::string> tokens;
    std::string token;
    while (iss >> token) {
        tokens.push_back(token);
    }

    if (tokens.empty() || tokens.size() > 2) {
        return false;
    }

    builtinName = tokens[0];
    builtinId = tokens.size() == 2 ? tokens[1] : "";
    return !builtinName.empty();
}

bool parseBuiltinBlockLine(const std::string& trimmedLine, ModuleTask& task) {
    std::string line = Utils::trim(trimmedLine);
    if (line.empty()) {
        return true;
    }

    // Accept either "key = value" or the legacy-like "key value" form.
    size_t eqPos = line.find('=');
    std::string key;
    std::string value;
    if (eqPos != std::string::npos) {
        key = Utils::trim(line.substr(0, eqPos));
        value = Utils::trim(line.substr(eqPos + 1));
    } else {
        std::istringstream iss(line);
        iss >> key;
        std::getline(iss, value);
        value = Utils::trim(value);
    }

    if (key.empty()) {
        return false;
    }

    value = Utils::trimQuotes(value);
    if (task.isBuiltin() && isBuiltinListParamKey(key)) {
        task.builtinBody.push_back(Utils::toLowerAscii(key) + "=" + value);
    } else {
        task.params[key] = value;
    }
    return true;
}

bool isInteractiveMarker(const std::vector<std::string>& values) {
    return values.size() == 1 && Utils::trim(values[0]) == "?";
}

std::vector<std::string> parseListLiteral(const std::string& rawValue) {
    const std::string trimmedValue = Utils::trim(rawValue);
    if (trimmedValue.empty()) {
        return {};
    }
    return Utils::parseBashArray(trimmedValue);
}

std::vector<std::string> parseStoredListValues(const std::vector<std::string>& values) {
    if (values.empty()) {
        return {};
    }

    if (values.size() == 1) {
        return parseListLiteral(values.front());
    }

    return values;
}

std::vector<std::string> collectListValues(const std::map<std::string, std::vector<std::string>>& vars,
                                           const std::string& baseName) {
    const auto directIt = vars.find(baseName + "*");
    if (directIt != vars.end()) {
        const std::vector<std::string> directValues = parseStoredListValues(directIt->second);
        if (!directValues.empty()) {
            return directValues;
        }
    }

    std::vector<std::pair<int, std::string>> indexedValues;
    for (const auto& kv : vars) {
        std::string indexedBase;
        int index = 0;
        if (VariableSyntax::parseIndexedVariableName(kv.first, &indexedBase, &index) && indexedBase == baseName) {
            const std::string value = kv.second.empty() ? std::string("") : kv.second.front();
            indexedValues.push_back({index, value});
        }
    }

    std::sort(indexedValues.begin(), indexedValues.end(),
              [](const auto& lhs, const auto& rhs) { return lhs.first < rhs.first; });

    std::vector<std::string> values;
    for (const auto& item : indexedValues) {
        values.push_back(item.second);
    }
    return values;
}

std::string makeLenKey(const std::string& baseName) {
    return "len(" + baseName + ")";
}

void clearIndexedValues(std::map<std::string, std::vector<std::string>>& vars, const std::string& baseName) {
    std::vector<std::string> keysToErase;
    for (const auto& kv : vars) {
        std::string indexedBase;
        int index = 0;
        if (VariableSyntax::parseIndexedVariableName(kv.first, &indexedBase, &index) && indexedBase == baseName) {
            keysToErase.push_back(kv.first);
        }
    }

    for (const auto& key : keysToErase) {
        vars.erase(key);
    }
}

void materializeListVariable(std::map<std::string, std::vector<std::string>>& vars,
                             const std::string& listKey,
                             const std::vector<std::string>& values,
                             bool updateLenWhenMissingOnly) {
    std::string baseName;
    if (!VariableSyntax::isListVariableName(listKey, &baseName)) {
        return;
    }

    vars[listKey] = {VariableSyntax::serializeListValues(values)};
    clearIndexedValues(vars, baseName);
    for (size_t i = 0; i < values.size(); ++i) {
        vars[baseName + std::to_string(i + 1)] = {values[i]};
    }

    const std::string lenKey = makeLenKey(baseName);
    const auto lenIt = vars.find(lenKey);
    if (lenIt == vars.end() || !updateLenWhenMissingOnly || isInteractiveMarker(lenIt->second) ||
        lenIt->second.empty() || Utils::trim(lenIt->second.front()).empty()) {
        vars[lenKey] = {std::to_string(values.size())};
    }
}

void materializeAllListVariables(std::map<std::string, std::vector<std::string>>& vars) {
    std::vector<std::string> listKeys;
    for (const auto& kv : vars) {
        if (VariableSyntax::isListVariableName(kv.first) && !isInteractiveMarker(kv.second)) {
            listKeys.push_back(kv.first);
        }
    }

    for (const auto& listKey : listKeys) {
        const auto it = vars.find(listKey);
        if (it == vars.end()) {
            continue;
        }
        materializeListVariable(vars, listKey, parseStoredListValues(it->second), true);
    }
}

bool tryParseNonNegativeInteger(const std::string& text, int& value) {
    if (Utils::trim(text).empty()) {
        value = 0;
        return true;
    }
    return Utils::tryParseNonNegativeInt(text, value);
}

struct InputPlaceholderResolution {
    bool found;
    std::string value;
};

InputPlaceholderResolution resolveInputScalarPlaceholder(const std::string& varName,
                                                         const std::string& defaultValue,
                                                         bool usedBraces,
                                                         const std::string& wfnFile,
                                                         const std::map<std::string, std::vector<std::string>>& customVars) {
    if (varName == "output") {
        return {false, ""};
    }

    const auto customIt = customVars.find(varName);
    if (customIt != customVars.end() && !customIt->second.empty()) {
        if (VariableSyntax::isListVariableName(varName)) {
            return {true, VariableSyntax::serializeListValues(collectListValues(customVars, varName.substr(0, varName.size() - 1)))};
        }
        return {true, customIt->second.front()};
    }

    std::string baseName;
    if (VariableSyntax::isLengthVariableName(varName, &baseName)) {
        const std::vector<std::string> values = collectListValues(customVars, baseName);
        if (!values.empty()) {
            return {true, std::to_string(values.size())};
        }
    }

    if (VariableSyntax::isListVariableName(varName, &baseName)) {
        const std::vector<std::string> values = collectListValues(customVars, baseName);
        if (!values.empty()) {
            return {true, VariableSyntax::serializeListValues(values)};
        }
    }

    if (varName == "wfn") {
        return {true, wfnFile};
    }

    if (varName == "input") {
        return {true, Utils::getBaseName(wfnFile)};
    }

    if (usedBraces && Utils::fileExists(varName)) {
        std::ifstream f(varName);
        if (f.good()) {
            std::stringstream buffer;
            buffer << f.rdbuf();
            return {true, Utils::trim(buffer.str())};
        }
    }

    if (!defaultValue.empty()) {
        if (VariableSyntax::isListVariableName(varName)) {
            return {true, VariableSyntax::serializeListValues(parseListLiteral(defaultValue))};
        }
        return {true, defaultValue};
    }

    return {false, ""};
}

} // namespace

// Replace input file placeholders ($input and ${input}) with wavefunction filename without extension
// Additionally, support ${name} -> read value from file "name" in current directory (trimmed)
// Also support custom variables from command line or file header
// For array variables, use the first element for replacement
std::string InputParser::replaceInputPlaceholders(const std::string& text, const std::string& wfnFile, const std::map<std::string, std::vector<std::string>>& customVars) {
    std::string result = text;

    VariableSyntax::Placeholder placeholder;
    size_t searchPos = 0;
    while (VariableSyntax::parseNextPlaceholder(result, searchPos, placeholder)) {
        const auto resolved = resolveInputScalarPlaceholder(
            placeholder.name, placeholder.defaultValue, placeholder.braced, wfnFile, customVars);

        if (resolved.found) {
            result.replace(placeholder.begin, placeholder.end - placeholder.begin, resolved.value);
            searchPos = placeholder.begin + resolved.value.length();
        } else {
            searchPos = placeholder.end;
        }
    }

    return result;
}

static std::vector<std::string> replaceInputPlaceholdersExpanded(
    const std::string& text,
    const std::string& wfnFile,
    const std::map<std::string, std::vector<std::string>>& customVars) {
    std::vector<std::string> expandedLines = {""};

    size_t cursor = 0;
    VariableSyntax::Placeholder placeholder;
    while (VariableSyntax::parseNextPlaceholder(text, cursor, placeholder)) {
        const std::string literal = text.substr(cursor, placeholder.begin - cursor);
        for (auto& line : expandedLines) {
            line += literal;
        }

        std::string baseName;
        if (VariableSyntax::isListVariableName(placeholder.name, &baseName)) {
            std::vector<std::string> values = collectListValues(customVars, baseName);
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
            const auto resolved = resolveInputScalarPlaceholder(
                placeholder.name, placeholder.defaultValue, placeholder.braced, wfnFile, customVars);
            const std::string replacement = resolved.found
                ? resolved.value
                : text.substr(placeholder.begin, placeholder.end - placeholder.begin);
            for (auto& line : expandedLines) {
                line += replacement;
            }
        }

        cursor = placeholder.end;
    }

    const std::string tail = text.substr(cursor);
    for (auto& line : expandedLines) {
        line += tail;
    }

    return expandedLines;
}

// Apply placeholder replacement to all tasks using wavefunction filename and custom variables
void InputParser::applyPlaceholderReplacement(std::vector<ModuleTask>& tasks, const std::string& wfnFile, const std::map<std::string, std::vector<std::string>>& customVars) {
    for (auto& task : tasks) {
        // Apply replacement to wfn_rebase directive target file
        if (task.isWfnRebase()) {
            task.wfnRebaseFile = replaceInputPlaceholders(task.wfnRebaseFile, wfnFile, customVars);
        }

        // Apply replacement to collect directive target directory
        if (task.isCollect()) {
            task.collectDir = replaceInputPlaceholders(task.collectDir, wfnFile, customVars);
        }

        // Apply replacement to parameter values
        for (auto& param : task.params) {
            param.second = replaceInputPlaceholders(param.second, wfnFile, customVars);
        }

        if (task.isBuiltin()) {
            task.builtinId = replaceInputPlaceholders(task.builtinId, wfnFile, customVars);
            for (auto& bodyLine : task.builtinBody) {
                bodyLine = replaceInputPlaceholders(bodyLine, wfnFile, customVars);
            }
        }

        if (task.isCitation()) {
            task.citationId = replaceInputPlaceholders(task.citationId, wfnFile, customVars);
        }

        if (task.isCitationOutput()) {
            task.citationOutputName = replaceInputPlaceholders(
                task.citationOutputName, wfnFile, customVars);
        }

        // Apply replacement to post-processing step parameters
        for (auto& step : task.postProcessSteps) {
            for (auto& param : step.second) {
                param.second = replaceInputPlaceholders(param.second, wfnFile, customVars);
            }
        }

        // Apply replacement to pre-raw Multiwfn commands
        std::vector<std::string> expandedPreRawCommands;
        for (const auto& preRawCommand : task.preRawCommands) {
            const auto expandedLines = replaceInputPlaceholdersExpanded(preRawCommand, wfnFile, customVars);
            expandedPreRawCommands.insert(expandedPreRawCommands.end(), expandedLines.begin(), expandedLines.end());
        }
        task.preRawCommands.swap(expandedPreRawCommands);

        // Apply replacement to raw Multiwfn commands
        std::vector<std::string> expandedRawCommands;
        for (const auto& rawCommand : task.rawCommands) {
            const auto expandedLines = replaceInputPlaceholdersExpanded(rawCommand, wfnFile, customVars);
            expandedRawCommands.insert(expandedRawCommands.end(), expandedLines.begin(), expandedLines.end());
        }
        task.rawCommands.swap(expandedRawCommands);

        // Apply replacement to the structured %grep AST. ${output} is not an
        // input/custom variable, so it intentionally remains unresolved here
        // and is replaced by the executor after the Multiwfn output filename is
        // known.
        for (auto& rule : task.grepRules) {
            rule.name = replaceInputPlaceholders(rule.name, wfnFile, customVars);
            rule.source = replaceInputPlaceholders(rule.source, wfnFile, customVars);
            rule.selector.first.value = replaceInputPlaceholders(
                rule.selector.first.value, wfnFile, customVars);
            rule.selector.second.value = replaceInputPlaceholders(
                rule.selector.second.value, wfnFile, customVars);
            for (auto& stage : rule.stages) {
                stage.pattern.value = replaceInputPlaceholders(
                    stage.pattern.value, wfnFile, customVars);
                stage.argument = replaceInputPlaceholders(stage.argument, wfnFile, customVars);
                for (auto& column : stage.columns) {
                    column.outputName = replaceInputPlaceholders(
                        column.outputName, wfnFile, customVars);
                    column.sourceName = replaceInputPlaceholders(
                        column.sourceName, wfnFile, customVars);
                }
            }
            rule.sink.path = replaceInputPlaceholders(rule.sink.path, wfnFile, customVars);
            rule.sink.property = replaceInputPlaceholders(
                rule.sink.property, wfnFile, customVars);
        }

        // Apply replacement to commands
        for (auto& command : task.commands) {
            command = replaceInputPlaceholders(command, wfnFile, customVars);
        }
    }
}

bool InputParser::resolveInteractiveCustomVars(std::map<std::string, std::vector<std::string>>& customVars) {
    std::vector<std::string> interactiveListKeys;
    for (const auto& kv : customVars) {
        if (VariableSyntax::isListVariableName(kv.first) && isInteractiveMarker(kv.second)) {
            interactiveListKeys.push_back(kv.first);
        }
    }

    for (const auto& listKey : interactiveListKeys) {
        std::string baseName;
        if (!VariableSyntax::isListVariableName(listKey, &baseName)) {
            continue;
        }

        const std::string lenKey = makeLenKey(baseName);
        int requestedCount = -1;

        auto lenIt = customVars.find(lenKey);
        if (lenIt != customVars.end()) {
            if (isInteractiveMarker(lenIt->second)) {
                while (true) {
                    std::cout << "Bane need count for variable list '" << baseName
                              << "' (" << lenKey << ", empty for 0): ";
                    std::string lenInput;
                    if (!std::getline(std::cin, lenInput)) {
                        std::cerr << "\nError: Input stream closed while waiting for " << lenKey << "." << std::endl;
                        return false;
                    }

                    int parsedCount = 0;
                    if (tryParseNonNegativeInteger(lenInput, parsedCount)) {
                        requestedCount = parsedCount;
                        lenIt->second = {std::to_string(parsedCount)};
                        break;
                    }

                    std::cout << "Warning: Invalid " << lenKey
                              << " value, please enter a non-negative integer." << std::endl;
                }
            } else if (!lenIt->second.empty()) {
                int parsedCount = 0;
                if (tryParseNonNegativeInteger(lenIt->second.front(), parsedCount)) {
                    requestedCount = parsedCount;
                } else {
                    std::cerr << "Warning: Invalid " << lenKey << " value: "
                              << lenIt->second.front()
                              << ". Falling back to blank-terminated collection for " << listKey
                              << std::endl;
                }
            }
        }

        std::vector<std::string> values;
        if (requestedCount >= 0) {
            values.reserve(static_cast<size_t>(requestedCount));
            for (int i = 1; i <= requestedCount; ++i) {
                std::cout << "Bane need value for variable '" << baseName << i << "': ";
                std::string userInput;
                if (!std::getline(std::cin, userInput)) {
                    std::cerr << "\nError: Input stream closed while waiting for variable '"
                              << baseName << i << "'." << std::endl;
                    return false;
                }
                values.push_back(Utils::trimQuotes(Utils::trim(userInput)));
            }
        } else {
            for (int i = 1;; ++i) {
                std::cout << "Bane need value for variable '" << baseName << i
                          << "' (empty to finish): ";
                std::string userInput;
                if (!std::getline(std::cin, userInput)) {
                    std::cerr << "\nError: Input stream closed while waiting for variable '"
                              << baseName << i << "'." << std::endl;
                    return false;
                }
                const std::string cleanedValue = Utils::trimQuotes(Utils::trim(userInput));
                if (cleanedValue.empty()) {
                    break;
                }
                values.push_back(cleanedValue);
            }
        }

        materializeListVariable(customVars, listKey, values, false);
    }

    for (auto& kv : customVars) {
        if (!isInteractiveMarker(kv.second)) {
            continue;
        }
        if (VariableSyntax::isListVariableName(kv.first)) {
            continue;
        }

        std::cout << "Bane need value for variable '" << kv.first;
        if (VariableSyntax::isLengthVariableName(kv.first)) {
            std::cout << "' (non-negative integer, empty for 0): ";
            while (true) {
                std::string userInput;
                if (!std::getline(std::cin, userInput)) {
                    std::cerr << "\nError: Input stream closed while waiting for variable '"
                              << kv.first << "'." << std::endl;
                    return false;
                }
                int parsedCount = 0;
                if (tryParseNonNegativeInteger(userInput, parsedCount)) {
                    kv.second = {std::to_string(parsedCount)};
                    break;
                }
                std::cout << "Warning: Invalid " << kv.first
                          << " value, please enter a non-negative integer: ";
            }
        } else {
            std::cout << "' (supports bash array like (a b c), empty for blank): ";
            std::string userInput;
            if (!std::getline(std::cin, userInput)) {
                std::cerr << "\nError: Input stream closed while waiting for variable '"
                          << kv.first << "'." << std::endl;
                return false;
            }
            userInput = Utils::trim(userInput);
            kv.second = Utils::parseBashArray(userInput);
            if (kv.second.size() == 1) {
                kv.second[0] = Utils::trimQuotes(kv.second[0]);
            }
        }
    }

    materializeAllListVariables(customVars);
    return true;
}

// Parse inp file, return named parse result with module tasks, headers, variables, and load status
ParsedInputFile InputParser::parseInpFileDetailed(const std::string& inpFile) {
    ParsedInputFile parsed;
    std::vector<ModuleTask>& tasks = parsed.tasks;
    std::string& wfnFile = parsed.wfnFile;
    int& cores = parsed.cores;  // -1 means not specified
    std::map<std::string, std::vector<std::string>>& customVars = parsed.customVars;
    bool& dryrun = parsed.dryrun;
    bool& debug = parsed.debug;
    bool& nogui = parsed.nogui;
    std::string& citationsOutput = parsed.citationsOutput;
    bool& citationsOutputSpecified = parsed.citationsOutputSpecified;

    std::ifstream file(inpFile);
    if (!file.is_open()) {
        std::cerr << "Error: Cannot open inp file: " << inpFile << std::endl;
        return parsed;
    }
    parsed.loaded = true;

    std::string line;
    ModuleTask currentTask;
    bool inProcessMode = false;
    bool inCommandMode = false;
    bool inRawMode = false;
    bool inPreRawMode = false;
    bool inGrepMode = false;
    bool inBuiltinMode = false;
    std::vector<GrepDslLine> grepBlockLines;
    int grepBlockStartLine = 0;
    int inputLineNumber = 0;
    std::map<std::string, int> moduleBlockCounters;  // Track block indices for each module name
    int anonymousBlockCounter = 0;

    auto ensureAnonymousTask = [&]() {
        if (currentTask.moduleName.empty() && currentTask.commands.empty() &&
            currentTask.preRawCommands.empty() && currentTask.rawCommands.empty() &&
            currentTask.grepRules.empty() && currentTask.grepErrors.empty()) {
            currentTask = ModuleTask();
            currentTask.useWait = false;
            currentTask.blockIndex = anonymousBlockCounter++;
        }
    };

    auto hasPendingTask = [&]() {
        return !currentTask.isWorkflow() || !currentTask.moduleName.empty() || !currentTask.commands.empty() ||
               !currentTask.preRawCommands.empty() || !currentTask.rawCommands.empty() ||
               !currentTask.grepRules.empty() || !currentTask.grepErrors.empty();
    };

    auto flushGrepBlock = [&]() {
        if (grepBlockStartLine <= 0) {
            return;
        }

        GrepParseResult grepResult = GrepDsl::parseBlock(grepBlockLines);
        if (grepResult.rules.empty() && grepResult.errors.empty()) {
            grepResult.errors.push_back("line " + std::to_string(grepBlockStartLine) +
                                        ": %grep block contains no rules");
        }
        currentTask.grepRules.insert(currentTask.grepRules.end(),
                                     grepResult.rules.begin(), grepResult.rules.end());
        currentTask.grepErrors.insert(currentTask.grepErrors.end(),
                                      grepResult.errors.begin(), grepResult.errors.end());
        grepBlockLines.clear();
        grepBlockStartLine = 0;
    };

    while (std::getline(file, line)) {
        ++inputLineNumber;
        // 保留前导空白用于模块行"顶格"判断
        std::string noComment = Utils::removeInlineComment(line);
        std::string trimmed = Utils::trim(noComment);

        // %grep is line-oriented but uses its own tokenizer/comment rules so
        // that # inside /regular expressions/ remains literal. A new block
        // directive, end/wait, module header, or builtin block naturally
        // terminates the current %grep block and is then processed normally.
        if (inGrepMode) {
            const std::string grepNoComment = GrepDsl::removeInlineComment(line);
            const std::string grepTrimmed = Utils::trim(grepNoComment);
            bool moduleHeader = false;
            if (!grepNoComment.empty() && grepNoComment[0] == '[') {
                const size_t lastNonWS = grepNoComment.find_last_not_of(" \t\r\n");
                moduleHeader = lastNonWS != std::string::npos && grepNoComment[lastNonWS] == ']';
            }
            std::string builtinName;
            std::string builtinId;
            const bool builtinStart = tryParseBuiltinStart(grepTrimmed, builtinName, builtinId);
            const bool grepTerminator = grepTrimmed == "%grep" || grepTrimmed == "%command" ||
                                        grepTrimmed == "%preraw" || grepTrimmed == "%raw" ||
                                        grepTrimmed == "%process" || grepTrimmed == "end" ||
                                        grepTrimmed == "wait" || moduleHeader || builtinStart;
            if (!grepTerminator) {
                grepBlockLines.push_back({inputLineNumber, line});
                continue;
            }
            flushGrepBlock();
            inGrepMode = false;
        }

        // In command mode, check for special keywords first (before storing raw line)
        // Special keywords still need to be detected even in command mode
        bool isSpecialKeyword = false;

        // Built-in bane.* blocks are parsed as strict key/value blocks until a closing brace.
        if (inBuiltinMode) {
            if (trimmed == "}" || trimmed == "};") {
                tasks.push_back(currentTask);
                currentTask = ModuleTask();
                inBuiltinMode = false;
                continue;
            }

            if (trimmed.empty()) {
                continue;
            }

            if (!parseBuiltinBlockLine(trimmed, currentTask)) {
                std::cerr << "Warning: Could not parse builtin DSL line: " << trimmed << std::endl;
            }
            continue;
        }

        // Enter structured text-extraction mode. It is valid both inside a
        // module task and as an anonymous standalone task with from <file>.
        if (trimmed == "%grep") {
            isSpecialKeyword = true;
            ensureAnonymousTask();
            inGrepMode = true;
            grepBlockStartLine = inputLineNumber;
            grepBlockLines.clear();
            inCommandMode = false;
            inProcessMode = false;
            inPreRawMode = false;
            inRawMode = false;
            continue;
        }

        // Enter command mode
        if (trimmed == "%command") {
            isSpecialKeyword = true;
            // Allow top-level %command without module definition ("裸command")
            ensureAnonymousTask();
            inCommandMode = true;
            inProcessMode = false;
            inPreRawMode = false;
            inRawMode = false;
            inGrepMode = false;
            continue;
        }

        // Enter pre-raw Multiwfn command mode
        if (trimmed == "%preraw") {
            isSpecialKeyword = true;
            // Primarily used inside module blocks, but allow anonymous blocks for consistency
            ensureAnonymousTask();
            inPreRawMode = true;
            inCommandMode = false;
            inProcessMode = false;
            inRawMode = false;
            inGrepMode = false;
            continue;
        }

        // Enter raw Multiwfn command mode
        if (trimmed == "%raw") {
            isSpecialKeyword = true;
            // Allow top-level %raw without module definition
            ensureAnonymousTask();
            inRawMode = true;
            inCommandMode = false;
            inPreRawMode = false;
            inProcessMode = false;
            inGrepMode = false;
            continue;
        }

        // End current module with "end"
        if (trimmed == "end") {
            isSpecialKeyword = true;
            if (hasPendingTask()) {
                tasks.push_back(currentTask);
                currentTask = ModuleTask();
            }
            inProcessMode = false;
            inCommandMode = false;
            inPreRawMode = false;
            inRawMode = false;
            inGrepMode = false;
            continue;
        }

        // End current module with "wait" (interactive mode)
        if (trimmed == "wait") {
            isSpecialKeyword = true;
            if (hasPendingTask()) {
                currentTask.useWait = !currentTask.moduleName.empty() ||
                                      !currentTask.preRawCommands.empty() ||
                                      !currentTask.rawCommands.empty();
                tasks.push_back(currentTask);
                currentTask = ModuleTask();
            }
            inProcessMode = false;
            inCommandMode = false;
            inPreRawMode = false;
            inRawMode = false;
            inGrepMode = false;
            continue;
        }

        // Enter post-processing mode.
        // Keep %process literal inside %command/%raw for backward compatibility,
        // but allow it to terminate %preraw so the block can appear before other module content.
        if (trimmed == "%process" && !inCommandMode && !inRawMode) {
            isSpecialKeyword = true;
            if (currentTask.moduleName.empty()) {
                std::cerr << "Warning: %process without module definition" << std::endl;
                continue;
            }
            inProcessMode = true;
            inCommandMode = false;
            inPreRawMode = false;
            inRawMode = false;
            inGrepMode = false;
            continue;
        }

        // In command mode, store raw line (including comments and empty lines) if not special keyword
        if (inCommandMode && !isSpecialKeyword) {
            // Command mode: store the entire raw line as a command (preserve comments and empty lines)
            currentTask.commands.push_back(line);
            continue;
        }

        // In pre-raw mode, store literal Multiwfn input line (preserve comments and empty lines)
        if (inPreRawMode && !isSpecialKeyword) {
            currentTask.preRawCommands.push_back(line);
            continue;
        }

        // In raw mode, store literal Multiwfn input line (preserve comments and empty lines)
        if (inRawMode && !isSpecialKeyword) {
            currentTask.rawCommands.push_back(line);
            continue;
        }

        // Special directive: collect(path);
        // Only recognized between completed blocks. Inside %process/%raw/%command
        // it remains ordinary block content, so existing block syntax stays explicit.
        if (!hasPendingTask() && !inProcessMode && !inCommandMode && !inPreRawMode && !inRawMode && !inGrepMode) {
            std::string collectDir;
            if (tryParseCollectDirective(trimmed, collectDir)) {
                ModuleTask collectTask;
                collectTask.kind = TaskKind::Collect;
                collectTask.collectDir = collectDir;
                tasks.push_back(collectTask);
                continue;
            }
        }

        // For non-command mode, skip empty lines
        if (trimmed.empty()) continue;

        // Check for wfn=xx format at the beginning of file
        if (trimmed.find("wfn=") == 0 && currentTask.moduleName.empty()) {
            wfnFile = Utils::trimQuotes(Utils::trim(trimmed.substr(4)));
            continue;
        }

        // Check for core=xx format at the beginning of file
        if (trimmed.find("core=") == 0 && currentTask.moduleName.empty()) {
            const std::string coreStr = Utils::trim(trimmed.substr(5));
            int parsedCores = 0;
            if (Utils::tryParseNonNegativeInt(coreStr, parsedCores)) {
                cores = parsedCores;
            } else {
                std::cerr << "Warning: Invalid core value in input file: " << coreStr
                          << ". Ignoring this setting." << std::endl;
            }
            continue;
        }

        // Check for dryrun=on/true format at the beginning of file
        if (trimmed.find("dryrun=") == 0 && tasks.empty() && currentTask.moduleName.empty() && !inProcessMode && !inCommandMode && !inPreRawMode && !inRawMode && !inGrepMode) {
            tryParseInputBoolFlag(trimmed.substr(7), "dryrun", dryrun);
            continue;
        }

        // Check for debug=on/true format at the beginning of file
        if (trimmed.find("debug=") == 0 && tasks.empty() && currentTask.moduleName.empty() && !inProcessMode && !inCommandMode && !inPreRawMode && !inRawMode && !inGrepMode) {
            tryParseInputBoolFlag(trimmed.substr(6), "debug", debug);
            continue;
        }

        // Check for nogui=on/true format at the beginning of file
        if (trimmed.find("nogui=") == 0 && tasks.empty() && currentTask.moduleName.empty() && !inProcessMode && !inCommandMode && !inPreRawMode && !inRawMode && !inGrepMode) {
            tryParseInputBoolFlag(trimmed.substr(6), "nogui", nogui);
            continue;
        }

        // Optional per-workflow override for the automatic BibTeX file declared
        // in banewfn.rc. Use off/none/false/0 to disable it for this input file.
        if (tasks.empty() && currentTask.moduleName.empty() && !inProcessMode && !inCommandMode &&
            !inPreRawMode && !inRawMode && !inGrepMode) {
            const std::size_t headerEq = trimmed.find('=');
            if (headerEq != std::string::npos &&
                Utils::trim(trimmed.substr(0, headerEq)) == "citations_output") {
                citationsOutput = Utils::trimQuotes(Utils::trim(trimmed.substr(headerEq + 1)));
                citationsOutputSpecified = true;
                continue;
            }
        }

        // Special directive: wfn_rebase=xxx
        // It can appear between blocks to switch the file provided to subsequent Multiwfn tasks.
        // Only recognized when not inside any module/%process/%command.
        if (trimmed.find("wfn_rebase=") == 0 && currentTask.moduleName.empty() && !inProcessMode && !inCommandMode && !inPreRawMode && !inRawMode && !inGrepMode) {
            ModuleTask rebaseTask;
            rebaseTask.kind = TaskKind::WfnRebase;
            rebaseTask.wfnRebaseFile = Utils::trim(trimmed.substr(std::string("wfn_rebase=").size()));
            tasks.push_back(rebaseTask);
            continue;
        }

        // Check for key=value format at the beginning of file (custom variables)
        // This should come before module definitions, so check if no module is active
        if (currentTask.moduleName.empty() && !inProcessMode && !inCommandMode && !inPreRawMode && !inRawMode && !inGrepMode) {
            size_t eqPos = trimmed.find('=');
            // Only treat as variable if:
            // 1. Contains exactly one '='
            // 2. Key is not empty
            // 3. Key contains only alphanumeric and underscore (valid variable name)
            // 4. Not a special keyword (wfn, core)
            if (eqPos != std::string::npos && eqPos > 0 && eqPos < trimmed.length() - 1) {
                std::string key = Utils::trim(trimmed.substr(0, eqPos));
                std::string value = Utils::trim(trimmed.substr(eqPos + 1));

                // Only accept if key is valid and not a special keyword
                if (VariableSyntax::isValidCustomVariableName(key) && !key.empty() && key != "wfn" && key != "core" &&
                    key != "wfn_rebase" && key != "dryrun" && key != "debug" && key != "nogui" &&
                    key != "citations_output") {
                    if (VariableSyntax::isListVariableName(key)) {
                        customVars[key] = {value};
                    } else if (VariableSyntax::isLengthVariableName(key)) {
                        customVars[key] = {value};
                    } else {
                        // Parse value as bash array (supports both array and single value)
                        customVars[key] = Utils::parseBashArray(value);
                    }
                    continue;
                }
            }
        }

        // Built-in high-level DSL block start, e.g.
        // bane.cube.make density { ... }
        if (!inProcessMode && !inCommandMode && !inPreRawMode && !inRawMode && !inGrepMode) {
            std::string builtinName;
            std::string builtinId;
            if (tryParseBuiltinStart(trimmed, builtinName, builtinId)) {
                if (hasPendingTask()) {
                    tasks.push_back(currentTask);
                }
                currentTask = ModuleTask();
                if (builtinName == "cite") {
                    currentTask.kind = TaskKind::Citation;
                    currentTask.citationId = builtinId;
                } else if (builtinName == "citations.write") {
                    currentTask.kind = TaskKind::CitationOutput;
                    currentTask.citationOutputName = builtinId;
                } else {
                    currentTask.kind = TaskKind::Builtin;
                    currentTask.builtinName = builtinName;
                    currentTask.builtinId = builtinId;
                }
                currentTask.origin = "input:" + inpFile + ":" + std::to_string(inputLineNumber);
                currentTask.blockIndex = moduleBlockCounters["bane:" + builtinName]++;
                inBuiltinMode = true;
                inProcessMode = false;
                inCommandMode = false;
                inPreRawMode = false;
                inRawMode = false;
                inGrepMode = false;
                continue;
            }
        }

        // Module start [module_name] 必须顶格
        if (!noComment.empty() && noComment[0] == '[') {
            size_t lastNonWS = noComment.find_last_not_of(" \t\r\n");
            if (lastNonWS != std::string::npos && noComment[lastNonWS] == ']') {
                // If there is an unfinished task, save it
                if (hasPendingTask()) {
                    tasks.push_back(currentTask);
                }
                currentTask = ModuleTask();
                std::string inside = noComment.substr(1, lastNonWS - 1);
                currentTask.moduleName = Utils::trim(inside);
                currentTask.useWait = false;
                currentTask.blockIndex = moduleBlockCounters[currentTask.moduleName]++;
                inProcessMode = false;
                inCommandMode = false;
                inPreRawMode = false;
                inRawMode = false;
                inGrepMode = false;
                continue;
            }
        }

        // Parse parameters, post-processing commands, or shell commands
        if (inCommandMode) {
            // This should not be reached, as command mode lines are handled above
            // But keep as fallback
            currentTask.commands.push_back(line);
        } else if (inPreRawMode) {
            // This should not be reached, as pre-raw mode lines are handled above
            // But keep as fallback
            currentTask.preRawCommands.push_back(line);
        } else if (inRawMode) {
            // This should not be reached, as raw mode lines are handled above
            // But keep as fallback
            currentTask.rawCommands.push_back(line);
        } else {
            std::vector<std::string> tokens = Utils::split(trimmed, ' ');
            if (tokens.empty()) continue;

            if (!inProcessMode) {
                // Pre-processing parameter setting mode
                if (tokens.size() >= 2) {
                    // Store parameter value (placeholder replacement will be done later)
                    currentTask.params[tokens[0]] = tokens[1];
                }
            } else {
                // Post-processing command mode
                std::string sectionName = tokens[0];
                std::map<std::string, std::string> sectionParams;

                // Parse subsequent parameters
                for (size_t i = 1; i < tokens.size(); i += 2) {
                    if (i + 1 < tokens.size()) {
                        // Store parameter value (placeholder replacement will be done later)
                        sectionParams[tokens[i]] = tokens[i + 1];
                    }
                }

                currentTask.postProcessSteps.push_back({sectionName, sectionParams});
            }
        }
    }

    flushGrepBlock();

    // Save the last task (module, grep-only, or command-only)
    if (hasPendingTask()) {
        tasks.push_back(currentTask);
    }

    file.close();
    return parsed;
}

// Parse inp file, return all module tasks, optional wfn file, core count, custom variables, and header execution flags (backward compatibility)
std::tuple<std::vector<ModuleTask>, std::string, int,
           std::map<std::string, std::vector<std::string>>, bool, bool>
InputParser::parseInpFileWithWfnAndCoresAndVars(const std::string& inpFile) {
    const ParsedInputFile parsed = parseInpFileDetailed(inpFile);
    return {parsed.tasks, parsed.wfnFile, parsed.cores, parsed.customVars, parsed.dryrun, parsed.nogui};
}

// Parse inp file, return all module tasks, optional wfn file, and core count (backward compatibility)
std::tuple<std::vector<ModuleTask>, std::string, int> InputParser::parseInpFileWithWfnAndCores(const std::string& inpFile) {
    auto result = parseInpFileWithWfnAndCoresAndVars(inpFile);
    return {std::get<0>(result), std::get<1>(result), std::get<2>(result)};
}

// Parse inp file, return all module tasks and optional wfn file (backward compatibility)
std::pair<std::vector<ModuleTask>, std::string> InputParser::parseInpFileWithWfn(const std::string& inpFile) {
    auto result = parseInpFileWithWfnAndCores(inpFile);
    return {std::get<0>(result), std::get<1>(result)};
}

// Parse inp file, return all module tasks (backward compatibility)
std::vector<ModuleTask> InputParser::parseInpFile(const std::string& inpFile) {
    auto result = parseInpFileWithWfn(inpFile);
    return result.first;
}
