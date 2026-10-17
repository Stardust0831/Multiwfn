#ifndef CITATION_H
#define CITATION_H

#include <cstddef>
#include <iosfwd>
#include <map>
#include <string>
#include <vector>

struct CitationRecord {
    std::string id;
    std::vector<std::string> authors;
    std::string title;
    std::string journal;
    std::string year;
    std::string volume;
    std::string issue;
    std::string pages;
    std::string doi;
    std::string url;
    std::string text;
};

struct CitationUse {
    std::string id;
    std::string reason;
    std::string origin;
};

class CitationManager {
public:
    bool loadCatalog(const std::string& path);
    bool loadCatalogFromText(const std::string& text,
                             const std::string& origin = "inline-catalog");
    bool addOrOverride(const CitationRecord& record);
    bool addOrOverride(const CitationRecord& record, const std::string& origin);
    bool use(const std::string& id,
             const std::string& reason,
             const std::string& origin);

    bool writePlain(const std::string& path) const;
    bool writeBibTeX(const std::string& path) const;
    void printSummary(std::ostream& out) const;

    bool hasRecord(const std::string& id) const;
    bool getRecord(const std::string& id, CitationRecord& record) const;
    std::size_t usedCitationCount() const noexcept;

    static std::string normalizeDoi(const std::string& doi);

private:
    struct FieldSource {
        std::string origin;
        int priority = 0;
    };

    struct StoredRecord {
        CitationRecord record;
        std::string origin;
        int priority = 0;
        std::map<std::string, FieldSource> fieldSources;
    };

    bool addRecord(const CitationRecord& record,
                   const std::string& origin,
                   int priority);
    bool loadCatalogStream(std::istream& input,
                           const std::string& sourceName,
                           int priority);
    bool loadBibTeXFile(const std::string& path, int priority);
    bool writeBibTeXFile(const std::string& path) const;
    std::string findRecordKey(const std::string& id) const;
    std::string findRecordKey(const CitationRecord& record) const;
    StoredRecord makeStoredRecord(const CitationRecord& record,
                                  const std::string& origin,
                                  int priority) const;
    void mergeStoredRecord(StoredRecord& target,
                           const StoredRecord& incoming,
                           const std::string& identity);
    void mergeRecordKeys(const std::string& targetKey,
                         const std::string& sourceKey,
                         const std::string& identity);

    std::map<std::string, StoredRecord> recordsByKey_;
    std::map<std::string, std::string> idToKey_;
    std::map<std::string, std::vector<CitationUse>> usesByKey_;
    std::vector<std::string> useOrder_;
};

#endif // CITATION_H
