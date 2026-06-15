// SPDX-License-Identifier: MIT
/**
 * Audio level math — the pure core of the mixer. DOM-free and
 * WebAudio-free so every gain decision is unit-tested; the AudioContext
 * graph that applies these values lives in mixer.js.
 */

/** Decibels → linear gain. −Infinity dB maps to 0 naturally. */
export function dbToGain(db) {
    return Math.pow(10, db / 20)
}

/** Linear gain → decibels. Zero (or negative) gain is −Infinity dB. */
export function gainToDb(gain) {
    return gain <= 0 ? -Infinity : 20 * Math.log10(gain)
}

/** Fader position [0,1] → linear gain, square-law audio taper, clamped. */
export function faderToGain(position) {
    const p = Math.max(0, Math.min(1, position))
    return p * p
}

/**
 * Resolve each channel's effective gain given mute/solo across the bank.
 * Mute always silences. If any channel is soloed, only soloed channels
 * pass. Channels: [{ gain, muted, soloed }] → [effectiveGain].
 */
export function resolveChannelGains(channels) {
    const anySolo = channels.some((c) => c.soloed)
    return channels.map((c) => {
        if (c.muted) return 0
        if (anySolo && !c.soloed) return 0
        return c.gain
    })
}

/** Root-mean-square of a sample buffer (values in −1..1). Empty → 0. */
export function rms(samples) {
    const n = samples.length
    if (n === 0) return 0
    let sum = 0
    for (let i = 0; i < n; i++) sum += samples[i] * samples[i]
    return Math.sqrt(sum / n)
}
