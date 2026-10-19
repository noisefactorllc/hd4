// SPDX-License-Identifier: MIT
/**
 * ProgramOutput — fans the finished program frame out to output sinks.
 *
 * The compositor draws each frame into the 2D program canvas; the frame loop
 * then calls publish(), which hands that canvas to every registered sink (the
 * viewport window, the Noisedeck Sync sender). A sink is the Noisemaker sink
 * contract ({ configure, submit, close }), run by Noisemaker's SinkManager,
 * and ProgramOutput exposes the same sink surface a Noisemaker renderer does
 * (addSink / createFrameExportQueue / pipeline), so the Sync output
 * controller drives it exactly as it drives visualize's mixer renderer.
 *
 * Sinks receive the program canvas itself as the frame source. The program
 * is always opaque (the compositor fills black under every frame).
 *
 * Program timing is authoritative: a sink's deferRender() is never honoured,
 * so a slow encoder drops its own frames instead of stalling the program
 * monitor, the recorder, or the viewport window.
 */

export const PROGRAM_FPS = 60

export function programDescriptor(width, height) {
    return Object.freeze({
        width,
        height,
        format: 'rgba8unorm',
        colorSpace: 'srgb',
        alphaMode: 'opaque',
        fps: PROGRAM_FPS,
    })
}

export class ProgramOutput {
    /**
     * @param {object} opts
     * @param {HTMLCanvasElement} opts.canvas  the on-air program canvas
     * @param {object} opts.sinkManager  a Noisemaker SinkManager (or the same contract)
     * @param {(opts: {canvas: HTMLCanvasElement, slots: number}) => object|null} [opts.createExportQueue]
     *        builds a Sync export queue that reads this canvas
     */
    constructor({ canvas, sinkManager, createExportQueue = null } = {}) {
        if (!canvas) throw new TypeError('ProgramOutput needs the program canvas')
        if (!sinkManager || typeof sinkManager.add !== 'function' ||
            typeof sinkManager.configure !== 'function' || typeof sinkManager.submit !== 'function') {
            throw new TypeError('ProgramOutput needs a SinkManager')
        }
        this.canvas = canvas
        this._sinks = sinkManager
        this._createExportQueue = createExportQueue
        // Stable renderer identity for the Sync controller: the program canvas
        // is never replaced, so the identity never changes.
        this.pipeline = Object.freeze({ kind: 'hd4-program' })
        this._descriptor = null
        this._closed = false
        this._configureIfResized()
    }

    /** The current output descriptor (program size, opaque sRGB, 60 fps). */
    get descriptor() {
        this._configureIfResized()
        return this._descriptor
    }

    /** Register a sink; returns its idempotent removal function. */
    addSink(sink) {
        if (this._closed) throw new Error('ProgramOutput is closed')
        this._configureIfResized()
        return this._sinks.add(sink)
    }

    /** A Sync export queue for this canvas, or null when none can be built. */
    createFrameExportQueue({ slots = 3 } = {}) {
        if (this._closed || typeof this._createExportQueue !== 'function') return null
        return this._createExportQueue({ canvas: this.canvas, slots })
    }

    /** Hand the frame the compositor just drew to every sink. */
    publish(timestamp) {
        if (this._closed) return
        this._configureIfResized()
        this._sinks.submit(this.canvas, timestamp)
    }

    close() {
        if (this._closed) return
        this._closed = true
        this._sinks.close?.()
    }

    _configureIfResized() {
        if (this._closed) return
        const { width, height } = this.canvas
        if (this._descriptor && this._descriptor.width === width && this._descriptor.height === height) return
        this._descriptor = programDescriptor(width, height)
        this._sinks.configure(this._descriptor)
    }
}
