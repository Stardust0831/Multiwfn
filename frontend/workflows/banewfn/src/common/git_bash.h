#pragma once

// Windows-only adapter for BaneWfn %command blocks. Never select the WSL
// bash.exe shim: workflow paths and executables belong to the Windows package.
#include <windows.h>
#include <filesystem>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace WorkflowShell {

inline bool requestsBash(const std::vector<std::string>& lines) {
    for (const auto& line : lines) {
        std::istringstream words(line);
        std::string interpreter, argument;
        if (!(words >> interpreter)) continue;
        if (interpreter == "#!/bin/bash" || interpreter == "#!/usr/bin/bash") return true;
        return interpreter == "#!/usr/bin/env" && (words >> argument) && argument == "bash";
    }
    return false;
}

inline std::wstring environment(const wchar_t* name) {
    DWORD size = GetEnvironmentVariableW(name, nullptr, 0);
    if (!size) return {};
    std::vector<wchar_t> value(size);
    if (!GetEnvironmentVariableW(name, value.data(), size)) return {};
    return value.data();
}

inline bool isFile(const std::filesystem::path& path) {
    std::error_code error;
    return std::filesystem::is_regular_file(path, error);
}

inline std::filesystem::path bashExecutable(std::filesystem::path path) {
    // git-bash.exe is a terminal launcher; execute the synchronous interpreter.
    std::wstring name = path.filename().wstring();
    if (_wcsicmp(name.c_str(), L"git-bash.exe") == 0) path = path.parent_path() / "bin/bash.exe";
    if (!isFile(path)) return {};
    return std::filesystem::absolute(path);
}

inline std::filesystem::path findGitBash(const std::string& configured) {
    const auto overridePath = environment(L"BANEWFN_GIT_BASH");
    // An explicit but invalid setting must fail, not select a different shell.
    if (!configured.empty()) return bashExecutable(std::filesystem::u8path(configured));
    if (!overridePath.empty()) return bashExecutable(overridePath);

    for (const auto* variable : {L"ProgramW6432", L"ProgramFiles", L"ProgramFiles(x86)", L"LOCALAPPDATA"}) {
        const auto base = environment(variable);
        if (base.empty()) continue;
        const auto root = std::filesystem::path(base) /
            (std::wstring(variable) == L"LOCALAPPDATA" ? "Programs/Git" : "Git");
        const auto bash = bashExecutable(root / "bin/bash.exe");
        if (!bash.empty()) return bash;
    }
    std::wistringstream entries(environment(L"PATH"));
    std::wstring entry;
    while (std::getline(entries, entry, L';')) {
        if (entry.size() >= 2 && entry.front() == L'"' && entry.back() == L'"')
            entry = entry.substr(1, entry.size() - 2);
        if (entry.empty()) continue; // Do not search the working directory.
        const std::filesystem::path directory(entry);
        if (!directory.is_absolute()) continue;
        // Git for Windows exposes git.exe through cmd/, bin/ or mingw64/bin/.
        if (!isFile(directory / "git.exe")) continue;
        for (const auto& root : {directory.parent_path(), directory.parent_path().parent_path()}) {
            if (!isFile(root / "cmd/git.exe")) continue;
            const auto bash = bashExecutable(root / "bin/bash.exe");
            if (!bash.empty()) return bash;
        }
    }
    return {};
}

inline std::wstring quoteArgument(const std::wstring& value) {
    std::wstring result = L"\"";
    size_t slashes = 0;
    for (wchar_t ch : value) {
        if (ch == L'\\') { ++slashes; continue; }
        result.append(ch == L'"' ? slashes * 2 + 1 : slashes, L'\\');
        slashes = 0;
        result += ch;
    }
    result.append(slashes * 2, L'\\');
    return result + L'"';
}

inline int runGitBash(const std::filesystem::path& bash, const std::string& script) {
    const auto scriptPath = std::filesystem::absolute(std::filesystem::u8path(script));
    std::wstring command = quoteArgument(bash.wstring()) + L" --noprofile --norc " +
        quoteArgument(scriptPath.generic_wstring());
    std::cout << "Running script with Git Bash: " << bash.u8string()
              << " --noprofile --norc \"" << scriptPath.generic_u8string() << "\"\n" << std::flush;
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(bash.c_str(), command.data(), nullptr, nullptr, TRUE,
                        CREATE_NO_WINDOW, nullptr, nullptr, &startup, &process)) {
        std::cerr << "Error: Failed to start Git Bash. Windows error " << GetLastError() << '\n';
        return 1;
    }
    DWORD code = 1;
    if (WaitForSingleObject(process.hProcess, INFINITE) == WAIT_OBJECT_0)
        GetExitCodeProcess(process.hProcess, &code);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return static_cast<int>(code);
}

} // namespace WorkflowShell
