#include "common/inline_conf.h"
#include "common/utils.h"

#include <fstream>
#include <sstream>

namespace InlineConf {

static const char* kBeginTag = "BANEWFN_INLINE_CONF_BEGIN";
static const char* kEndTag   = "BANEWFN_INLINE_CONF_END";
static const char* kCitationBeginTag = "BANEWFN_INLINE_CITATIONS_BEGIN";
static const char* kCitationEndTag   = "BANEWFN_INLINE_CITATIONS_END";

static bool parseMarker(const std::string& trimmed, const char* arrow, const char* tag,
                        std::string* outModule) {
    // Expected: "#>>> TAG module" or "#<<< TAG module"
    // where arrow is "#>>>" or "#<<<".
    std::vector<std::string> tokens = Utils::split(trimmed, ' ');
    if (tokens.size() < 2) return false;
    if (tokens[0] != arrow) return false;
    if (tokens[1] != tag) return false;
    if (outModule) {
        if (tokens.size() >= 3) {
            *outModule = tokens[2];
        } else {
            outModule->clear();
        }
    }
    return true;
}

static std::string stripOneLeadingComment(const std::string& line) {
    // Remove one leading '#' and an optional following whitespace.
    if (!line.empty() && line[0] == '#') {
        std::string out = line.substr(1);
        if (!out.empty() && (out[0] == ' ' || out[0] == '\t')) {
            out.erase(0, 1);
        }
        return out;
    }
    return line;
}

std::map<std::string, std::string> extractInlineConfs(const std::string& filepath) {
    std::map<std::string, std::string> result;

    std::ifstream file(filepath);
    if (!file.is_open()) {
        return result;
    }

    bool inBlock = false;
    std::string currentModule;
    std::stringstream buf;

    std::string line;
    while (std::getline(file, line)) {
        std::string trimmed = Utils::trim(line);

        if (!inBlock) {
            std::string mod;
            if (parseMarker(trimmed, "#>>>", kBeginTag, &mod)) {
                inBlock = true;
                currentModule = mod;
                buf.str("");
                buf.clear();
            }
            continue;
        }

        // inBlock
        std::string endMod;
        if (parseMarker(trimmed, "#<<<", kEndTag, &endMod)) {
            // Optional sanity check: if endMod is present, it should match.
            // Still accept mismatches.
            result[currentModule] = buf.str();
            inBlock = false;
            currentModule.clear();
            buf.str("");
            buf.clear();
            continue;
        }

        // Strip one comment prefix for conf content.
        buf << stripOneLeadingComment(line) << "\n";
    }

    // If file ends while in a block, keep what we collected.
    if (inBlock && !currentModule.empty()) {
        result[currentModule] = buf.str();
    }

    return result;
}

std::string extractInlineCitationCatalog(const std::string& filepath) {
    std::ifstream file(filepath);
    if (!file.is_open()) {
        return "";
    }

    bool inBlock = false;
    std::stringstream buf;
    std::string line;
    while (std::getline(file, line)) {
        const std::string trimmed = Utils::trim(line);
        if (!inBlock) {
            if (parseMarker(trimmed, "#>>>", kCitationBeginTag, nullptr)) {
                inBlock = true;
            }
            continue;
        }

        if (parseMarker(trimmed, "#<<<", kCitationEndTag, nullptr)) {
            return buf.str();
        }
        buf << stripOneLeadingComment(line) << "\n";
    }

    return inBlock ? buf.str() : std::string();
}

std::string stripInlineConfsFromFile(const std::string& filepath) {
    std::ifstream file(filepath);
    if (!file.is_open()) {
        return "";
    }

    std::stringstream out;
    std::string line;
    while (std::getline(file, line)) {
        std::string trimmed = Utils::trim(line);
        std::string mod;
        if (parseMarker(trimmed, "#>>>", kBeginTag, &mod) ||
            parseMarker(trimmed, "#>>>", kCitationBeginTag, nullptr)) {
            // Stop copying anything from first inline-conf block.
            break;
        }
        out << line << "\n";
    }
    return out.str();
}

std::string formatInlineConfBlock(const std::string& moduleName, const std::string& confText) {
    std::stringstream out;
    out << "#>>> " << kBeginTag << " " << moduleName << "\n";

    // One metadata line as a conf comment (after stripping one '#', it remains '#')
    out << "## bundled module: " << moduleName << "\n";

    std::stringstream ss(confText);
    std::string line;
    while (std::getline(ss, line)) {
        out << "# " << line << "\n";
    }

    out << "#<<< " << kEndTag << " " << moduleName << "\n";
    return out.str();
}

std::string formatInlineCitationCatalogBlock(const std::string& catalogText) {
    std::stringstream out;
    out << "#>>> " << kCitationBeginTag << "\n";
    out << "## bundled citation catalog\n";

    std::stringstream ss(catalogText);
    std::string line;
    while (std::getline(ss, line)) {
        out << "# " << line << "\n";
    }

    out << "#<<< " << kCitationEndTag << "\n";
    return out.str();
}

} // namespace InlineConf
