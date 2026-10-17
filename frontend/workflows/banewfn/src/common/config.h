#ifndef CONFIG_H
#define CONFIG_H
#include <cstddef>
#include <string>
#include <map>
#include <vector>
#include <istream>

// Platform detection
#ifdef _WIN32
    #define PLATFORM_WINDOWS
#else
    #define PLATFORM_LINUX
#endif

// Section structure
struct Section {
    std::vector<std::string> commands;
    std::map<std::string, std::string> defaults;
};

// A citation catalog entry bound to one or more executable sections in a
// module configuration. Bindings are declared in the reserved [citations]
// metadata section and are never emitted as Multiwfn commands.
struct ConfigCitationBinding {
    std::string id;
    std::vector<std::string> targets;
    std::string reason;
    std::size_t lineNumber = 0;
};

// Module configuration structure
struct ModuleConfig {
    std::map<std::string, Section> sections;
    std::vector<std::string> quitCommands;  // Quit command sequence
    std::vector<ConfigCitationBinding> citationBindings;
    std::string origin;
    std::map<std::string, std::map<std::string, std::map<std::string, std::string>>> gui;
    std::vector<std::string> guiErrors;
};

// Global configuration structure
struct BaneWfnConfig {
    std::string multiwfnExec;
    std::string confPath;
    int cores;
    std::string gitbashExec;  // Git Bash executable path (Windows only)
    std::string citationsOutput;  // Automatic BibTeX output path template; empty disables it

    BaneWfnConfig() : cores(0) {}
};

// Runtime/path helpers. Generic wrappers are retained for source compatibility.
std::string trim(const std::string& str);
std::string expandPath(const std::string& path);
std::string getExecutableDir();
bool fileExists(const std::string& filepath);
std::string findConfigFile(const std::string& executablePath, bool verbose = true);
std::string getBaseName(const std::string& filepath);
std::string replacePlaceholders(const std::string& cmd,
                               const std::map<std::string, std::string>& params);
std::vector<std::string> replacePlaceholdersExpanded(const std::string& cmd,
                                                    const std::map<std::string, std::string>& params);

// Configuration manager class
class ConfigManager {
private:
    std::map<std::string, ModuleConfig> moduleConfigs;
    BaneWfnConfig config;

    // Parse module configuration from a stream (shared by file-based and inline-based loaders)
    bool parseModuleConfigStream(std::istream& in, const std::string& moduleName, const std::string& origin);

public:
    // Load banewfn.rc configuration file
    bool loadBaneWfnConfig(const std::string& configFile, bool requireMultiwfnExec = true);

    // Load module-specific conf file
    bool loadModuleConfig(const std::string& moduleName);

    // Load module-specific conf from inlined text
    bool loadModuleConfigFromText(const std::string& moduleName, const std::string& confText, const std::string& origin = "inline");

    // Get configuration values
    const BaneWfnConfig& getConfig() const { return config; }
    const ModuleConfig& getModuleConfig(const std::string& moduleName) const;
    bool hasModuleConfig(const std::string& moduleName) const;

    // Get cores setting
    int getCores() const { return config.cores; }
};

#endif // CONFIG_H
