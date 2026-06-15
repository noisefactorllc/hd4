// SPDX-License-Identifier: MIT
/**
 * BeatClock — HD4's beat-matching core.
 *
 * Holds the tempo (manual BPM or tap tempo) and a clock-injected beat
 * grid: tick(now) advances the grid and returns the beats that fired
 * since the last tick, each flagged with its position in the bar (a bar =
 * 4 beats; every 4th is a downbeat). Pure and deterministic — the app
 * drives tick() from its frame loop and an audio detector can re-anchor
 * the phase. Mirrors visualize's bpm.js.
 */
const MIN_BPM = 40
const MAX_BPM = 300
const TAP_RESET_MS = 2000

export function computeBarSeconds(bpm, divider = 1) {
    return (60 / bpm) * 4 * divider
}

export class BeatClock {
    constructor({ bpm = 120 } = {}) {
        this._bpm = clampBpm(bpm)
        this._running = false
        this._lastBeatMs = 0
        this._beatIndex = 0
        this._tapTimes = []
    }

    get bpm() { return this._bpm }
    get beatIntervalMs() { return 60000 / this._bpm }
    get running() { return this._running }
    get beatIndex() { return this._beatIndex }

    setBpm(v) {
        const n = Number(v)
        if (Number.isFinite(n) && n > 0) this._bpm = clampBpm(n)
    }

    start(now) {
        this._running = true
        this._lastBeatMs = now
        this._beatIndex = 0
    }

    stop() { this._running = false }

    /** Advance to `now`; returns the beats that fired since the last tick. */
    tick(now) {
        if (!this._running) return []
        const beats = []
        let guard = 0
        while (now >= this._lastBeatMs + this.beatIntervalMs && guard < 64) {
            this._lastBeatMs += this.beatIntervalMs
            this._beatIndex++
            beats.push(this._beatInfo())
            guard++
        }
        return beats
    }

    /** Re-anchor the beat grid to `now` (e.g. on a detected audio onset). */
    resetPhase(now) { this._lastBeatMs = now }

    /** Fractional position [0,1] within the current beat. */
    beatPhase(now) {
        if (!this._running) return 0
        return Math.max(0, Math.min(1, (now - this._lastBeatMs) / this.beatIntervalMs))
    }

    /** Record a tap; infers BPM from the rolling inter-tap average. */
    tap(now) {
        if (this._tapTimes.length && now - this._tapTimes[this._tapTimes.length - 1] > TAP_RESET_MS) {
            this._tapTimes = []
        }
        this._tapTimes.push(now)
        if (this._tapTimes.length > 8) this._tapTimes.shift()
        if (this._tapTimes.length >= 2) {
            const intervals = []
            for (let i = 1; i < this._tapTimes.length; i++) {
                intervals.push(this._tapTimes[i] - this._tapTimes[i - 1])
            }
            const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
            const bpm = 60000 / avg
            if (bpm > MIN_BPM && bpm < MAX_BPM) {
                this._bpm = clampBpm(bpm)
                this._lastBeatMs = now // align the grid to the tap
            }
        }
        return this._bpm
    }

    _beatInfo() {
        const beatInBar = this._beatIndex % 4
        return { beatIndex: this._beatIndex, beatInBar, isDownbeat: beatInBar === 0, bpm: this._bpm }
    }
}

function clampBpm(n) {
    return Math.max(MIN_BPM, Math.min(MAX_BPM, n))
}
