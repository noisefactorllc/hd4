// SPDX-License-Identifier: MIT
/**
 * Channel-strip audio helpers — the pure math behind the channel
 * processing: dB↔gain, the discrete compressor ratios, parameter clamping
 * to each control's range, and the frame-driven gate envelope. The WebAudio
 * graph that consumes these is integration-tested.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    dbToGain, COMP_RATIOS, nearestRatio, clampStripParam, STRIP_DEFAULTS, gateStep,
} from '../../js/audio/strip.js'

test('dbToGain converts decibels to a linear gain', () => {
    assert.ok(Math.abs(dbToGain(0) - 1) < 1e-9)
    assert.ok(Math.abs(dbToGain(-6) - 0.5012) < 1e-3)
    assert.ok(Math.abs(dbToGain(6) - 1.995) < 1e-3)
})

test('dbToGain treats -Infinity (and deep floor) as silence', () => {
    assert.equal(dbToGain(-Infinity), 0)
    assert.equal(dbToGain(-120), 0)
})

test('COMP_RATIOS includes the full ladder up to INF', () => {
    assert.ok(COMP_RATIOS.includes(1))
    assert.ok(COMP_RATIOS.includes(2))
    assert.ok(COMP_RATIOS.includes(Infinity)) // INF:1
})

test('nearestRatio snaps an arbitrary value to the closest ladder rung', () => {
    assert.equal(nearestRatio(2.1), 2)
    assert.equal(nearestRatio(3), 3.2)
    assert.equal(nearestRatio(999), Infinity)
})

test('clampStripParam coerces booleans and clamps ranges', () => {
    assert.equal(clampStripParam('hpf', 1), true)
    assert.equal(clampStripParam('eqHi', 99), 15) // -15..15
    assert.equal(clampStripParam('eqHi', -99), -15)
    assert.equal(clampStripParam('eqMidQ', 99), 16) // 0.5..16
    assert.equal(clampStripParam('pan', -5), -1) // -1..1
    assert.equal(clampStripParam('delay', 999), 500) // 0..500 ms
    assert.equal(clampStripParam('gateThreshold', 10), 0) // -80..0
})

test('clampStripParam snaps the compressor ratio to the ladder', () => {
    assert.equal(clampStripParam('compRatio', 2.1), 2)
})

test('send levels allow -Infinity (off) and clamp the +10 dB ceiling', () => {
    assert.equal(clampStripParam('auxSend', -Infinity), -Infinity)
    assert.equal(clampStripParam('auxSend', 99), 10)
    assert.equal(clampStripParam('revSend', 99), 10)
})

test('STRIP_DEFAULTS is a flat, centered, all-bypassed strip', () => {
    assert.equal(STRIP_DEFAULTS.eqHi, 0)
    assert.equal(STRIP_DEFAULTS.eqMid, 0)
    assert.equal(STRIP_DEFAULTS.eqLo, 0)
    assert.equal(STRIP_DEFAULTS.pan, 0)
    assert.equal(STRIP_DEFAULTS.hpf, false)
    assert.equal(STRIP_DEFAULTS.gate, false)
    assert.equal(STRIP_DEFAULTS.comp, false)
})

test('gateStep opens quickly and closes over the release time', () => {
    // closing: from open(1), 100ms elapsed of a 1000ms release → down ~0.1
    assert.ok(Math.abs(gateStep(1, false, 100, 1000) - 0.9) < 1e-6)
    // never below 0
    assert.equal(gateStep(0.05, false, 1000, 1000), 0)
    // opening rises toward 1 (10ms attack → full in one 10ms+ step)
    assert.equal(gateStep(0, true, 20, 1000), 1)
})
