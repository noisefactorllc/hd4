// SPDX-License-Identifier: MIT
/**
 * AutoMix — the beat-synced auto-switcher (AUTO SWITCHING; the
 * 4-channel analogue of visualize's automix.js). Fed the BeatClock's
 * beats and the current live channel, it returns the channel to take next
 * (on every Nth bar, at a downbeat) — or null. "scan" cycles 1→2→3→4→1;
 * "random" picks any other channel. Pure; the app performs the take.
 */
export class AutoMix {
    constructor({ channelCount = 4, mode = 'scan', barsPerSwitch = 4, rng = Math.random } = {}) {
        this._channelCount = channelCount
        this._mode = mode === 'random' ? 'random' : 'scan'
        this._barsPerSwitch = Math.max(1, barsPerSwitch)
        this._rng = rng
        this._enabled = false
        this._lastSwitchBeat = 0
    }

    get enabled() { return this._enabled }
    get mode() { return this._mode }
    get barsPerSwitch() { return this._barsPerSwitch }

    setEnabled(v) { this._enabled = !!v }
    toggle() { this._enabled = !this._enabled; return this._enabled }
    setMode(m) { this._mode = m === 'random' ? 'random' : 'scan' }
    setBarsPerSwitch(n) { this._barsPerSwitch = Math.max(1, Number(n) || 1) }

    /** Anchor the bar counter (call when enabling, with the current beatIndex). */
    reset(beatIndex) { this._lastSwitchBeat = beatIndex }

    /** Decide on a beat: returns the channel to take, or null. */
    onBeat(beat, live) {
        if (!this._enabled) return null
        if (!beat.isDownbeat) return null
        const barsSince = (beat.beatIndex - this._lastSwitchBeat) / 4
        if (barsSince < this._barsPerSwitch) return null
        this._lastSwitchBeat = beat.beatIndex
        return this._pickNext(live)
    }

    _pickNext(live) {
        if (this._mode === 'random') {
            const candidates = []
            for (let i = 1; i <= this._channelCount; i++) if (i !== live) candidates.push(i)
            if (candidates.length === 0) return null
            const idx = Math.min(candidates.length - 1, Math.floor(this._rng() * candidates.length))
            return candidates[idx]
        }
        return (live % this._channelCount) + 1
    }
}
