// SPDX-License-Identifier: MIT
/**
 * BeatDetector — energy-onset beat detection (the "match the music" half
 * of beat matching). Each frame, push(energy, now) the audio's low-band
 * energy; an onset is flagged when it spikes above the recent local
 * average (with a refractory gap), and the tempo is estimated from the
 * inter-onset intervals, folded into a musical band. Pure and
 * clock-injected; the app reads energy from the AudioMixer's analyser and
 * uses onsets to re-anchor the BeatClock.
 */
const FOLD_MIN = 70
const FOLD_MAX = 180

export class BeatDetector {
    constructor({ sensitivity = 1.4, minIntervalMs = 250, historySize = 43, minHistory = 8 } = {}) {
        this._sensitivity = sensitivity
        this._minIntervalMs = minIntervalMs
        this._historySize = historySize
        this._minHistory = minHistory
        this._history = []
        this._lastOnsetMs = -Infinity
        this._onsetTimes = []
    }

    push(energy, now) {
        let onset = false
        if (this._history.length >= this._minHistory) {
            const avg = this._history.reduce((a, b) => a + b, 0) / this._history.length
            if (energy > avg * this._sensitivity && now - this._lastOnsetMs >= this._minIntervalMs) {
                onset = true
                this._lastOnsetMs = now
                this._onsetTimes.push(now)
                if (this._onsetTimes.length > 8) this._onsetTimes.shift()
            }
        }
        this._history.push(energy)
        if (this._history.length > this._historySize) this._history.shift()
        return { onset, bpm: this._estimateBpm() }
    }

    reset() {
        this._history = []
        this._onsetTimes = []
        this._lastOnsetMs = -Infinity
    }

    _estimateBpm() {
        if (this._onsetTimes.length < 2) return null
        const intervals = []
        for (let i = 1; i < this._onsetTimes.length; i++) {
            intervals.push(this._onsetTimes[i] - this._onsetTimes[i - 1])
        }
        intervals.sort((a, b) => a - b)
        const median = intervals[Math.floor(intervals.length / 2)]
        let bpm = 60000 / median
        while (bpm < FOLD_MIN) bpm *= 2
        while (bpm > FOLD_MAX) bpm /= 2
        return bpm
    }
}
