// SPDX-License-Identifier: MIT
/**
 * Switcher — HD4's program-bus state machine (the switching core).
 *
 * Holds the live channel, the selected transition (cut/mix/wipe) and time,
 * and any in-flight take. A take ramps a mix 0→1 from the outgoing channel
 * to the incoming one over the transition time; cut and time-0 takes snap
 * instantly. The clock is injected (now in ms) so it's fully deterministic.
 *
 * tick(now) returns the presentation the renderer should show:
 *   { transitioning, from, to, mix }   program = blend(from, to, mix)
 *
 * Design choices for predictability: a take to the already-live channel is
 * ignored, and a take while a transition is in flight is ignored (let it
 * finish). cut() always works — it snaps to its target and clears any
 * transition, the reliable hard-cut escape.
 */
export class Switcher {
    constructor({ channelCount = 4, live = 1, type = 'mix', time = 1.0 } = {}) {
        this._channelCount = channelCount
        this._from = live
        this._to = live
        this._type = type
        this._time = time
        this._startedAt = null
        this._durationMs = 0
    }

    /** The selected on-air channel (lights immediately on take, for the UI). */
    get live() { return this._to }
    get type() { return this._type }
    get time() { return this._time }
    get transitioning() { return this._startedAt !== null }

    setType(type) { this._type = type }
    setTime(seconds) { this._time = Math.max(0, seconds) }

    /** Begin a transition to `target` (or snap if cut/time-0). */
    take(target, now = 0) {
        if (!this._valid(target)) return
        if (this.transitioning) return
        if (target === this._to) return
        if (this._type === 'cut' || this._time <= 0) {
            this._snap(target)
            return
        }
        this._from = this._to
        this._to = target
        this._startedAt = now
        this._durationMs = this._time * 1000
    }

    /** Hard cut: snap to `target` immediately, clearing any transition. */
    cut(target) {
        if (!this._valid(target)) return
        this._snap(target)
    }

    /** Advance any in-flight transition and return the current presentation. */
    tick(now) {
        if (this._startedAt === null) {
            return { transitioning: false, from: this._to, to: this._to, mix: 1 }
        }
        let mix = this._durationMs > 0 ? (now - this._startedAt) / this._durationMs : 1
        if (mix >= 1) {
            this._from = this._to
            this._startedAt = null
            this._durationMs = 0
            return { transitioning: false, from: this._to, to: this._to, mix: 1 }
        }
        if (mix < 0) mix = 0
        return { transitioning: true, from: this._from, to: this._to, mix }
    }

    _snap(target) {
        this._from = target
        this._to = target
        this._startedAt = null
        this._durationMs = 0
    }

    _valid(target) {
        return Number.isInteger(target) && target >= 1 && target <= this._channelCount
    }
}
