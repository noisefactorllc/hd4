// SPDX-License-Identifier: MIT
/**
 * Switcher — the pure program-bus state machine at the heart of HD4.
 *
 * Models the classic switching paradigm: a live channel, a selected
 * transition (cut/mix/wipe) and time, and an in-flight take that ramps
 * a mix 0→1 from the outgoing channel to the incoming one. DOM-free and
 * clock-injected (now in ms), so every transition path is unit-tested.
 *
 * Presentation contract returned by tick(now) / read by the compositor:
 *   { transitioning, from, to, mix }   program = blend(from, to, mix)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Switcher } from '../../js/switcher.js'

test('constructs on channel 1 with mix/1.0s defaults, idle', () => {
    const s = new Switcher()
    assert.equal(s.live, 1)
    assert.equal(s.type, 'mix')
    assert.equal(s.time, 1.0)
    assert.equal(s.transitioning, false)
    assert.deepEqual(s.tick(0), { transitioning: false, from: 1, to: 1, mix: 1 })
})

test('setType and setTime update the configuration', () => {
    const s = new Switcher()
    s.setType('wipe')
    s.setTime(2.5)
    assert.equal(s.type, 'wipe')
    assert.equal(s.time, 2.5)
})

test('cut() switches the live channel instantly, no transition', () => {
    const s = new Switcher({ type: 'mix', time: 2 })
    s.cut(3, 1000)
    assert.equal(s.live, 3)
    assert.equal(s.transitioning, false)
    assert.deepEqual(s.tick(1000), { transitioning: false, from: 3, to: 3, mix: 1 })
})

test('take() with type "cut" is instant', () => {
    const s = new Switcher({ type: 'cut', time: 2 })
    s.take(2, 500)
    assert.equal(s.live, 2)
    assert.equal(s.transitioning, false)
})

test('take() with time 0 is instant even for mix', () => {
    const s = new Switcher({ type: 'mix', time: 0 })
    s.take(4, 100)
    assert.equal(s.live, 4)
    assert.equal(s.transitioning, false)
})

test('take() with mix/2s ramps the mix 0→1 then completes', () => {
    const s = new Switcher({ type: 'mix', time: 2, live: 1 })

    s.take(2, 1000)
    assert.equal(s.live, 2, 'selected channel goes live immediately for UI')
    assert.equal(s.transitioning, true)

    assert.deepEqual(s.tick(1000), { transitioning: true, from: 1, to: 2, mix: 0 })
    assert.deepEqual(s.tick(2000), { transitioning: true, from: 1, to: 2, mix: 0.5 })

    const done = s.tick(3000)
    assert.equal(done.transitioning, false)
    assert.deepEqual(done, { transitioning: false, from: 2, to: 2, mix: 1 })
    assert.equal(s.transitioning, false)
})

test('mix clamps to [0,1] past the end of the transition', () => {
    const s = new Switcher({ type: 'mix', time: 1, live: 1 })
    s.take(2, 0)
    const t = s.tick(5000)
    assert.equal(t.mix, 1)
    assert.equal(t.transitioning, false)
})

test('take() to the already-live channel is ignored', () => {
    const s = new Switcher({ live: 2 })
    s.take(2, 0)
    assert.equal(s.transitioning, false)
})

test('take() while a transition is in flight is ignored (predictable)', () => {
    const s = new Switcher({ type: 'mix', time: 2, live: 1 })
    s.take(2, 0)
    s.take(3, 500)
    assert.equal(s.live, 2)
    assert.deepEqual(s.tick(1000), { transitioning: true, from: 1, to: 2, mix: 0.5 })
})

test('cut() during a transition snaps to the cut target and clears it', () => {
    const s = new Switcher({ type: 'mix', time: 2, live: 1 })
    s.take(2, 1000)
    s.cut(3, 1500)
    assert.equal(s.live, 3)
    assert.equal(s.transitioning, false)
    assert.deepEqual(s.tick(1600), { transitioning: false, from: 3, to: 3, mix: 1 })
})

test('out-of-range channel targets are ignored', () => {
    const s = new Switcher({ channelCount: 4, live: 1 })
    s.take(0, 0)
    s.take(5, 0)
    s.cut(9, 0)
    assert.equal(s.live, 1)
    assert.equal(s.transitioning, false)
})

test('wipe transitions over time the same way mix does', () => {
    const s = new Switcher({ type: 'wipe', time: 4, live: 1 })
    s.take(3, 0)
    assert.equal(s.transitioning, true)
    assert.deepEqual(s.tick(2000), { transitioning: true, from: 1, to: 3, mix: 0.5 })
})

test('changing time mid-transition does not warp the in-flight take', () => {
    const s = new Switcher({ type: 'mix', time: 2, live: 1 })
    s.take(2, 0)
    s.setTime(10) // affects only future takes
    assert.deepEqual(s.tick(1000), { transitioning: true, from: 1, to: 2, mix: 0.5 })
})
