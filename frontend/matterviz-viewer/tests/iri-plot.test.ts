import assert from 'node:assert/strict'
import test from 'node:test'
import { IRI_COLOR_RANGE, iri_interaction_color } from '../src/iri-plot.ts'

test('uses the official sign(lambda2)rho IRI color anchors and clipping', () => {
  assert.deepEqual(IRI_COLOR_RANGE, [-0.04, 0.02])
  assert.equal(iri_interaction_color(-1), 'rgb(0, 0, 255)')
  assert.equal(iri_interaction_color(-0.04), 'rgb(0, 0, 255)')
  assert.equal(iri_interaction_color(-0.02), 'rgb(0, 128, 128)')
  assert.equal(iri_interaction_color(0), 'rgb(0, 255, 0)')
  assert.equal(iri_interaction_color(0.01), 'rgb(128, 128, 0)')
  assert.equal(iri_interaction_color(0.02), 'rgb(255, 0, 0)')
  assert.equal(iri_interaction_color(1), 'rgb(255, 0, 0)')
})
