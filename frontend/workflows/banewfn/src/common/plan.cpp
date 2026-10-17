#include "common/gui.h"
#include "common/utils.h"
#include <algorithm>
#include <filesystem>
#include <iostream>
#include <set>
#include <sstream>
#include <stdexcept>

namespace Gui {
int plan(int argc, char* argv[]) {
    namespace fs = std::filesystem;
    std::ostream output(std::cout.rdbuf());
    struct Redirect {
        std::streambuf* previous = std::cout.rdbuf(std::cerr.rdbuf());
        ~Redirect() { std::cout.rdbuf(previous); }
    } redirect;
    try {
        std::string script, root, parameterFile, excluded, filesFile, bindingsFile;
        std::vector<std::string> patterns, files;
        Values vars, bindings;
        bool recursive = false;
        for (int i = 1; i < argc; ++i) {
            std::string arg = argv[i];
            if (arg == "--plan-json") continue;
            if (arg == "--recursive") { recursive = true; continue; }
            if (arg == "--root" || arg == "--pattern" || arg == "--file" || arg == "--files-json" || arg == "--bindings-json" || arg == "--exclude-dir" || arg == "--parameters-json" || arg == "--var" || arg == "--binding") {
                if (++i == argc) throw std::runtime_error("Missing value for " + arg);
                std::string value = argv[i];
                if (arg == "--root") root = value;
                else if (arg == "--pattern") patterns.push_back(value);
                else if (arg == "--file") files.push_back(value);
                else if (arg == "--files-json") filesFile = value;
                else if (arg == "--bindings-json") bindingsFile = value;
                else if (arg == "--exclude-dir") excluded = value;
                else if (arg == "--parameters-json") parameterFile = value;
                else {
                    const auto equal = value.find('=');
                    if (equal == std::string::npos || equal == 0) throw std::runtime_error("Expected key=value for " + arg);
                    (arg == "--var" ? vars : bindings)[value.substr(0, equal)] = value.substr(equal + 1);
                }
            } else if (script.empty() && !arg.empty() && arg[0] != '-') script = arg;
            else throw std::runtime_error("Unexpected planning argument: " + arg);
        }
        ParsedInputFile input;
        if (!script.empty()) {
            input = InputParser::parseInpFileDetailed(script);
            if (!input.loaded) throw std::runtime_error("Cannot parse script: " + script);
        }
        for (const auto& var : vars) input.customVars[var.first] =
            (VariableSyntax::isListVariableName(var.first) || VariableSyntax::isLengthVariableName(var.first))
                ? std::vector<std::string>{var.second} : Utils::parseBashArray(var.second);
        variables(input.customVars, readValues(parameterFile));
        for (const auto& file : readValues(filesFile)) files.push_back(file.second);
        for (const auto& binding : readValues(bindingsFile)) bindings[binding.first] = binding.second;
        unsigned long long combinations = 1;
        for (const auto& var : input.customVars) {
            if (var.second.size() > 1) {
                if (combinations > 1000000000ULL / var.second.size()) throw std::runtime_error("Too many variable combinations");
                combinations *= var.second.size();
            }
        }
        std::set<std::string> found;
        auto add = [&](const fs::path& path) {
            if (!fs::is_regular_file(path)) throw std::runtime_error("Input file is missing: " + path.u8string());
            found.insert(fs::canonical(path).u8string());
            if (found.size() > 1024) throw std::runtime_error("Select at most 1024 input files");
        };
        for (const auto& file : files) add(fs::u8path(file));
        if (!root.empty()) {
            const auto directory = fs::canonical(fs::u8path(root));
            if (!fs::is_directory(directory)) throw std::runtime_error("Choose an input folder");
            if (patterns.empty() && !input.wfnFile.empty()) patterns.push_back(input.wfnFile);
            if (patterns.empty()) throw std::runtime_error("Enter a filename pattern");
            for (const auto& pattern : patterns) {
                if (pattern.empty() || pattern.find_first_of("/\\\r\n") != std::string::npos)
                    throw std::runtime_error("Patterns must match filenames; choose their folder with --root");
            }
            fs::path skip;
            if (!excluded.empty()) skip = fs::weakly_canonical(fs::u8path(excluded));
            auto excludedPath = [&](const fs::path& path) {
                if (skip.empty()) return false;
                const auto relative = path.lexically_relative(skip);
                return path == skip || (!relative.empty() && *relative.begin() != "..");
            };
            auto match = [&](const fs::path& folder) {
                if (excludedPath(folder)) return;
                for (const auto& pattern : patterns)
                    for (const auto& path : Utils::expandWildcard((folder / fs::u8path(pattern)).u8string())) add(fs::u8path(path));
            };
            match(directory);
            if (recursive) {
                std::size_t visited = 0;
                for (fs::recursive_directory_iterator it(directory, fs::directory_options::skip_permission_denied), end; it != end; ++it) {
                    if (++visited > 100000) throw std::runtime_error("Input folder contains too many entries");
                    if (it->is_symlink() || excludedPath(it->path())) { it.disable_recursion_pending(); continue; }
                    if (it->is_directory()) match(it->path());
                }
            }
        }
        std::ostringstream result;
        result << "{\"version\":1,\"combinations\":" << combinations << ",\"inputs\":[";
        bool first = true;
        for (const auto& file : found) {
            if (!first) result << ',';
            first = false;
            std::string mapped, errors;
            for (const auto& binding : bindings) {
                if (!mapped.empty()) mapped += ',';
                std::string expression = binding.second;
                // File bindings are per input, independent of the script's variable sweep.
                VariableSyntax::Placeholder placeholder;
                std::size_t offset = 0;
                while (VariableSyntax::parseNextPlaceholder(expression, offset, placeholder)) {
                    if (placeholder.name != "input" && placeholder.name != "wfn") throw std::runtime_error("File bindings support ${input} and ${wfn} placeholders");
                    offset = placeholder.end;
                }
                std::vector<ModuleTask> context(1);
                context[0].params["file"] = expression;
                InputParser::applyPlaceholderReplacement(context, file, {});
                const auto& resolved = context[0].params.at("file");
                auto target = fs::u8path(resolved);
                if (target.is_relative()) target = fs::u8path(file).parent_path() / target;
                const auto candidates = Utils::expandWildcard(target.u8string());
                if (candidates.size() == 1) target = fs::canonical(fs::u8path(candidates.front()));
                else {
                    if (!errors.empty()) errors += ',';
                    errors += quote(binding.first + (candidates.empty() ? ": companion file is missing: " : ": companion pattern matches multiple files: ") + target.u8string());
                }
                mapped += quote(binding.first) + ':' + quote(target.u8string());
            }
            result << "{\"path\":" << quote(file) << ",\"bindings\":{" << mapped << "},\"errors\":[" << errors << "]}";
        }
        result << "]}\n";
        output << result.str();
        return 0;
    } catch (const std::exception& error) {
        output << "{\"error\":" << quote(error.what()) << "}\n";
        return 2;
    }
}
}
