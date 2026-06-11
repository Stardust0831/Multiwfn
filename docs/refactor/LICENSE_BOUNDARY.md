# License Boundary Notes

This note records the license facts that guide the Multiwfn/VMD integration
strategy on this branch. It is an engineering risk note, not legal advice.

## Sources Checked

- Local source tree: no top-level `LICENSE`, `COPYING`, or `COPYRIGHT` file is
  present in the 2026.6.2 Linux source package.
- Multiwfn official download page:
  `http://sobereva.com/multiwfn/download.html`
- VMD official license page:
  `https://www.ks.uiuc.edu/Research/vmd/current/LICENSE.html`

Checked on 2026-06-12 from this working environment.

## Multiwfn

The official Multiwfn download page states that current Multiwfn is free of
charge and open-source for academic and commercial use, and allows redistribution
of original or modified Multiwfn code. The same page says selling a modified
version may be granted but needs prior consent from Tian Lu, and it requires
citation of the original Multiwfn papers when Multiwfn or code incorporated from
Multiwfn is used.

Implications for this branch:

- Publishing this refactor branch with modified Multiwfn source appears aligned
  with the official download-page terms.
- The repository should preserve citation and attribution expectations in user
  documentation.
- A top-level license file from the upstream source package is still absent, so
  release packaging should keep linking to the official download terms until an
  upstream license file is added or separately confirmed.

## VMD

The official VMD license page distinguishes VMD plugins from the main VMD
program. The main VMD program and source code are under a restricted University
of Illinois license. The license allows complimentary works that interoperate
with VMD while directing users to obtain VMD itself from the official TCBG
server, but broader distribution of VMD or derivative works requires a separate
license. Commercial use also requires a commercial license.

Implications for this branch:

- Do not merge VMD main-program source code into this repository.
- Do not redistribute VMD binaries, source archives, or derived VMD code from
  this repository.
- Keep the integration as a file/script bridge: Multiwfn writes structure or
  cube files plus VMD Tcl scene scripts, and optionally invokes a user-installed
  `vmd` executable.
- Generated Tcl scenes should be treated as complimentary interoperability
  artifacts, not as modified VMD source.

## Current Architecture Decision

The current VMD bridge follows the lower-risk path:

1. Multiwfn remains responsible for wavefunction, structure, and grid analysis.
2. Exported files remain ordinary Multiwfn outputs.
3. VMD scene generation is optional and controlled by `ivmdscene`, `ivmdrun`,
   `-vmd`, `-vmdrun`, `-vmdpath`, `-vmdscene`, and `-vmdmaterial`.
4. Users install and license VMD separately.

This boundary supports the user's desired workflow, namely using Multiwfn for
wavefunction analysis while gaining VMD visualization, without creating a mixed
source distribution that inherits VMD's main-program licensing restrictions.

## Revisit Triggers

Revisit this document before:

- vendoring any VMD code, Tcl library, binary, plugin, or derived asset;
- distributing preconfigured VMD packages with this repository;
- selling or relicensing a modified Multiwfn distribution;
- replacing the bridge with a deeper API-level or source-level integration.
