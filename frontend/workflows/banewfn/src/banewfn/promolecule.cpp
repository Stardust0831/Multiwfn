#include "banewfn/promolecule.h"

#include "common/utils.h"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <set>
#include <sstream>

namespace Promolecule {
namespace {

bool parseScalarInt(const std::vector<std::string>& lines,
                    const std::string& label,
                    int& value) {
    for (const auto& line : lines) {
        if (line.rfind(label, 0) != 0) continue;
        std::istringstream input(line.substr(label.size()));
        char type = '\0';
        if (!(input >> type >> value)) return false;
        return type == 'I';
    }
    return false;
}

bool parseArrayTokens(const std::vector<std::string>& lines,
                      const std::string& label,
                      std::vector<std::string>& values) {
    values.clear();
    for (std::size_t lineIndex = 0; lineIndex < lines.size(); ++lineIndex) {
        const auto& line = lines[lineIndex];
        if (line.rfind(label, 0) != 0) continue;

        const std::size_t countPos = line.find("N=");
        if (countPos == std::string::npos) return false;
        std::istringstream countStream(line.substr(countPos + 2));
        std::size_t count = 0;
        if (!(countStream >> count)) return false;

        for (std::size_t next = lineIndex + 1;
             next < lines.size() && values.size() < count; ++next) {
            std::istringstream data(lines[next]);
            std::string token;
            while (data >> token) {
                values.push_back(token);
                if (values.size() == count) break;
            }
        }
        return values.size() == count;
    }
    return false;
}

std::string canonicalArray(const std::vector<std::string>& values) {
    std::ostringstream out;
    for (const auto& value : values) out << value << ';';
    return out.str();
}

bool basisSignature(const std::vector<std::string>& lines,
                    int atoms,
                    int basisFunctions,
                    std::string& signature) {
    static const std::vector<std::string> requiredLabels{
        // AO centres are part of the identity of the basis. Two identical
        // monomers can otherwise have the same shell table while living on
        // different atoms of the complex, which must not be mistaken for a
        // shared/complex basis.
        "Atomic numbers",
        "Current cartesian coordinates",
        "Shell types",
        "Number of primitives per shell",
        "Shell to atom map",
        "Primitive exponents",
        "Contraction coefficients"
    };

    std::ostringstream out;
    out << "atoms=" << atoms << ";nbasis=" << basisFunctions << ';';
    for (const auto& label : requiredLabels) {
        std::vector<std::string> values;
        if (!parseArrayTokens(lines, label, values)) {
            return false;
        }
        out << label << '=' << canonicalArray(values) << '|';
    }

    // Gaussian emits this array for SP contractions, but it can be absent in
    // formatted checkpoints that contain no SP shell. Include it when present
    // without making automatic basis detection depend on that representation
    // detail.
    std::vector<std::string> spCoefficients;
    if (parseArrayTokens(lines, "P(S=P) Contraction coefficients", spCoefficients)) {
        out << "P(S=P) Contraction coefficients="
            << canonicalArray(spCoefficients) << '|';
    }
    signature = out.str();
    return true;
}

bool headerIsUnrestricted(const std::vector<std::string>& lines) {
    if (lines.size() < 2) return false;
    // Gaussian formatted checkpoint files use a fixed-width second header line;
    // column 11 is R/U for the wavefunction form. This matches the convention
    // used by the reference sobEDA script.
    return lines[1].size() > 10 &&
           std::toupper(static_cast<unsigned char>(lines[1][10])) == 'U';
}

void enumerateSpinAssignments(const std::vector<int>& deltas,
                              const std::vector<std::size_t>& fragmentIndices,
                              const int targetDelta,
                              const std::size_t position,
                              std::vector<bool>& flips,
                              std::vector<std::vector<bool>>& solutions,
                              const bool lockFirstPositive) {
    if (solutions.size() > 1) return;
    if (position == fragmentIndices.size()) {
        int total = 0;
        for (std::size_t i = 0; i < fragmentIndices.size(); ++i) {
            const int delta = deltas[i];
            total += flips[i] ? -delta : delta;
        }
        if (total == targetDelta) solutions.push_back(flips);
        return;
    }

    flips[position] = false;
    enumerateSpinAssignments(deltas, fragmentIndices, targetDelta,
                             position + 1, flips, solutions, lockFirstPositive);
    if (solutions.size() > 1) return;

    if (!(lockFirstPositive && position == 0)) {
        flips[position] = true;
        enumerateSpinAssignments(deltas, fragmentIndices, targetDelta,
                                 position + 1, flips, solutions, lockFirstPositive);
    }
}

bool inferSpinFlips(const std::vector<FragmentWavefunctionInfo>& fragments,
                    const std::optional<int>& targetMultiplicity,
                    const std::vector<std::size_t>& explicitFlipFragments,
                    std::vector<bool>& flipSpin,
                    std::string& errorMessage) {
    flipSpin.assign(fragments.size(), false);

    std::vector<std::size_t> unrestrictedIndices;
    std::vector<int> spinDeltas;
    bool hasZeroDeltaUnrestricted = false;
    for (std::size_t i = 0; i < fragments.size(); ++i) {
        if (!fragments[i].unrestricted) continue;
        unrestrictedIndices.push_back(i);
        spinDeltas.push_back(fragments[i].alphaElectrons - fragments[i].betaElectrons);
        if (spinDeltas.back() == 0) hasZeroDeltaUnrestricted = true;
    }

    if (targetMultiplicity.has_value() && *targetMultiplicity < 1) {
        errorMessage = "target multiplicity must be a positive integer";
        return false;
    }

    if (!explicitFlipFragments.empty()) {
        std::set<std::size_t> explicitIndices;
        for (const auto oneBased : explicitFlipFragments) {
            if (oneBased == 0 || oneBased > fragments.size()) {
                errorMessage = "flip contains an out-of-range fragment index: " +
                               std::to_string(oneBased);
                return false;
            }
            const std::size_t index = oneBased - 1;
            if (!fragments[index].unrestricted) {
                errorMessage = "flip selects restricted fragment " + std::to_string(oneBased);
                return false;
            }
            explicitIndices.insert(index);
        }
        for (const auto index : explicitIndices) flipSpin[index] = true;

        if (targetMultiplicity.has_value()) {
            int totalDelta = 0;
            for (std::size_t i = 0; i < fragments.size(); ++i) {
                const int delta = fragments[i].alphaElectrons - fragments[i].betaElectrons;
                totalDelta += flipSpin[i] ? -delta : delta;
            }
            if (totalDelta != *targetMultiplicity - 1) {
                errorMessage = "explicit flip selection is inconsistent with target multiplicity " +
                               std::to_string(*targetMultiplicity);
                return false;
            }
        }
        return true;
    }

    if (unrestrictedIndices.empty()) {
        if (targetMultiplicity.has_value() && *targetMultiplicity != 1) {
            errorMessage = "closed-shell fragment wavefunctions are inconsistent with target multiplicity " +
                           std::to_string(*targetMultiplicity);
            return false;
        }
        return true;
    }

    if (unrestrictedIndices.size() == 1 && !hasZeroDeltaUnrestricted) {
        if (targetMultiplicity.has_value() &&
            spinDeltas.front() != *targetMultiplicity - 1) {
            errorMessage = "fragment spin multiplicities cannot reproduce target multiplicity " +
                           std::to_string(*targetMultiplicity);
            return false;
        }
        return true;
    }

    if (!targetMultiplicity.has_value()) {
        errorMessage = "target multiplicity is required to infer spin orientation for multiple unrestricted fragments";
        return false;
    }
    if (hasZeroDeltaUnrestricted) {
        errorMessage = "an unrestricted fragment has equal alpha/beta electron counts; target multiplicity cannot determine whether its spin should be flipped";
        return false;
    }

    const int targetDelta = *targetMultiplicity - 1;
    std::vector<bool> localFlips(unrestrictedIndices.size(), false);
    std::vector<std::vector<bool>> solutions;
    const bool lockFirstPositive = (targetDelta == 0);
    enumerateSpinAssignments(spinDeltas, unrestrictedIndices, targetDelta,
                             0, localFlips, solutions, lockFirstPositive);

    if (solutions.empty()) {
        errorMessage = "fragment spin multiplicities cannot reproduce target multiplicity " +
                       std::to_string(*targetMultiplicity);
        return false;
    }
    if (solutions.size() > 1) {
        errorMessage = "target multiplicity does not uniquely determine fragment spin orientation; specify flip only for the ambiguous fragments";
        return false;
    }

    for (std::size_t i = 0; i < unrestrictedIndices.size(); ++i) {
        flipSpin[unrestrictedIndices[i]] = solutions.front()[i];
    }
    return true;
}

} // namespace

bool inspectFormattedCheckpoint(const std::string& path,
                                FragmentWavefunctionInfo& info,
                                std::string& errorMessage) {
    std::ifstream input(path);
    if (!input.is_open()) {
        errorMessage = "cannot open formatted checkpoint: " + path;
        return false;
    }

    std::vector<std::string> lines;
    std::string line;
    while (std::getline(input, line)) lines.push_back(line);
    if (lines.size() < 2) {
        errorMessage = "formatted checkpoint is incomplete: " + path;
        return false;
    }

    FragmentWavefunctionInfo parsed;
    parsed.path = path;
    parsed.unrestricted = headerIsUnrestricted(lines);
    if (!parseScalarInt(lines, "Charge", parsed.charge) ||
        !parseScalarInt(lines, "Multiplicity", parsed.multiplicity) ||
        !parseScalarInt(lines, "Number of alpha electrons", parsed.alphaElectrons) ||
        !parseScalarInt(lines, "Number of beta electrons", parsed.betaElectrons) ||
        !parseScalarInt(lines, "Number of basis functions", parsed.basisFunctions) ||
        !parseScalarInt(lines, "Number of atoms", parsed.atoms)) {
        errorMessage = "formatted checkpoint is missing required wavefunction metadata: " + path;
        return false;
    }
    if (parsed.alphaElectrons < parsed.betaElectrons) {
        errorMessage = "formatted checkpoint has fewer alpha than beta electrons and cannot be used as a canonical fragment reference: " + path;
        return false;
    }
    const int spinDelta = parsed.alphaElectrons - parsed.betaElectrons;
    if (parsed.multiplicity != spinDelta + 1) {
        errorMessage = "formatted checkpoint multiplicity is inconsistent with its alpha/beta electron counts: " + path;
        return false;
    }
    if (!parsed.unrestricted && spinDelta != 0) {
        errorMessage = "restricted open-shell formatted checkpoints are not supported for promolecule spin assembly: " + path;
        return false;
    }
    if (!basisSignature(lines, parsed.atoms, parsed.basisFunctions, parsed.basisSignature)) {
        errorMessage = "formatted checkpoint is missing basis-set metadata required for automatic promolecule construction: " + path;
        return false;
    }

    info = std::move(parsed);
    return true;
}

bool makeBuildPlan(const BuildRequest& request,
                   BuildPlan& plan,
                   std::string& errorMessage) {
    plan = BuildPlan{};
    if (request.fragmentPaths.size() < 2) {
        errorMessage = "promolecule construction requires at least two fragment wavefunctions";
        return false;
    }

    plan.fragments.reserve(request.fragmentPaths.size());
    for (const auto& path : request.fragmentPaths) {
        FragmentWavefunctionInfo info;
        if (!inspectFormattedCheckpoint(path, info, errorMessage)) return false;
        plan.fragments.push_back(std::move(info));
    }

    const std::string& reference = plan.fragments.front().basisSignature;
    plan.sharedBasis = std::all_of(plan.fragments.begin() + 1, plan.fragments.end(),
                                   [&](const FragmentWavefunctionInfo& info) {
                                       return info.basisSignature == reference;
                                   });

    if (!inferSpinFlips(plan.fragments, request.targetMultiplicity,
                        request.explicitFlipFragments, plan.flipSpin, errorMessage)) {
        return false;
    }
    return true;
}

} // namespace Promolecule
