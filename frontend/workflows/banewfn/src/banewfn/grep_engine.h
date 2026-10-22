#ifndef GREP_ENGINE_H
#define GREP_ENGINE_H

#include "common/grep_dsl.h"

#include <cstddef>
#include <string>
#include <vector>

struct GrepExecutionContext {
    // Default source for rules without an explicit from clause. For a normal
    // module task this is the Multiwfn .out file.
    std::string defaultSource;

    // Runtime value used to replace $output / ${output}. Usually identical to
    // defaultSource, but kept explicit for clarity and future pipelines.
    std::string outputFile;

    bool dryrun = false;
};

struct GrepExecutionResult {
    bool success = true;
    std::size_t completedRules = 0;
    std::size_t skippedOptionalRules = 0;
    std::vector<std::string> outputFiles;
};

namespace GrepEngine {

GrepExecutionResult execute(const std::vector<GrepRule>& rules,
                            const GrepExecutionContext& context);

} // namespace GrepEngine

#endif // GREP_ENGINE_H
