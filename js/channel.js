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
        this._runtime = {} // the payload (e.g. a File) the source was applied with
        this._driver = null
        this._attempt = 0
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
     *
     * A start that rejects never produced a frame, so the previous
     * source is put back on screen before the rejection propagates: a
     * denied camera or a vanished device must not leave a dead input
     * selected. (Only sync drivers may return a non-promise from
     * start(); those cannot fail here.)
     */
    setSource(source, runtime = {}) {
        this._releaseDriver()
        const previous = this._source
        const previousRuntime = this._runtime
        this._source = source || EMPTY_SOURCE
        this._runtime = runtime
        if (sourceKind(this._source) === 'empty') {
            // The channel is explicitly empty now: a start still in flight
            // must not resurrect its source when it fails.
            this._attempt++
            return undefined
        }

        const attempt = ++this._attempt
        this._driver = this._driverFactory(this._source, {
            canvas: this.canvas,
            channel: this,
            runtime,
        })
        const started = this._driver.start()
        if (started && typeof started.catch === 'function') {
            return started.catch((err) => {
                if (attempt === this._attempt) this._fallBack(previous, previousRuntime)
                throw err
            })
        }
        return started
    }

    /**
     * Restore the source that was live before a failed start. The
     * fallback is rebuilt without the failed attempt's runtime payload
     * (a File belongs to that attempt); if even it cannot start, the
     * channel settles empty — there is nothing further to fall back to.
     * Synchronous, so a second setSource during the wait above has
     * already replaced this state by the time it runs (guarded by the
     * attempt token).
     */
    _fallBack(previous, previousRuntime) {
        const attempt = this._attempt
        this._releaseDriver()
        this._source = previous
        // The fallback re-applies the source it is restoring — including the
        // runtime payload it was originally applied with (an uploaded file's
        // File handle travels only through runtime).
        this._runtime = previousRuntime || {}
        if (sourceKind(previous) === 'empty') {
            this._driver = null
            return
        }
        this._driver = this._driverFactory(previous, {
            canvas: this.canvas,
            channel: this,
            runtime: this._runtime,
        })
        const restart = this._driver.start()
        if (restart && typeof restart.catch === 'function') {
            restart.catch(() => {
                // Nothing further to fall back to: settle empty. Another
                // setSource since means it owns the channel now.
                if (attempt !== this._attempt) return
                this._releaseDriver()
                this._source = EMPTY_SOURCE
                this._driver = null
            })
        }
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

    /** Full teardown — stop the driver and reset to empty. A start still
     *  in flight must not rebuild a driver after the teardown. */
    dispose() {
        this._attempt++
        this._releaseDriver()
        this._source = EMPTY_SOURCE
        this._runtime = {}
    }

    _releaseDriver() {
        if (this._driver) {
            try { this._driver.stop() } catch { /* best effort */ }
            this._driver = null
        }
    }
}
