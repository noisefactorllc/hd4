// SPDX-License-Identifier: MIT
/**
 * Audio level math — the pure core of the mixer: dB↔gain, the fader taper,
 * mute/solo resolution, and RMS metering. DOM-free and WebAudio-free, so
 * the gain logic is fully unit-tested; the AudioContext graph that applies
 * these gains is integration-tested.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dbToGain, gainToDb, faderToGain, resolveChannelGains, rms } from '../../js/audio/levels.js'

const close = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps

test('dbToGain: 0 dB is unity, −6 dB is ~half-amplitude, −Inf is silence', () => {
    assert.equal(dbToGain(0), 1)
    assert.ok(close(dbToGain(-6), 0.5012))
    assert.equal(dbToGain(-Infinity), 0)
    assert.ok(close(dbToGain(6), 1.9953))
})

test('gainToDb inverts dbToGain; zero gain is −Infinity', () => {
    assert.equal(gainToDb(1), 0)
    assert.equal(gainToDb(0), -Infinity)
    assert.ok(close(gainToDb(0.5), -6.0206))
    assert.ok(close(gainToDb(dbToGain(-12)), -12))
})

test('faderToGain is a square-law taper, clamped to [0,1]', () => {
    assert.equal(faderToGain(0), 0)
    assert.equal(faderToGain(1), 1)
    assert.equal(faderToGain(0.5), 0.25)
    assert.equal(faderToGain(2), 1)
    assert.equal(faderToGain(-1), 0)
})

test('resolveChannelGains passes gains through when nothing is muted or soloed', () => {
    const gains = resolveChannelGains([
        { gain: 0.8, muted: false, soloed: false },
        { gain: 0.5, muted: false, soloed: false },
    ])
    assert.deepEqual(gains, [0.8, 0.5])
})

test('a muted channel is silenced; others are unaffected', () => {
    const gains = resolveChannelGains([
        { gain: 0.8, muted: true, soloed: false },
        { gain: 0.5, muted: false, soloed: false },
    ])
    assert.deepEqual(gains, [0, 0.5])
})

test('solo isolates: non-soloed channels are silenced', () => {
    const gains = resolveChannelGains([
        { gain: 0.8, muted: false, soloed: true },
        { gain: 0.5, muted: false, soloed: false },
        { gain: 0.3, muted: false, soloed: true },
    ])
    assert.deepEqual(gains, [0.8, 0, 0.3])
})

test('mute beats solo on the same channel', () => {
    const gains = resolveChannelGains([
        { gain: 0.8, muted: true, soloed: true },
        { gain: 0.5, muted: false, soloed: true },
    ])
    assert.deepEqual(gains, [0, 0.5])
})

test('rms computes the root-mean-square of a sample buffer', () => {
    assert.equal(rms([0, 0, 0]), 0)
    assert.equal(rms([1, -1, 1, -1]), 1)
    assert.equal(rms([0.5, -0.5]), 0.5)
    assert.equal(rms([]), 0)
})
