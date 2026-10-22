#ifndef UI_H
#define UI_H

#include <string>

class UI {
public:
    static void printLogo();
    static std::string getLogoString();
    static std::string getVersionString();
    static std::string requestInputFile();
    static std::string requestWavefunctionFile();
    static std::string getUserInput(const std::string& prompt);

private:
    static void printFileError(const std::string& filepath);
};

#endif // UI_H
