#include "common/execution_trace.h"
#include "common/gui.h"
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <iostream>
#include <stdexcept>

namespace {
long long outputPosition() {
    std::cout.flush();
    std::cerr.flush();
    std::fflush(stdout);
#ifdef _WIN32
    return _ftelli64(stdout);
#else
    return ftello(stdout);
#endif
}
unsigned long long size(const std::string& path) {
    std::error_code error;
    auto length = std::filesystem::file_size(std::filesystem::u8path(path), error);
    return error ? 0 : length;
}
}

void ExecutionTrace::open(const std::string& path, const std::string& steps) {
    if (path.empty()) return;
    stream.open(std::filesystem::u8path(path), std::ios::binary | std::ios::trunc);
    if (!stream) throw std::runtime_error("Cannot create execution trace: " + path);
    event("plan", "\"steps\":" + steps);
}
void ExecutionTrace::event(const std::string& name, const std::string& details) {
    if (!stream.is_open()) return;
    const auto time = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    stream << "{\"version\":1,\"event\":" << Gui::quote(name)
           << ",\"group\":" << Gui::quote(group) << ",\"task\":" << task
           << ",\"time\":" << time << ",\"offset\":" << outputPosition();
    if (!details.empty()) stream << ',' << details;
    stream << "}\n" << std::flush;
    if (!stream) throw std::runtime_error("Cannot write execution trace");
}
void ExecutionTrace::iteration(const std::string& details, const std::string& id) {
    if (!stream.is_open()) return;
    group = id;
    event("iteration", details);
}
void ExecutionTrace::start(std::size_t index) {
    if (!stream.is_open()) return;
    task = index;
    phaseName.clear(); output.clear(); failedPhase.clear();
    event("start");
}
void ExecutionTrace::phase(const std::string& name, const std::string& file) {
    if (!stream.is_open()) return;
    phaseName = name; output = file;
    event("phase", "\"phase\":" + Gui::quote(name) + ",\"output\":" + Gui::quote(file)
        + ",\"outputOffset\":" + std::to_string(size(file)));
}
void ExecutionTrace::phaseDone(bool success) {
    if (!stream.is_open()) return;
    if (!success && failedPhase.empty()) failedPhase = phaseName;
    event("phase-end", "\"phase\":" + Gui::quote(phaseName) + ",\"success\":"
        + (success ? "true" : "false") + ",\"outputOffset\":" + std::to_string(size(output)));
}
void ExecutionTrace::finish(bool success, bool dryRun) {
    if (!stream.is_open()) return;
    event("finish", "\"state\":" + Gui::quote(success ? (dryRun ? "prepared" : "completed") : "failed")
        + ",\"failedPhase\":" + Gui::quote(failedPhase));
}
void ExecutionTrace::moved(const std::string& source, const std::string& destination) {
    if (!stream.is_open()) return;
    event("move", "\"source\":" + Gui::quote(source) + ",\"destination\":" + Gui::quote(destination));
}
