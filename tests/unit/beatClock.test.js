// SPDX-License-Identifier: MIT
/**
 * BeatClock — the beat-matching core (visualize bpm.js):
 * manual BPM, tap tempo, and a clock-injected beat grid that emits beats
 * and downbeats. Pure (now is passed in) so it's fully unit-tested.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BeatClock, computeBarSeconds } from '../../js/beatClock.js'

test('computeBarSeconds: a bar is four beats', () => {
    assert.equal(computeBarSeconds(120), 2) // 120bpm = 0.5s/beat × 4
    assert.equal(computeBarSeconds(60), 4)
})

test('constructs at a BPM with a derived beat interval', () => {
    const c = new BeatClock({ bpm: 120 })
    assert.equal(c.bpm, 120)
    assert.equal(c.beatIntervalMs, 500)
    assert.equal(c.running, false)
})

test('setBpm clamps to the musical range', () => {
    const c = new BeatClock()
    c.setBpm(150); assert.equal(c.bpm, 150)
    c.setBpm(10); assert.equal(c.bpm, 40)
    c.setBpm(999); assert.equal(c.bpm, 300)
})

test('tick emits one beat per interval once running', () => {
    const c = new BeatClock({ bpm: 120 }) // 500ms/beat
    c.start(1000)
    assert.deepEqual(c.tick(1000), []) // nothing yet
    assert.deepEqual(c.tick(1499).length, 0)
    const b = c.tick(1500)
    assert.equal(b.length, 1)
    assert.equal(b[0].beatIndex, 1)
    assert.deepEqual(c.tick(1700), []) // not yet next
    assert.equal(c.tick(2000)[0].beatIndex, 2)
})

test('tick catches up multiple beats and marks downbeats (every 4th)', () => {
    const c = new BeatClock({ bpm: 120 })
    c.start(0)
    const beats = c.tick(2000) // beats at 500,1000,1500,2000 → indices 1..4
    assert.deepEqual(beats.map((b) => b.beatIndex), [1, 2, 3, 4])
    assert.deepEqual(beats.map((b) => b.isDownbeat), [false, false, false, true])
    assert.deepEqual(beats.map((b) => b.beatInBar), [1, 2, 3, 0])
})

test('a stopped clock emits nothing', () => {
    const c = new BeatClock()
    c.start(0); c.stop()
    assert.deepEqual(c.tick(10_000), [])
})

test('tap tempo infers BPM from the average inter-tap interval', () => {
    const c = new BeatClock({ bpm: 120 })
    assert.equal(c.tap(0), 120) // first tap: not enough info yet
    c.tap(500) // 500ms → 120bpm
    c.tap(1000)
    assert.equal(c.bpm, 120)

    const c2 = new BeatClock()
    c2.tap(0); c2.tap(600); c2.tap(1200) // 600ms → 100bpm
    assert.equal(Math.round(c2.bpm), 100)
})

test('tap restarts the rolling window after a long gap', () => {
    const c = new BeatClock({ bpm: 120 })
    c.tap(0); c.tap(600) // 100 bpm
    assert.equal(Math.round(c.bpm), 100)
    c.tap(5000) // >2s gap: window resets, BPM unchanged from a lone tap
    assert.equal(Math.round(c.bpm), 100)
    c.tap(5400); c.tap(5800) // 400ms → 150bpm
    assert.equal(Math.round(c.bpm), 150)
})

test('beatPhase reports fractional position within the current beat', () => {
    const c = new BeatClock({ bpm: 120 }) // 500ms
    c.start(0)
    c.tick(500) // anchor at the first beat
    assert.ok(Math.abs(c.beatPhase(750) - 0.5) < 1e-9)
})
