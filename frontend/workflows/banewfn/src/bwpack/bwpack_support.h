#ifndef BWPACK_SUPPORT_H
#define BWPACK_SUPPORT_H

#include <cstddef>
#include <string>
#include <vector>

class CitationManager;
class ConfigManager;
struct ModuleTask;

namespace Bwpack {

struct CitationExpansionResult {
    bool success = true;
    std::size_t expandedCount = 0;
    std::string content;
};

struct ConfiguredCitationCatalogResult {
    bool success = true;
    std::size_t recordCount = 0;
    std::string catalogText;
};

// Replace parsed bane.cite blocks that reference records in citations.conf
// with complete inline records. Inline fields override catalog fields; reason
// is retained as workflow-use metadata.
CitationExpansionResult expandCatalogCitations(const std::string& content,
                                                const CitationManager& catalog,
                                                const std::vector<ModuleTask>& tasks,
                                                const std::string& sourceName);

// Build a compact citations.conf fragment containing only records selected by
// [citations] bindings in the module sections used by this workflow.
ConfiguredCitationCatalogResult buildConfiguredCitationCatalog(
    const CitationManager& catalog,
    const ConfigManager& configs,
    const std::vector<ModuleTask>& tasks,
    const std::string& sourceName);

} // namespace Bwpack

#endif // BWPACK_SUPPORT_H
