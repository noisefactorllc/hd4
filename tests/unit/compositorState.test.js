// SPDX-License-Identifier: MIT
/**
 * CompositorState — the composition section: one mutually-exclusive
 * COMPOSITION TYPE (OFF / PinP / SPLIT / QUAD) plus an independent KEY
 * overlay, with each effect's parameters validated and clamped to its
 * legal range. Pure state; the compositor reads snapshot() each frame.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CompositorState } from '../../js/compositorState.js'

test('defaults: composition off, key off, sensible PinP/SPLIT params', () => {
    const c = new CompositorState({ channelCount: 4 })
    const s = c.snapshot()
    assert.equal(s.composition, 'off')
    assert.equal(s.key.on, false)
    assert.equal(s.pinp.size, '1/4')
    assert.equal(s.split.pattern, 'v-center')
})

test('setComposition only accepts valid modes', () => {
    const c = new CompositorState()
    c.setComposition('pinp')
    assert.equal(c.composition, 'pinp')
    c.setComposition('bogus')
    assert.equal(c.composition, 'pinp') // unchanged
})

test('toggleComposition turns a mode on, then off when pressed again', () => {
    const c = new CompositorState()
    assert.equal(c.toggleComposition('quad'), 'quad')
    assert.equal(c.composition, 'quad')
    assert.equal(c.toggleComposition('quad'), 'off') // same button → off
    assert.equal(c.toggleComposition('pinp'), 'pinp')
    assert.equal(c.toggleComposition('split'), 'split') // switching mode
})

test('setPinp merges valid fields and clamps out-of-range ones', () => {
    const c = new CompositorState({ channelCount: 4 })
    c.setPinp({ size: '1/2', hPosition: 999, borderWidth: 50, hCropping: 0, source: 9 })
    const p = c.snapshot().pinp
    assert.equal(p.size, '1/2')
    assert.equal(p.hPosition, 50) // clamped to +50
    assert.equal(p.borderWidth, 15) // clamped to 15
    assert.equal(p.hCropping, 1) // clamped to 1 (min)
    assert.equal(p.source, 4) // clamped to channelCount
})

test('setPinp ignores invalid enum values', () => {
    const c = new CompositorState()
    c.setPinp({ shape: 'octagon', aspect: '4:3' })
    const p = c.snapshot().pinp
    assert.equal(p.shape, 'square') // unchanged
    assert.equal(p.aspect, '16:9') // unchanged
})

test('setSplit validates pattern and clamps centers', () => {
    const c = new CompositorState()
    c.setSplit({ pattern: 'h-stretch', centerPosition: -999, aCenter: 200 })
    const s = c.snapshot().split
    assert.equal(s.pattern, 'h-stretch')
    assert.equal(s.centerPosition, -50)
    assert.equal(s.aCenter, 100)
})

test('setKey merges + clamps; toggleKey flips on', () => {
    const c = new CompositorState()
    c.setKey({ type: 'luma', level: 300, sourceCh: 9 })
    let k = c.snapshot().key
    assert.equal(k.type, 'luma')
    assert.equal(k.level, 255)
    assert.equal(k.sourceCh, 5) // clamped to STILL max
    assert.equal(c.toggleKey(), true)
    assert.equal(c.snapshot().key.on, true)
})

test('toggleKey defaults the source to CH1 when armed with no source (so it is visible)', () => {
    const c = new CompositorState()
    assert.equal(c.snapshot().key.sourceCh, 0) // default OFF
    c.toggleKey() // arm
    assert.equal(c.snapshot().key.on, true)
    assert.equal(c.snapshot().key.sourceCh, 1) // auto-picks a source so KEY actually shows
    c.setKey({ sourceCh: 3 })
    c.toggleKey() // off
    c.toggleKey() // on again — keeps the chosen source
    assert.equal(c.snapshot().key.sourceCh, 3)
})

test('snapshot returns an independent copy (mutation does not leak back)', () => {
    const c = new CompositorState()
    const s = c.snapshot()
    s.pinp.size = '1/2'
    assert.equal(c.snapshot().pinp.size, '1/4')
})
