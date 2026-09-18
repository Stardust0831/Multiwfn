import type { AnyStructure } from 'matterviz'

/** Identify the input linked to the loaded wavefunction, excluding display metadata. */
export const analysis_structure_key = (structure: AnyStructure | undefined): string => {
  if (!structure) return ''
  return JSON.stringify({
    sites: structure.sites.map((site) => ({
      xyz: site.xyz,
      species: site.species.map(({ element, occu }) => [element, occu ?? 1])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    })),
    lattice: 'lattice' in structure ? structure.lattice.matrix : null,
    pbc: 'lattice' in structure ? structure.lattice.pbc : null,
    charge: structure.charge ?? 0,
  })
}
