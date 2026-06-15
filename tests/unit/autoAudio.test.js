// SPDX-License-Identifier: MIT
/**
 * Auto-audio decision logic — the pure math behind the auto-audio
 * modes: AUTO MIXING (level/weight gain sharing, loudest stays at unity,
 * others duck) and VIDEO FOLLOWS AUDIO (switch the program to the loudest
 * input over a sense threshold). Audio-follows-video is a trivial gate
 * applied in the mixer.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoMixGains, pickLoudest } from '../../js/audio/autoAudio.js'

test('autoMixGains keeps the loudest enabled channel at unity and ducks quieter ones', () => {
    const g = autoMixGains([0.1, 0.5, 0.25], [100, 100, 100], [true, true, true])
    assert.ok(Math.abs(g[1] - 1) < 1e-9) // loudest → unity
    assert.ok(Math.abs(g[0] - 0.2) < 1e-9) // 0.1/0.5
    assert.ok(Math.abs(g[2] - 0.5) < 1e-9) // 0.25/0.5
})

test('autoMixGains leaves disabled channels untouched (gain 1)', () => {
    const g = autoMixGains([0.1, 0.5], [100, 100], [false, true])
    assert.equal(g[0], 1) // not part of auto-mix
    assert.equal(g[1], 1)
})

test('autoMixGains weights the priority', () => {
    // equal levels, double weight on ch0 → ch1 ducks to half
    const g = autoMixGains([0.4, 0.4], [100, 50], [true, true])
    assert.ok(Math.abs(g[0] - 1) < 1e-9)
    assert.ok(Math.abs(g[1] - 0.5) < 1e-9)
})

test('autoMixGains does not duck when everything is silent', () => {
    assert.deepEqual(autoMixGains([0, 0], [100, 100], [true, true]), [1, 1])
})

test('pickLoudest returns the loudest included channel above the threshold (1-based)', () => {
    assert.equal(pickLoudest([0.2, 0.7, 0.5], [true, true, true], 0.05), 2)
})

test('pickLoudest ignores excluded channels', () => {
    assert.equal(pickLoudest([0.9, 0.3], [false, true], 0.05), 2)
})

test('pickLoudest returns null when nothing clears the threshold', () => {
    assert.equal(pickLoudest([0.01, 0.02], [true, true], 0.1), null)
})
