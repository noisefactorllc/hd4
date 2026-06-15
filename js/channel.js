// SPDX-License-Identifier: MIT
/**
 * Channel — one of HD4's four inputs.
 *
 * Owns a canvas (its always-current output buffer) and coordinates the
 * lifecycle of a source *driver* that pumps pixels into that canvas. The
 * driver is built by an injected factory based on the source descriptor,
 * which keeps this lifecycle logic free of the DOM, getUserMedia, and the
 * GPU — the real drivers (camera / file / shader) are integration-tested.
 *
 * Driver contract: { start(), stop(), tick() }  (start may be async).
 */

import {
    EMPTY_SOURCE,
    sourceKind,
    sourceLabel,
    serializeSource,
    deserializeSource,
} from './sources/sourceModel.js'

export class Channel {
    constructor({ id, canvas, driverFactory }) {
        this.id = id
        this.canvas = canvas
        this._driverFactory = driverFactory
        this._source = EMPTY_SOURCE
        this._driver = null
    }

    get source() { return this._source }
    get driver() { return this._driver }
    get kind() { return sourceKind(this._source) }
    get label() { return sourceLabel(this._source) }

    /**
     * Swap the channel's source. Stops and releases any current driver
     * first, then (for a non-empty source) builds a fresh driver and
     * starts it. Returns whatever the driver's start() returns (a
     * promise for async acquisition like getUserMedia).
     */
    setSource(source, runtime = {}) {
        this._releaseDriver()
        this._source = source || EMPTY_SOURCE
        if (sourceKind(this._source) === 'empty') return undefined

        this._driver = this._driverFactory(this._source, {
            canvas: this.canvas,
            channel: this,
            runtime,
        })
        return this._driver.start()
    }

    /** Convenience: go back to the empty source. */
    clear() { return this.setSource(EMPTY_SOURCE) }

    /** Pump one frame from the active driver into the canvas. No-op when empty. */
    tick() {
        if (this._driver) this._driver.tick()
    }

    /** Persistable snapshot of the current source. */
    serialize() { return serializeSource(this._source) }

    /** Re-apply a persisted source snapshot. */
    restore(obj) { return this.setSource(deserializeSource(obj)) }

    /** Full teardown — stop the driver and reset to empty. */
    dispose() {
        this._releaseDriver()
        this._source = EMPTY_SOURCE
    }

    _releaseDriver() {
        if (this._driver) {
            try { this._driver.stop() } catch { /* best effort */ }
            this._driver = null
        }
    }
}
