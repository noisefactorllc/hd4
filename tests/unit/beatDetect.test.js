// SPDX-License-Identifier: MIT
/**
 * BeatDetector — energy-onset beat detection over the audio, estimating
 * tempo (the "match the music" part of beat matching). push(energy, now)
 * flags an onset when energy spikes above the recent local average and
 * estimates BPM from the inter-onset intervals. Pure and clock-injected.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BeatDetector } from '../../js/beatDetect.js'

/** Push a run of low-energy samples to advance time / build history. */
function quiet(d, from, to, step = 20) {
    let last = { onset: false, bpm: null }
    for (let t = from; t < to; t += step) last = d.push(0.1, t)
    return last
}

test('detects an energy spike as an onset above the local average', () => {
    const d = new BeatDetector({ sensitivity: 1.5, minIntervalMs: 200 })
    quiet(d, 0, 400)
    assert.equal(d.push(1.0, 400).onset, true)
})

test('does not double-trigger within the refractory window', () => {
    const d = new BeatDetector({ sensitivity: 1.5, minIntervalMs: 200 })
    quiet(d, 0, 400)
    assert.equal(d.push(1.0, 400).onset, true)
    assert.equal(d.push(1.0, 450).onset, false) // 50ms < 200ms refractory
})

test('steady spikes yield an onset each time and estimate the tempo', () => {
    const d = new BeatDetector({ sensitivity: 1.5, minIntervalMs: 200 })
    quiet(d, 0, 400)
    assert.equal(d.push(1.0, 400).onset, true) // onset 1
    quiet(d, 420, 900)
    assert.equal(d.push(1.0, 900).onset, true) // onset 2 (+500ms)
    quiet(d, 920, 1400)
    const r = d.push(1.0, 1400) // onset 3 (+500ms)
    assert.equal(r.onset, true)
    assert.ok(Math.abs(r.bpm - 120) < 1, `bpm ${r.bpm}`) // 500ms beat = 120bpm
})

test('folds an out-of-range tempo into the musical band', () => {
    const d = new BeatDetector({ sensitivity: 1.5, minIntervalMs: 100 })
    quiet(d, 0, 400)
    // spikes every 250ms = 240bpm → folds down to 120
    d.push(1.0, 400)
    quiet(d, 420, 650)
    d.push(1.0, 650)
    quiet(d, 670, 900)
    const r = d.push(1.0, 900)
    assert.ok(r.bpm >= 70 && r.bpm <= 180, `bpm ${r.bpm}`)
})

test('bpm is null until at least two onsets are seen', () => {
    const d = new BeatDetector({ sensitivity: 1.5, minIntervalMs: 200 })
    quiet(d, 0, 400)
    assert.equal(d.push(1.0, 400).bpm, null)
})
