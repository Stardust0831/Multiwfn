<script lang="ts">
  import { bond_angle, dihedral_angle, distance_pbc, Icon, type AnyStructure, type MeasureMode } from 'matterviz'

  export type BondResult = { key: string; atoms: string; method: string; value: number }
  let { structure, sites, mode, bonds, on_remove_bond, on_clear_selection }: {
    structure?: AnyStructure
    sites: number[]
    mode: MeasureMode
    bonds: BondResult[]
    on_remove_bond: (key: string) => void
    on_clear_selection: () => void
  } = $props()

  const selected = $derived(sites.map((index) => structure?.sites[index]))
  const names = $derived(sites.map((index, order) => `${selected[order]?.species?.[0]?.element ?? 'Atom'}${index + 1}`).join(' - '))
  const geometry = $derived.by(() => {
    if (selected.some((site) => !site)) return undefined
    const [a, b, c, d] = selected
    const lattice = structure && 'lattice' in structure ? structure.lattice : undefined
    if (mode === 'distance' && selected.length === 2 && a && b) {
      const direct = Math.hypot(...a.xyz.map((value, axis) => value - b.xyz[axis]))
      const value = lattice ? distance_pbc(a.xyz, b.xyz, lattice.matrix, undefined, lattice.pbc) : direct
      return { name: 'Distance', value, unit: 'Å', direct: Math.abs(value - direct) > 1e-6 ? direct : undefined }
    }
    if (mode === 'angle' && a && b && c) {
      return d
        ? { name: 'Dihedral', value: dihedral_angle(a.xyz, b.xyz, c.xyz, d.xyz, lattice?.matrix, undefined, lattice?.pbc, 'degrees'), unit: '°' }
        : { name: 'Angle', value: bond_angle(a.xyz, b.xyz, c.xyz, lattice?.matrix, undefined, lattice?.pbc, 'degrees'), unit: '°' }
    }
    return undefined
  })
</script>

{#if sites.length && (mode === 'distance' || mode === 'angle')}
  <div class="measurement-result" aria-label="Geometry measurement">
    <span class="result-kind">{geometry?.name ?? 'Selected atoms'}</span>
    <span class="result-atoms">{names}</span>
    {#if geometry}
      <strong>{geometry.value === null || !Number.isFinite(geometry.value) ? 'Undefined' : `${geometry.value.toFixed(4)} ${geometry.unit}`}</strong>
      {#if geometry.direct !== undefined}<small>Direct: {geometry.direct.toFixed(4)} Å</small>{/if}
    {/if}
    <button type="button" aria-label="Clear measurement" title="Clear measurement" onclick={on_clear_selection}><Icon icon="Cross" width="14" height="14" /></button>
  </div>
{/if}
{#each bonds as result (result.key)}
  <div class="measurement-result" aria-label="Bond-order result">
    <span class="result-kind">{result.method}</span>
    <span class="result-atoms">{result.atoms}</span>
    <strong>{result.value.toFixed(6)}</strong>
    <button type="button" aria-label={`Remove ${result.method} result for ${result.atoms}`} title="Remove result" onclick={() => on_remove_bond(result.key)}><Icon icon="Cross" width="14" height="14" /></button>
  </div>
{/each}

<style>
  .measurement-result { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-height: 32px; padding: 3px 8px; font-size: 12px; }
  .result-kind { min-width: 62px; color: #526070; }
  .result-atoms { overflow-wrap: anywhere; }
  strong { font-variant-numeric: tabular-nums; white-space: nowrap; }
  small { color: #526070; }
  button { display: grid; place-items: center; width: 24px; height: 24px; margin-left: auto; padding: 0; flex: 0 0 24px; }
</style>
