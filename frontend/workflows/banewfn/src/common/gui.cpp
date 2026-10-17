#include "common/gui.h"
#include "common/inline_conf.h"
#include "common/utils.h"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <fstream>
#include <iostream>
#include <set>
#include <sstream>
#include <stdexcept>

namespace Gui {
std::string quote(const std::string& s) {
    std::string out = "\"";
    const char* hex = "0123456789abcdef";
    for (unsigned char c : s) {
        if (c == '"' || c == '\\') { out += '\\'; out += char(c); }
        else if (c < 32) { out += "\\u00"; out += hex[c >> 4]; out += hex[c & 15]; }
        else out += char(c);
    }
    return out + '"';
}

// Deliberately accepts only the documented string-to-string JSON object.
class ValueReader {
    std::string s; size_t p = 0;
    void ws() { while (p < s.size() && std::isspace(static_cast<unsigned char>(s[p]))) ++p; }
    void expect(char c) { ws(); if (p == s.size() || s[p++] != c) throw std::runtime_error("Invalid parameters JSON"); }
    unsigned hex4() {
        unsigned n = 0;
        for (int i = 0; i < 4; ++i) {
            if (p == s.size()) throw std::runtime_error("Incomplete JSON Unicode escape");
            char c = s[p++]; int v = c >= '0' && c <= '9' ? c-'0' : c >= 'a' && c <= 'f' ? c-'a'+10 : c >= 'A' && c <= 'F' ? c-'A'+10 : -1;
            if (v < 0) throw std::runtime_error("Invalid JSON Unicode escape");
            n = n * 16 + unsigned(v);
        }
        return n;
    }
    std::string string() {
        expect('"'); std::string out;
        while (p < s.size()) {
            unsigned char c = s[p++];
            if (c == '"') return out;
            if (c < 32) throw std::runtime_error("Control character in parameters JSON");
            if (c != '\\') { out += char(c); continue; }
            if (p == s.size()) break;
            c = s[p++];
            if (c == '"' || c == '\\' || c == '/') out += char(c);
            else if (c == 'n') out += '\n'; else if (c == 'r') out += '\r';
            else if (c == 't') out += '\t'; else if (c == 'b') out += '\b'; else if (c == 'f') out += '\f';
            else if (c == 'u') {
                unsigned n = hex4();
                if (n >= 0xd800 && n <= 0xdbff) {
                    if (s.substr(p, 2) != "\\u") throw std::runtime_error("Missing JSON low surrogate");
                    p += 2; unsigned low = hex4();
                    if (low < 0xdc00 || low > 0xdfff) throw std::runtime_error("Invalid JSON low surrogate");
                    n = 0x10000 + (n-0xd800)*1024 + low-0xdc00;
                } else if (n >= 0xdc00 && n <= 0xdfff) throw std::runtime_error("Unexpected JSON low surrogate");
                if (n < 128) out += char(n);
                else if (n < 2048) { out += char(0xc0 | (n>>6)); out += char(0x80 | (n&63)); }
                else if (n < 65536) { out += char(0xe0 | (n>>12)); out += char(0x80 | ((n>>6)&63)); out += char(0x80 | (n&63)); }
                else { out += char(0xf0 | (n>>18)); out += char(0x80 | ((n>>12)&63)); out += char(0x80 | ((n>>6)&63)); out += char(0x80 | (n&63)); }
            } else throw std::runtime_error("Invalid JSON escape");
        }
        throw std::runtime_error("Unterminated JSON string");
    }
public:
    explicit ValueReader(std::string text): s(std::move(text)) {}
    Values read() {
        Values out; expect('{'); ws();
        if (p < s.size() && s[p] == '}') ++p;
        else for (;;) {
            auto key = string(); expect(':'); auto value = string();
            if (value.size() > 4096 || value.find_first_of("\r\n") != std::string::npos || value.find('\0') != std::string::npos)
                throw std::runtime_error("Parameter values must be single lines, at most 4096 bytes");
            if (!out.emplace(key, value).second) throw std::runtime_error("Duplicate parameter: " + key);
            if (out.size() > 1024) throw std::runtime_error("Too many parameters");
            ws(); if (p < s.size() && s[p] == '}') { ++p; break; } expect(',');
        }
        ws(); if (p != s.size()) throw std::runtime_error("Trailing parameters JSON data");
        return out;
    }
};

Values readValues(const std::string& path) {
    if (path.empty()) return {};
    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("Cannot read parameters: " + path);
    std::string text((std::istreambuf_iterator<char>(f)), {});
    if (text.size() > 256*1024) throw std::runtime_error("Parameters file is too large");
    if (text.compare(0,3,"\xef\xbb\xbf")==0) text.erase(0,3);
    return ValueReader(text).read();
}

static std::vector<std::pair<std::string,std::string>> choices(const std::string& value) {
    std::vector<std::pair<std::string,std::string>> out;
    std::istringstream in(value); std::string item;
    while (std::getline(in, item, '|')) {
        auto pos = item.find(':');
        if (pos == std::string::npos) throw std::runtime_error("options must use value:label pairs separated by |");
        auto key = Utils::trim(item.substr(0,pos)), label = Utils::trim(item.substr(pos+1));
        if (key.empty() || label.empty()) throw std::runtime_error("Empty option value or label");
        for (const auto& old : out) if (old.first == key) throw std::runtime_error("Duplicate option value");
        out.emplace_back(key,label);
    }
    return out;
}

static std::string displayDefault(const Values& meta, const std::string& key, const std::string& fallback = "") {
    for (const auto& suffix : {"", ".en", ".zh"}) {
        auto it = meta.find(key + suffix);
        if (it != meta.end()) return it->second;
    }
    return fallback;
}

static std::string translations(const Values& meta, const std::string& key) {
    std::string out = "{";
    for (const auto& lang : {"en", "zh"}) {
        auto it = meta.find(key + "." + lang);
        if (it == meta.end()) continue;
        if (out.size() > 1) out += ",";
        out += quote(lang) + ":" + quote(it->second);
    }
    return out + "}";
}

static void validateOptions(const Values& meta) {
    const auto base = choices(displayDefault(meta, "options"));
    std::set<std::string> values;
    for (const auto& option : base) values.insert(option.first);
    for (const auto& lang : {"en", "zh"}) {
        auto it = meta.find(std::string("options.") + lang);
        if (it == meta.end()) continue;
        std::set<std::string> translated;
        for (const auto& option : choices(it->second)) translated.insert(option.first);
        if (translated != values) throw std::runtime_error("Translated options must have the same values");
    }
}

void parseMetadata(const std::string& text, ModuleConfig& config) {
    std::istringstream in(text); std::string line, scope, name; Values metadata;
    size_t number = 0, start = 0;
    auto error = [&](const std::string& message) {
        config.guiErrors.push_back(config.origin + ":" + std::to_string(number) + " [" + name + "]: " + message);
    };
    while (std::getline(in,line)) {
        ++number; line = Utils::trim(line);
        if (line.rfind("#@gui ",0) == 0) {
            if (!name.empty()) error("Missing #@end");
            name = Utils::trim(line.substr(6)); metadata.clear(); start = number;
            if (!VariableSyntax::isValidCustomVariableName(name)) error("Invalid variable name");
        } else if (line == "#@end") {
            if (name.empty()) { error("Unexpected #@end"); continue; }
            try {
                auto type = metadata.count("type") ? metadata.at("type") : "text";
                if (!std::set<std::string>{"text","number","select","boolean","file","directory"}.count(type)) throw std::runtime_error("Unknown control type");
                if (type == "select" || type == "boolean") {
                    auto opts = choices(displayDefault(metadata,"options"));
                    if (opts.empty() || (type == "boolean" && opts.size()!=2)) throw std::runtime_error("select needs options; boolean needs exactly two options");
                }
                validateOptions(metadata);
                if (config.gui[scope].count(name)) throw std::runtime_error("Duplicate GUI annotation in this scope");
                config.gui[scope][name] = metadata;
            } catch (const std::exception& e) { error(e.what()); }
            name.clear(); metadata.clear();
        } else if (!name.empty()) {
            if (line.empty()) continue;
            if (line[0]!='#') { error("GUI properties must be comments"); name.clear(); }
            else {
                line = Utils::trim(line.substr(1)); auto pos = line.find('=');
                if (pos == std::string::npos) { error("Expected property = value"); continue; }
                auto key = Utils::trim(line.substr(0,pos));
                if (!std::set<std::string>{"label","label.zh","label.en","help","help.zh","help.en","type","options","options.zh","options.en","unit"}.count(key)) error("Unknown GUI property: " + key);
                else if (!metadata.emplace(key,Utils::trim(line.substr(pos+1))).second) error("Duplicate GUI property: " + key);
            }
        } else {
            const auto header=Utils::trim(Utils::removeInlineComment(line));
            if(header.size()>2 && header.front()=='[' && header.back()==']') scope=Utils::trim(header.substr(1,header.size()-2));
        }
    }
    if (!name.empty()) { number=start; error("Missing #@end"); }
}

std::vector<std::string> commands(const Section& section, const Values& params) {
    Values merged = section.defaults;
    for (const auto& p : params) if (!p.second.empty()) merged[p.first]=p.second;
    std::vector<std::string> result;
    for (const auto& cmd : section.commands) {
        auto lines=replacePlaceholdersExpanded(cmd,merged);
        result.insert(result.end(),lines.begin(),lines.end());
    }
    return result;
}

static Values placeholders(const Section& section) {
    Values out;
    for (const auto& cmd : section.commands) {
        VariableSyntax::Placeholder p; size_t at=0;
        while (VariableSyntax::parseNextPlaceholder(cmd,at,p)) {
            out.emplace(p.name,p.defaultValue); at=p.end;
        }
    }
    return out;
}
static Values metadata(const ModuleConfig& config, const std::string& section, const std::string& name) {
    Values result;
    for (const auto& scope : {std::string(),section}) {
        auto it=config.gui.find(scope); if (it==config.gui.end()) continue;
        auto field=it->second.find(name); if (field==it->second.end()) continue;
        for (const auto& p : field->second) result[p.first]=p.second;
    }
    return result;
}
static void validate(const Values& meta, const std::string& value) {
    auto it=meta.find("type"); if (value.empty() || it==meta.end()) return;
    if (it->second=="number") {
        size_t end=0; double n=std::stod(value,&end);
        if (end!=value.size() || !std::isfinite(n)) throw std::runtime_error("Expected a finite number");
    } else if (it->second=="select" || it->second=="boolean") {
        auto options=choices(displayDefault(meta,"options"));
        if (std::none_of(options.begin(),options.end(),[&](const auto& p){return p.first==value;})) throw std::runtime_error("Value is not in the declared options");
    }
}
void variables(std::map<std::string,std::vector<std::string>>& vars,const Values& values) {
    for (const auto& p : values) if (p.first.rfind("var/",0)==0) {
        auto name=p.first.substr(4);
        if (!vars.count(name)) throw std::runtime_error("Unknown variable: " + name);
        // Use the CLI's array grammar, including Cartesian sweeps.
        vars[name]=(VariableSyntax::isListVariableName(name) || VariableSyntax::isLengthVariableName(name))
            ? std::vector<std::string>{p.second} : Utils::parseBashArray(p.second);
    }
}
void apply(std::vector<ModuleTask>& tasks,const ConfigManager& config,const Values& values) {
    std::set<std::string> used;
    for (size_t i=0;i<tasks.size();++i) {
        auto& task=tasks[i];
        if (task.isBuiltin()) {
            for (auto& param:task.params) {
                auto id=std::to_string(i)+"/main/"+param.first;
                auto value=values.find(id);
                if(value!=values.end()) {param.second=value->second;used.insert(id);}
            }
            continue;
        }
        if (!task.isWorkflow() || task.moduleName.empty()) continue;
        const auto& mod=config.getModuleConfig(task.moduleName);
        auto section=[&](const std::string& name,Values& params,const std::string& location) {
            auto found=mod.sections.find(name); if (found==mod.sections.end()) return;
            auto names=placeholders(found->second);
            for (const auto& p : params) names.emplace(p.first,"");
            for (const auto& p : names) {
                auto id=std::to_string(i)+"/"+location+"/"+p.first;
                auto v=values.find(id); if (v==values.end()) continue;
                try { validate(metadata(mod,name,p.first),v->second); }
                catch(const std::exception& e) { throw std::runtime_error(id+": "+e.what()); }
                params[p.first]=v->second; used.insert(id);
            }
        };
        section("main",task.params,"main");
        for(size_t j=0;j<task.postProcessSteps.size();++j) section(task.postProcessSteps[j].first,task.postProcessSteps[j].second,std::to_string(j));
    }
    for(const auto& p:values) if(p.first.rfind("var/",0)!=0 && !used.count(p.first)) throw std::runtime_error("Unknown parameter: "+p.first);
}

int inspect(int argc,char* argv[]) {
    std::ostream output(std::cout.rdbuf());
    struct Redirect {
        std::streambuf* previous = std::cout.rdbuf(std::cerr.rdbuf());
        ~Redirect() { std::cout.rdbuf(previous); }
    } redirect;
    try {
        std::string script,wfn,conf,parameterFile; Values cliVars;
        for(int i=1;i<argc;++i) {
            std::string arg=argv[i];
            if(arg=="--inspect-json" || arg=="--nogui") continue;
            if(arg=="--conf-dir" || arg=="--parameters-json" || arg=="--wfn" || arg=="-w" || arg=="--var" || arg=="-v") {
                if(++i==argc) throw std::runtime_error("Missing value for "+arg);
                std::string value=argv[i];
                if(arg=="--conf-dir") conf=value;
                else if(arg=="--parameters-json") parameterFile=value;
                else if(arg=="--var" || arg=="-v") { auto p=value.find('='); if(p==std::string::npos) throw std::runtime_error("Expected key=value"); cliVars[value.substr(0,p)]=value.substr(p+1); }
                else wfn=value;
            } else if(script.empty() && arg[0]!='-') script=arg;
            else throw std::runtime_error("Unexpected inspection argument: "+arg);
        }
        if(script.empty()) throw std::runtime_error("Select a script");
        auto input=InputParser::parseInpFileDetailed(script);
        if(!input.loaded) throw std::runtime_error("Cannot parse script: "+script);
        auto overrides=readValues(parameterFile);
        for(const auto& p:cliVars) input.customVars[p.first]=(VariableSyntax::isListVariableName(p.first) || VariableSyntax::isLengthVariableName(p.first))
            ? std::vector<std::string>{p.second} : Utils::parseBashArray(p.second);
        variables(input.customVars,overrides);
        if(wfn.empty()) wfn=input.wfnFile;
        ConfigManager cm;
        auto rc=conf.empty()?findConfigFile(argv[0],false):std::string();
        if(!rc.empty() && !cm.loadBaneWfnConfig(rc,false)) throw std::runtime_error("Cannot load "+rc);
        auto inlineConfigs=InlineConf::extractInlineConfs(script);
        for(const auto& task:input.tasks) if(task.isWorkflow() && !task.moduleName.empty() && !cm.hasModuleConfig(task.moduleName)) {
            bool ok=false; auto it=inlineConfigs.find(task.moduleName);
            if(it!=inlineConfigs.end() && !it->second.empty()) ok=cm.loadModuleConfigFromText(task.moduleName,it->second,script+" (inline)");
            else if(!conf.empty()) {
                std::string path=conf+"/"+task.moduleName+".conf";
                std::ifstream file(path); if(!file) throw std::runtime_error("Cannot read "+path);
                std::string text((std::istreambuf_iterator<char>(file)),{});
                ok=cm.loadModuleConfigFromText(task.moduleName,text,path);
            } else ok=cm.loadModuleConfig(task.moduleName);
            if(!ok) throw std::runtime_error("Cannot load module: "+task.moduleName);
        }
        auto resolved=input.tasks;
        InputParser::applyPlaceholderReplacement(resolved,wfn,input.customVars);
        apply(resolved,cm,overrides);
        std::vector<std::string> fields,groups,diagnostics;
        bool runnable=!input.debug;
        if(input.debug) diagnostics.push_back("debug requires a terminal");
        for(const auto& p:input.customVars) {
            std::string value=p.second.size()==1?p.second[0]:VariableSyntax::serializeListValues(p.second);
            fields.push_back("{\"id\":"+quote("var/"+p.first)+",\"name\":"+quote(p.first)+",\"label\":"+quote(p.first)+",\"group\":\"Variables\",\"type\":\"text\",\"value\":"+quote(value)+",\"source\":\"variable\",\"options\":[]}");
            if(std::find(p.second.begin(),p.second.end(),"?")!=p.second.end()) { runnable=false; diagnostics.push_back(p.first+": provide a value before running"); }
            if(p.second.size()>1) diagnostics.push_back(p.first+": array sweep; native preview shows the first value");
        }
        for(size_t i=0;i<resolved.size();++i) {
            auto& task=resolved[i]; const auto& original=input.tasks[i];
            if(task.useWait) { runnable=false; diagnostics.push_back(task.origin+": wait requires a terminal"); }
            for(const auto& e:task.grepErrors) { runnable=false; diagnostics.push_back(e); }
            if(task.isBuiltin()) {
                for(const auto& param:task.params) {
                    auto id=std::to_string(i)+"/main/"+param.first;
                    fields.push_back("{\"id\":"+quote(id)+",\"name\":"+quote(param.first)+",\"label\":"+quote(param.first)+",\"group\":"+quote(std::to_string(i+1)+" · bane."+task.builtinName)+",\"type\":\"text\",\"value\":"+quote(param.second)+",\"source\":\"script\",\"options\":[]}");
                }
            }
            if(!task.isWorkflow()) { diagnostics.push_back(task.origin+": native input preview is available for conf and raw steps"); continue; }
            std::vector<std::string> lines=task.preRawCommands;
            const ModuleConfig* mod=nullptr;
            if(!task.moduleName.empty()) {
                mod=&cm.getModuleConfig(task.moduleName);
                for(const auto& e:mod->guiErrors) { runnable=false; diagnostics.push_back(e); }
                auto section=[&](const std::string& name,const Values& params,const Values& raw,const std::string& location) {
                    auto it=mod->sections.find(name);
                    if(it==mod->sections.end()) { runnable=false; diagnostics.push_back(task.moduleName+": missing section "+name); return; }
                    const auto& sec=it->second;
                    auto names=placeholders(sec);
                    for(const auto& p:params) names.emplace(p.first,"");
                    for(const auto& p:names) {
                        std::string value=p.second,source="placeholder";
                        auto def=sec.defaults.find(p.first); if(def!=sec.defaults.end() && !def->second.empty()) {value=def->second;source="default";}
                        auto actual=params.find(p.first); if(actual!=params.end() && !actual->second.empty()) {value=actual->second;source="script";}
                        auto id=std::to_string(i)+"/"+location+"/"+p.first;
                        if(overrides.count(id)) source="override";
                        auto meta=metadata(*mod,name,p.first);
                        std::string f="{\"id\":"+quote(id)+",\"name\":"+quote(p.first)+",\"group\":"+quote(std::to_string(i+1)+" · "+task.moduleName+" / "+name+" ["+location+"]")+",\"value\":"+quote(value)+",\"source\":"+quote(source)+",\"expression\":"+quote(raw.count(p.first)?raw.at(p.first):p.second);
                        validateOptions(meta);
                        f+=",\"label\":"+quote(displayDefault(meta,"label",p.first))+",\"labels\":"+translations(meta,"label")+",\"type\":"+quote(meta.count("type")?meta["type"]:"text")+",\"help\":"+quote(displayDefault(meta,"help"))+",\"helps\":"+translations(meta,"help")+",\"unit\":"+quote(meta["unit"])+",\"options\":[";
                        bool first=true;
                        for(const auto& option:choices(displayDefault(meta,"options"))) {
                            if(!first)f+=",";
                            first=false;
                            Values labels;
                            for (const auto& lang : {"en", "zh"}) {
                                auto it=meta.find(std::string("options.")+lang);
                                if(it!=meta.end()) for(const auto& translated:choices(it->second))
                                    if(translated.first==option.first) labels[std::string("label.")+lang]=translated.second;
                            }
                            f+="{\"value\":"+quote(option.first)+",\"label\":"+quote(option.second)+",\"labels\":"+translations(labels,"label")+"}";
                        }
                        fields.push_back(f+"]}");
                    }
                    auto generated=commands(sec,params); lines.insert(lines.end(),generated.begin(),generated.end());
                };
                section("main",task.params,original.params,"main");
                for(size_t j=0;j<task.postProcessSteps.size();++j) section(task.postProcessSteps[j].first,task.postProcessSteps[j].second,original.postProcessSteps[j].second,std::to_string(j));
            }
            lines.insert(lines.end(),task.rawCommands.begin(),task.rawCommands.end());
            if(mod && !lines.empty()) lines.insert(lines.end(),mod->quitCommands.begin(),mod->quitCommands.end());
            std::string native; for(const auto& line:lines) native+=line+"\n";
            groups.push_back("{\"task\":"+std::to_string(i)+",\"module\":"+quote(task.moduleName)+",\"commands\":"+quote(native)+"}");
        }
        auto join=[](const std::vector<std::string>& values){std::string s;for(const auto& v:values){if(!s.empty())s+=",";s+=v;}return s;};
        for(auto& d:diagnostics)d=quote(d);
        output<<"{\"version\":1,\"runnable\":"<<(runnable?"true":"false")<<",\"fields\":["<<join(fields)<<"],\"tasks\":["<<join(groups)<<"],\"diagnostics\":["<<join(diagnostics)<<"]}\n";
        return 0;
    } catch(const std::exception& e) {
        output<<"{\"error\":"<<quote(e.what())<<"}\n"; return 2;
    }
}
}
