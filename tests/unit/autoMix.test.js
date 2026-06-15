// SPDX-License-Identifier: MIT
/**
 * AutoMix — the beat-synced auto-switcher decision (AUTO SWITCHING /
 * visualize automix.js). Given beats from the BeatClock and the current
 * live channel, it decides when to take the next channel and which one
 * (scan = cycle, random = any other). Pure; the actual take is the app's
 * job via the switcher.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AutoMix } from '../../js/autoMix.js'

const downbeat = (beatIndex) => ({ beatIndex, isDownbeat: true })

test('defaults: disabled, scan mode, 4 bars per switch', () => {
    const a = new AutoMix()
    assert.equal(a.enabled, false)
    assert.equal(a.mode, 'scan')
    assert.equal(a.barsPerSwitch, 4)
})

test('toggle / setEnabled flip the enabled flag', () => {
    const a = new AutoMix()
    assert.equal(a.toggle(), true)
    assert.equal(a.enabled, true)
    a.setEnabled(false)
    assert.equal(a.enabled, false)
})

test('onBeat does nothing while disabled or off a downbeat', () => {
    const a = new AutoMix({ barsPerSwitch: 1 })
    a.reset(0)
    assert.equal(a.onBeat(downbeat(4), 1), null) // disabled
    a.setEnabled(true)
    assert.equal(a.onBeat({ beatIndex: 5, isDownbeat: false }, 1), null) // not a downbeat
})

test('scan takes the next channel every N bars, wrapping 4→1', () => {
    const a = new AutoMix({ channelCount: 4, mode: 'scan', barsPerSwitch: 2 })
    a.setEnabled(true)
    a.reset(0)
    assert.equal(a.onBeat(downbeat(4), 1), null) // 1 bar since → too soon
    assert.equal(a.onBeat(downbeat(8), 1), 2) // 2 bars → take ch2
    assert.equal(a.onBeat(downbeat(12), 2), null) // 1 bar since last switch
    assert.equal(a.onBeat(downbeat(16), 2), 3) // take ch3
    assert.equal(a.onBeat(downbeat(24), 4), 1) // wraps 4 → 1
})

test('random picks any channel except the live one', () => {
    const a = new AutoMix({ channelCount: 4, mode: 'random', barsPerSwitch: 1, rng: () => 0 })
    a.setEnabled(true)
    a.reset(0)
    assert.equal(a.onBeat(downbeat(4), 2), 1) // candidates [1,3,4], rng 0 → 1

    const a2 = new AutoMix({ channelCount: 4, mode: 'random', barsPerSwitch: 1, rng: () => 0.99 })
    a2.setEnabled(true)
    a2.reset(0)
    assert.equal(a2.onBeat(downbeat(4), 2), 4) // candidates [1,3,4], rng hi → 4
})

test('setBarsPerSwitch and setMode reconfigure', () => {
    const a = new AutoMix()
    a.setBarsPerSwitch(8)
    assert.equal(a.barsPerSwitch, 8)
    a.setMode('random')
    assert.equal(a.mode, 'random')
    a.setBarsPerSwitch(0) // clamped up to at least 1
    assert.equal(a.barsPerSwitch, 1)
})
