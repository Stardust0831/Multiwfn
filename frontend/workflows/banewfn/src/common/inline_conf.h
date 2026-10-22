#ifndef INLINE_CONF_H
#define INLINE_CONF_H

#include <map>
#include <string>

/**
 * @brief Inline module conf support.
 *
 * This module allows embedding one or more <module>.conf blocks at the end of a .bw/.inp file
 * so that the script can be shared without relying on external conf directory.
 *
 * The embedded conf blocks are stored as commented lines so legacy parsers ignore them.
 *
 * Syntax:
 *   #>>> BANEWFN_INLINE_CONF_BEGIN <module>
 *   # <conf line 1>
 *   # <conf line 2>
 *   ...
 *   #<<< BANEWFN_INLINE_CONF_END <module>
 *
 * During extraction, one leading '#' (and an optional following space/tab) is stripped
 * from each conf line.
 */
namespace InlineConf {

// Extract embedded conf blocks from a bw/inp file.
// Returns: moduleName -> confText
std::map<std::string, std::string> extractInlineConfs(const std::string& filepath);

// Extract the optional bundled citation catalog block from a bw/bwc file.
// The returned text uses the normal citations.conf syntax.
std::string extractInlineCitationCatalog(const std::string& filepath);

// Strip any embedded inline conf blocks from file and return the remaining content.
// It removes everything from the first BEGIN marker to EOF.
std::string stripInlineConfsFromFile(const std::string& filepath);

// Format a module conf text into an embeddable commented block.
std::string formatInlineConfBlock(const std::string& moduleName, const std::string& confText);

// Format citations.conf text as a commented block that can be embedded beside
// inline module configurations.
std::string formatInlineCitationCatalogBlock(const std::string& catalogText);

} // namespace InlineConf

#endif // INLINE_CONF_H
