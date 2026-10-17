#ifndef BANEWFN_PROMOLECULE_H
#define BANEWFN_PROMOLECULE_H

#include <cstddef>
#include <optional>
#include <string>
#include <vector>

namespace Promolecule {

struct FragmentWavefunctionInfo {
    std::string path;
    bool unrestricted{false};
    int charge{0};
    int multiplicity{1};
    int alphaElectrons{0};
    int betaElectrons{0};
    int basisFunctions{0};
    int atoms{0};
    std::string basisSignature;
};

struct BuildRequest {
    std::vector<std::string> fragmentPaths;
    std::optional<int> targetMultiplicity;
    std::vector<std::size_t> explicitFlipFragments; // 1-based fragment indices
};

struct BuildPlan {
    std::vector<FragmentWavefunctionInfo> fragments;
    bool sharedBasis{false};
    std::vector<bool> flipSpin;
};

bool inspectFormattedCheckpoint(const std::string& path,
                                FragmentWavefunctionInfo& info,
                                std::string& errorMessage);

bool makeBuildPlan(const BuildRequest& request,
                   BuildPlan& plan,
                   std::string& errorMessage);

} // namespace Promolecule

#endif // BANEWFN_PROMOLECULE_H
