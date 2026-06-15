// SPDX-License-Identifier: MIT
/**
 * Channel-strip audio helpers — pure math for the channel processing.
 * The AudioMixer builds the WebAudio graph (HPF → 3-band EQ → gate → comp →
 * makeup → delay → pan → fader, plus AUX/REV sends) from these.
 */

/** Decibels → linear gain; -Infinity (and a deep floor) is silence. */
export function dbToGain(db) {
    if (!Number.isFinite(db) || db <= -100) return 0
    return 10 ** (db / 20)
}

/** Compressor ratio ladder (…:1), INF as Infinity. */
export const COMP_RATIOS = [1, 1.12, 1.25, 1.4, 1.6, 1.8, 2, 2.5, 3.2, 4, 5.6, 8, 16, Infinity]

/** Snap an arbitrary ratio to the closest ladder rung. */
export function nearestRatio(v) {
    if (v >= 16) return v > 24 ? Infinity : 16 // halfway between 16 and INF → INF
    let best = COMP_RATIOS[0]
    let bestD = Infinity
    for (const r of COMP_RATIOS) {
        if (!Number.isFinite(r)) continue
        const d = Math.abs(r - v)
        if (d < bestD) { bestD = d; best = r }
    }
    return best
}

const RANGES = {
    eqHi: [-15, 15], eqHiFreq: [1000, 20000],
    eqMid: [-15, 15], eqMidFreq: [20, 20000], eqMidQ: [0.5, 16],
    eqLo: [-15, 15], eqLoFreq: [20, 500],
    gateThreshold: [-80, 0], gateRelease: [30, 5000],
    compThreshold: [-60, 0], compAttack: [0.2, 100], compRelease: [30, 5000], compMakeup: [-40, 40],
    pan: [-1, 1], delay: [0, 500],
    auxSend: [-Infinity, 10], revSend: [-Infinity, 10],
}
const BOOLS = new Set(['hpf', 'gate', 'comp', 'compAutoGain'])

/** Validate/clamp one strip parameter to its legal range. */
export function clampStripParam(key, value) {
    if (BOOLS.has(key)) return !!value
    if (key === 'compRatio') return nearestRatio(Number(value))
    const range = RANGES[key]
    if (!range) return value
    const v = Number(value)
    if (Number.isNaN(v)) return STRIP_DEFAULTS[key]
    return Math.max(range[0], Math.min(range[1], v))
}

/** A flat, centered, fully-bypassed channel strip (factory defaults). */
export const STRIP_DEFAULTS = Object.freeze({
    hpf: false,
    eqHi: 0, eqHiFreq: 10000,
    eqMid: 0, eqMidFreq: 500, eqMidQ: 1,
    eqLo: 0, eqLoFreq: 100,
    gate: false, gateThreshold: -50, gateRelease: 860,
    comp: false, compThreshold: -30, compRatio: 2, compAttack: 1, compRelease: 380, compMakeup: 0, compAutoGain: false,
    pan: 0, delay: 0,
    auxSend: 0, revSend: -60, // -60 dB ≈ off (kept finite so state serializes)
})

/**
 * One frame's step of the gate gain. Opens toward 1 over the attack time,
 * closes toward 0 over the release time. Linear ramp (frame granularity).
 */
export function gateStep(current, open, dtMs, releaseMs, attackMs = 10) {
    if (open) {
        const step = attackMs > 0 ? dtMs / attackMs : 1
        return Math.min(1, current + step)
    }
    const step = releaseMs > 0 ? dtMs / releaseMs : 1
    return Math.max(0, current - step)
}
