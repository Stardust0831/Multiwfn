import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { canvas_data_url, is_pdf, is_png, svg_to_pdf, wait_for_plot_ready } from '../src/plot-export.ts'

test('recognizes PNG and PDF signatures', () => {
  assert.equal(is_png(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])), true)
  assert.equal(is_pdf(new TextEncoder().encode('%PDF-1.7')), true)
  assert.equal(is_png(new TextEncoder().encode('screenshot')), false)
  assert.equal(is_pdf(new TextEncoder().encode('<svg>')), false)
})

test('uses maintained converters and never sends a client-selected path', () => {
  const source = readFileSync(new URL('../src/plot-export.ts', import.meta.url), 'utf8')
  assert.match(source, /import\('svg2pdf\.js'\)/)
  assert.match(source, /import\('jspdf'\)/)
  assert.doesNotMatch(source, /searchParams\.set\(['"]path/)
  assert.match(source, /toDataURL\('image\/png'\)/)
})

test('waits for a real scientific SVG and reports timeout', async () => {
  let ready = false
  const root = { querySelector: (selector: string) => {
    if (selector === '.plot-loading') return ready ? null : {}
    return ready ? {} : null
  } } as unknown as HTMLElement
  const pending = wait_for_plot_ready(root, 100, 2)
  setTimeout(() => { ready = true }, 5)
  await pending
  const empty_root = { querySelector: () => null } as unknown as HTMLElement
  await assert.rejects(wait_for_plot_ready(empty_root, 5, 1), /Timed out waiting/)
})

test('fails closed when a scientific Canvas layer cannot be serialized', () => {
  const canvas = { toDataURL: () => { throw new Error('tainted canvas') } } as unknown as HTMLCanvasElement
  assert.throws(() => canvas_data_url(canvas), /Unable to serialize a scientific Canvas layer: tainted canvas/)
})

test('uses svg2pdf for vector PDF output when a browser DOM is available', { skip: typeof DOMParser === 'undefined' }, async () => {
  const bytes = await svg_to_pdf('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><path d="M0 0 L100 80" stroke="black" fill="none"/><text x="8" y="16">line</text></svg>', { width: 100, height: 80 })
  assert.equal(is_pdf(bytes), true)
  const text = new TextDecoder().decode(bytes)
  assert.match(text, /100 0 l/)
  assert.match(text, /line/)
  assert.doesNotMatch(text, /screenshot|viewport/i)
})
