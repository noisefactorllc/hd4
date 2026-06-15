// SPDX-License-Identifier: MIT
/**
 * PreviewBus — the PGM/PVW preview selection (an addition beyond the original
 * direct-take bus). A channel is queued on preview; TAKE/AUTO sends it to
 * program through the switcher and the bus flip-flops so the outgoing
 * program returns to preview. Pure.
 */
export class PreviewBus {
    constructor({ channelCount = 4, preview = 2 } = {}) {
        this.channelCount = channelCount
        this._preview = this._valid(preview) ? preview : 1
    }

    get preview() { return this._preview }

    set(n) {
        if (this._valid(n)) this._preview = n
        return this._preview
    }

    /** Take the queued preview; flip the outgoing program back onto preview. */
    take(live) {
        const target = this._preview
        if (this._valid(live)) this._preview = live
        return target
    }

    _valid(n) { return Number.isInteger(n) && n >= 1 && n <= this.channelCount }
}
