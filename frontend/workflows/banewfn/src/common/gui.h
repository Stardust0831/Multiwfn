#pragma once
#include "common/config.h"
#include "common/input.h"
#include <map>
#include <string>

namespace Gui {
using Values = std::map<std::string, std::string>;
Values readValues(const std::string& path);
std::string quote(const std::string& value);
void parseMetadata(const std::string& text, ModuleConfig& config);
std::vector<std::string> commands(const Section& section, const Values& params);
void apply(std::vector<ModuleTask>& tasks, const ConfigManager& config, const Values& values);
void variables(std::map<std::string, std::vector<std::string>>& vars, const Values& values);
int inspect(int argc, char* argv[]);
int plan(int argc, char* argv[]);
}
