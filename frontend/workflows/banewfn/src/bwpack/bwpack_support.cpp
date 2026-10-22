#include "bwpack/bwpack_support.h"

#include "common/citation.h"
#include "common/config.h"
#include "common/input.h"
#include "common/utils.h"

#include <algorithm>
#include <cerrno>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <vector>

namespace {

struct SourceLine {
    std::string text;
    bool hasNewline = false;
};

std::vector<SourceLine> splitLines(const std::string& content) {
    std::vector<SourceLine> lines;
    std::size_t cursor = 0;
    while (cursor < content.size()) {
        const std::size_t newline = content.find('\n', cursor);
        if (newline == std::string::npos) {
            lines.push_back({content.substr(cursor), false});
            break;
        }
        lines.push_back({content.substr(cursor, newline - cursor), true});
        cursor = newline + 1;
    }
    return lines;
}

std::string leadingWhitespace(const std::string& line) {
    const std::size_t first = line.find_first_not_of(" \t");
    return first == std::string::npos ? line : line.substr(0, first);
}

bool isCitationEnd(const std::string& line) {
    const std::string trimmed = Utils::trim(Utils::removeInlineComment(line));
    return trimmed == "}" || trimmed == "};";
}

bool parseOriginLine(const std::string& origin, std::size_t& lineNumber) {
    const std::size_t separator = origin.find_last_of(':');
    if (separator == std::string::npos || separator + 1 >= origin.size()) {
        return false;
    }

    const std::string value = origin.substr(separator + 1);
    char* end = nullptr;
    errno = 0;
    const unsigned long long parsed = std::strtoull(value.c_str(), &end, 10);
    if (errno != 0 || end == value.c_str() || *end != '\0' || parsed == 0 ||
        parsed > static_cast<unsigned long long>(
            std::numeric_limits<std::size_t>::max())) {
        return false;
    }
    lineNumber = static_cast<std::size_t>(parsed);
    return true;
}

std::map<std::size_t, const ModuleTask*> collectCitationTasks(
    const std::vector<ModuleTask>& tasks) {
    std::map<std::size_t, const ModuleTask*> byLine;
    for (const auto& task : tasks) {
        if (!task.isCitation()) {
            continue;
        }
        std::size_t lineNumber = 0;
        if (parseOriginLine(task.origin, lineNumber)) {
            byLine[lineNumber] = &task;
        }
    }
    return byLine;
}

std::vector<std::string> parseAuthors(const std::string& rawAuthors) {
    std::vector<std::string> authors;
    for (const auto& author : Utils::split(rawAuthors, ';')) {
        const std::string cleaned = Utils::trim(author);
        if (!cleaned.empty()) {
            authors.push_back(cleaned);
        }
    }
    return authors;
}

std::string joinAuthors(const std::vector<std::string>& authors) {
    std::ostringstream out;
    for (std::size_t i = 0; i < authors.size(); ++i) {
        if (i > 0) {
            out << "; ";
        }
        out << authors[i];
    }
    return out.str();
}

std::string quoteDslValue(const std::string& value) {
    if (value.find('"') == std::string::npos) {
        return '"' + value + '"';
    }
    if (value.find('\'') == std::string::npos) {
        return '\'' + value + '\'';
    }

    std::string unquoted;
    unquoted.reserve(value.size());
    for (char c : value) {
        if (c == '#') {
            unquoted += "\\#";
        } else {
            unquoted.push_back(c);
        }
    }
    return unquoted;
}

std::map<std::string, std::string> normalizedFields(const ModuleTask& task) {
    std::map<std::string, std::string> fields;
    for (const auto& param : task.params) {
        fields[Utils::toLowerAscii(Utils::trim(param.first))] =
            Utils::trim(param.second);
    }
    return fields;
}

void overlayField(CitationRecord& record,
                  const std::string& key,
                  const std::string& value) {
    if (value.empty()) {
        return;
    }
    if (key == "authors") record.authors = parseAuthors(value);
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

bool definesSelfContainedCitation(
    const std::map<std::string, std::string>& fields) {
    const auto titleIt = fields.find("title");
    if (titleIt != fields.end() && !titleIt->second.empty()) {
        return true;
    }
    const auto textIt = fields.find("text");
    return textIt != fields.end() && !textIt->second.empty();
}

bool hasUnknownFields(const std::map<std::string, std::string>& fields,
                      std::string& unknownField) {
    static const std::set<std::string> allowedFields = {
        "reason", "authors", "title", "journal", "year", "volume",
        "issue", "pages", "doi", "url", "text"
    };
    for (const auto& field : fields) {
        if (allowedFields.count(field.first) == 0) {
            unknownField = field.first;
            return true;
        }
    }
    return false;
}

void writeField(std::ostringstream& out,
                const std::string& indent,
                const std::string& key,
                const std::string& value) {
    if (!value.empty()) {
        out << indent << "    " << key << " = " << quoteDslValue(value) << "\n";
    }
}

std::string formatCitationBlock(const std::string& id,
                                const CitationRecord& record,
                                const std::string& reason,
                                const std::string& indent,
                                bool trailingNewline) {
    std::ostringstream out;
    out << indent << "bane.cite " << id << " {\n";
    writeField(out, indent, "reason", reason);
    writeField(out, indent, "authors", joinAuthors(record.authors));
    writeField(out, indent, "title", record.title);
    writeField(out, indent, "journal", record.journal);
    writeField(out, indent, "year", record.year);
    writeField(out, indent, "volume", record.volume);
    writeField(out, indent, "issue", record.issue);
    writeField(out, indent, "pages", record.pages);
    writeField(out, indent, "doi", record.doi);
    writeField(out, indent, "url", record.url);
    writeField(out, indent, "text", record.text);
    out << indent << "}";
    if (trailingNewline) {
        out << "\n";
    }
    return out.str();
}

void copyLines(std::ostringstream& output,
               const std::vector<SourceLine>& lines,
               std::size_t begin,
               std::size_t endInclusive) {
    for (std::size_t lineIndex = begin; lineIndex <= endInclusive; ++lineIndex) {
        output << lines[lineIndex].text;
        if (lines[lineIndex].hasNewline) {
            output << '\n';
        }
    }
}

std::string normalizedCitationId(const std::string& id) {
    return Utils::toLowerAscii(Utils::trim(id));
}

bool citationBindingMatches(const ConfigCitationBinding& binding,
                            const std::set<std::string>& activeSections) {
    return std::any_of(binding.targets.begin(), binding.targets.end(),
                       [&](const std::string& target) {
                           return activeSections.count(target) != 0;
                       });
}

std::vector<std::string> collectConfiguredCitationIds(
    const ConfigManager& configs,
    const std::vector<ModuleTask>& tasks) {
    std::vector<std::string> ids;
    std::set<std::string> seen;

    for (const auto& task : tasks) {
        if (!task.isWorkflow() || task.moduleName.empty() ||
            !configs.hasModuleConfig(task.moduleName)) {
            continue;
        }

        std::set<std::string> activeSections = {"main"};
        for (const auto& step : task.postProcessSteps) {
            activeSections.insert(step.first);
        }

        const ModuleConfig& module = configs.getModuleConfig(task.moduleName);
        for (const auto& binding : module.citationBindings) {
            if (!citationBindingMatches(binding, activeSections)) {
                continue;
            }
            const std::string key = normalizedCitationId(binding.id);
            if (!key.empty() && seen.insert(key).second) {
                ids.push_back(Utils::trim(binding.id));
            }
        }
    }
    return ids;
}

bool recordHasBibliographicFields(const CitationRecord& record) {
    return !record.authors.empty() || !record.title.empty() ||
        !record.journal.empty() || !record.year.empty() || !record.volume.empty() ||
        !record.issue.empty() || !record.pages.empty() || !record.doi.empty() ||
        !record.url.empty() || !record.text.empty();
}

bool recordHasPlaceholders(const CitationRecord& record) {
    const auto containsPlaceholder = [](const std::string& value) {
        return value.find('$') != std::string::npos;
    };
    if (containsPlaceholder(record.id) || containsPlaceholder(record.title) ||
        containsPlaceholder(record.journal) || containsPlaceholder(record.year) ||
        containsPlaceholder(record.volume) || containsPlaceholder(record.issue) ||
        containsPlaceholder(record.pages) || containsPlaceholder(record.doi) ||
        containsPlaceholder(record.url) || containsPlaceholder(record.text)) {
        return true;
    }
    return std::any_of(record.authors.begin(), record.authors.end(), containsPlaceholder);
}

bool resolveConfiguredCitation(const std::string& citationId,
                               const CitationManager& catalog,
                               const std::vector<ModuleTask>& tasks,
                               const std::string& sourceName,
                               CitationRecord& record) {
    const bool foundInCatalog = catalog.getRecord(citationId, record);
    if (!foundInCatalog) {
        record = CitationRecord();
        record.id = citationId;
    }

    bool foundInlineDefinition = false;
    std::set<std::string> inlineOverrides;
    for (const auto& task : tasks) {
        if (!task.isCitation() ||
            normalizedCitationId(task.citationId) != normalizedCitationId(citationId)) {
            continue;
        }

        const std::map<std::string, std::string> fields = normalizedFields(task);
        std::string unknownField;
        if (hasUnknownFields(fields, unknownField)) {
            std::cerr << "Error: Cannot bundle configured citation " << citationId
                      << " from " << sourceName << " because bane.cite "
                      << task.citationId << " contains unknown field '"
                      << unknownField << "'" << std::endl;
            return false;
        }

        const auto doiIt = fields.find("doi");
        if (doiIt != fields.end() && !doiIt->second.empty() &&
            !Utils::trim(record.doi).empty() &&
            CitationManager::normalizeDoi(doiIt->second) !=
                CitationManager::normalizeDoi(record.doi)) {
            std::cerr << "Error: Cannot bundle configured citation " << citationId
                      << " from " << sourceName
                      << "; its inline DOI conflicts with citations.conf" << std::endl;
            return false;
        }

        for (const auto& field : fields) {
            if (field.first == "reason" || field.second.empty() ||
                inlineOverrides.count(field.first) != 0) {
                continue;
            }
            overlayField(record, field.first, field.second);
            inlineOverrides.insert(field.first);
            foundInlineDefinition = true;
        }
    }

    record.id = citationId;
    record.doi = CitationManager::normalizeDoi(record.doi);
    if (!foundInCatalog && !foundInlineDefinition) {
        std::cerr << "Error: Citation id '" << citationId
                  << "' is selected by a module [citations] binding, but no matching "
                     "record was found while bundling "
                  << sourceName << std::endl;
        return false;
    }
    if (!recordHasBibliographicFields(record) ||
        (Utils::trim(record.title).empty() && Utils::trim(record.text).empty())) {
        std::cerr << "Error: Citation id '" << citationId
                  << "' selected by a module [citations] binding must define title or text"
                  << " while bundling " << sourceName << std::endl;
        return false;
    }
    if (recordHasPlaceholders(record)) {
        std::cerr << "Error: Citation id '" << citationId
                  << "' selected by a module [citations] binding contains unresolved "
                     "placeholders while bundling "
                  << sourceName << std::endl;
        return false;
    }
    return true;
}

void writeCatalogField(std::ostringstream& out,
                       const std::string& key,
                       const std::string& value) {
    if (!value.empty()) {
        out << key << " = " << quoteDslValue(value) << "\n";
    }
}

std::string formatCatalogRecord(const CitationRecord& record) {
    std::ostringstream out;
    out << "[" << record.id << "]\n";
    writeCatalogField(out, "authors", joinAuthors(record.authors));
    writeCatalogField(out, "title", record.title);
    writeCatalogField(out, "journal", record.journal);
    writeCatalogField(out, "year", record.year);
    writeCatalogField(out, "volume", record.volume);
    writeCatalogField(out, "issue", record.issue);
    writeCatalogField(out, "pages", record.pages);
    writeCatalogField(out, "doi", record.doi);
    writeCatalogField(out, "url", record.url);
    writeCatalogField(out, "text", record.text);
    return out.str();
}

} // namespace

namespace Bwpack {

CitationExpansionResult expandCatalogCitations(const std::string& content,
                                                const CitationManager& catalog,
                                                const std::vector<ModuleTask>& tasks,
                                                const std::string& sourceName) {
    CitationExpansionResult result;
    const std::vector<SourceLine> lines = splitLines(content);
    const std::map<std::size_t, const ModuleTask*> citationTasks =
        collectCitationTasks(tasks);
    std::ostringstream output;

    for (std::size_t i = 0; i < lines.size();) {
        const auto taskIt = citationTasks.find(i + 1);
        if (taskIt == citationTasks.end()) {
            output << lines[i].text;
            if (lines[i].hasNewline) {
                output << '\n';
            }
            ++i;
            continue;
        }

        const ModuleTask& task = *taskIt->second;
        const std::string citationId = Utils::trim(task.citationId);
        std::size_t end = i + 1;
        for (; end < lines.size(); ++end) {
            if (isCitationEnd(lines[end].text)) {
                break;
            }
        }
        if (end == lines.size()) {
            std::cerr << "Error: Cannot expand bane.cite " << citationId
                      << " at " << sourceName << ":" << (i + 1)
                      << "; the citation block is not terminated" << std::endl;
            result.success = false;
            output << lines[i].text;
            if (lines[i].hasNewline) {
                output << '\n';
            }
            ++i;
            continue;
        }

        const std::map<std::string, std::string> fields = normalizedFields(task);
        bool blockSuccess = true;
        std::string unknownField;
        if (hasUnknownFields(fields, unknownField)) {
            std::cerr << "Error: Cannot expand bane.cite " << citationId
                      << " at " << sourceName << ":" << (i + 1)
                      << " because it contains unknown field '" << unknownField << "'"
                      << std::endl;
            result.success = false;
            blockSuccess = false;
        }

        CitationRecord record;
        const bool foundInCatalog = catalog.getRecord(citationId, record);
        if (!foundInCatalog) {
            if (!definesSelfContainedCitation(fields)) {
                std::cerr << "Error: Cannot expand bane.cite " << citationId
                          << " at " << sourceName << ":" << (i + 1)
                          << "; no matching record was found in citations.conf"
                          << std::endl;
                result.success = false;
            }
            copyLines(output, lines, i, end);
            i = end + 1;
            continue;
        }

        const auto doiIt = fields.find("doi");
        if (doiIt != fields.end() && !doiIt->second.empty() &&
            !Utils::trim(record.doi).empty() &&
            CitationManager::normalizeDoi(doiIt->second) !=
                CitationManager::normalizeDoi(record.doi)) {
            std::cerr << "Error: Cannot expand bane.cite " << citationId
                      << " at " << sourceName << ":" << (i + 1)
                      << "; the inline DOI conflicts with citations.conf"
                      << std::endl;
            result.success = false;
            blockSuccess = false;
        }

        if (!blockSuccess) {
            copyLines(output, lines, i, end);
            i = end + 1;
            continue;
        }

        record.id = citationId;
        for (const auto& field : fields) {
            overlayField(record, field.first, field.second);
        }

        const auto reasonIt = fields.find("reason");
        const std::string reason = reasonIt == fields.end() ? std::string() : reasonIt->second;
        output << formatCitationBlock(citationId, record, reason,
                                      leadingWhitespace(lines[i].text),
                                      lines[end].hasNewline);
        ++result.expandedCount;
        i = end + 1;
    }

    result.content = output.str();
    return result;
}

ConfiguredCitationCatalogResult buildConfiguredCitationCatalog(
    const CitationManager& catalog,
    const ConfigManager& configs,
    const std::vector<ModuleTask>& tasks,
    const std::string& sourceName) {
    ConfiguredCitationCatalogResult result;
    const std::vector<std::string> citationIds =
        collectConfiguredCitationIds(configs, tasks);

    std::ostringstream catalogText;
    for (const auto& citationId : citationIds) {
        CitationRecord record;
        if (!resolveConfiguredCitation(
                citationId, catalog, tasks, sourceName, record)) {
            result.success = false;
            return result;
        }
        catalogText << formatCatalogRecord(record) << "\n";
        ++result.recordCount;
    }

    result.catalogText = catalogText.str();
    return result;
}

} // namespace Bwpack
