#include "common/grep_dsl.h"
#include "common/utils.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <limits>
#include <sstream>

namespace {

enum class TokenKind {
    Word,
    String,
    Regex,
    Pipe,
    Arrow,
    Range
};

struct Token {
    TokenKind kind = TokenKind::Word;
    std::string text;
    bool ignoreCase = false;
    std::size_t position = 0;
};

std::string lowerAscii(const std::string& text) {
    std::string result = text;
    std::transform(result.begin(), result.end(), result.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return result;
}

bool isBoundaryAfterRegex(const std::string& text, std::size_t pos) {
    if (pos >= text.size()) {
        return true;
    }
    if (std::isspace(static_cast<unsigned char>(text[pos]))) {
        return true;
    }
    if (text[pos] == '|') {
        return true;
    }
    if (pos + 1 < text.size() && text[pos] == '-' && text[pos + 1] == '>') {
        return true;
    }
    if (pos + 1 < text.size() && text[pos] == '.' && text[pos + 1] == '.') {
        return true;
    }
    return false;
}

bool findRegexEnd(const std::string& text, std::size_t start,
                  std::size_t& closingSlash, bool& ignoreCase, std::size_t& tokenEnd) {
    if (start >= text.size() || text[start] != '/') {
        return false;
    }

    bool escaped = false;
    for (std::size_t i = start + 1; i < text.size(); ++i) {
        const char c = text[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (c == '\\') {
            escaped = true;
            continue;
        }
        if (c != '/') {
            continue;
        }

        std::size_t end = i + 1;
        bool icase = false;
        if (end < text.size() && (text[end] == 'i' || text[end] == 'I')) {
            icase = true;
            ++end;
        }
        if (!isBoundaryAfterRegex(text, end)) {
            continue;
        }

        closingSlash = i;
        ignoreCase = icase;
        tokenEnd = end;
        return true;
    }
    return false;
}

bool startsOperator(const std::string& text, std::size_t pos) {
    if (pos >= text.size()) {
        return false;
    }
    if (text[pos] == '|') {
        return true;
    }
    if (pos + 1 < text.size() && text[pos] == '-' && text[pos + 1] == '>') {
        return true;
    }
    if (pos + 1 < text.size() && text[pos] == '.' && text[pos + 1] == '.') {
        return true;
    }
    return false;
}

bool tokenExpectsPattern(const std::vector<Token>& tokens) {
    if (tokens.empty()) {
        return false;
    }
    const Token& last = tokens.back();
    if (last.kind == TokenKind::Range) {
        return true;
    }
    if (last.kind != TokenKind::Word) {
        return false;
    }
    const std::string word = lowerAscii(last.text);
    return word == "between" || word == "inside" || word == "after" ||
           word == "before" || word == "match" || word == "reject";
}

bool tokenize(const std::string& text, std::vector<Token>& tokens, std::string& errorMessage) {
    tokens.clear();
    std::size_t pos = 0;

    while (pos < text.size()) {
        while (pos < text.size() && std::isspace(static_cast<unsigned char>(text[pos]))) {
            ++pos;
        }
        if (pos >= text.size()) {
            break;
        }

        Token token;
        token.position = pos;

        if (text[pos] == '|') {
            token.kind = TokenKind::Pipe;
            token.text = "|";
            ++pos;
            tokens.push_back(token);
            continue;
        }
        if (pos + 1 < text.size() && text[pos] == '-' && text[pos + 1] == '>') {
            token.kind = TokenKind::Arrow;
            token.text = "->";
            pos += 2;
            tokens.push_back(token);
            continue;
        }
        if (pos + 1 < text.size() && text[pos] == '.' && text[pos + 1] == '.') {
            token.kind = TokenKind::Range;
            token.text = "..";
            pos += 2;
            tokens.push_back(token);
            continue;
        }

        if (text[pos] == '"' || text[pos] == '\'') {
            const char quote = text[pos++];
            token.kind = TokenKind::String;
            bool closed = false;
            while (pos < text.size()) {
                const char c = text[pos++];
                if (c == quote) {
                    closed = true;
                    break;
                }
                if (c == '\\' && pos < text.size()) {
                    const char next = text[pos];
                    if (next == quote || next == '\\') {
                        token.text.push_back(next);
                        ++pos;
                    } else {
                        token.text.push_back(c);
                    }
                } else {
                    token.text.push_back(c);
                }
            }
            if (!closed) {
                errorMessage = "unterminated quoted string";
                return false;
            }
            tokens.push_back(token);
            continue;
        }

        if (text[pos] == '/' && tokenExpectsPattern(tokens)) {
            std::size_t closingSlash = 0;
            std::size_t tokenEnd = 0;
            bool ignoreCase = false;
            if (findRegexEnd(text, pos, closingSlash, ignoreCase, tokenEnd)) {
                token.kind = TokenKind::Regex;
                token.text = text.substr(pos + 1, closingSlash - pos - 1);
                token.ignoreCase = ignoreCase;
                pos = tokenEnd;
                tokens.push_back(token);
                continue;
            }
        }

        token.kind = TokenKind::Word;
        const std::size_t start = pos;
        while (pos < text.size() &&
               !std::isspace(static_cast<unsigned char>(text[pos])) &&
               !startsOperator(text, pos)) {
            ++pos;
        }
        if (pos == start) {
            errorMessage = "unexpected token near column " + std::to_string(start + 1);
            return false;
        }
        token.text = text.substr(start, pos - start);
        tokens.push_back(token);
    }

    return true;
}

bool isWord(const Token& token, const std::string& word) {
    return token.kind == TokenKind::Word && lowerAscii(token.text) == word;
}

bool isPipelineBoundary(const Token& token) {
    return token.kind == TokenKind::Pipe || token.kind == TokenKind::Arrow;
}

bool isValidRuleName(const std::string& name) {
    if (name.empty()) {
        return false;
    }
    for (const char c : name) {
        if (!std::isalnum(static_cast<unsigned char>(c)) && c != '_' && c != '-' && c != '.') {
            return false;
        }
    }
    return true;
}

bool parsePositiveSize(const std::string& text, std::size_t& value) {
    if (text.empty()) {
        return false;
    }
    char* end = nullptr;
    const unsigned long long parsed = std::strtoull(text.c_str(), &end, 10);
    if (end == nullptr || *end != '\0' || parsed == 0 ||
        parsed > static_cast<unsigned long long>(std::numeric_limits<std::size_t>::max())) {
        return false;
    }
    value = static_cast<std::size_t>(parsed);
    return true;
}

bool parseInteger(const std::string& text, int& value) {
    if (text.empty()) {
        return false;
    }
    char* end = nullptr;
    const long parsed = std::strtol(text.c_str(), &end, 10);
    if (end == nullptr || *end != '\0' || parsed == 0 ||
        parsed < static_cast<long>(std::numeric_limits<int>::min()) ||
        parsed > static_cast<long>(std::numeric_limits<int>::max())) {
        return false;
    }
    value = static_cast<int>(parsed);
    return true;
}

class RuleParser {
public:
    explicit RuleParser(const std::vector<Token>& input) : tokens(input) {}

    bool parse(GrepRule& rule, std::string& errorMessage) {
        if (tokens.empty()) {
            errorMessage = "empty rule";
            return false;
        }

        if (peekWord("optional")) {
            rule.optional = true;
            ++pos;
        }

        if (pos < tokens.size() && tokens[pos].kind == TokenKind::Word &&
            !tokens[pos].text.empty() && tokens[pos].text.back() == ':') {
            const std::string candidate = tokens[pos].text.substr(0, tokens[pos].text.size() - 1);
            if (!isValidRuleName(candidate)) {
                errorMessage = "invalid rule name: " + candidate;
                return false;
            }
            rule.name = candidate;
            ++pos;
        }

        if (peekWord("from")) {
            ++pos;
            if (!parseScalarToken(rule.source, "source path", errorMessage)) {
                return false;
            }
            if (!consume(TokenKind::Pipe)) {
                errorMessage = "expected '|' after from <source>";
                return false;
            }
        }

        if (!parseSelector(rule.selector, errorMessage)) {
            return false;
        }

        bool hasSink = false;
        while (pos < tokens.size()) {
            if (consume(TokenKind::Arrow)) {
                if (hasSink) {
                    errorMessage = "multiple output sinks in one rule";
                    return false;
                }
                rule.sink.kind = GrepSinkKind::File;
                if (!parseScalarToken(rule.sink.path, "output path", errorMessage)) {
                    return false;
                }
                hasSink = true;
                if (pos != tokens.size()) {
                    errorMessage = "unexpected token after output path: " + tokens[pos].text;
                    return false;
                }
                break;
            }

            if (!consume(TokenKind::Pipe)) {
                errorMessage = "expected '|', '->', or end of rule near: " + tokens[pos].text;
                return false;
            }
            if (pos >= tokens.size()) {
                errorMessage = "pipeline cannot end with '|'";
                return false;
            }

            if (peekWord("emit")) {
                if (hasSink) {
                    errorMessage = "multiple output sinks in one rule";
                    return false;
                }
                if (!parseEmitter(rule.sink, errorMessage)) {
                    return false;
                }
                hasSink = true;
                if (pos != tokens.size()) {
                    errorMessage = "emit must be the final pipeline element";
                    return false;
                }
                break;
            }

            GrepStage stage;
            if (!parseStage(stage, errorMessage)) {
                return false;
            }
            rule.stages.push_back(stage);
        }

        if (!hasSink) {
            errorMessage = "rule has no output sink; use '-> <path>' or '| emit ...'";
            return false;
        }
        return true;
    }

private:
    const std::vector<Token>& tokens;
    std::size_t pos = 0;

    bool peekWord(const std::string& word) const {
        return pos < tokens.size() && isWord(tokens[pos], word);
    }

    bool consume(TokenKind kind) {
        if (pos < tokens.size() && tokens[pos].kind == kind) {
            ++pos;
            return true;
        }
        return false;
    }

    bool parseScalarToken(std::string& value, const std::string& description,
                          std::string& errorMessage) {
        if (pos >= tokens.size() || isPipelineBoundary(tokens[pos]) || tokens[pos].kind == TokenKind::Range) {
            errorMessage = "expected " + description;
            return false;
        }
        if (tokens[pos].kind == TokenKind::Regex) {
            errorMessage = description + " cannot be a regular expression";
            return false;
        }
        value = tokens[pos].text;
        ++pos;
        return true;
    }

    bool parsePattern(GrepPattern& pattern, std::string& errorMessage) {
        bool exact = false;
        if (peekWord("exact")) {
            exact = true;
            ++pos;
        }

        if (pos >= tokens.size()) {
            errorMessage = "expected text or regular-expression pattern";
            return false;
        }

        const Token& token = tokens[pos];
        if (token.kind == TokenKind::Regex) {
            if (exact) {
                errorMessage = "exact cannot modify a regular expression";
                return false;
            }
            pattern.kind = GrepPatternKind::Regex;
            pattern.value = token.text;
            pattern.ignoreCase = token.ignoreCase;
            ++pos;
            return true;
        }

        if (token.kind != TokenKind::String && token.kind != TokenKind::Word) {
            errorMessage = "expected text or regular-expression pattern";
            return false;
        }
        pattern.kind = exact ? GrepPatternKind::ExactLiteral : GrepPatternKind::Literal;
        pattern.value = token.text;
        pattern.ignoreCase = false;
        ++pos;
        return true;
    }

    bool parseOccurrence(GrepOccurrence& occurrence, GrepOccurrenceKind defaultKind,
                         std::string& errorMessage) {
        occurrence.kind = defaultKind;
        occurrence.nth = 1;
        if (pos >= tokens.size() || tokens[pos].kind != TokenKind::Word) {
            return true;
        }

        const std::string modifier = lowerAscii(tokens[pos].text);
        if (modifier == "first") {
            occurrence.kind = GrepOccurrenceKind::First;
            ++pos;
        } else if (modifier == "last") {
            occurrence.kind = GrepOccurrenceKind::Last;
            ++pos;
        } else if (modifier == "all") {
            occurrence.kind = GrepOccurrenceKind::All;
            ++pos;
        } else if (modifier == "nth") {
            ++pos;
            if (pos >= tokens.size() || tokens[pos].kind != TokenKind::Word ||
                !parsePositiveSize(tokens[pos].text, occurrence.nth)) {
                errorMessage = "nth requires a positive integer";
                return false;
            }
            occurrence.kind = GrepOccurrenceKind::Nth;
            ++pos;
        }
        return true;
    }

    bool parseSelector(GrepSelector& selector, std::string& errorMessage) {
        if (pos >= tokens.size() || tokens[pos].kind != TokenKind::Word) {
            errorMessage = "expected selector (between, inside, after, before, or match)";
            return false;
        }

        const std::string kind = lowerAscii(tokens[pos].text);
        ++pos;
        if (kind == "between" || kind == "inside") {
            selector.kind = kind == "between" ? GrepSelectorKind::Between : GrepSelectorKind::Inside;
            if (!parsePattern(selector.first, errorMessage)) {
                return false;
            }
            if (!consume(TokenKind::Range)) {
                errorMessage = "expected '..' between range markers";
                return false;
            }
            if (!parsePattern(selector.second, errorMessage)) {
                return false;
            }
            return parseOccurrence(selector.occurrence, GrepOccurrenceKind::First, errorMessage);
        }

        if (kind == "after" || kind == "before" || kind == "match") {
            if (kind == "after") selector.kind = GrepSelectorKind::After;
            if (kind == "before") selector.kind = GrepSelectorKind::Before;
            if (kind == "match") selector.kind = GrepSelectorKind::Match;
            if (!parsePattern(selector.first, errorMessage)) {
                return false;
            }
            const GrepOccurrenceKind defaultKind =
                selector.kind == GrepSelectorKind::Match ? GrepOccurrenceKind::All : GrepOccurrenceKind::First;
            return parseOccurrence(selector.occurrence, defaultKind, errorMessage);
        }

        errorMessage = "unknown selector: " + kind;
        return false;
    }

    bool ensureStageEnd(const std::string& stageName, std::string& errorMessage) const {
        if (pos < tokens.size() && !isPipelineBoundary(tokens[pos])) {
            errorMessage = "unexpected argument to " + stageName + ": " + tokens[pos].text;
            return false;
        }
        return true;
    }

    bool parseStage(GrepStage& stage, std::string& errorMessage) {
        if (pos >= tokens.size() || tokens[pos].kind != TokenKind::Word) {
            errorMessage = "expected pipeline operator";
            return false;
        }

        const std::string name = lowerAscii(tokens[pos].text);
        ++pos;

        if (name == "trim") {
            stage.kind = GrepStageKind::Trim;
            return ensureStageEnd(name, errorMessage);
        }
        if (name == "drop") {
            if (!peekWord("blank")) {
                errorMessage = "drop currently supports only 'drop blank'";
                return false;
            }
            ++pos;
            stage.kind = GrepStageKind::DropBlank;
            return ensureStageEnd(name, errorMessage);
        }
        if (name == "drop_blank" || name == "drop-blank") {
            stage.kind = GrepStageKind::DropBlank;
            return ensureStageEnd(name, errorMessage);
        }
        if (name == "skip" || name == "take" || name == "tail") {
            stage.kind = name == "skip" ? GrepStageKind::Skip :
                         name == "take" ? GrepStageKind::Take : GrepStageKind::Tail;
            if (!parseScalarToken(stage.argument, name + " count", errorMessage)) {
                return false;
            }
            return ensureStageEnd(name, errorMessage);
        }
        if (name == "reject") {
            stage.kind = GrepStageKind::Reject;
            if (!parsePattern(stage.pattern, errorMessage)) {
                return false;
            }
            return ensureStageEnd(name, errorMessage);
        }
        if (name == "scan") {
            stage.kind = GrepStageKind::Scan;
            if (peekWord("strict")) {
                stage.strict = true;
                ++pos;
            }
            if (!parseScalarToken(stage.argument, "scan pattern", errorMessage)) {
                return false;
            }
            if (peekWord("strict")) {
                stage.strict = true;
                ++pos;
            }
            return ensureStageEnd(name, errorMessage);
        }
        if (name == "split") {
            stage.kind = GrepStageKind::Split;
            if (!parseScalarToken(stage.argument, "split delimiter", errorMessage)) {
                return false;
            }
            return ensureStageEnd(name, errorMessage);
        }
        if (name == "cols") {
            stage.kind = GrepStageKind::Cols;
            while (pos < tokens.size() && !isPipelineBoundary(tokens[pos])) {
                if (tokens[pos].kind != TokenKind::Word && tokens[pos].kind != TokenKind::String) {
                    errorMessage = "invalid cols specification: " + tokens[pos].text;
                    return false;
                }
                const std::string spec = tokens[pos].text;
                ++pos;
                if (spec.empty()) {
                    errorMessage = "empty cols specification";
                    return false;
                }

                GrepColumnSpec column;
                const std::size_t eqPos = spec.find('=');
                if (eqPos == std::string::npos) {
                    column.outputName = spec;
                    column.sourceName = spec;
                    column.byIndex = false;
                } else {
                    column.outputName = spec.substr(0, eqPos);
                    const std::string source = spec.substr(eqPos + 1);
                    if (column.outputName.empty() || source.empty()) {
                        errorMessage = "invalid cols specification: " + spec;
                        return false;
                    }
                    int index = 0;
                    if (parseInteger(source, index)) {
                        column.byIndex = true;
                        column.index = index;
                    } else {
                        column.byIndex = false;
                        column.sourceName = source;
                    }
                }
                stage.columns.push_back(column);
            }
            if (stage.columns.empty()) {
                errorMessage = "cols requires at least one field";
                return false;
            }
            return true;
        }
        if (name == "expect") {
            if (pos >= tokens.size() || tokens[pos].kind != TokenKind::Word) {
                errorMessage = "expect requires rows, unique, contiguous, or finite";
                return false;
            }
            const std::string expectation = lowerAscii(tokens[pos].text);
            ++pos;
            if (expectation == "rows") {
                stage.kind = GrepStageKind::ExpectRows;
                if (pos < tokens.size() && tokens[pos].kind == TokenKind::Word) {
                    const std::string op = tokens[pos].text;
                    if (op == "==") { stage.comparison = GrepComparison::Equal; ++pos; }
                    else if (op == "!=") { stage.comparison = GrepComparison::NotEqual; ++pos; }
                    else if (op == "<") { stage.comparison = GrepComparison::Less; ++pos; }
                    else if (op == "<=") { stage.comparison = GrepComparison::LessEqual; ++pos; }
                    else if (op == ">") { stage.comparison = GrepComparison::Greater; ++pos; }
                    else if (op == ">=") { stage.comparison = GrepComparison::GreaterEqual; ++pos; }
                }
                if (!parseScalarToken(stage.argument, "expected row count", errorMessage)) {
                    return false;
                }
                return ensureStageEnd(name, errorMessage);
            }
            if (expectation == "unique" || expectation == "contiguous" || expectation == "finite") {
                stage.kind = expectation == "unique" ? GrepStageKind::ExpectUnique :
                             expectation == "contiguous" ? GrepStageKind::ExpectContiguous :
                                                           GrepStageKind::ExpectFinite;
                if (!parseScalarToken(stage.argument, "field name", errorMessage)) {
                    return false;
                }
                return ensureStageEnd(name, errorMessage);
            }
            errorMessage = "unknown expectation: " + expectation;
            return false;
        }

        errorMessage = "unknown pipeline operator: " + name;
        return false;
    }

    bool parseEmitter(GrepSink& sink, std::string& errorMessage) {
        ++pos; // emit
        if (pos >= tokens.size() || tokens[pos].kind != TokenKind::Word) {
            errorMessage = "emit requires an emitter name (atomvec or kv)";
            return false;
        }
        const std::string emitter = lowerAscii(tokens[pos].text);
        ++pos;

        if (emitter == "atomvec") {
            sink.kind = GrepSinkKind::AtomVec;
            if (pos < tokens.size() && !peekWord("to")) {
                if (!parseScalarToken(sink.property, "atomvec property name", errorMessage)) {
                    return false;
                }
            }
            if (peekWord("to")) {
                ++pos;
                if (!parseScalarToken(sink.path, "atomvec output path", errorMessage)) {
                    return false;
                }
            }
            return true;
        }

        if (emitter == "kv") {
            sink.kind = GrepSinkKind::Kv;
            if (peekWord("to")) {
                ++pos;
                if (!parseScalarToken(sink.path, "kv output path", errorMessage)) {
                    return false;
                }
            }
            return true;
        }

        errorMessage = "unknown emitter: " + emitter;
        return false;
    }
};

bool isContinuationLine(const std::string& trimmed) {
    return trimmed.rfind("|", 0) == 0 || trimmed.rfind("->", 0) == 0 ||
           trimmed.rfind("..", 0) == 0;
}

} // namespace

namespace GrepDsl {

std::string removeInlineComment(const std::string& line) {
    bool inSingleQuote = false;
    bool inDoubleQuote = false;
    bool escaped = false;
    std::string currentWord;
    std::string lastWord;
    TokenKind lastKind = TokenKind::Word;
    bool hasLastToken = false;

    const auto finishWord = [&]() {
        if (!currentWord.empty()) {
            lastWord = lowerAscii(currentWord);
            lastKind = TokenKind::Word;
            hasLastToken = true;
            currentWord.clear();
        }
    };

    const auto patternExpected = [&]() {
        if (!hasLastToken) {
            return false;
        }
        if (lastKind == TokenKind::Range) {
            return true;
        }
        if (lastKind != TokenKind::Word) {
            return false;
        }
        return lastWord == "between" || lastWord == "inside" ||
               lastWord == "after" || lastWord == "before" ||
               lastWord == "match" || lastWord == "reject";
    };

    for (std::size_t i = 0; i < line.size(); ++i) {
        const char c = line[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if ((inSingleQuote || inDoubleQuote) && c == '\\') {
            escaped = true;
            continue;
        }
        if (!inDoubleQuote && c == '\'') {
            inSingleQuote = !inSingleQuote;
            continue;
        }
        if (!inSingleQuote && c == '"') {
            inDoubleQuote = !inDoubleQuote;
            continue;
        }
        if (inSingleQuote || inDoubleQuote) {
            continue;
        }

        if (std::isspace(static_cast<unsigned char>(c))) {
            finishWord();
            continue;
        }

        if (c == '#') {
            return line.substr(0, i);
        }

        if (c == '|') {
            finishWord();
            lastKind = TokenKind::Pipe;
            lastWord.clear();
            hasLastToken = true;
            continue;
        }
        if (i + 1 < line.size() && c == '-' && line[i + 1] == '>') {
            finishWord();
            lastKind = TokenKind::Arrow;
            lastWord.clear();
            hasLastToken = true;
            ++i;
            continue;
        }
        if (i + 1 < line.size() && c == '.' && line[i + 1] == '.') {
            finishWord();
            lastKind = TokenKind::Range;
            lastWord.clear();
            hasLastToken = true;
            ++i;
            continue;
        }

        if (c == '/' && currentWord.empty() && patternExpected()) {
            std::size_t closingSlash = 0;
            std::size_t tokenEnd = 0;
            bool ignoreCase = false;
            if (findRegexEnd(line, i, closingSlash, ignoreCase, tokenEnd)) {
                (void)ignoreCase;
                lastKind = TokenKind::Regex;
                lastWord.clear();
                hasLastToken = true;
                i = tokenEnd - 1;
                continue;
            }
        }

        currentWord.push_back(c);
    }
    return line;
}

bool parseRule(const std::string& text, int lineNumber, GrepRule& rule, std::string& errorMessage) {
    std::vector<Token> tokens;
    if (!tokenize(text, tokens, errorMessage)) {
        return false;
    }

    rule = GrepRule();
    rule.lineNumber = lineNumber;
    RuleParser parser(tokens);
    return parser.parse(rule, errorMessage);
}

GrepParseResult parseBlock(const std::vector<GrepDslLine>& lines) {
    GrepParseResult result;
    std::string current;
    int currentLine = 0;

    auto flush = [&]() {
        if (Utils::trim(current).empty()) {
            current.clear();
            currentLine = 0;
            return;
        }
        GrepRule rule;
        std::string errorMessage;
        if (parseRule(current, currentLine, rule, errorMessage)) {
            result.rules.push_back(rule);
        } else {
            result.errors.push_back("line " + std::to_string(currentLine) + ": " + errorMessage);
        }
        current.clear();
        currentLine = 0;
    };

    for (const auto& inputLine : lines) {
        const std::string stripped = removeInlineComment(inputLine.text);
        const std::string trimmed = Utils::trim(stripped);
        if (trimmed.empty()) {
            continue;
        }

        if (isContinuationLine(trimmed)) {
            if (current.empty()) {
                result.errors.push_back("line " + std::to_string(inputLine.lineNumber) +
                                        ": continuation without a preceding %grep rule");
                continue;
            }
            current += " " + trimmed;
            continue;
        }

        flush();
        current = trimmed;
        currentLine = inputLine.lineNumber;
    }

    flush();
    return result;
}

} // namespace GrepDsl
