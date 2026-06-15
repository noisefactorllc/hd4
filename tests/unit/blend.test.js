// SPDX-License-Identifier: MIT
/**
 * Transition blend modes — map a blend name to the canvas
 * globalCompositeOperation used while cross-fading the incoming channel.
 * Pure lookup; the compositor applies it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BLEND_MODES, blendComposite } from '../../js/blend.js'

test('blendComposite maps names to canvas composite operations', () => {
    assert.equal(blendComposite('mix'), 'source-over')
    assert.equal(blendComposite('add'), 'lighter')
    assert.equal(blendComposite('screen'), 'screen')
    assert.equal(blendComposite('multiply'), 'multiply')
})

test('blendComposite falls back to normal for unknown modes', () => {
    assert.equal(blendComposite('hologram'), 'source-over')
    assert.equal(blendComposite(undefined), 'source-over')
})

test('BLEND_MODES lists mix first and only known modes', () => {
    assert.equal(BLEND_MODES[0], 'mix')
    for (const m of BLEND_MODES) assert.notEqual(blendComposite(m), undefined)
})
