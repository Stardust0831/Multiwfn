import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { createServer } from 'vite'

test('rendered ESP legend uses each palette midpoint for zero-width color ranges', async () => {
  const server = await createServer({ appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } })
  try {
    const { default: Legend } = await server.ssrLoadModule('/src/EspLegend.svelte')
    const { render } = await server.ssrLoadModule('svelte/server')
    const { get_d3_interpolator } = await server.ssrLoadModule('/node_modules/matterviz/dist/colors/index.js')
    const { scalars_to_vertex_colors } = await server.ssrLoadModule('/node_modules/matterviz/dist/isosurface/coloring.js')
    const { Color } = createRequire(realpathSync(new URL('../node_modules/matterviz/dist/isosurface/coloring.js', import.meta.url)))('three')
    for (const colormap of ['interpolateViridis', 'interpolateTurbo', 'interpolateCool', 'interpolateTransFlag']) {
      const expected = get_d3_interpolator(colormap)(0.5)
      const linear = new Color(expected)
      for (const endpoint of [-0.05, 0, 0.05]) {
        const html = render(Legend, { props: { min: endpoint, max: endpoint, colormap } }).body
        assert.ok(html.includes(`background: ${expected}`), `${colormap} at ${endpoint}: expected ${expected}`)
        assert.ok(!html.includes('NaN'))
        const colors = scalars_to_vertex_colors(new Float64Array([-1, endpoint, 1]), {
          colormap, color_range: [endpoint, endpoint],
        })
        for (let index = 0; index < 3; index++) {
          for (const [channel, value] of [linear.r, linear.g, linear.b].entries()) {
            // Surface colors use a 256-entry LUT; the CSS strip samples D3 directly.
            assert.ok(Math.abs(colors[index * 3 + channel] - value) < 0.01, `${colormap} surface midpoint`)
          }
        }
      }
    }
  } finally { await server.close() }
})
