#include "common/gui.h"
#include "common/utils.h"
#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <set>
#include <sstream>
#include <stdexcept>

namespace Gui {
namespace {
const std::vector<std::string> properties={"title","summary","inputs","outputs","notes"};
bool identifier(const std::string& value,bool section=false) {
    return !value.empty() && value.size()<128 && std::all_of(value.begin(),value.end(),[&](unsigned char c) {
        return (c>='a' && c<='z') || (c>='A' && c<='Z') || (c>='0' && c<='9') || c=='_' || c=='-' || (section && c=='+');
    });
}
void append(std::string& value,const std::string& line) {
    if(!value.empty()) value+='\n';
    value+=line;
}
}

// Strip only documentation comments before the independent GUI-field parser.
// Keep line numbers intact. Documentation errors never alter runnable status.
std::string parseDocumentation(const std::string& text,ModuleConfig& config) {
    std::istringstream in(text);
    std::string raw,clean,scope,target,pending,intro;
    bool doc=false,gui=false,seenSection=false,sectionStarted=false;
    size_t number=0;
    std::set<std::string> explicitScopes;
    std::set<std::string> allSections;
    std::map<std::string,size_t> starts;
    auto warn=[&](const std::string& message) {
        config.documentationWarnings.push_back(config.origin+":"+std::to_string(number)+": "+message);
    };
    while(std::getline(in,raw)) {
        ++number;
        const auto line=Utils::trim(raw);
        if(line.rfind("#@doc ",0)==0 && !gui) {
            if(doc) warn("Missing #@end for documentation");
            const auto spec=Utils::trim(line.substr(6));
            target=spec=="module"?"":spec.rfind("section ",0)==0?Utils::trim(spec.substr(8)):"!invalid";
            if(target=="!invalid" || (!target.empty() && !identifier(target,true))) { target="!invalid"; warn("Expected #@doc module or #@doc section NAME"); }
            if(!explicitScopes.insert(target).second) warn("Duplicate documentation scope: "+spec);
            starts[target]=number;
            doc=true; pending.clear(); clean+='\n'; continue;
        }
        if(doc) {
            if(line.rfind("#@gui ",0)==0) {warn("Missing #@end for documentation"); doc=false;}
            else if(line=="#@end") doc=false;
            else if(!line.empty()) {
                if(line[0]!='#') { warn("Documentation properties must be comments; missing #@end"); doc=false; }
                else {
                    const auto pos=line.find('=');
                    if(pos==std::string::npos) warn("Expected documentation property = value");
                    else {
                        auto key=Utils::trim(line.substr(1,pos-1));
                        auto base=key;
                        if(base.size()>3 && (base.substr(base.size()-3)==".zh" || base.substr(base.size()-3)==".en")) base.resize(base.size()-3);
                        if(std::find(properties.begin(),properties.end(),base)==properties.end()) warn("Unknown documentation property: "+key);
                        else if(target!="!invalid") append(config.documentation[target][key],Utils::trim(line.substr(pos+1)));
                    }
                }
            }
            if(doc || line.empty() || (line[0]=='#' && line.rfind("#@gui ",0)!=0)) {clean+='\n'; continue;}
            // A malformed comment block must not hide a real section or command.
        }
        clean+=raw+'\n';
        if(line.rfind("#@gui ",0)==0) {gui=true; if(!seenSection) pending.clear(); continue;}
        if(gui) {if(line=="#@end") gui=false; continue;}
        if(line.rfind("#@",0)==0) continue;
        if(!line.empty() && line[0]=='#') {
            const auto note=Utils::trim(line.substr(1));
            append(pending,note);
            if(!seenSection) append(intro,note);
            continue;
        }
        const auto header=Utils::trim(Utils::removeInlineComment(line));
        if(header.size()>2 && header.front()=='[' && header.back()==']') {
            scope=Utils::trim(header.substr(1,header.size()-2));
            allSections.insert(scope);
            sectionStarted=false;
            if(identifier(scope,true) && scope!="quit" && scope!="citations") {
                if(std::find(config.documentationSections.begin(),config.documentationSections.end(),scope)==config.documentationSections.end()) config.documentationSections.push_back(scope);
                if(!pending.empty()) config.documentation[scope]["legacy"]=pending;
            }
            seenSection=true;
        } else if(!line.empty() && !scope.empty()) {
            if(!sectionStarted && scope!="quit" && scope!="citations" && !pending.empty()) append(config.documentation[scope]["legacy"],pending);
            sectionStarted=true;
        }
        if(!line.empty()) pending.clear();
    }
    if(doc) warn("Missing #@end for documentation");
    if(!intro.empty()) config.documentation[""]["legacy"]=intro;
    for(const auto& item:config.documentation) {
        if(starts.count(item.first)) number=starts.at(item.first);
        if(!item.first.empty() && !allSections.count(item.first)) warn("Documentation refers to missing section: "+item.first);
        for(const auto& property:properties) {
            const auto& values=item.second;
            bool zh=values.count(property+".zh"),en=values.count(property+".en");
            if(zh!=en) warn("Missing documentation translation: "+(item.first.empty()?"module":item.first)+" / "+property+(zh?".en":".zh"));
        }
    }
    return clean;
}

std::string documentationJson(const ModuleConfig& config,const std::string& scope) {
    auto found=config.documentation.find(scope);
    if(found==config.documentation.end()) return "{}";
    const auto& values=found->second;
    std::string out="{";
    bool hasBody=false;
    for(const auto& property:properties) {
        std::string localized="{";
        for(const auto& lang:{"zh","en","und"}) {
            auto value=values.find(property+(std::string(lang)=="und"?"":"."+std::string(lang)));
            if(value==values.end() || value->second.empty()) continue;
            if(localized.size()>1) localized+=",";
            localized+=quote(lang)+":"+quote(value->second);
        }
        if(localized.size()==1) continue;
        if(property!="title") hasBody=true;
        if(out.size()>1) out+=",";
        out+=quote(property)+":"+localized+"}";
    }
    if(!hasBody && values.count("legacy")) {
        if(out.size()>1) out+=",";
        out+="\"notes\":{\"und\":"+quote(values.at("legacy"))+"}";
    }
    return out+"}";
}

int catalog(int argc,char* argv[]) {
    namespace fs=std::filesystem;
    std::ostream output(std::cout.rdbuf());
    struct Redirect {std::streambuf* old=std::cout.rdbuf(std::cerr.rdbuf()); ~Redirect(){std::cout.rdbuf(old);}} redirect;
    try {
        std::string directory;
        for(int i=1;i<argc;++i) {
            std::string arg=argv[i];
            if(arg=="--catalog-json") continue;
            if(arg=="--conf-dir" && i+1<argc) directory=argv[++i];
            else throw std::runtime_error("Expected --catalog-json --conf-dir DIRECTORY");
        }
        if(directory.empty()) throw std::runtime_error("Select a conf directory");
        std::map<std::string,fs::path> paths;
        for(const auto& entry:fs::directory_iterator(fs::u8path(directory))) {
            const auto name=entry.path().stem().u8string();
            if(entry.is_symlink() || !entry.is_regular_file() || entry.path().extension()!=".conf" || name=="citations" || !identifier(name)) continue;
            if(entry.file_size()>128*1024) throw std::runtime_error("Conf file is too large: "+name);
            paths.emplace(name,entry.path());
            if(paths.size()>256) throw std::runtime_error("Too many conf modules");
        }
        std::string modules;
        for(const auto& path:paths) {
            std::ifstream file(path.second,std::ios::binary);
            if(!file) throw std::runtime_error("Cannot read conf: "+path.first);
            std::string source((std::istreambuf_iterator<char>(file)),{});
            ConfigManager manager;
            if(!manager.loadModuleConfigFromText(path.first,source,path.second.u8string())) throw std::runtime_error("Cannot parse conf: "+path.first);
            const auto& config=manager.getModuleConfig(path.first);
            if(!config.sections.count("main")) continue;
            if(!modules.empty()) modules+=",";
            modules+="{\"name\":"+quote(path.first)+",\"documentation\":"+documentationJson(config,"")+",\"sections\":[";
            bool first=true;
            for(const auto& section:config.documentationSections) {
                if(!first) modules+=",";
                first=false;
                modules+="{\"name\":"+quote(section)+",\"documentation\":"+documentationJson(config,section)+"}";
            }
            modules+="],\"warnings\":[";
            first=true;
            for(const auto& warning:config.documentationWarnings) {if(!first) modules+=","; first=false; modules+=quote(warning);}
            modules+="]}";
        }
        output<<"{\"version\":2,\"modules\":["<<modules<<"]}\n";
        return 0;
    } catch(const std::exception& e) {output<<"{\"error\":"<<quote(e.what())<<"}\n"; return 2;}
}
}
