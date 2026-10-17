#include "common/ui.h"
#include "common/utils.h"
#include <iostream>
#include <string>

#ifndef BANEWFN_VERSION
#error BANEWFN_VERSION must be provided by the build system
#endif

void UI::printLogo() {
    std::cout << getLogoString();
}

std::string UI::getVersionString() {
    return BANEWFN_VERSION;
}

std::string UI::getLogoString() {
    std::string logo;
    logo += "\n";
    logo += u8"   ____    _    _   _ _______        _______ _   _ \n";
    logo += u8"  | __ )  / \\  | \\ | | ____\\ \\      / /  ___| \\ | |\n";
    logo += u8"  |  _ \\ / _ \\ |  \\| |  _|  \\ \\ /\\ / /| |_  |  \\| |\n";
    logo += u8"  | |_) / ___ \\| |\\  | |___  \\ V  V / |  _| | |\\  |\n";
    logo += u8"  |____/_/   \\_\\_| \\_|_____|  \\_/\\_/  |_|   |_| \\_|\n";
    logo += u8"  Author: Bane Dysta\n";
    logo += "  Version: " + getVersionString() + "\n";
    logo += u8"  Feedback: https://github.com/bane-dysta/banewfn\n";
    logo += u8"  Tips: \n";
    logo += u8"  Available citation suggestions for BaneWfn, Multiwfn, and declared methods\n";
    logo += u8"    are printed after workflow execution.\n";
    logo += u8"    \nLet's start Multiwfn analysis!\n";
    logo += "\n";
    return logo;
}

std::string UI::requestInputFile() {
    std::string inputFile;

    while (true) {
        std::cout << "Bane need an input file: ";
        if (!std::getline(std::cin, inputFile)) {
            std::cerr << "\nError: Input stream closed while waiting for an input file.\n";
            return {};
        }

        // Remove quotes and trim whitespace
        std::string cleanedFile = Utils::trimQuotes(inputFile);

        if (Utils::fileExists(cleanedFile)) {
            return cleanedFile;
        } else {
            printFileError(cleanedFile);
        }
    }
}

std::string UI::requestWavefunctionFile() {
    std::string wfnFile;

    while (true) {
        std::cout << "Bane need a wavefunction file (or other file supported by Multiwfn): ";
        if (!std::getline(std::cin, wfnFile)) {
            std::cerr << "\nError: Input stream closed while waiting for a wavefunction file.\n";
            return {};
        }

        // Remove quotes and trim whitespace
        std::string cleanedFile = Utils::trimQuotes(wfnFile);

        if (Utils::fileExists(cleanedFile)) {
            return cleanedFile;
        } else {
            printFileError(cleanedFile);
        }
    }
}

void UI::printFileError(const std::string& filepath) {
    std::cout << "Bane is useless, cannot access file '" << filepath << "' TAT\n";
}

std::string UI::getUserInput(const std::string& prompt) {
    std::string input;
    std::cout << prompt;
    std::getline(std::cin, input);
    return input;
}
