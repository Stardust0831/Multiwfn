# 3Dmol displayed bond-order perception

This note describes the structural bond orders drawn by the 3Dmol frontend.
They are deliberately separate from Mayer, GWBO, Wiberg, Mulliken, and FBO
values calculated by Multiwfn. A displayed line is a visualization decision;
it is not evidence that a chemical bond exists and it does not affect a
wavefunction calculation.

## Data precedence

1. When a Gaussian formatted checkpoint contains all four optional
   `MxBond`/`NBond`/`IBond`/`RBond` fields, Multiwfn validates and loads them
   into `connmat`. The 3Dmol backend exports that explicit topology as MOL2;
   `RBond=1.5` is carried as an aromatic bond. Missing, dimensionally
   inconsistent, or unsupported values leave connectivity unavailable.
2. SDF/MOL and MOL2 bond orders are preserved. CIF bond records are also left
   to the 3Dmol parser.
3. PDB/PQR `CONECT` records preserve the input topology. When all parsed orders
   are single, only the orders on those edges are inferred.
4. XYZ, cube-derived XYZ, FCHK files without the optional arrays, and other
   structures without explicit topology use the
   perception pipeline below.

This prevents a geometry heuristic from overwriting bond orders already stored
by the source program while still making geometry-only quantum-chemistry files
useful. The FCHK arrays describe Gaussian's stored formal drawing topology;
they remain distinct from wavefunction-derived Mayer, Wiberg, or FBO values.

## Perception pipeline

### 1. Connectivity: Multiwfn behavior

An atom pair is a normal bond candidate when

```text
distance <= bondingThreshold * (CSD radius 1 + CSD radius 2)
```

The default `bondingThreshold` is 1.15. The radii are copied from Multiwfn's
`covr` table in `define.f90` (Dalton Trans. 2008, 2832-2838). The frontend's
Bonding threshold control now reruns this step instead of being a parity-only
placeholder. This choice retains Multiwfn's better behavior for cases such as
longer coordination bonds that GaussView can omit.

### 2. Initial order: GaussView element-pair thresholds

For a connected pair, the distance is divided by the sum of the GaussView
covalent radii. The linked GaussView element-pair table reduces to these upper
limits:

| Ratio | Candidate |
| --- | --- |
| `<= 0.81` | triple |
| `<= 0.90` | double |
| `<= 0.94` | resonant/aromatic candidate |
| otherwise | single |

The measured table is preferred to the approximate 0.78/0.88/0.91 equilibrium
figures in the reverse-engineering notes. For example, all C-C entries are
reproduced by multiplying the 1.54 Angstrom GaussView radius sum by these
ratios. The thresholds are applied directly, without a molecule-specific
tolerance.

### 3. Element and valence constraints

Hydrogen and halogens cannot become multiple bonds; oxygen-family atoms are
capped at double bonds; carbon/nitrogen-family atoms may reach triple bonds.
Normal connectivity is selected first, then multiple bonds are upgraded in
shortest normalized-distance order while respecting typical coordination and
valence limits. Group 1/2 and transition metals retain high coordination caps,
because coordination number must not be confused with oxidation state.

### 4. Aromatic validation

A resonant distance is only a candidate. The implementation enumerates 5- and
6-membered cycles and requires:

- planarity within 0.18 Angstrom;
- conjugatable ring elements;
- a p contribution or an eligible heteroatom lone-pair donation at every ring
  position;
- a `4n+2` pi-electron count.

Only then are all ring edges assigned order 1.5. A rejected resonant candidate
falls back to a single bond.

### 5. Weak bonds

Pairs outside the normal Multiwfn cutoff but within 1.5 times the GaussView
radius sum are weak candidates. A weak edge is retained only if it joins two
otherwise disconnected strong-bond components, and at most one weak edge is
kept per atom. This implements the useful part of the reverse-engineered weak
bond cleanup without filling ordinary molecules with dashed shortcuts.

## 3Dmol representation

The perception result is written symmetrically to each 3Dmol atom's `bonds`
and `bondOrder` arrays. Orders are 0.5, 1, 1.5, 2, or 3. Stick styles therefore
render weak/fractional bonds dashed and double/triple bonds with multiple
cylinders. The frontend's wireframe option uses very thin sticks because the
3Dmol line renderer does not reliably render fractional aromatic bonds.

Right-clicking two selected adjacent atoms exposes both the displayed order
and the independent Multiwfn bond-order analyses.

## Validation

Run the focused tests with:

```sh
node --test frontend/3dmol-viewer/tests/bond-perception.test.js
```

The cases cover C-C/C=C/C-triple-C, C=O, N-triple-N, hydrogen/halogen caps,
Pt-N connectivity, benzene, a five-membered heteroaromatic ring, a puckered
saturated ring, weak-bond cleanup, reciprocal 3Dmol arrays, explicit topology,
and PDB-style topology-only order inference.

## Scope and limitations

The inference path is intentionally deterministic and geometry-first. Formal
charges, unusual oxidation states, rings outside the supported 5/6-membered
set, and multicenter or metal-metal bonding can require an explicit SDF/MOL2
topology or manual interpretation. Quantitative bonding claims should use the
independent Multiwfn analyses exposed by the right-click menu, not the displayed
structural order alone.

## Sources

- Multiwfn `define.f90`, `sub.f90`, `plot.f90`, and `GUI.f90` in this repository.
- Sobereva, [discussion of deciding whether atoms are bonded](http://sobereva.com/414).
- [GaussView element-pair threshold table](https://liuyujie714.github.io/GaussView/).
- [3Dmol GLModel documentation](https://3dmol.org/doc/GLModel.html).
