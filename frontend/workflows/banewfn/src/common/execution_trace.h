#pragma once
#include <fstream>
#include <string>

// Optional execution observations. The workflow executor remains authoritative.
class ExecutionTrace {
public:
    void open(const std::string& path, const std::string& steps);
    void iteration(const std::string& details, const std::string& group);
    void start(std::size_t task);
    void phase(const std::string& name, const std::string& output = "");
    void phaseDone(bool success);
    void finish(bool success, bool dryRun);
    void moved(const std::string& source, const std::string& destination);
private:
    void event(const std::string& name, const std::string& details = "");
    std::ofstream stream;
    std::string group, phaseName, output, failedPhase;
    std::size_t task = 0;
};
