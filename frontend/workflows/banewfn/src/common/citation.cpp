#include "common/citation.h"
#include "common/utils.h"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <system_error>

namespace {

std::string expandVersionPlaceholder(std::string value) {
    const std::string placeholder = "@BANEWFN_VERSION@";
    std::size_t pos = 0;
    while ((pos = value.find(placeholder, pos)) != std::string::npos) {
        value.replace(pos, placeholder.size(), BANEWFN_VERSION);
        pos += sizeof(BANEWFN_VERSION) - 1;
    }
    return value;
}

std::string normalizedId(const std::string& id) {
    return Utils::toLowerAscii(Utils::trim(id));
}

std::vector<std::string> parseAuthors(const std::string& raw) {
    std::vector<std::string> authors;
    for (const auto& item : Utils::split(raw, ';')) {
        const std::string author = Utils::trim(item);
        if (!author.empty()) {
            authors.push_back(author);
        }
    }
    return authors;
}

std::string joinAuthors(const std::vector<std::string>& authors, const std::string& separator) {
    std::ostringstream out;
    for (std::size_t i = 0; i < authors.size(); ++i) {
        if (i > 0) {
            out << separator;
        }
        out << authors[i];
    }
    return out.str();
}

std::string compactAuthor(const std::string& author) {
    const std::string cleaned = Utils::trim(author);
    if (cleaned.empty() || cleaned.find(',') != std::string::npos) {
        return cleaned;
    }

    std::istringstream input(cleaned);
    std::vector<std::string> parts;
    std::string part;
    while (input >> part) {
        parts.push_back(part);
    }
    if (parts.size() <= 1) {
        return cleaned;
    }

    std::ostringstream out;
    for (std::size_t i = 0; i + 1 < parts.size(); ++i) {
        if (!parts[i].empty()) {
            out << parts[i][0] << ". ";
        }
    }
    out << parts.back();
    return out.str();
}

std::string formatPlainAuthors(const std::vector<std::string>& authors) {
    if (authors.empty()) {
        return "";
    }

    std::vector<std::string> compact;
    compact.reserve(authors.size());
    for (const auto& author : authors) {
        compact.push_back(compactAuthor(author));
    }

    if (compact.size() == 1) {
        return compact.front();
    }
    if (compact.size() == 2) {
        return compact[0] + " and " + compact[1];
    }

    std::ostringstream out;
    for (std::size_t i = 0; i < compact.size(); ++i) {
        if (i > 0) {
            out << (i + 1 == compact.size() ? ", and " : ", ");
        }
        out << compact[i];
    }
    return out.str();
}

std::string formatPlainRecord(const CitationRecord& record) {
    if (!Utils::trim(record.text).empty()) {
        return Utils::trim(record.text);
    }

    std::ostringstream out;
    const std::string authors = formatPlainAuthors(record.authors);
    if (!authors.empty()) {
        out << authors;
    }
    if (!record.title.empty()) {
        if (out.tellp() > 0) {
            out << ", ";
        }
        out << '"' << record.title << '"';
    }
    if (!record.journal.empty()) {
        if (out.tellp() > 0) {
            out << ", ";
        }
        out << record.journal;
    }
    if (!record.year.empty()) {
        out << " " << record.year;
    }
    if (!record.volume.empty()) {
        out << ", " << record.volume;
        if (!record.issue.empty()) {
            out << "(" << record.issue << ")";
        }
    }
    if (!record.pages.empty()) {
        out << ", " << record.pages;
    }
    if (out.tellp() > 0 && out.str().back() != '.') {
        out << '.';
    }
    if (!record.doi.empty()) {
        if (out.tellp() > 0) {
            out << " ";
        }
        out << "DOI: " << CitationManager::normalizeDoi(record.doi);
    }
    if (!record.url.empty()) {
        if (out.tellp() > 0) {
            out << " ";
        }
        out << "URL: " << record.url;
    }
    return out.str();
}

std::string bibtexEscape(const std::string& value) {
    std::string result;
    result.reserve(value.size());
    for (char c : value) {
        switch (c) {
            case '&': result += "\\&"; break;
            case '%': result += "\\%"; break;
            case '#': result += "\\#"; break;
            case '_': result += "\\_"; break;
            default: result.push_back(c); break;
        }
    }
    return result;
}

std::string bibtexKey(const std::string& id) {
    std::string key;
    for (unsigned char c : id) {
        if (std::isalnum(c) || c == '_' || c == '-' || c == ':') {
            key.push_back(static_cast<char>(c));
        }
    }
    return key.empty() ? "citation" : key;
}

std::string bibtexUnescape(const std::string& value) {
    std::string result;
    result.reserve(value.size());
    for (std::size_t i = 0; i < value.size(); ++i) {
        if (value[i] == '\\' && i + 1 < value.size()) {
            const char next = value[i + 1];
            if (next == '&' || next == '%' || next == '#' || next == '_') {
                result.push_back(next);
                ++i;
                continue;
            }
        }
        result.push_back(value[i]);
    }
    return result;
}

std::vector<std::string> parseBibtexAuthors(const std::string& raw) {
    std::vector<std::string> authors;
    std::size_t begin = 0;
    while (begin <= raw.size()) {
        const std::size_t separator = raw.find(" and ", begin);
        const std::size_t end = separator == std::string::npos ? raw.size() : separator;
        const std::string author = Utils::trim(raw.substr(begin, end - begin));
        if (!author.empty()) {
            authors.push_back(author);
        }
        if (separator == std::string::npos) {
            break;
        }
        begin = separator + 5;
    }
    return authors;
}

struct ParsedBibtexEntry {
    std::string type;
    std::string key;
    std::map<std::string, std::string> fields;
};

void skipBibtexSpace(const std::string& text, std::size_t& pos) {
    while (pos < text.size() && std::isspace(static_cast<unsigned char>(text[pos]))) {
        ++pos;
    }
}

bool parseBibtexValue(const std::string& text,
                      std::size_t& pos,
                      char entryClose,
                      std::string& value) {
    skipBibtexSpace(text, pos);
    if (pos >= text.size()) {
        return false;
    }

    std::ostringstream out;
    if (text[pos] == '{') {
        ++pos;
        int depth = 1;
        while (pos < text.size() && depth > 0) {
            const char c = text[pos++];
            if (c == '{') {
                ++depth;
                if (depth > 1) out << c;
            } else if (c == '}') {
                --depth;
                if (depth > 0) out << c;
            } else {
                out << c;
            }
        }
        if (depth != 0) {
            return false;
        }
    } else if (text[pos] == '"') {
        ++pos;
        bool escaped = false;
        bool closed = false;
        while (pos < text.size()) {
            const char c = text[pos++];
            if (c == '"' && !escaped) {
                closed = true;
                break;
            }
            out << c;
            if (c == '\\' && !escaped) {
                escaped = true;
            } else {
                escaped = false;
            }
        }
        if (!closed) {
            return false;
        }
    } else {
        while (pos < text.size() && text[pos] != ',' && text[pos] != entryClose) {
            out << text[pos++];
        }
    }

    value = bibtexUnescape(Utils::trim(out.str()));
    return true;
}

bool parseBibtex(const std::string& text,
                 std::vector<ParsedBibtexEntry>& entries,
                 std::string& error) {
    std::size_t pos = 0;
    while (true) {
        const std::size_t at = text.find('@', pos);
        if (at == std::string::npos) {
            return true;
        }
        pos = at + 1;
        skipBibtexSpace(text, pos);

        const std::size_t typeBegin = pos;
        while (pos < text.size() &&
               (std::isalnum(static_cast<unsigned char>(text[pos])) || text[pos] == '_')) {
            ++pos;
        }
        const std::string type = Utils::toLowerAscii(text.substr(typeBegin, pos - typeBegin));
        skipBibtexSpace(text, pos);
        if (type.empty() || pos >= text.size() || (text[pos] != '{' && text[pos] != '(')) {
            error = "invalid entry header near byte " + std::to_string(at);
            return false;
        }

        const char entryClose = text[pos] == '{' ? '}' : ')';
        ++pos;
        skipBibtexSpace(text, pos);
        const std::size_t keyBegin = pos;
        while (pos < text.size() && text[pos] != ',' && text[pos] != entryClose) {
            ++pos;
        }
        if (pos >= text.size() || text[pos] != ',') {
            error = "missing citation key separator near byte " + std::to_string(at);
            return false;
        }

        ParsedBibtexEntry entry;
        entry.type = type;
        entry.key = Utils::trim(text.substr(keyBegin, pos - keyBegin));
        ++pos;

        while (true) {
            skipBibtexSpace(text, pos);
            while (pos < text.size() && text[pos] == ',') {
                ++pos;
                skipBibtexSpace(text, pos);
            }
            if (pos >= text.size()) {
                error = "unterminated entry '" + entry.key + "'";
                return false;
            }
            if (text[pos] == entryClose) {
                ++pos;
                break;
            }

            const std::size_t fieldBegin = pos;
            while (pos < text.size() &&
                   (std::isalnum(static_cast<unsigned char>(text[pos])) ||
                    text[pos] == '_' || text[pos] == '-')) {
                ++pos;
            }
            const std::string field = Utils::toLowerAscii(
                Utils::trim(text.substr(fieldBegin, pos - fieldBegin)));
            skipBibtexSpace(text, pos);
            if (field.empty() || pos >= text.size() || text[pos] != '=') {
                error = "invalid field in entry '" + entry.key + "'";
                return false;
            }
            ++pos;

            std::string value;
            if (!parseBibtexValue(text, pos, entryClose, value)) {
                error = "invalid value for field '" + field + "' in entry '" + entry.key + "'";
                return false;
            }
            entry.fields[field] = value;
            skipBibtexSpace(text, pos);
            if (pos < text.size() && text[pos] == ',') {
                ++pos;
            }
        }

        if (!entry.key.empty() && type != "comment" && type != "preamble" && type != "string") {
            entries.push_back(entry);
        }
    }
}

std::string fieldValue(const ParsedBibtexEntry& entry, const std::string& name) {
    const auto it = entry.fields.find(name);
    return it == entry.fields.end() ? "" : it->second;
}

bool isSoftwareOrigin(const std::string& origin) {
    return Utils::toLowerAscii(Utils::trim(origin)).rfind("software:", 0) == 0;
}

bool ensureParentDirectory(const std::string& path) {
    namespace fs = std::filesystem;
    const fs::path outputPath(path);
    const fs::path parent = outputPath.parent_path();
    if (parent.empty()) {
        return true;
    }

    std::error_code ec;
    fs::create_directories(parent, ec);
    if (ec) {
        std::cerr << "Error: Cannot create citation output directory '"
                  << parent.string() << "': " << ec.message() << std::endl;
        return false;
    }
    return true;
}

bool sameText(const std::string& lhs, const std::string& rhs) {
    return Utils::trim(lhs) == Utils::trim(rhs);
}

bool sameAuthors(const std::vector<std::string>& lhs,
                 const std::vector<std::string>& rhs) {
    if (lhs.size() != rhs.size()) {
        return false;
    }
    for (std::size_t i = 0; i < lhs.size(); ++i) {
        if (!sameText(lhs[i], rhs[i])) {
            return false;
        }
    }
    return true;
}

void warnConflict(const std::string& identity,
                  const std::string& field,
                  const std::string& oldOrigin,
                  const std::string& newOrigin,
                  bool newWins) {
    std::cerr << "Warning: Citation conflict for " << identity
              << " field '" << field << "' between " << oldOrigin
              << " and " << newOrigin << "; "
              << (newWins ? "using the higher-priority value from " + newOrigin
                          : "keeping the value from " + oldOrigin)
              << std::endl;
}

} // namespace

std::string CitationManager::normalizeDoi(const std::string& doi) {
    std::string value = Utils::toLowerAscii(Utils::trim(doi));
    const std::vector<std::string> prefixes = {
        "https://doi.org/",
        "http://doi.org/",
        "http://dx.doi.org/",
        "https://dx.doi.org/",
        "doi:"
    };

    bool removed = true;
    while (removed) {
        removed = false;
        for (const auto& prefix : prefixes) {
            if (value.rfind(prefix, 0) == 0) {
                value = Utils::trim(value.substr(prefix.size()));
                removed = true;
                break;
            }
        }
    }
    return value;
}

bool CitationManager::loadCatalog(const std::string& path) {
    std::ifstream input(path);
    if (!input.is_open()) {
        std::cerr << "Error: Cannot open citation catalog: " << path << std::endl;
        return false;
    }
    return loadCatalogStream(input, path, 0);
}

bool CitationManager::loadCatalogFromText(const std::string& text,
                                          const std::string& origin) {
    std::istringstream input(text);
    return loadCatalogStream(input, origin.empty() ? "inline-catalog" : origin, 1);
}

bool CitationManager::loadCatalogStream(std::istream& input,
                                        const std::string& sourceName,
                                        int priority) {
    CitationRecord current;
    std::string currentSection;
    std::size_t lineNumber = 0;
    bool ok = true;

    auto flush = [&]() {
        if (currentSection.empty()) {
            return;
        }
        if (current.id.empty()) {
            current.id = currentSection;
        }
        const std::string origin = "catalog:" + sourceName + ":[" + currentSection + "]";
        if (!addRecord(current, origin, priority)) {
            ok = false;
        }
        current = CitationRecord();
        currentSection.clear();
    };

    std::string line;
    while (std::getline(input, line)) {
        ++lineNumber;
        line = Utils::trim(Utils::removeInlineComment(line));
        if (line.empty()) {
            continue;
        }

        if (line.front() == '[' && line.back() == ']') {
            flush();
            currentSection = Utils::trim(line.substr(1, line.size() - 2));
            const std::string prefix = "citation ";
            if (Utils::toLowerAscii(currentSection).rfind(prefix, 0) == 0) {
                currentSection = Utils::trim(currentSection.substr(prefix.size()));
            }
            if (currentSection.empty()) {
                std::cerr << "Error: Empty citation catalog section at " << sourceName
                          << ":" << lineNumber << std::endl;
                ok = false;
            }
            current.id = currentSection;
            continue;
        }

        if (currentSection.empty()) {
            std::cerr << "Error: Citation catalog field outside a section at "
                      << sourceName << ":" << lineNumber << std::endl;
            ok = false;
            continue;
        }

        const std::size_t eqPos = line.find('=');
        if (eqPos == std::string::npos) {
            std::cerr << "Error: Invalid citation catalog field at " << sourceName
                      << ":" << lineNumber << std::endl;
            ok = false;
            continue;
        }

        const std::string key = Utils::toLowerAscii(Utils::trim(line.substr(0, eqPos)));
        const std::string value = Utils::trimQuotes(Utils::trim(line.substr(eqPos + 1)));
        if (key == "id") current.id = value;
        else if (key == "authors") current.authors = parseAuthors(value);
        else if (key == "title") current.title = expandVersionPlaceholder(value);
        else if (key == "journal") current.journal = value;
        else if (key == "year") current.year = value;
        else if (key == "volume") current.volume = value;
        else if (key == "issue") current.issue = value;
        else if (key == "pages") current.pages = value;
        else if (key == "doi") current.doi = value;
        else if (key == "url") current.url = value;
        else if (key == "text") current.text = expandVersionPlaceholder(value);
        else {
            std::cerr << "Warning: Unknown citation catalog field '" << key
                      << "' at " << sourceName << ":" << lineNumber << std::endl;
        }
    }

    flush();
    return ok;
}

bool CitationManager::addOrOverride(const CitationRecord& record) {
    return addOrOverride(record, "input:" + record.id);
}

bool CitationManager::addOrOverride(const CitationRecord& record,
                                    const std::string& origin) {
    return addRecord(record, origin.empty() ? "input:" + record.id : origin, 2);
}

CitationManager::StoredRecord CitationManager::makeStoredRecord(
    const CitationRecord& record,
    const std::string& origin,
    int priority) const {
    StoredRecord stored;
    stored.record = record;
    stored.origin = origin;
    stored.priority = priority;

    const FieldSource source{origin, priority};
    if (!record.authors.empty()) stored.fieldSources["authors"] = source;
    if (!record.title.empty()) stored.fieldSources["title"] = source;
    if (!record.journal.empty()) stored.fieldSources["journal"] = source;
    if (!record.year.empty()) stored.fieldSources["year"] = source;
    if (!record.volume.empty()) stored.fieldSources["volume"] = source;
    if (!record.issue.empty()) stored.fieldSources["issue"] = source;
    if (!record.pages.empty()) stored.fieldSources["pages"] = source;
    if (!record.doi.empty()) stored.fieldSources["doi"] = source;
    if (!record.url.empty()) stored.fieldSources["url"] = source;
    if (!record.text.empty()) stored.fieldSources["text"] = source;
    return stored;
}

void CitationManager::mergeStoredRecord(StoredRecord& target,
                                        const StoredRecord& incoming,
                                        const std::string& identity) {
    auto sourceFor = [](const StoredRecord& stored, const std::string& field) {
        const auto it = stored.fieldSources.find(field);
        if (it != stored.fieldSources.end()) {
            return it->second;
        }
        return FieldSource{stored.origin, stored.priority};
    };

    auto mergeString = [&](std::string& oldValue,
                           const std::string& newValue,
                           const std::string& field) {
        if (newValue.empty()) {
            return;
        }

        const FieldSource newSource = sourceFor(incoming, field);
        if (oldValue.empty()) {
            oldValue = newValue;
            target.fieldSources[field] = newSource;
            return;
        }

        const FieldSource oldSource = sourceFor(target, field);
        if (sameText(oldValue, newValue)) {
            if (newSource.priority > oldSource.priority) {
                target.fieldSources[field] = newSource;
            }
            return;
        }

        const bool newWins = newSource.priority > oldSource.priority;
        warnConflict(identity, field, oldSource.origin, newSource.origin, newWins);
        if (newWins) {
            oldValue = newValue;
            target.fieldSources[field] = newSource;
        }
    };

    if (!incoming.record.authors.empty()) {
        const FieldSource newSource = sourceFor(incoming, "authors");
        if (target.record.authors.empty()) {
            target.record.authors = incoming.record.authors;
            target.fieldSources["authors"] = newSource;
        } else {
            const FieldSource oldSource = sourceFor(target, "authors");
            if (sameAuthors(target.record.authors, incoming.record.authors)) {
                if (newSource.priority > oldSource.priority) {
                    target.fieldSources["authors"] = newSource;
                }
            } else {
                const bool newWins = newSource.priority > oldSource.priority;
                warnConflict(identity, "authors", oldSource.origin, newSource.origin, newWins);
                if (newWins) {
                    target.record.authors = incoming.record.authors;
                    target.fieldSources["authors"] = newSource;
                }
            }
        }
    }

    mergeString(target.record.title, incoming.record.title, "title");
    mergeString(target.record.journal, incoming.record.journal, "journal");
    mergeString(target.record.year, incoming.record.year, "year");
    mergeString(target.record.volume, incoming.record.volume, "volume");
    mergeString(target.record.issue, incoming.record.issue, "issue");
    mergeString(target.record.pages, incoming.record.pages, "pages");
    mergeString(target.record.doi, incoming.record.doi, "doi");
    mergeString(target.record.url, incoming.record.url, "url");
    mergeString(target.record.text, incoming.record.text, "text");

    if (incoming.priority > target.priority) {
        target.record.id = incoming.record.id;
        target.origin = incoming.origin;
        target.priority = incoming.priority;
    }
}

void CitationManager::mergeRecordKeys(const std::string& targetKey,
                                      const std::string& sourceKey,
                                      const std::string& identity) {
    if (targetKey == sourceKey) {
        return;
    }

    auto targetIt = recordsByKey_.find(targetKey);
    auto sourceIt = recordsByKey_.find(sourceKey);
    if (targetIt == recordsByKey_.end() || sourceIt == recordsByKey_.end()) {
        return;
    }

    mergeStoredRecord(targetIt->second, sourceIt->second, identity);

    const auto sourceUsesIt = usesByKey_.find(sourceKey);
    if (sourceUsesIt != usesByKey_.end()) {
        auto& targetUses = usesByKey_[targetKey];
        for (const auto& citationUse : sourceUsesIt->second) {
            const bool duplicate = std::any_of(
                targetUses.begin(), targetUses.end(), [&](const CitationUse& existing) {
                    return existing.reason == citationUse.reason &&
                           existing.origin == citationUse.origin;
                });
            if (!duplicate) {
                targetUses.push_back(citationUse);
            }
        }
        usesByKey_.erase(sourceUsesIt);
    }

    for (auto& usedKey : useOrder_) {
        if (usedKey == sourceKey) {
            usedKey = targetKey;
        }
    }
    std::vector<std::string> uniqueOrder;
    uniqueOrder.reserve(useOrder_.size());
    for (const auto& usedKey : useOrder_) {
        if (std::find(uniqueOrder.begin(), uniqueOrder.end(), usedKey) == uniqueOrder.end()) {
            uniqueOrder.push_back(usedKey);
        }
    }
    useOrder_.swap(uniqueOrder);

    for (auto& alias : idToKey_) {
        if (alias.second == sourceKey) {
            alias.second = targetKey;
        }
    }
    recordsByKey_.erase(sourceIt);
}

bool CitationManager::addRecord(const CitationRecord& rawRecord,
                                const std::string& origin,
                                int priority) {
    CitationRecord record = rawRecord;
    record.id = Utils::trim(record.id);
    record.doi = normalizeDoi(record.doi);
    for (auto& author : record.authors) {
        author = Utils::trim(author);
    }
    record.authors.erase(
        std::remove_if(record.authors.begin(), record.authors.end(),
                       [](const std::string& author) { return author.empty(); }),
        record.authors.end());

    if (record.id.empty()) {
        std::cerr << "Error: Citation record from " << origin << " has no id" << std::endl;
        return false;
    }
    if (record.title.empty() && record.text.empty()) {
        std::cerr << "Error: Citation '" << record.id << "' from " << origin
                  << " must define title or text" << std::endl;
        return false;
    }

    const std::string idKey = normalizedId(record.id);
    const std::string doiKey = record.doi.empty() ? "" : "doi:" + record.doi;
    std::string aliasKey;
    const auto aliasIt = idToKey_.find(idKey);
    if (aliasIt != idToKey_.end()) {
        aliasKey = aliasIt->second;
    }

    if (!record.doi.empty() && !aliasKey.empty()) {
        const auto aliasRecordIt = recordsByKey_.find(aliasKey);
        if (aliasRecordIt != recordsByKey_.end() &&
            !aliasRecordIt->second.record.doi.empty() &&
            normalizeDoi(aliasRecordIt->second.record.doi) != record.doi) {
            std::cerr << "Error: Citation id '" << record.id << "' from " << origin
                      << " conflicts with DOI '" << aliasRecordIt->second.record.doi
                      << "' defined by " << aliasRecordIt->second.origin << std::endl;
            return false;
        }
    }

    std::string key;
    if (!doiKey.empty()) {
        const bool doiExists = recordsByKey_.find(doiKey) != recordsByKey_.end();
        if (doiExists && !aliasKey.empty() && aliasKey != doiKey) {
            mergeRecordKeys(doiKey, aliasKey, "DOI '" + record.doi + "'");
            aliasKey = doiKey;
        } else if (!doiExists && !aliasKey.empty() && aliasKey != doiKey) {
            recordsByKey_[doiKey] = recordsByKey_.at(aliasKey);
            recordsByKey_.erase(aliasKey);

            const auto usesIt = usesByKey_.find(aliasKey);
            if (usesIt != usesByKey_.end()) {
                usesByKey_[doiKey] = usesIt->second;
                usesByKey_.erase(usesIt);
            }
            for (auto& usedKey : useOrder_) {
                if (usedKey == aliasKey) {
                    usedKey = doiKey;
                }
            }
            for (auto& alias : idToKey_) {
                if (alias.second == aliasKey) {
                    alias.second = doiKey;
                }
            }
            aliasKey = doiKey;
        }
        key = doiKey;
    } else if (!aliasKey.empty()) {
        key = aliasKey;
    } else {
        key = "id:" + idKey;
    }

    const StoredRecord incoming = makeStoredRecord(record, origin, priority);
    auto existingIt = recordsByKey_.find(key);
    if (existingIt == recordsByKey_.end()) {
        recordsByKey_[key] = incoming;
    } else {
        const std::string identity = !record.doi.empty()
            ? "DOI '" + record.doi + "'"
            : "citation id '" + record.id + "'";
        mergeStoredRecord(existingIt->second, incoming, identity);
    }

    idToKey_[idKey] = key;
    idToKey_[normalizedId(recordsByKey_.at(key).record.id)] = key;
    return true;
}

std::string CitationManager::findRecordKey(const CitationRecord& record) const {
    const std::string doi = normalizeDoi(record.doi);
    if (!doi.empty()) {
        const std::string doiKey = "doi:" + doi;
        if (recordsByKey_.find(doiKey) != recordsByKey_.end()) {
            return doiKey;
        }
    }
    return findRecordKey(record.id);
}

std::string CitationManager::findRecordKey(const std::string& id) const {
    const auto aliasIt = idToKey_.find(normalizedId(id));
    if (aliasIt == idToKey_.end()) {
        return "";
    }
    return aliasIt->second;
}

bool CitationManager::use(const std::string& id,
                          const std::string& reason,
                          const std::string& origin) {
    const std::string key = findRecordKey(id);
    if (key.empty()) {
        std::cerr << "Error: Citation id '" << id << "' requested by " << origin
                  << " is not defined in the catalog or input" << std::endl;
        return false;
    }

    auto& uses = usesByKey_[key];
    const std::string cleanReason = Utils::trim(reason);
    const std::string cleanOrigin = Utils::trim(origin);
    const bool duplicate = std::any_of(
        uses.begin(), uses.end(), [&](const CitationUse& existing) {
            return existing.reason == cleanReason && existing.origin == cleanOrigin;
        });
    if (!duplicate) {
        uses.push_back({id, cleanReason, cleanOrigin});
    }

    if (std::find(useOrder_.begin(), useOrder_.end(), key) == useOrder_.end()) {
        useOrder_.push_back(key);
    }
    return true;
}

bool CitationManager::loadBibTeXFile(const std::string& path, int priority) {
    std::ifstream input(path);
    if (!input.is_open()) {
        return false;
    }

    std::ostringstream buffer;
    buffer << input.rdbuf();
    if (!input.good() && !input.eof()) {
        std::cerr << "Error: Failed while reading citation file: " << path << std::endl;
        return false;
    }

    std::vector<ParsedBibtexEntry> entries;
    std::string error;
    if (!parseBibtex(buffer.str(), entries, error)) {
        std::cerr << "Error: Cannot merge existing BibTeX file '" << path
                  << "': " << error << std::endl;
        return false;
    }

    bool ok = true;
    for (const auto& entry : entries) {
        CitationRecord record;
        record.id = fieldValue(entry, "baneid");
        if (record.id.empty()) {
            record.id = entry.key;
        }
        record.authors = parseBibtexAuthors(fieldValue(entry, "author"));
        record.title = fieldValue(entry, "title");
        record.journal = fieldValue(entry, "journal");
        record.year = fieldValue(entry, "year");
        record.volume = fieldValue(entry, "volume");
        record.issue = fieldValue(entry, "number");
        record.pages = fieldValue(entry, "pages");
        record.doi = fieldValue(entry, "doi");
        record.url = fieldValue(entry, "url");
        record.text = fieldValue(entry, "banetext");
        if (record.text.empty() && record.title.empty()) {
            record.text = fieldValue(entry, "note");
        }

        const std::string origin = "bibtex:" + path + ":" + entry.key;
        if (!addRecord(record, origin, priority)) {
            ok = false;
            continue;
        }

        std::vector<std::pair<int, std::string>> reasons;
        for (const auto& field : entry.fields) {
            const std::string prefix = "banereason";
            if (field.first.rfind(prefix, 0) != 0) {
                continue;
            }
            int index = 0;
            const std::string suffix = field.first.substr(prefix.size());
            if (!suffix.empty()) {
                try {
                    index = std::stoi(suffix);
                } catch (...) {
                    index = 0;
                }
            }
            reasons.push_back({index, field.second});
        }
        std::stable_sort(reasons.begin(), reasons.end(),
                         [](const auto& lhs, const auto& rhs) { return lhs.first < rhs.first; });

        if (reasons.empty()) {
            if (!use(record.id, "", origin)) {
                ok = false;
            }
        } else {
            for (const auto& reason : reasons) {
                if (!use(record.id, reason.second, origin)) {
                    ok = false;
                }
            }
        }
    }
    return ok;
}

bool CitationManager::writePlain(const std::string& path) const {
    if (!ensureParentDirectory(path)) {
        return false;
    }
    std::ofstream out(path);
    if (!out.is_open()) {
        std::cerr << "Error: Cannot write citation file: " << path << std::endl;
        return false;
    }
    printSummary(out);
    if (!out.good()) {
        std::cerr << "Error: Failed while writing citation file: " << path << std::endl;
        return false;
    }
    return true;
}

bool CitationManager::writeBibTeXFile(const std::string& path) const {
    std::ofstream out(path);
    if (!out.is_open()) {
        std::cerr << "Error: Cannot write citation file: " << path << std::endl;
        return false;
    }

    for (const auto& key : useOrder_) {
        const auto recordIt = recordsByKey_.find(key);
        if (recordIt == recordsByKey_.end()) {
            continue;
        }
        const CitationRecord& record = recordIt->second.record;
        const std::string type = record.journal.empty() ? "misc" : "article";
        out << "@" << type << "{" << bibtexKey(record.id) << ",\n";

        std::vector<std::pair<std::string, std::string>> fields;
        if (!record.authors.empty()) {
            fields.push_back({"author", joinAuthors(record.authors, " and ")});
        }
        if (!record.title.empty()) fields.push_back({"title", record.title});
        if (!record.journal.empty()) fields.push_back({"journal", record.journal});
        if (!record.year.empty()) fields.push_back({"year", record.year});
        if (!record.volume.empty()) fields.push_back({"volume", record.volume});
        if (!record.issue.empty()) fields.push_back({"number", record.issue});
        if (!record.pages.empty()) fields.push_back({"pages", record.pages});
        if (!record.doi.empty()) fields.push_back({"doi", normalizeDoi(record.doi)});
        if (!record.url.empty()) fields.push_back({"url", record.url});
        if (!record.text.empty() && record.title.empty()) fields.push_back({"note", record.text});

        fields.push_back({"baneid", record.id});
        if (!record.text.empty()) {
            fields.push_back({"banetext", record.text});
        }

        const auto usesIt = usesByKey_.find(key);
        if (usesIt != usesByKey_.end()) {
            std::vector<std::string> reasons;
            for (const auto& citationUse : usesIt->second) {
                const std::string reason = Utils::trim(citationUse.reason);
                if (reason.empty() || isSoftwareOrigin(citationUse.origin) ||
                    std::find(reasons.begin(), reasons.end(), reason) != reasons.end()) {
                    continue;
                }
                reasons.push_back(reason);
            }
            for (std::size_t i = 0; i < reasons.size(); ++i) {
                fields.push_back({"banereason" + std::to_string(i + 1), reasons[i]});
            }
        }

        for (std::size_t i = 0; i < fields.size(); ++i) {
            out << "  " << fields[i].first << " = {" << bibtexEscape(fields[i].second) << "}";
            if (i + 1 < fields.size()) {
                out << ',';
            }
            out << "\n";
        }
        out << "}\n\n";
    }

    if (!out.good()) {
        std::cerr << "Error: Failed while writing citation file: " << path << std::endl;
        return false;
    }
    return true;
}

bool CitationManager::writeBibTeX(const std::string& path) const {
    if (!ensureParentDirectory(path)) {
        return false;
    }

    CitationManager merged;
    namespace fs = std::filesystem;
    std::error_code ec;
    if (fs::exists(fs::path(path), ec) && !ec) {
        if (!merged.loadBibTeXFile(path, -1)) {
            return false;
        }
    }

    for (const auto& key : useOrder_) {
        const auto recordIt = recordsByKey_.find(key);
        if (recordIt == recordsByKey_.end()) {
            continue;
        }
        const CitationRecord& record = recordIt->second.record;
        if (!merged.addRecord(record, recordIt->second.origin, 3)) {
            return false;
        }

        const auto usesIt = usesByKey_.find(key);
        if (usesIt == usesByKey_.end() || usesIt->second.empty()) {
            if (!merged.use(record.id, "", "merge:" + path)) {
                return false;
            }
            continue;
        }
        for (const auto& citationUse : usesIt->second) {
            if (!merged.use(record.id, citationUse.reason, citationUse.origin)) {
                return false;
            }
        }
    }

    return merged.writeBibTeXFile(path);
}

void CitationManager::printSummary(std::ostream& out) const {
    if (useOrder_.empty()) {
        return;
    }

    out << ">>> Suggested citations for this workflow\n\n";
    std::size_t index = 0;
    for (const auto& key : useOrder_) {
        const auto recordIt = recordsByKey_.find(key);
        if (recordIt == recordsByKey_.end()) {
            continue;
        }
        ++index;
        out << "[" << index << "] " << formatPlainRecord(recordIt->second.record) << "\n";

        const auto usesIt = usesByKey_.find(key);
        if (usesIt != usesByKey_.end()) {
            std::vector<std::string> reasons;
            for (const auto& use : usesIt->second) {
                if (!use.reason.empty() &&
                    std::find(reasons.begin(), reasons.end(), use.reason) == reasons.end()) {
                    reasons.push_back(use.reason);
                }
            }
            if (!reasons.empty()) {
                out << "    Used for:\n";
                for (const auto& reason : reasons) {
                    out << "      - " << reason << "\n";
                }
            }
        }
        out << "\n";
    }
}

bool CitationManager::hasRecord(const std::string& id) const {
    return !findRecordKey(id).empty();
}

bool CitationManager::getRecord(const std::string& id, CitationRecord& record) const {
    const std::string key = findRecordKey(id);
    if (key.empty()) {
        return false;
    }

    const auto it = recordsByKey_.find(key);
    if (it == recordsByKey_.end()) {
        return false;
    }

    record = it->second.record;
    return true;
}

std::size_t CitationManager::usedCitationCount() const noexcept {
    return useOrder_.size();
}
