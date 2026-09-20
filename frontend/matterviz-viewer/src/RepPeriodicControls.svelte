<script lang="ts">
  import { untrack } from 'svelte'
  import { t } from './i18n'
  import { valid_cell, valid_range, type Cell, type RepPeriodic } from './reps'
  import { rep_translations } from './rep-periodic'
  let { value, sourceCell, structure = false, onchange }: { value: RepPeriodic; sourceCell?: Cell; structure?: boolean; onchange: (value: RepPeriodic) => void } = $props()
  let draft = $state<RepPeriodic>({ enabled: false, axes: [true, true, true], range: [[0, 1], [0, 1], [0, 1]], showCell: false, boundary: 'clip' })
  let custom = $state(false)
  let matrix = $state<Cell>([[10, 0, 0], [0, 10, 0], [0, 0, 10]])
  let error = $state('')
  $effect(() => {
    const current = $state.snapshot(value), source = sourceCell
    untrack(() => {
      draft = current; custom = Boolean(current.cell)
      matrix = current.cell ?? (source ? source.map((vector) => [...vector]) as Cell : [[10, 0, 0], [0, 10, 0], [0, 0, 10]])
      error = ''
    })
  })
  const apply = () => {
    const next = { ...$state.snapshot(draft), cell: custom ? $state.snapshot(matrix) : undefined }
    if ((next.enabled || custom) && !valid_cell(next.cell ?? sourceCell)) { error = 'Lattice vectors must form a nonsingular cell.'; return }
    if (!valid_range(next.range)) { error = 'Each lower bound must be below its upper bound (−20 to 20).'; return }
    try { rep_translations(next, next.cell ?? sourceCell) } catch (cause) { error = String((cause as Error).message); return }
    error = ''; onchange(next)
  }
</script>

<div class="rep-periodic">
  <label class="rep-toggle"><input type="checkbox" bind:checked={draft.enabled} /><span>{$t('Repeat this Rep periodically')}</span></label>
  <p class="rep-help">{$t('Fractional ranges follow a, b and c. For example, −0.5 to 1.5 shows two cells centered on the original cell.')}</p>
  <div class="rep-range-grid">
    <span>{$t('Axis')}</span><span>{$t('From')}</span><span>{$t('To')}</span>
    {#each ['a', 'b', 'c'] as axis, index}
      <label class="rep-axis"><input type="checkbox" bind:checked={draft.axes[index]} disabled={!draft.enabled} aria-label={$t('Repeat along {axis}', { axis })} />{axis}</label>
      <input type="number" step="0.1" min="-20" max="20" bind:value={draft.range[index][0]} disabled={!draft.enabled || !draft.axes[index]} aria-label={$t('{axis} lower bound', { axis })} />
      <input type="number" step="0.1" min="-20" max="20" bind:value={draft.range[index][1]} disabled={!draft.enabled || !draft.axes[index]} aria-label={$t('{axis} upper bound', { axis })} />
    {/each}
  </div>
  {#if structure}
    <label class="rep-field"><span>{$t('Atoms at range boundaries')}</span><select bind:value={draft.boundary}>
      <option value="clip">{$t('Clip atoms and bonds at the boundary')}</option>
      <option value="atoms">{$t('Include whole boundary atoms')}</option>
      <option value="none">{$t('Exclude upper boundary atoms')}</option>
    </select></label>
  {/if}
  <label class="rep-toggle"><input type="checkbox" bind:checked={draft.showCell} /><span>{$t('Show this Rep’s cell')}</span></label>
  <div class="rep-subheading"><strong>{$t('Translation vectors')}</strong><span>Å</span></div>
  <label class="rep-toggle"><input type="checkbox" bind:checked={custom} /><span>{$t('Use custom lattice vectors')}</span></label>
  {#if custom || sourceCell}
    <div class="rep-cell-grid">
      <span></span><span>x</span><span>y</span><span>z</span>
      {#each ['a', 'b', 'c'] as axis, row}
        <strong>{axis}</strong>
        {#each [0, 1, 2] as column}
          <input type="number" step="0.1" bind:value={matrix[row][column]} disabled={!custom} aria-label={$t('Lattice {axis} {component}', { axis, component: ['x', 'y', 'z'][column] })} />
        {/each}
      {/each}
    </div>
  {:else}
    <p class="rep-help">{$t('This source has no periodic cell. Enter custom vectors to repeat it.')}</p>
  {/if}
  <p class="rep-help">{$t('Custom vectors translate copies without stretching atoms or the volume grid. Source data stays unchanged.')}</p>
  {#if error}<p class="rep-error" role="alert">{$t(error)}</p>{/if}
  <button type="button" class="rep-primary" onclick={apply}>{$t('Apply periodic display')}</button>
</div>
