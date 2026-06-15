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
        this._mode = AutoMix._normMode(mode)
        this._barsPerSwitch = Math.max(1, barsPerSwitch)
        this._rng = rng
        this._enabled = false
        this._lastSwitchBeat = 0
        // Which channels take part in the auto rotation (default: all).
        this._included = new Set()
        for (let i = 1; i <= channelCount; i++) this._included.add(i)
    }

    get enabled() { return this._enabled }
    get mode() { return this._mode }
    get barsPerSwitch() { return this._barsPerSwitch }

    setEnabled(v) { this._enabled = !!v }
    toggle() { this._enabled = !this._enabled; return this._enabled }
    setMode(m) { this._mode = AutoMix._normMode(m) }
    static _normMode(m) { return ['scan', 'random', 'follows-audio'].includes(m) ? m : 'scan' }
    setBarsPerSwitch(n) { this._barsPerSwitch = Math.max(1, Number(n) || 1) }

    /** Include/exclude a channel from the auto rotation. */
    setIncluded(channel, on) {
        if (on) this._included.add(channel)
        else this._included.delete(channel)
    }
    isIncluded(channel) { return this._included.has(channel) }

    /** Anchor the bar counter (call when enabling, with the current beatIndex). */
    reset(beatIndex) { this._lastSwitchBeat = beatIndex }

    /** Decide on a beat: returns the channel to take, or null. */
    onBeat(beat, live) {
        if (!this._enabled) return null
        if (this._mode === 'follows-audio') return null // level-driven, not beat-driven
        if (!beat.isDownbeat) return null
        const barsSince = (beat.beatIndex - this._lastSwitchBeat) / 4
        if (barsSince < this._barsPerSwitch) return null
        this._lastSwitchBeat = beat.beatIndex
        return this._pickNext(live)
    }

    _pickNext(live) {
        const others = []
        for (let i = 1; i <= this._channelCount; i++) {
            if (this._included.has(i) && i !== live) others.push(i)
        }
        if (others.length === 0) return null // nothing else to switch to
        if (this._mode === 'random') {
            const idx = Math.min(others.length - 1, Math.floor(this._rng() * others.length))
            return others[idx]
        }
        // scan: the next included channel after `live`, cyclically.
        for (let step = 1; step <= this._channelCount; step++) {
            const c = ((live - 1 + step) % this._channelCount) + 1
            if (this._included.has(c) && c !== live) return c
        }
        return null
    }
}
