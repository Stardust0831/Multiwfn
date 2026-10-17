#ifndef GREP_DSL_H
#define GREP_DSL_H

#include <cstddef>
#include <string>
#include <vector>

enum class GrepPatternKind {
    Literal,
    ExactLiteral,
    Regex
};

struct GrepPattern {
    GrepPatternKind kind = GrepPatternKind::Literal;
    std::string value;
    bool ignoreCase = false;
};

enum class GrepOccurrenceKind {
    First,
    Last,
    Nth,
    All
};

struct GrepOccurrence {
    GrepOccurrenceKind kind = GrepOccurrenceKind::First;
    std::size_t nth = 1;
};

enum class GrepSelectorKind {
    Between,
    Inside,
    After,
    Before,
    Match
};

struct GrepSelector {
    GrepSelectorKind kind = GrepSelectorKind::Match;
    GrepPattern first;
    GrepPattern second;
    GrepOccurrence occurrence;
};

enum class GrepStageKind {
    Trim,
    DropBlank,
    Skip,
    Take,
    Tail,
    Reject,
    Scan,
    Split,
    Cols,
    ExpectRows,
    ExpectUnique,
    ExpectContiguous,
    ExpectFinite
};

struct GrepColumnSpec {
    std::string outputName;
    std::string sourceName;
    int index = 0;
    bool byIndex = false;
};

enum class GrepComparison {
    Equal,
    NotEqual,
    Less,
    LessEqual,
    Greater,
    GreaterEqual
};

struct GrepStage {
    GrepStageKind kind = GrepStageKind::Trim;
    GrepPattern pattern;
    std::string argument;
    bool strict = false;
    GrepComparison comparison = GrepComparison::Equal;
    std::vector<GrepColumnSpec> columns;
};

enum class GrepSinkKind {
    File,
    AtomVec,
    Kv
};

struct GrepSink {
    GrepSinkKind kind = GrepSinkKind::File;
    std::string path;
    std::string property;
};

struct GrepRule {
    std::string name;
    bool optional = false;
    std::string source;  // Empty means the current task output.
    GrepSelector selector;
    std::vector<GrepStage> stages;
    GrepSink sink;
    int lineNumber = 0;
};

struct GrepDslLine {
    int lineNumber = 0;
    std::string text;
};

struct GrepParseResult {
    std::vector<GrepRule> rules;
    std::vector<std::string> errors;
};

namespace GrepDsl {

// Parse all logical rules collected from a %grep block.
GrepParseResult parseBlock(const std::vector<GrepDslLine>& lines);

// Parse a single logical rule. Intended for tests and diagnostics.
bool parseRule(const std::string& text, int lineNumber, GrepRule& rule, std::string& errorMessage);

// Remove an inline # comment while preserving # characters inside quoted strings
// and /regular expressions/.
std::string removeInlineComment(const std::string& line);

} // namespace GrepDsl

#endif // GREP_DSL_H
