import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'


test('backend work does not unmount Structure and all numerical readouts have a separate layout row', async () => {
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8')
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  assert.match(app, /bind:loading=\{structureLoading\}/)
  assert.doesNotMatch(app, /bind:loading\s/)
  assert.doesNotMatch(app, /Working\.\.\./)
  assert.match(app, /<div class="calculation-status" role="status">/)
  assert.match(css, /\.viewer-shell\s*\{[^}]*grid-template-rows: minmax\(0, 1fr\) auto/)
})

test('frontier shortcuts use declared HOMO metadata and scroll only the orbital list', async () => {
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8')
  assert.match(app, /homoIndex = \$derived\(manifest.orbitals\?\.homoIndex \?\? manifest.multiwfnGui\?\.state\?\.homoIndex\)/)
  assert.match(app, /aria-label=\{\$t\("Frontier orbitals"\)\}/)
  assert.match(app, /data-orbital-index=\{item.index\}/)
  assert.match(app, /list.scrollTop = Math.max/)
  assert.doesNotMatch(app, /scrollIntoView\(/)
})
