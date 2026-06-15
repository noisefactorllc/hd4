// SPDX-License-Identifier: MIT
/**
 * Main-bus audio helpers — the pure config behind the MAIN [SETUP]:
 * defaults + clamping for the main EQ, limiter, reverb (return/time/type),
 * multiband compressor, and AUX bus, plus the reverb impulse parameters.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAIN_DEFAULTS, clampMainParam, reverbIRParams } from '../../js/audio/mainBus.js'

test('MAIN_DEFAULTS: limiter on, EQ flat, reverb low, MB comp off', () => {
    assert.equal(MAIN_DEFAULTS.mainLimiter, true)
    assert.equal(MAIN_DEFAULTS.eqHi, 0)
    assert.equal(MAIN_DEFAULTS.mbComp, false)
    assert.equal(MAIN_DEFAULTS.reverbType, 'room')
})

test('clampMainParam coerces bools and clamps ranges', () => {
    assert.equal(clampMainParam('mainMute', 1), true)
    assert.equal(clampMainParam('mainLimiterThreshold', 10), 0) // -40..0
    assert.equal(clampMainParam('mainLimiterThreshold', -99), -40)
    assert.equal(clampMainParam('eqMid', 99), 15) // -15..15
    assert.equal(clampMainParam('reverbTime', 99), 5) // 0..5 s
    assert.equal(clampMainParam('auxDelay', -5), 0) // 0..500 ms
})

test('clampMainParam validates reverb type and snaps MB ratios', () => {
    assert.equal(clampMainParam('reverbType', 'hall'), 'hall')
    assert.equal(clampMainParam('reverbType', 'cathedral'), 'room') // invalid → default
    assert.equal(clampMainParam('mbMidRatio', 2.6), 2.5)
})

test('reverbIRParams maps type+time to an impulse length and decay', () => {
    const hall = reverbIRParams('hall', 3)
    assert.equal(hall.seconds, 3)
    const room = reverbIRParams('room', 1.5)
    assert.equal(room.seconds, 1.5)
    assert.ok(room.decay > hall.decay) // room decays faster (shorter tail) than hall
    assert.ok(reverbIRParams('room', 0).seconds > 0) // never zero-length
})
