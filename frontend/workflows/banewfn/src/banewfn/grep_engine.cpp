#include "banewfn/grep_engine.h"
#include "common/utils.h"

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iomanip>
#include <iostream>
#include <limits>
#include <map>
#include <regex>
#include <set>
#include <sstream>
#include <string>
#include <variant>

namespace {

namespace fs = std::filesystem;

enum class OperationStatus {
    Ok,
    Missing,
    Error
};

struct TextLine {
    std::string text;
    std::size_t sourceLine = 0;
};

enum class FieldType {
    String,
    Integer,
    Number
};

struct FieldValue {
    std::string name;
    std::string raw;
    FieldType type = FieldType::String;
    std::int64_t intValue = 0;
    double numberValue = 0.0;
};

struct Record {
    std::vector<FieldValue> fields;
    std::string originalLine;
    std::size_t sourceLine = 0;
};

using LineStream = std::vector<TextLine>;
using RecordStream = std::vector<Record>;
using PipelineData = std::variant<LineStream, RecordStream>;

std::string lowerAscii(const std::string& text) {
    std::string result = text;
    std::transform(result.begin(), result.end(), result.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return result;
}

std::string ruleLabel(const GrepRule& rule, std::size_t index) {
    if (!rule.name.empty()) {
        return rule.name;
    }
    if (rule.lineNumber > 0) {
        return "line " + std::to_string(rule.lineNumber);
    }
    return "rule " + std::to_string(index + 1);
}

std::string normalizeHorizontalWhitespace(const std::string& text) {
    std::string result;
    result.reserve(text.size());
    bool inWhitespace = false;
    for (const char c : text) {
        if (c == ' ' || c == '\t' || c == '\f' || c == '\v') {
            inWhitespace = true;
            continue;
        }
        if (inWhitespace && !result.empty()) {
            result.push_back(' ');
        }
        result.push_back(c);
        inWhitespace = false;
    }
    return Utils::trim(result);
}

std::string replaceOutputPlaceholder(const std::string& text, const std::string& outputFile) {
    std::string result;
    result.reserve(text.size());

    std::size_t pos = 0;
    while (pos < text.size()) {
        const std::size_t dollar = text.find('$', pos);
        if (dollar == std::string::npos) {
            result.append(text, pos, std::string::npos);
            break;
        }
        result.append(text, pos, dollar - pos);

        std::size_t end = dollar + 1;
        std::string name;
        std::string defaultValue;
        if (end < text.size() && text[end] == '{') {
            const std::size_t close = text.find('}', end + 1);
            if (close == std::string::npos) {
                result.append(text, dollar, std::string::npos);
                break;
            }
            const std::string inside = text.substr(end + 1, close - end - 1);
            const std::size_t sep = inside.find(":-");
            if (sep == std::string::npos) {
                name = inside;
            } else {
                name = inside.substr(0, sep);
                defaultValue = inside.substr(sep + 2);
            }
            end = close + 1;
        } else {
            while (end < text.size() &&
                   (std::isalnum(static_cast<unsigned char>(text[end])) || text[end] == '_')) {
                ++end;
            }
            name = text.substr(dollar + 1, end - dollar - 1);
        }

        if (name == "output") {
            result += outputFile.empty() ? defaultValue : outputFile;
        } else {
            result.append(text, dollar, end - dollar);
        }
        pos = end;
    }
    return result;
}

GrepPattern resolvePattern(const GrepPattern& input, const std::string& outputFile) {
    GrepPattern result = input;
    result.value = replaceOutputPlaceholder(result.value, outputFile);
    return result;
}

GrepRule resolveRuntimeRule(const GrepRule& input, const GrepExecutionContext& context) {
    GrepRule result = input;
    result.source = replaceOutputPlaceholder(result.source, context.outputFile);
    result.selector.first = resolvePattern(result.selector.first, context.outputFile);
    result.selector.second = resolvePattern(result.selector.second, context.outputFile);
    for (auto& stage : result.stages) {
        stage.pattern = resolvePattern(stage.pattern, context.outputFile);
        stage.argument = replaceOutputPlaceholder(stage.argument, context.outputFile);
        for (auto& column : stage.columns) {
            column.outputName = replaceOutputPlaceholder(column.outputName, context.outputFile);
            column.sourceName = replaceOutputPlaceholder(column.sourceName, context.outputFile);
        }
    }
    result.sink.path = replaceOutputPlaceholder(result.sink.path, context.outputFile);
    result.sink.property = replaceOutputPlaceholder(result.sink.property, context.outputFile);
    return result;
}

class LineMatcher {
public:
    bool initialize(const GrepPattern& input, std::string& errorMessage) {
        pattern = input;
        if (pattern.value.empty()) {
            errorMessage = "empty match pattern";
            return false;
        }
        if (pattern.kind == GrepPatternKind::Literal) {
            normalizedLiteral = normalizeHorizontalWhitespace(pattern.value);
            if (normalizedLiteral.empty()) {
                errorMessage = "literal pattern contains only whitespace";
                return false;
            }
            return true;
        }
        if (pattern.kind == GrepPatternKind::Regex) {
            try {
                std::regex::flag_type flags = std::regex::ECMAScript | std::regex::optimize;
                if (pattern.ignoreCase) {
                    flags |= std::regex::icase;
                }
                regex = std::regex(pattern.value, flags);
            } catch (const std::regex_error& error) {
                errorMessage = "invalid regular expression /" + pattern.value + "/: " + error.what();
                return false;
            }
        }
        return true;
    }

    bool matches(const std::string& line) const {
        if (pattern.kind == GrepPatternKind::ExactLiteral) {
            return line.find(pattern.value) != std::string::npos;
        }
        if (pattern.kind == GrepPatternKind::Literal) {
            return normalizeHorizontalWhitespace(line).find(normalizedLiteral) != std::string::npos;
        }
        return std::regex_search(line, regex);
    }

private:
    GrepPattern pattern;
    std::string normalizedLiteral;
    std::regex regex;
};

OperationStatus readSourceLines(const std::string& source, LineStream& lines,
                                std::string& errorMessage) {
    std::error_code ec;
    const bool sourceExists = fs::exists(source, ec);
    if (ec) {
        errorMessage = "cannot inspect source file " + source + ": " + ec.message();
        return OperationStatus::Error;
    }
    if (!sourceExists) {
        errorMessage = "source file does not exist: " + source;
        return OperationStatus::Missing;
    }

    std::ifstream input(source, std::ios::binary);
    if (!input.is_open()) {
        errorMessage = "cannot open source file: " + source;
        return OperationStatus::Error;
    }

    lines.clear();
    std::string line;
    std::size_t lineNumber = 0;
    while (std::getline(input, line)) {
        ++lineNumber;
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        lines.push_back({line, lineNumber});
    }
    if (!input.eof() && input.fail()) {
        errorMessage = "failed while reading source file: " + source;
        return OperationStatus::Error;
    }
    return OperationStatus::Ok;
}

std::vector<std::size_t> selectOccurrences(std::size_t count, const GrepOccurrence& occurrence) {
    std::vector<std::size_t> indices;
    if (count == 0) {
        return indices;
    }
    switch (occurrence.kind) {
        case GrepOccurrenceKind::First:
            indices.push_back(0);
            break;
        case GrepOccurrenceKind::Last:
            indices.push_back(count - 1);
            break;
        case GrepOccurrenceKind::Nth:
            if (occurrence.nth >= 1 && occurrence.nth <= count) {
                indices.push_back(occurrence.nth - 1);
            }
            break;
        case GrepOccurrenceKind::All:
            indices.reserve(count);
            for (std::size_t i = 0; i < count; ++i) {
                indices.push_back(i);
            }
            break;
    }
    return indices;
}

OperationStatus applySelector(const LineStream& source, const GrepSelector& selector,
                              LineStream& selected, std::string& errorMessage) {
    selected.clear();
    LineMatcher firstMatcher;
    if (!firstMatcher.initialize(selector.first, errorMessage)) {
        return OperationStatus::Error;
    }

    if (selector.kind == GrepSelectorKind::Match) {
        std::vector<std::size_t> matches;
        for (std::size_t i = 0; i < source.size(); ++i) {
            if (firstMatcher.matches(source[i].text)) {
                matches.push_back(i);
            }
        }
        const auto occurrences = selectOccurrences(matches.size(), selector.occurrence);
        for (const std::size_t occurrence : occurrences) {
            selected.push_back(source[matches[occurrence]]);
        }
        if (selected.empty()) {
            errorMessage = "selector did not match any line";
            return OperationStatus::Missing;
        }
        return OperationStatus::Ok;
    }

    if (selector.kind == GrepSelectorKind::After || selector.kind == GrepSelectorKind::Before) {
        std::vector<std::size_t> matches;
        for (std::size_t i = 0; i < source.size(); ++i) {
            if (firstMatcher.matches(source[i].text)) {
                matches.push_back(i);
            }
        }
        if (matches.empty()) {
            errorMessage = "selector marker was not found";
            return OperationStatus::Missing;
        }

        std::size_t markerIndex = 0;
        if (selector.occurrence.kind == GrepOccurrenceKind::Last) {
            markerIndex = matches.back();
        } else if (selector.occurrence.kind == GrepOccurrenceKind::Nth) {
            if (selector.occurrence.nth < 1 || selector.occurrence.nth > matches.size()) {
                errorMessage = "requested marker occurrence does not exist";
                return OperationStatus::Missing;
            }
            markerIndex = matches[selector.occurrence.nth - 1];
        } else if (selector.occurrence.kind == GrepOccurrenceKind::All) {
            // The union of all "after" regions starts after the first marker;
            // the union of all "before" regions ends before the last marker.
            markerIndex = selector.kind == GrepSelectorKind::After ? matches.front() : matches.back();
        } else {
            markerIndex = matches.front();
        }

        if (selector.kind == GrepSelectorKind::After) {
            if (markerIndex + 1 < source.size()) {
                selected.insert(selected.end(), source.begin() + static_cast<std::ptrdiff_t>(markerIndex + 1), source.end());
            }
        } else {
            if (markerIndex > 0) {
                selected.insert(selected.end(), source.begin(), source.begin() + static_cast<std::ptrdiff_t>(markerIndex));
            }
        }
        if (selected.empty()) {
            errorMessage = "selector produced an empty range";
            return OperationStatus::Missing;
        }
        return OperationStatus::Ok;
    }

    LineMatcher secondMatcher;
    if (!secondMatcher.initialize(selector.second, errorMessage)) {
        return OperationStatus::Error;
    }

    struct Span {
        std::size_t start = 0;
        std::size_t end = 0;
    };
    std::vector<Span> spans;
    std::size_t cursor = 0;
    while (cursor < source.size()) {
        std::size_t start = source.size();
        for (std::size_t i = cursor; i < source.size(); ++i) {
            if (firstMatcher.matches(source[i].text)) {
                start = i;
                break;
            }
        }
        if (start == source.size()) {
            break;
        }

        std::size_t end = source.size();
        for (std::size_t i = start; i < source.size(); ++i) {
            if (secondMatcher.matches(source[i].text)) {
                end = i;
                break;
            }
        }
        if (end == source.size()) {
            const bool requestedCompleteSpanAlreadyFound =
                (selector.occurrence.kind == GrepOccurrenceKind::First && !spans.empty()) ||
                (selector.occurrence.kind == GrepOccurrenceKind::Nth &&
                 selector.occurrence.nth >= 1 && spans.size() >= selector.occurrence.nth);
            if (requestedCompleteSpanAlreadyFound) {
                // A trailing incomplete section must not invalidate an earlier
                // explicitly requested first/nth complete range. `last` and
                // `all` still fail because the dangling start makes their
                // result ambiguous/incomplete.
                break;
            }
            errorMessage = "start marker found at source line " +
                           std::to_string(source[start].sourceLine) +
                           ", but the end marker was not found";
            return OperationStatus::Error;
        }
        spans.push_back({start, end});
        cursor = end + 1;
    }

    const auto occurrences = selectOccurrences(spans.size(), selector.occurrence);
    if (occurrences.empty()) {
        errorMessage = spans.empty() ? "range markers were not found" :
                       "requested range occurrence does not exist";
        return OperationStatus::Missing;
    }

    for (const std::size_t occurrence : occurrences) {
        std::size_t begin = spans[occurrence].start;
        std::size_t end = spans[occurrence].end;
        if (selector.kind == GrepSelectorKind::Inside) {
            ++begin;
            if (end > 0) {
                --end;
            }
            if (begin > end || begin >= source.size()) {
                continue;
            }
        }
        selected.insert(selected.end(), source.begin() + static_cast<std::ptrdiff_t>(begin),
                        source.begin() + static_cast<std::ptrdiff_t>(end + 1));
    }

    if (selected.empty()) {
        errorMessage = "selector produced an empty range";
        return OperationStatus::Missing;
    }
    return OperationStatus::Ok;
}

std::size_t rowCount(const PipelineData& data) {
    if (const auto* lines = std::get_if<LineStream>(&data)) {
        return lines->size();
    }
    return std::get<RecordStream>(data).size();
}

bool parseNonNegativeSize(const std::string& text, std::size_t& value) {
    if (text.empty() || text[0] == '-') {
        return false;
    }
    char* end = nullptr;
    errno = 0;
    const unsigned long long parsed = std::strtoull(text.c_str(), &end, 10);
    if (errno != 0 || end == nullptr || *end != '\0' ||
        parsed > static_cast<unsigned long long>(std::numeric_limits<std::size_t>::max())) {
        return false;
    }
    value = static_cast<std::size_t>(parsed);
    return true;
}

bool parseInt64(const std::string& raw, std::int64_t& value) {
    const std::string text = Utils::trim(raw);
    if (text.empty()) {
        return false;
    }
    char* end = nullptr;
    errno = 0;
    const long long parsed = std::strtoll(text.c_str(), &end, 10);
    if (errno != 0 || end == nullptr || *end != '\0') {
        return false;
    }
    value = static_cast<std::int64_t>(parsed);
    return true;
}

bool parseNumber(const std::string& raw, double& value) {
    std::string text = Utils::trim(raw);
    if (text.empty()) {
        return false;
    }
    for (char& c : text) {
        if (c == 'D' || c == 'd') {
            c = 'E';
        }
    }
    char* end = nullptr;
    errno = 0;
    const double parsed = std::strtod(text.c_str(), &end);
    if (errno != 0 || end == nullptr || *end != '\0') {
        return false;
    }
    value = parsed;
    return true;
}

FieldValue makeStringField(const std::string& name, const std::string& raw) {
    FieldValue field;
    field.name = name;
    field.raw = raw;
    field.type = FieldType::String;
    return field;
}

const FieldValue* findField(const Record& record, const std::string& name) {
    for (const auto& field : record.fields) {
        if (field.name == name) {
            return &field;
        }
    }
    const std::string lowerName = lowerAscii(name);
    for (const auto& field : record.fields) {
        if (lowerAscii(field.name) == lowerName) {
            return &field;
        }
    }
    return nullptr;
}

struct ScanFieldSpec {
    std::string name;
    std::string type;
};

bool isValidFieldName(const std::string& name) {
    if (name.empty()) {
        return false;
    }
    for (const char c : name) {
        if (!std::isalnum(static_cast<unsigned char>(c)) && c != '_' && c != '.' && c != '-') {
            return false;
        }
    }
    return true;
}

std::string escapeRegexLiteral(char c) {
    static const std::string special = R"(.^$|()[]*+?{}\)";
    if (special.find(c) != std::string::npos) {
        return std::string("\\") + c;
    }
    return std::string(1, c);
}

bool compileScanPattern(const std::string& pattern, std::regex& regex,
                        std::vector<ScanFieldSpec>& fields, std::string& errorMessage) {
    std::string expression = "^\\s*";
    fields.clear();
    std::set<std::string> names;

    for (std::size_t pos = 0; pos < pattern.size();) {
        if (pattern[pos] == '{') {
            const std::size_t close = pattern.find('}', pos + 1);
            if (close == std::string::npos) {
                errorMessage = "scan pattern has an unterminated field";
                return false;
            }
            const std::string inside = pattern.substr(pos + 1, close - pos - 1);
            const std::size_t colon = inside.rfind(':');
            if (colon == std::string::npos) {
                errorMessage = "scan field must use {name:type}: " + inside;
                return false;
            }
            const std::string name = Utils::trim(inside.substr(0, colon));
            const std::string type = lowerAscii(Utils::trim(inside.substr(colon + 1)));
            if (!isValidFieldName(name)) {
                errorMessage = "invalid scan field name: " + name;
                return false;
            }
            if (!names.insert(name).second) {
                errorMessage = "duplicate scan field name: " + name;
                return false;
            }

            std::string capture;
            if (type == "int") {
                capture = "[-+]?\\d+";
            } else if (type == "num") {
                capture = "[-+]?(?:(?:\\d+(?:\\.\\d*)?)|(?:\\.\\d+))(?:[eEdD][-+]?\\d+)?";
            } else if (type == "word") {
                capture = "[^\\s]+";
            } else if (type == "str") {
                capture = ".+?";
            } else if (type == "rest") {
                capture = ".*";
            } else {
                errorMessage = "unsupported scan field type: " + type;
                return false;
            }

            expression += "\\s*(" + capture + ")\\s*";
            fields.push_back({name, type});
            pos = close + 1;
            continue;
        }

        if (pattern[pos] == '}') {
            errorMessage = "scan pattern has an unmatched '}'";
            return false;
        }

        if (std::isspace(static_cast<unsigned char>(pattern[pos]))) {
            while (pos < pattern.size() && std::isspace(static_cast<unsigned char>(pattern[pos]))) {
                ++pos;
            }
            expression += "\\s*";
            continue;
        }

        expression += escapeRegexLiteral(pattern[pos]);
        ++pos;
    }

    if (fields.empty()) {
        errorMessage = "scan pattern contains no fields";
        return false;
    }
    expression += "\\s*$";

    try {
        regex = std::regex(expression, std::regex::ECMAScript | std::regex::optimize);
    } catch (const std::regex_error& error) {
        errorMessage = "failed to compile scan pattern: " + std::string(error.what());
        return false;
    }
    return true;
}

OperationStatus applyScan(const LineStream& lines, const GrepStage& stage,
                          RecordStream& records, std::size_t& rejectedRows,
                          std::string& errorMessage) {
    std::regex regex;
    std::vector<ScanFieldSpec> fieldSpecs;
    if (!compileScanPattern(stage.argument, regex, fieldSpecs, errorMessage)) {
        return OperationStatus::Error;
    }

    records.clear();
    rejectedRows = 0;
    for (const auto& line : lines) {
        if (Utils::trim(line.text).empty()) {
            continue;
        }
        std::smatch match;
        if (!std::regex_match(line.text, match, regex)) {
            ++rejectedRows;
            continue;
        }
        if (match.size() != fieldSpecs.size() + 1) {
            errorMessage = "internal scan capture mismatch";
            return OperationStatus::Error;
        }

        Record record;
        record.originalLine = line.text;
        record.sourceLine = line.sourceLine;
        for (std::size_t i = 0; i < fieldSpecs.size(); ++i) {
            FieldValue field;
            field.name = fieldSpecs[i].name;
            field.raw = Utils::trim(match[i + 1].str());
            if (fieldSpecs[i].type == "int") {
                field.type = FieldType::Integer;
                if (!parseInt64(field.raw, field.intValue)) {
                    errorMessage = "scan captured an invalid integer at source line " +
                                   std::to_string(line.sourceLine);
                    return OperationStatus::Error;
                }
                field.numberValue = static_cast<double>(field.intValue);
            } else if (fieldSpecs[i].type == "num") {
                field.type = FieldType::Number;
                if (!parseNumber(field.raw, field.numberValue)) {
                    errorMessage = "scan captured an invalid number at source line " +
                                   std::to_string(line.sourceLine);
                    return OperationStatus::Error;
                }
            } else {
                field.type = FieldType::String;
            }
            record.fields.push_back(field);
        }
        records.push_back(record);
    }

    if (stage.strict && rejectedRows > 0) {
        errorMessage = "scan strict rejected " + std::to_string(rejectedRows) + " non-empty row(s)";
        return OperationStatus::Error;
    }
    if (records.empty()) {
        errorMessage = "scan produced no records";
        return OperationStatus::Missing;
    }
    return OperationStatus::Ok;
}

RecordStream splitLines(const LineStream& lines, const std::string& delimiter,
                        bool whitespace, std::string& errorMessage) {
    RecordStream records;
    if (!whitespace && delimiter.empty()) {
        errorMessage = "split delimiter cannot be empty";
        return records;
    }

    for (const auto& line : lines) {
        if (Utils::trim(line.text).empty()) {
            continue;
        }
        std::vector<std::string> values;
        if (whitespace) {
            std::istringstream input(line.text);
            std::string value;
            while (input >> value) {
                values.push_back(value);
            }
        } else {
            std::size_t start = 0;
            while (true) {
                const std::size_t found = line.text.find(delimiter, start);
                if (found == std::string::npos) {
                    values.push_back(Utils::trim(line.text.substr(start)));
                    break;
                }
                values.push_back(Utils::trim(line.text.substr(start, found - start)));
                start = found + delimiter.size();
            }
        }

        if (values.empty()) {
            continue;
        }
        Record record;
        record.originalLine = line.text;
        record.sourceLine = line.sourceLine;
        for (std::size_t i = 0; i < values.size(); ++i) {
            record.fields.push_back(makeStringField(std::to_string(i + 1), values[i]));
        }
        records.push_back(record);
    }
    return records;
}

OperationStatus applyCols(PipelineData& data, const GrepStage& stage, std::string& errorMessage) {
    if (auto* lines = std::get_if<LineStream>(&data)) {
        RecordStream records = splitLines(*lines, "", true, errorMessage);
        if (!errorMessage.empty()) {
            return OperationStatus::Error;
        }
        data = std::move(records);
    }

    auto& records = std::get<RecordStream>(data);
    if (records.empty()) {
        errorMessage = "cols received no records";
        return OperationStatus::Missing;
    }

    std::set<std::string> outputNames;
    for (const auto& spec : stage.columns) {
        if (spec.outputName.empty() || !outputNames.insert(spec.outputName).second) {
            errorMessage = "cols has an empty or duplicate output field: " + spec.outputName;
            return OperationStatus::Error;
        }
    }

    for (auto& record : records) {
        std::vector<FieldValue> projected;
        projected.reserve(stage.columns.size());
        for (const auto& spec : stage.columns) {
            const FieldValue* sourceField = nullptr;
            if (spec.byIndex) {
                long long index = spec.index;
                if (index < 0) {
                    index = static_cast<long long>(record.fields.size()) + index + 1;
                }
                if (index <= 0 || static_cast<std::size_t>(index) > record.fields.size()) {
                    errorMessage = "cols index " + std::to_string(spec.index) +
                                   " is out of range at source line " +
                                   std::to_string(record.sourceLine);
                    return OperationStatus::Error;
                }
                sourceField = &record.fields[static_cast<std::size_t>(index - 1)];
            } else {
                sourceField = findField(record, spec.sourceName);
                if (sourceField == nullptr) {
                    errorMessage = "cols field not found: " + spec.sourceName +
                                   " at source line " + std::to_string(record.sourceLine);
                    return OperationStatus::Error;
                }
            }
            FieldValue copied = *sourceField;
            copied.name = spec.outputName;
            projected.push_back(copied);
        }
        record.fields.swap(projected);
    }
    return OperationStatus::Ok;
}

bool compareRows(std::size_t actual, std::size_t expected, GrepComparison comparison) {
    switch (comparison) {
        case GrepComparison::Equal: return actual == expected;
        case GrepComparison::NotEqual: return actual != expected;
        case GrepComparison::Less: return actual < expected;
        case GrepComparison::LessEqual: return actual <= expected;
        case GrepComparison::Greater: return actual > expected;
        case GrepComparison::GreaterEqual: return actual >= expected;
    }
    return false;
}

std::string comparisonText(GrepComparison comparison) {
    switch (comparison) {
        case GrepComparison::Equal: return "==";
        case GrepComparison::NotEqual: return "!=";
        case GrepComparison::Less: return "<";
        case GrepComparison::LessEqual: return "<=";
        case GrepComparison::Greater: return ">";
        case GrepComparison::GreaterEqual: return ">=";
    }
    return "?";
}

OperationStatus applyRecordExpectation(const PipelineData& data, const GrepStage& stage,
                                       std::string& errorMessage) {
    const auto* records = std::get_if<RecordStream>(&data);
    if (records == nullptr) {
        errorMessage = "field expectation requires structured records";
        return OperationStatus::Error;
    }
    if (records->empty()) {
        errorMessage = "field expectation received no records";
        return OperationStatus::Missing;
    }

    if (stage.kind == GrepStageKind::ExpectUnique) {
        std::set<std::string> values;
        for (const auto& record : *records) {
            const FieldValue* field = findField(record, stage.argument);
            if (field == nullptr) {
                errorMessage = "expect unique field not found: " + stage.argument;
                return OperationStatus::Error;
            }
            if (!values.insert(field->raw).second) {
                errorMessage = "field is not unique: " + stage.argument + " (duplicate " + field->raw + ")";
                return OperationStatus::Error;
            }
        }
        return OperationStatus::Ok;
    }

    if (stage.kind == GrepStageKind::ExpectContiguous) {
        std::set<std::int64_t> values;
        for (const auto& record : *records) {
            const FieldValue* field = findField(record, stage.argument);
            std::int64_t value = 0;
            if (field == nullptr || !parseInt64(field->raw, value) || value <= 0) {
                errorMessage = "expect contiguous requires positive integers in field: " + stage.argument;
                return OperationStatus::Error;
            }
            values.insert(value);
        }
        if (values.size() != records->size()) {
            errorMessage = "field contains duplicate indices: " + stage.argument;
            return OperationStatus::Error;
        }
        std::int64_t expected = 1;
        for (const auto value : values) {
            if (value != expected) {
                errorMessage = "field is not contiguous from 1: " + stage.argument;
                return OperationStatus::Error;
            }
            ++expected;
        }
        return OperationStatus::Ok;
    }

    for (const auto& record : *records) {
        const FieldValue* field = findField(record, stage.argument);
        double value = 0.0;
        if (field == nullptr || !parseNumber(field->raw, value) || !std::isfinite(value)) {
            errorMessage = "field contains a non-finite or non-numeric value: " + stage.argument;
            return OperationStatus::Error;
        }
    }
    return OperationStatus::Ok;
}

OperationStatus applyStage(PipelineData& data, const GrepStage& stage,
                           const std::string& label, std::string& errorMessage) {
    if (stage.kind == GrepStageKind::Trim) {
        if (auto* lines = std::get_if<LineStream>(&data)) {
            for (auto& line : *lines) {
                line.text = Utils::trim(line.text);
            }
            return OperationStatus::Ok;
        }
        errorMessage = "trim requires text lines";
        return OperationStatus::Error;
    }

    if (stage.kind == GrepStageKind::DropBlank) {
        if (auto* lines = std::get_if<LineStream>(&data)) {
            lines->erase(std::remove_if(lines->begin(), lines->end(),
                                        [](const TextLine& line) { return Utils::trim(line.text).empty(); }),
                         lines->end());
            if (lines->empty()) {
                errorMessage = "drop blank removed all lines";
                return OperationStatus::Missing;
            }
            return OperationStatus::Ok;
        }
        errorMessage = "drop blank requires text lines";
        return OperationStatus::Error;
    }

    if (stage.kind == GrepStageKind::Skip || stage.kind == GrepStageKind::Take ||
        stage.kind == GrepStageKind::Tail) {
        std::size_t count = 0;
        if (!parseNonNegativeSize(stage.argument, count)) {
            errorMessage = "invalid row count for pipeline operator: " + stage.argument;
            return OperationStatus::Error;
        }
        const auto resizeSequence = [count, &stage](auto& sequence) {
            if (stage.kind == GrepStageKind::Skip) {
                const std::size_t removed = std::min(count, sequence.size());
                sequence.erase(sequence.begin(), sequence.begin() + static_cast<std::ptrdiff_t>(removed));
            } else if (stage.kind == GrepStageKind::Take) {
                if (sequence.size() > count) {
                    sequence.erase(sequence.begin() + static_cast<std::ptrdiff_t>(count), sequence.end());
                }
            } else if (sequence.size() > count) {
                sequence.erase(sequence.begin(), sequence.end() - static_cast<std::ptrdiff_t>(count));
            }
        };
        if (auto* lines = std::get_if<LineStream>(&data)) {
            resizeSequence(*lines);
        } else {
            resizeSequence(std::get<RecordStream>(data));
        }
        if (rowCount(data) == 0) {
            errorMessage = "row slicing produced no rows";
            return OperationStatus::Missing;
        }
        return OperationStatus::Ok;
    }

    if (stage.kind == GrepStageKind::Reject) {
        auto* lines = std::get_if<LineStream>(&data);
        if (lines == nullptr) {
            errorMessage = "reject requires text lines";
            return OperationStatus::Error;
        }
        LineMatcher matcher;
        if (!matcher.initialize(stage.pattern, errorMessage)) {
            return OperationStatus::Error;
        }
        lines->erase(std::remove_if(lines->begin(), lines->end(),
                                    [&matcher](const TextLine& line) { return matcher.matches(line.text); }),
                     lines->end());
        if (lines->empty()) {
            errorMessage = "reject removed all lines";
            return OperationStatus::Missing;
        }
        return OperationStatus::Ok;
    }

    if (stage.kind == GrepStageKind::Scan) {
        auto* lines = std::get_if<LineStream>(&data);
        if (lines == nullptr) {
            errorMessage = "scan requires text lines";
            return OperationStatus::Error;
        }
        RecordStream records;
        std::size_t rejectedRows = 0;
        const OperationStatus status = applyScan(*lines, stage, records, rejectedRows, errorMessage);
        if (status != OperationStatus::Ok) {
            return status;
        }
        if (rejectedRows > 0) {
            std::cerr << "Warning: %grep " << label << ": scan rejected "
                      << rejectedRows << " non-empty row(s)" << std::endl;
        }
        data = std::move(records);
        return OperationStatus::Ok;
    }

    if (stage.kind == GrepStageKind::Split) {
        auto* lines = std::get_if<LineStream>(&data);
        if (lines == nullptr) {
            errorMessage = "split requires text lines";
            return OperationStatus::Error;
        }
        const bool whitespace = lowerAscii(stage.argument) == "ws";
        RecordStream records = splitLines(*lines, stage.argument, whitespace, errorMessage);
        if (!errorMessage.empty()) {
            return OperationStatus::Error;
        }
        if (records.empty()) {
            errorMessage = "split produced no records";
            return OperationStatus::Missing;
        }
        data = std::move(records);
        return OperationStatus::Ok;
    }

    if (stage.kind == GrepStageKind::Cols) {
        return applyCols(data, stage, errorMessage);
    }

    if (stage.kind == GrepStageKind::ExpectRows) {
        std::size_t expected = 0;
        if (!parseNonNegativeSize(stage.argument, expected)) {
            errorMessage = "invalid expected row count: " + stage.argument;
            return OperationStatus::Error;
        }
        const std::size_t actual = rowCount(data);
        if (!compareRows(actual, expected, stage.comparison)) {
            errorMessage = "row-count expectation failed: " + std::to_string(actual) + " " +
                           comparisonText(stage.comparison) + " " + std::to_string(expected) +
                           " is false";
            return OperationStatus::Error;
        }
        return OperationStatus::Ok;
    }

    return applyRecordExpectation(data, stage, errorMessage);
}

std::string jsonEscape(const std::string& value) {
    std::ostringstream output;
    for (const unsigned char c : value) {
        switch (c) {
            case '"': output << "\\\""; break;
            case '\\': output << "\\\\"; break;
            case '\b': output << "\\b"; break;
            case '\f': output << "\\f"; break;
            case '\n': output << "\\n"; break;
            case '\r': output << "\\r"; break;
            case '\t': output << "\\t"; break;
            default:
                if (c < 0x20) {
                    output << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                           << static_cast<int>(c) << std::dec << std::setfill(' ');
                } else {
                    output << static_cast<char>(c);
                }
        }
    }
    return output.str();
}

std::string csvEscape(const std::string& value) {
    if (value.find_first_of(",\"\r\n") == std::string::npos) {
        return value;
    }
    std::string escaped = "\"";
    for (const char c : value) {
        if (c == '"') {
            escaped += "\"\"";
        } else {
            escaped.push_back(c);
        }
    }
    escaped.push_back('"');
    return escaped;
}

std::string jsonNumberLexeme(const FieldValue& field) {
    if (field.type == FieldType::Integer) {
        return std::to_string(field.intValue);
    }

    std::string text = Utils::trim(field.raw);
    for (char& c : text) {
        if (c == 'd' || c == 'D') {
            c = 'E';
        }
    }

    // scan:num accepts several useful scientific notations that are not
    // directly valid JSON numbers: leading '+', a leading decimal point,
    // trailing decimal point, and leading zeroes. Normalize only those lexical
    // details while preserving the original decimal digits and exponent.
    if (!text.empty() && text.front() == '+') {
        text.erase(text.begin());
    }

    const std::size_t exponentPos = text.find_first_of("eE");
    std::string mantissa = exponentPos == std::string::npos ? text : text.substr(0, exponentPos);
    std::string exponent = exponentPos == std::string::npos ? "" : text.substr(exponentPos + 1);

    std::string sign;
    if (!mantissa.empty() && (mantissa.front() == '-' || mantissa.front() == '+')) {
        if (mantissa.front() == '-') {
            sign = "-";
        }
        mantissa.erase(mantissa.begin());
    }

    const std::size_t decimalPos = mantissa.find('.');
    std::string integerPart = decimalPos == std::string::npos ? mantissa : mantissa.substr(0, decimalPos);
    std::string fractionalPart = decimalPos == std::string::npos ? "" : mantissa.substr(decimalPos + 1);

    const std::size_t firstNonZero = integerPart.find_first_not_of('0');
    if (firstNonZero == std::string::npos) {
        integerPart = "0";
    } else {
        integerPart.erase(0, firstNonZero);
    }

    std::string normalized = sign + integerPart;
    if (decimalPos != std::string::npos) {
        normalized += '.';
        normalized += fractionalPart.empty() ? "0" : fractionalPart;
    }
    if (exponentPos != std::string::npos) {
        normalized += 'E';
        normalized += exponent;
    }
    return normalized;
}

bool atomicWrite(const std::string& path,
                 const std::function<bool(std::ostream&, std::string&)>& writer,
                 std::string& errorMessage) {
    if (Utils::trim(path).empty()) {
        errorMessage = "output path is empty";
        return false;
    }

    const fs::path target(path);
    std::error_code ec;
    if (!target.parent_path().empty()) {
        fs::create_directories(target.parent_path(), ec);
        if (ec) {
            errorMessage = "cannot create output directory for " + path + ": " + ec.message();
            return false;
        }
    }

    fs::path temporary = target;
    temporary += ".tmp";
    fs::remove(temporary, ec);
    ec.clear();

    std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
    if (!output.is_open()) {
        errorMessage = "cannot create temporary output file: " + temporary.string();
        return false;
    }
    if (!writer(output, errorMessage)) {
        if (errorMessage.empty()) {
            errorMessage = "failed while serializing output file: " + path;
        }
        output.close();
        fs::remove(temporary, ec);
        return false;
    }
    output.flush();
    if (!output.good()) {
        errorMessage = "failed while writing output file: " + path;
        output.close();
        fs::remove(temporary, ec);
        return false;
    }
    output.close();

    // On POSIX, rename over an existing regular file is atomic. Try that first
    // so a successful prior result is never removed before the replacement is
    // ready. Windows commonly rejects replacement renames; in that case only,
    // remove the existing target and retry.
    fs::rename(temporary, target, ec);
    if (!ec) {
        return true;
    }

    ec.clear();
    if (fs::exists(target, ec) && !ec) {
        fs::remove(target, ec);
        if (ec) {
            errorMessage = "cannot replace existing output file " + path + ": " + ec.message();
            fs::remove(temporary, ec);
            return false;
        }
        fs::rename(temporary, target, ec);
        if (!ec) {
            return true;
        }
    }

    ec.clear();
    fs::copy_file(temporary, target, fs::copy_options::overwrite_existing, ec);
    if (ec) {
        errorMessage = "cannot finalize output file " + path + ": " + ec.message();
        fs::remove(temporary, ec);
        return false;
    }
    fs::remove(temporary, ec);
    return true;
}

bool validateRecordShape(const RecordStream& records, std::string& errorMessage) {
    if (records.empty()) {
        errorMessage = "no records to write";
        return false;
    }
    const auto& fields = records.front().fields;
    for (const auto& record : records) {
        if (record.fields.size() != fields.size()) {
            errorMessage = "records have inconsistent field counts";
            return false;
        }
        for (std::size_t i = 0; i < fields.size(); ++i) {
            if (record.fields[i].name != fields[i].name) {
                errorMessage = "records have inconsistent field order";
                return false;
            }
        }
    }
    return true;
}

OperationStatus writeFileSink(const PipelineData& data, const std::string& path,
                              std::string& errorMessage) {
    if (rowCount(data) == 0) {
        errorMessage = "pipeline produced no rows";
        return OperationStatus::Missing;
    }

    const std::string extension = lowerAscii(fs::path(path).extension().string());
    const bool ok = atomicWrite(path, [&](std::ostream& output, std::string& writerError) {
        if (const auto* lines = std::get_if<LineStream>(&data)) {
            for (const auto& line : *lines) {
                output << line.text << '\n';
            }
            return output.good();
        }

        const auto& records = std::get<RecordStream>(data);
        if (!validateRecordShape(records, writerError)) {
            return false;
        }
        if (extension == ".jsonl") {
            for (const auto& record : records) {
                output << '{';
                for (std::size_t i = 0; i < record.fields.size(); ++i) {
                    if (i > 0) output << ',';
                    const auto& field = record.fields[i];
                    output << '"' << jsonEscape(field.name) << "\":";
                    if (field.type == FieldType::Integer) {
                        output << field.intValue;
                    } else if (field.type == FieldType::Number && std::isfinite(field.numberValue)) {
                        output << jsonNumberLexeme(field);
                    } else {
                        output << '"' << jsonEscape(field.raw) << '"';
                    }
                }
                output << "}\n";
            }
            return output.good();
        }

        const bool csv = extension == ".csv";
        const char separator = csv ? ',' : '\t';
        for (const auto& record : records) {
            for (std::size_t i = 0; i < record.fields.size(); ++i) {
                if (i > 0) output << separator;
                output << (csv ? csvEscape(record.fields[i].raw) : record.fields[i].raw);
            }
            output << '\n';
        }
        return output.good();
    }, errorMessage);

    return ok ? OperationStatus::Ok : OperationStatus::Error;
}

bool isReservedAtomField(const std::string& name) {
    const std::string lower = lowerAscii(name);
    return lower == "atom" || lower == "index" || lower == "center" ||
           lower == "element" || lower == "symbol";
}

const FieldValue* findAnyField(const Record& record, const std::vector<std::string>& names) {
    for (const auto& name : names) {
        if (const FieldValue* field = findField(record, name)) {
            return field;
        }
    }
    return nullptr;
}

bool fieldIsNumeric(const FieldValue& field, double& value) {
    if (field.type == FieldType::Integer) {
        value = static_cast<double>(field.intValue);
        return true;
    }
    if (field.type == FieldType::Number) {
        value = field.numberValue;
        return true;
    }
    return parseNumber(field.raw, value);
}

OperationStatus writeAtomVecSink(const PipelineData& data, const GrepSink& sink,
                                 std::string& outputPath, std::string& errorMessage) {
    const auto* records = std::get_if<RecordStream>(&data);
    if (records == nullptr) {
        errorMessage = "emit atomvec requires structured records; use scan/split/cols first";
        return OperationStatus::Error;
    }
    if (records->empty()) {
        errorMessage = "emit atomvec received no records";
        return OperationStatus::Missing;
    }

    const Record& first = records->front();
    const FieldValue* firstAtom = findAnyField(first, {"atom", "index", "center"});
    const FieldValue* firstElement = findAnyField(first, {"element", "symbol"});

    std::vector<const FieldValue*> numericCandidates;
    for (const auto& field : first.fields) {
        if (isReservedAtomField(field.name)) {
            continue;
        }
        double value = 0.0;
        if (fieldIsNumeric(field, value)) {
            numericCandidates.push_back(&field);
        }
    }

    std::string property = sink.property;
    const FieldValue* propertyField = nullptr;
    if (!property.empty()) {
        propertyField = findField(first, property);
        if (propertyField == nullptr) {
            propertyField = findField(first, "value");
        }
        if (propertyField == nullptr && numericCandidates.size() == 1) {
            propertyField = numericCandidates.front();
        }
        if (propertyField == nullptr) {
            errorMessage = "cannot determine source field for atomvec property: " + property;
            return OperationStatus::Error;
        }
    } else {
        if (numericCandidates.size() != 1) {
            errorMessage = "emit atomvec requires exactly one non-reserved numeric field or an explicit property";
            return OperationStatus::Error;
        }
        propertyField = numericCandidates.front();
        if (lowerAscii(propertyField->name) == "value") {
            errorMessage = "emit atomvec with a value field requires an explicit property name";
            return OperationStatus::Error;
        }
        property = propertyField->name;
    }

    if (!isValidFieldName(property)) {
        errorMessage = "invalid atomvec property name: " + property;
        return OperationStatus::Error;
    }

    struct AtomValue {
        std::int64_t atom = 0;
        std::string element;
        std::string value;
    };
    std::vector<AtomValue> atoms;
    atoms.reserve(records->size());

    const std::string propertySourceName = propertyField->name;
    for (std::size_t i = 0; i < records->size(); ++i) {
        const Record& record = (*records)[i];
        AtomValue atomValue;
        const FieldValue* atomField = firstAtom == nullptr ? nullptr :
                                      findAnyField(record, {"atom", "index", "center"});
        if (atomField == nullptr) {
            atomValue.atom = static_cast<std::int64_t>(i + 1);
        } else if (!parseInt64(atomField->raw, atomValue.atom) || atomValue.atom <= 0) {
            errorMessage = "atomvec atom index is not a positive integer at source line " +
                           std::to_string(record.sourceLine);
            return OperationStatus::Error;
        }

        if (firstElement != nullptr) {
            const FieldValue* elementField = findAnyField(record, {"element", "symbol"});
            if (elementField == nullptr || Utils::trim(elementField->raw).empty()) {
                errorMessage = "atomvec element field is missing at source line " +
                               std::to_string(record.sourceLine);
                return OperationStatus::Error;
            }
            atomValue.element = Utils::trim(elementField->raw);
        }

        const FieldValue* valueField = findField(record, propertySourceName);
        if (valueField == nullptr && !sink.property.empty()) {
            valueField = findField(record, sink.property);
            if (valueField == nullptr) valueField = findField(record, "value");
        }
        double numericValue = 0.0;
        if (valueField == nullptr || !fieldIsNumeric(*valueField, numericValue) ||
            !std::isfinite(numericValue)) {
            errorMessage = "atomvec property is missing, non-numeric, or non-finite at source line " +
                           std::to_string(record.sourceLine);
            return OperationStatus::Error;
        }
        atomValue.value = valueField->raw;
        atoms.push_back(atomValue);
    }

    std::sort(atoms.begin(), atoms.end(),
              [](const AtomValue& lhs, const AtomValue& rhs) { return lhs.atom < rhs.atom; });
    for (std::size_t i = 0; i < atoms.size(); ++i) {
        const std::int64_t expected = static_cast<std::int64_t>(i + 1);
        if (atoms[i].atom != expected) {
            errorMessage = "atomvec atom indices must be unique and contiguous from 1";
            return OperationStatus::Error;
        }
    }

    outputPath = sink.path.empty() ? property + ".atomvec.kv" : sink.path;
    const bool ok = atomicWrite(outputPath, [&](std::ostream& output, std::string&) {
        output << "atom_count=" << atoms.size() << '\n';
        for (const auto& atom : atoms) {
            if (!atom.element.empty()) {
                output << "atoms." << atom.atom << ".element=" << atom.element << '\n';
            }
            output << "atoms." << atom.atom << '.' << property << '=' << atom.value << '\n';
        }
        return output.good();
    }, errorMessage);
    return ok ? OperationStatus::Ok : OperationStatus::Error;
}

OperationStatus writeKvSink(const PipelineData& data, const GrepRule& rule,
                            std::string& outputPath, std::string& errorMessage) {
    const auto* records = std::get_if<RecordStream>(&data);
    if (records == nullptr) {
        errorMessage = "emit kv requires structured records; use scan/split/cols first";
        return OperationStatus::Error;
    }
    if (records->empty()) {
        errorMessage = "emit kv received no records";
        return OperationStatus::Missing;
    }
    if (records->size() != 1) {
        errorMessage = "emit kv requires exactly one record, got " + std::to_string(records->size());
        return OperationStatus::Error;
    }

    outputPath = rule.sink.path;
    if (outputPath.empty()) {
        if (rule.name.empty()) {
            errorMessage = "emit kv without an explicit path requires a rule name";
            return OperationStatus::Error;
        }
        outputPath = rule.name + ".kv";
    }

    const bool ok = atomicWrite(outputPath, [&](std::ostream& output, std::string&) {
        for (const auto& field : records->front().fields) {
            output << field.name << '=' << field.raw << '\n';
        }
        return output.good();
    }, errorMessage);
    return ok ? OperationStatus::Ok : OperationStatus::Error;
}

OperationStatus writeSink(const PipelineData& data, const GrepRule& rule,
                          std::string& outputPath, std::string& errorMessage) {
    if (rule.sink.kind == GrepSinkKind::File) {
        outputPath = rule.sink.path;
        return writeFileSink(data, outputPath, errorMessage);
    }
    if (rule.sink.kind == GrepSinkKind::AtomVec) {
        return writeAtomVecSink(data, rule.sink, outputPath, errorMessage);
    }
    return writeKvSink(data, rule, outputPath, errorMessage);
}

std::string describeSink(const GrepRule& rule) {
    if (rule.sink.kind == GrepSinkKind::File) {
        return rule.sink.path;
    }
    if (!rule.sink.path.empty()) {
        return rule.sink.path;
    }
    if (rule.sink.kind == GrepSinkKind::Kv) {
        return rule.name.empty() ? "<rule-name>.kv" : rule.name + ".kv";
    }
    if (!rule.sink.property.empty()) {
        return rule.sink.property + ".atomvec.kv";
    }
    return "<inferred-property>.atomvec.kv";
}

OperationStatus runRule(const GrepRule& inputRule, std::size_t index,
                        const GrepExecutionContext& context,
                        std::string& outputPath, std::string& errorMessage) {
    const GrepRule rule = resolveRuntimeRule(inputRule, context);
    const std::string label = ruleLabel(rule, index);
    const std::string source = rule.source.empty() ? context.defaultSource : rule.source;
    if (Utils::trim(source).empty()) {
        errorMessage = "no source is available; use 'from <file>' or attach %grep to a non-screen module task";
        return OperationStatus::Error;
    }

    if (context.dryrun) {
        std::cout << "Dry-run mode: %grep " << label << " would read " << source
                  << " and write " << describeSink(rule) << std::endl;
        outputPath = describeSink(rule);
        return OperationStatus::Ok;
    }

    LineStream sourceLines;
    OperationStatus status = readSourceLines(source, sourceLines, errorMessage);
    if (status != OperationStatus::Ok) {
        return status;
    }

    LineStream selected;
    status = applySelector(sourceLines, rule.selector, selected, errorMessage);
    if (status != OperationStatus::Ok) {
        return status;
    }

    PipelineData data = std::move(selected);
    for (const auto& stage : rule.stages) {
        status = applyStage(data, stage, label, errorMessage);
        if (status != OperationStatus::Ok) {
            return status;
        }
    }

    if (rowCount(data) == 0) {
        errorMessage = "pipeline produced no rows";
        return OperationStatus::Missing;
    }
    return writeSink(data, rule, outputPath, errorMessage);
}

} // namespace

namespace GrepEngine {

GrepExecutionResult execute(const std::vector<GrepRule>& rules,
                            const GrepExecutionContext& context) {
    GrepExecutionResult result;
    for (std::size_t i = 0; i < rules.size(); ++i) {
        const std::string label = ruleLabel(rules[i], i);
        std::cout << "\n>>> Processing %grep rule: " << label << std::endl;

        std::string outputPath;
        std::string errorMessage;
        const OperationStatus status = runRule(rules[i], i, context, outputPath, errorMessage);
        if (status == OperationStatus::Ok) {
            ++result.completedRules;
            if (!context.dryrun && !outputPath.empty()) {
                result.outputFiles.push_back(outputPath);
                std::cout << "%grep output written: " << outputPath << std::endl;
            }
            continue;
        }

        if (status == OperationStatus::Missing && rules[i].optional) {
            ++result.skippedOptionalRules;
            std::cerr << "Warning: optional %grep rule " << label << " skipped: "
                      << errorMessage << std::endl;
            continue;
        }

        result.success = false;
        std::cerr << "Error: %grep rule " << label << " failed: " << errorMessage << std::endl;
        break;
    }
    return result;
}

} // namespace GrepEngine
