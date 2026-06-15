// SPDX-License-Identifier: MIT
/**
 * OutputState — the program-output stage flags and the fade ramp.
 *
 * The output controls: [FREEZE] (hold the program), [VFX]
 * (output filter), and [OUTPUT FADE] (fade the program to black). The fade
 * moves at a constant rate (1 / fadeTime per second) and reverses smoothly
 * from its current value. Pure and clock-injected; the compositor reads
 * tick(now) each frame as { freeze, vfx, fade }. (Composition — QUAD /
 * PinP / SPLIT / KEY — lives in CompositorState.)
 */
export class OutputState {
    constructor({ fadeTime = 0.5 } = {}) {
        this.freeze = false
        this.vfx = 'none'
        this._rate = fadeTime > 0 ? 1 / fadeTime : Infinity
        this._fadeValue = 0
        this._fadeTarget = 0
        this._lastNow = null
    }

    toggleFreeze() { this.freeze = !this.freeze; return this.freeze }
    setVfx(name) { this.vfx = name }
    setFadeTime(seconds) { this._rate = seconds > 0 ? 1 / seconds : Infinity }

    /** True when the output is fading to / held at black. */
    get faded() { return this._fadeTarget === 1 }

    /** Toggle the fade direction; the ramp continues from the current value. */
    toggleFade(now) {
        this._fadeTarget = this._fadeTarget === 1 ? 0 : 1
        this._lastNow = now
    }

    tick(now) {
        if (this._lastNow === null) this._lastNow = now
        const dt = (now - this._lastNow) / 1000
        this._lastNow = now
        if (this._fadeValue !== this._fadeTarget && dt > 0) {
            const step = this._rate === Infinity ? Infinity : this._rate * dt
            this._fadeValue = this._fadeTarget > this._fadeValue
                ? Math.min(this._fadeTarget, this._fadeValue + step)
                : Math.max(this._fadeTarget, this._fadeValue - step)
        }
        return { freeze: this.freeze, vfx: this.vfx, fade: this._fadeValue }
    }
}
