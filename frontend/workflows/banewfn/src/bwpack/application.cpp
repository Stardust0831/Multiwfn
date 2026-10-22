#include "bwpack/application.h"

#include <iostream>
#include <fstream>
#include <sstream>
#include <set>

#include "bwpack/bwpack_support.h"
#include "common/citation.h"
#include "common/config.h"
#include "common/input.h"
#include "common/inline_conf.h"
#include "common/utils.h"
#include "common/ui.h"

static void printUsage(const char* prog) {
    std::cout << "Usage: " << prog << " <input.bw> [options]\n\n"
              << "Options:\n"
              << "  -o, --output <file>   Output bw file (default: <input>.bwc)\n"
              << "  -c, --confdir <dir>   Directory containing module .conf files and citations.conf\n"
              << "  --rc <banewfn.rc>     Read confpath from banewfn.rc (fallback if --confdir not provided)\n"
              << "  -i, --inplace         Overwrite input file in-place\n"
              << "  -h, --help            Show this help\n";
}

static std::string readWholeFile(const std::string& path) {
    std::ifstream f(path);
    if (!f.is_open()) return "";
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

static std::string replaceExtension(const std::string& path, const std::string& newExt) {
    // newExt should include leading dot, e.g. ".bwc"
    std::string p = path;
    // Strip trailing separators? none.
    auto slash = p.find_last_of("/\\");
    auto dot = p.find_last_of('.');
    if (dot == std::string::npos || (slash != std::string::npos && dot < slash)) {
        return p + newExt;
    }
    return p.substr(0, dot) + newExt;
}

static std::string requestBwFile() {
    std::string bwFile;

    while (true) {
        std::cout << "Bane need a bw file: ";
        if (!std::getline(std::cin, bwFile)) {
            std::cerr << "\nError: Input stream closed while waiting for a bw file.\n";
            return {};
        }

        // Remove quotes and trim whitespace
        std::string cleanedFile = Utils::trimQuotes(bwFile);
        cleanedFile = Utils::trim(cleanedFile);

        if (Utils::fileExists(cleanedFile)) {
            return cleanedFile;
        } else {
            std::cout << "Bane is useless, cannot access file '" << cleanedFile << "' TAT\n";
        }
    }
}


int Bwpack::run(int argc, char* argv[]) {
    std::string inputFile;
    std::string outputFile;
    std::string confDir;
    std::string rcFile;
    bool inplace = false;

    // Simple argument parsing
    for (int i = 1; i < argc; i++) {
        std::string arg = argv[i];
        if (arg == "-h" || arg == "--help") {
            printUsage(argv[0]);
            return 0;
        } else if (arg == "-o" || arg == "--output") {
            if (i + 1 >= argc) {
                std::cerr << "Error: --output requires a file path\n";
                return 1;
            }
            outputFile = argv[++i];
        } else if (arg == "-c" || arg == "--confdir") {
            if (i + 1 >= argc) {
                std::cerr << "Error: --confdir requires a directory\n";
                return 1;
            }
            confDir = argv[++i];
        } else if (arg == "--rc") {
            if (i + 1 >= argc) {
                std::cerr << "Error: --rc requires a file path\n";
                return 1;
            }
            rcFile = argv[++i];
        } else if (arg == "-i" || arg == "--inplace") {
            inplace = true;
        } else if (!arg.empty() && arg[0] == '-') {
            std::cerr << "Error: Unknown option: " << arg << "\n";
            printUsage(argv[0]);
            return 1;
        } else {
            if (inputFile.empty()) {
                inputFile = arg;
            } else {
                std::cerr << "Error: Unexpected extra argument: " << arg << "\n";
                return 1;
            }
        }
    }

    // If no input file provided, request it interactively
    if (inputFile.empty()) {
        inputFile = requestBwFile();
        if (inputFile.empty()) {
            return 1;
        }
    }

    if (!Utils::fileExists(inputFile)) {
        std::cerr << "Error: Input file does not exist: " << inputFile << "\n";
        return 1;
    }

    if (inplace) {
        outputFile = inputFile;
    } else if (outputFile.empty()) {
        outputFile = replaceExtension(inputFile, ".bwc");
    }

    // Determine conf directory
    if (confDir.empty()) {
        // If rcFile not provided, try auto-discovery
        if (rcFile.empty()) {
            rcFile = findConfigFile(argv[0]);
        }

        ConfigManager cm;
        if (!rcFile.empty() && Utils::fileExists(rcFile)) {
            if (cm.loadBaneWfnConfig(rcFile, /*requireMultiwfnExec=*/false)) {
                confDir = cm.getConfig().confPath;
            }
        }

        if (confDir.empty()) {
            confDir = expandPath("~/.bane/wfn");
        }
    }

    std::cout << "Using conf directory: " << confDir << "\n";

    // Parse bw file to find required modules
    ParsedInputFile parsedInput = InputParser::parseInpFileDetailed(inputFile);
    if (!parsedInput.loaded) {
        return 1;
    }
    const std::vector<ModuleTask>& tasks = parsedInput.tasks;

    std::set<std::string> modules;
    bool hasCitationTask = false;
    for (const auto& t : tasks) {
        if (!t.moduleName.empty()) modules.insert(t.moduleName);
        if (t.isCitation()) hasCitationTask = true;
    }
    if (modules.empty() && !hasCitationTask) {
        std::cerr << "Error: No modules or citation declarations found in input file."
                  << std::endl;
        return 1;
    }

    std::cout << "Modules to bundle: ";
    if (modules.empty()) {
        std::cout << "(none)";
    } else {
        for (const auto& m : modules) std::cout << m << " ";
    }
    std::cout << "\n";

    // Read each module's conf file
    std::map<std::string, std::string> confTexts;
    for (const auto& m : modules) {
        std::string confPath = confDir;
        if (!confPath.empty() && confPath.back() != '/' && confPath.back() != '\\') {
            confPath += "/";
        }
        confPath += m + ".conf";

        if (!Utils::fileExists(confPath)) {
            std::cerr << "Warning: conf file not found for module '" << m << "': " << confPath << "\n";
            continue;
        }
        std::string txt = readWholeFile(confPath);
        if (txt.empty()) {
            std::cerr << "Warning: conf file is empty or unreadable: " << confPath << "\n";
            continue;
        }
        confTexts[m] = txt;
    }

    if (!modules.empty() && confTexts.empty()) {
        std::cerr << "Error: No conf files could be loaded. Nothing to bundle." << std::endl;
        return 1;
    }

    ConfigManager bundledConfigs;
    for (const auto& conf : confTexts) {
        std::string origin = confDir;
        if (!origin.empty() && origin.back() != '/' && origin.back() != '\\') {
            origin += "/";
        }
        origin += conf.first + ".conf";
        if (!bundledConfigs.loadModuleConfigFromText(conf.first, conf.second, origin)) {
            std::cerr << "Error: Cannot parse module config for bundling: "
                      << conf.first << std::endl;
            return 1;
        }
    }

    // Strip any existing inline conf blocks from the input file.
    std::string baseContent = InlineConf::stripInlineConfsFromFile(inputFile);

    // Expand catalog-backed citation declarations so the packed workflow does
    // not depend on an external citations.conf at runtime.
    CitationManager citationCatalog;
    std::string citationCatalogPath = confDir;
    if (!citationCatalogPath.empty() && citationCatalogPath.back() != '/' &&
        citationCatalogPath.back() != '\\') {
        citationCatalogPath += "/";
    }
    citationCatalogPath += "citations.conf";

    if (Utils::fileExists(citationCatalogPath) &&
        !citationCatalog.loadCatalog(citationCatalogPath)) {
        std::cerr << "Error: Cannot load citation catalog: "
                  << citationCatalogPath << std::endl;
        return 1;
    }

    const Bwpack::CitationExpansionResult citationExpansion =
        Bwpack::expandCatalogCitations(baseContent, citationCatalog, tasks, inputFile);
    if (!citationExpansion.success) {
        return 1;
    }
    baseContent = citationExpansion.content;
    if (citationExpansion.expandedCount > 0) {
        std::cout << "Expanded " << citationExpansion.expandedCount
                  << " citation catalog reference(s).\n";
    }

    const Bwpack::ConfiguredCitationCatalogResult configuredCitationCatalog =
        Bwpack::buildConfiguredCitationCatalog(
            citationCatalog, bundledConfigs, tasks, inputFile);
    if (!configuredCitationCatalog.success) {
        return 1;
    }
    if (configuredCitationCatalog.recordCount > 0) {
        std::cout << "Bundled " << configuredCitationCatalog.recordCount
                  << " module-selected citation record(s).\n";
    }

    // Write output
    std::ofstream out(outputFile);
    if (!out.is_open()) {
        std::cerr << "Error: Cannot write output file: " << outputFile << std::endl;
        return 1;
    }

    // Ensure base ends with newline
    out << baseContent;
    if (baseContent.empty() || baseContent.back() != '\n') {
        out << "\n";
    }

    out << "\n";
    out << "# Bundled by bane dysta\n";
    out << "# ConfDir: " << confDir << "\n\n";

    if (!configuredCitationCatalog.catalogText.empty()) {
        out << InlineConf::formatInlineCitationCatalogBlock(
            configuredCitationCatalog.catalogText) << "\n";
    }

    for (const auto& kv : confTexts) {
        out << InlineConf::formatInlineConfBlock(kv.first, kv.second) << "\n";
    }

    out.close();
    std::cout << "Wrote bundled file: " << outputFile << std::endl;
    return 0;
}
