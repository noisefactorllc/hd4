// SPDX-License-Identifier: MIT
/**
 * StillStore — the INPUT CAPTURE still (a freeze-frame grab).
 *
 * capture() snapshots a source canvas into an independent buffer and derives
 * a data URL. The buffer feeds the KEY "STILL" source; the data URL lets any
 * channel show the still through the normal image pipeline. Held in memory
 * for the session. The canvas factory is injected for testability.
 */
export class StillStore {
    constructor({ createCanvas } = {}) {
        this._createCanvas = createCanvas || (() => document.createElement('canvas'))
        this.canvas = null
        this.dataUrl = null
    }

    get hasStill() { return !!this.canvas }

    /** Snapshot a source canvas. Returns the still buffer, or null if empty. */
    capture(source) {
        if (!source || !source.width || !source.height) return null
        const reuse = this.canvas && this.canvas.width === source.width && this.canvas.height === source.height
        const c = reuse ? this.canvas : this._createCanvas()
        c.width = source.width
        c.height = source.height
        const ctx = c.getContext('2d')
        ctx.clearRect(0, 0, c.width, c.height)
        ctx.drawImage(source, 0, 0)
        this.canvas = c
        this.dataUrl = c.toDataURL('image/png')
        return c
    }

    clear() {
        this.canvas = null
        this.dataUrl = null
    }
}
