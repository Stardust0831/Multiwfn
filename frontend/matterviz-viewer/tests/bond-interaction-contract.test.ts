import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = (): Promise<string> =>
  readFile(new URL('../src/App.svelte', import.meta.url), 'utf8')

test('Multiwfn configures ordered distance and angle/dihedral measurement', async () => {
  const source = await appSource()

  assert.ok(source.includes('show_atom_tooltip={false}'))
  assert.ok(source.includes("distance: { max_sites: 2, overflow: 'restart' }"))
  assert.ok(source.includes("angle: { max_sites: 4, overflow: 'reject' }"))
  assert.ok(source.includes('measure_geometry="ordered"'))
  assert.ok(source.includes('on_selected_bond_context={open_bond_context_menu}'))
  assert.ok(source.includes('bind:displayed_structure={displayedStructure}'))
})

test('bond calculations require exactly two source atoms and context requests snapshot the pair', async () => {
  const source = await appSource()

  assert.ok(source.includes('if (sites.length !== 2) return undefined'))
  assert.ok(source.includes('pair.every((siteIndex) => siteIndex < Number(sourceSiteCount))'))
  assert.ok(source.includes('orig_unit_cell_idx ?? properties?.orig_site_idx ?? siteIndex'))
  assert.ok(source.includes("!selected_source_bond_pair() ? 'Use the measurement tool to select two atoms'"))
  const action = await readFile(new URL('../src/AnalysisAction.svelte', import.meta.url), 'utf8')
  assert.ok(action.includes('disabled={busy || Boolean(reason)}'))

  const snapshot = source.indexOf('const pair = menu ? valid_source_bond_pair(menu.source_site_indices) : undefined')
  const closeMenu = source.indexOf('close_bond_context_menu()', snapshot)
  const request = source.indexOf('await request_bond({ method, pair: [...pair] })', snapshot)
  assert.ok(snapshot >= 0, 'context-menu requests must capture their source atom pair')
  assert.ok(closeMenu > snapshot, 'the context menu should close after capturing its atom pair')
  assert.ok(request > closeMenu, 'the captured pair should be passed to the bond request')
})

test('bond-order context menu exposes disabled reasons and standard dismissal behavior', async () => {
  const source = await appSource()

  for (const [method, label] of [
    ['mayer', 'Mayer'],
    ['gwbo', 'GWBO'],
    ['wiberg_lowdin', 'Wiberg-Löwdin'],
    ['mulliken', 'Mulliken'],
    ['fbo', 'FBO'],
  ]) {
    assert.ok(source.includes(`${method}: '${label}'`), `${method} should have a human-readable label`)
  }
  assert.ok(source.includes(".replace(/[_-]+/g, ' ')"), 'unknown method keys should have a readable fallback')
  assert.ok(source.includes('<span>{bond_method_label(method)}</span>'))
  assert.ok(source.includes('class="bond-analysis-menu"'))
  assert.ok(source.includes('role="menu"'))
  assert.ok(source.includes('role="menuitem"'))
  assert.ok(source.includes('aria-disabled={Boolean(unavailableReason)}'))
  assert.ok(source.includes('{#each Object.entries(manifest.bondAnalysis.methods) as [method, capability]}'))
  assert.ok(source.includes('{#if unavailableReason}<small>{capability.reason || unavailableReason}</small>{/if}'))
  assert.ok(source.includes('bondMethod = method'))
  assert.ok(source.includes("event.key === 'Escape'"))
  assert.ok(source.includes("document.addEventListener('pointerdown', close_on_outside_pointer, true)"))
})
