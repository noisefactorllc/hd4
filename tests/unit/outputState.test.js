// SPDX-License-Identifier: MIT
/**
 * OutputState — the program-output stage flags ([QUAD] [FREEZE]
 * [OUTPUT FADE] [VFX]) plus a clock-injected fade ramp. Pure and
 * deterministic; the compositor reads tick(now) each frame.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OutputState } from '../../js/outputState.js'

test('defaults: no quad, no freeze, vfx none, fade 0', () => {
    const o = new OutputState()
    assert.deepEqual(o.tick(0), { quad: false, freeze: false, vfx: 'none', fade: 0 })
})

test('toggleQuad and toggleFreeze flip and report', () => {
    const o = new OutputState()
    assert.equal(o.toggleQuad(), true)
    assert.equal(o.toggleFreeze(), true)
    const s = o.tick(0)
    assert.equal(s.quad, true)
    assert.equal(s.freeze, true)
    assert.equal(o.toggleQuad(), false)
})

test('setVfx changes the active effect', () => {
    const o = new OutputState()
    o.setVfx('negative')
    assert.equal(o.tick(0).vfx, 'negative')
})

test('setQuad sets the quad flag explicitly (for memory recall)', () => {
    const o = new OutputState()
    o.setQuad(true)
    assert.equal(o.tick(0).quad, true)
    o.setQuad(false)
    assert.equal(o.tick(0).quad, false)
})

test('toggleFade ramps to black over the fade time, then holds', () => {
    const o = new OutputState({ fadeTime: 0.5 })
    o.toggleFade(0)
    assert.equal(o.faded, true)
    assert.equal(o.tick(0).fade, 0)
    assert.equal(o.tick(250).fade, 0.5)
    assert.equal(o.tick(500).fade, 1)
    assert.equal(o.tick(600).fade, 1)
})

test('toggleFade again fades back up from the current value', () => {
    const o = new OutputState({ fadeTime: 0.5 })
    o.toggleFade(0)
    o.tick(500) // fully black
    o.toggleFade(1000)
    assert.equal(o.faded, false)
    assert.equal(o.tick(1000).fade, 1)
    assert.equal(o.tick(1250).fade, 0.5)
    assert.equal(o.tick(1500).fade, 0)
})

test('reversing a fade mid-ramp continues from where it is', () => {
    const o = new OutputState({ fadeTime: 1 })
    o.toggleFade(0)
    assert.equal(o.tick(500).fade, 0.5) // halfway to black
    o.toggleFade(500) // reverse
    assert.equal(o.tick(1000).fade, 0) // back to visible in another 0.5s
})
