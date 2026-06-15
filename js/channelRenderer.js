// SPDX-License-Identifier: MIT
/**
 * ChannelRenderer — a thin wrapper around the Noisemaker CanvasRenderer
 * for a single channel's canvas. Every HD4 channel renders through one of
 * these, whatever its source: a shader source compiles its DSL directly;
 * a camera/video/image source compiles a `media()` program and uploads
 * the source element as that program's texture each frame.
 *
 * Unifying every channel on one renderer (rather than mixing 2D-canvas
 * and WebGL paths) sidesteps the "one context per canvas" limitation and
 * mirrors visualize's Deck. This module is browser/GPU-bound and is
 * exercised by the Playwright integration suite, not the Node units.
 */

import {
    CanvasRenderer,
    CDN_BASE,
    extractEffectNamesFromDsl,
    extractEffectsFromDsl,
} from './noisemaker/bundle.js'

// `media()` with `search synth` resolves to "synth.media"; some code
// paths spell it "synth/media". Accept either.
const MEDIA_EFFECT_KEYS = new Set(['synth.media', 'synth/media'])

export class ChannelRenderer {
    constructor(canvas, { width = 960, height = 540, onError } = {}) {
        this.canvas = canvas
        this.width = width
        this.height = height
        canvas.width = width
        canvas.height = height
        this.onError = onError || ((e) => console.warn('[channelRenderer]', e?.message || e))

        this._renderer = new CanvasRenderer({
            canvas,
            width,
            height,
            basePath: CDN_BASE,
            useBundles: true,
            bundlePath: `${CDN_BASE}/effects`,
            onError: (e) => this.onError(e),
        })

        this._initialized = false
        this._currentDsl = ''
        this._mediaStep = null
        this._lastSize = null
    }

    get currentDsl() { return this._currentDsl }
    get isRunning() { return !!this._renderer.isRunning }
    /** The underlying renderer (escape hatch for the program/transition stages). */
    get inner() { return this._renderer }

    async init() {
        if (this._initialized) return
        await this._renderer.loadManifest()
        this._initialized = true
    }

    /**
     * Compile and run a DSL program. Loads any effects the DSL references
     * first. Keeps the previous program running on error and surfaces the
     * message via onError.
     */
    async compile(dsl) {
        if (!this._initialized) await this.init()
        try {
            const ids = extractEffectNamesFromDsl(dsl, this._renderer.manifest || {})
                .map((e) => e.effectId)
            if (ids.length) await this._renderer.loadEffects(ids)
            await this._renderer.compile(dsl)
            this._currentDsl = dsl
            this._mediaStep = this._discoverMediaStep(dsl)
            this._lastSize = null
            if (!this._renderer.isRunning) this._renderer.start()
            return { success: true }
        } catch (err) {
            const msg = typeof err === 'string' ? err : err?.message || err?.error || 'compile error'
            this.onError(msg)
            return { success: false, error: msg }
        }
    }

    /** Does the current program contain a media() input? */
    get hasMedia() { return this._mediaStep != null }

    /**
     * Upload a frame (HTMLVideoElement / HTMLImageElement / canvas) into
     * the current program's media() step. The source is first fitted into
     * a channel-aspect buffer (aspect-preserving "cover": fill the frame,
     * crop the overflow), so a camera or clip of any aspect lands in the
     * 16:9 channel without stretching. imageSize then matches that buffer,
     * which equals the output aspect, so the media shader fills cleanly.
     * No-op when the program has no media() step.
     */
    uploadMediaFrame(src) {
        if (this._mediaStep == null || !src) return
        const sw = src.videoWidth || src.naturalWidth || src.width || 0
        const sh = src.videoHeight || src.naturalHeight || src.height || 0
        if (sw === 0 || sh === 0) return
        try {
            const fit = this._fitToChannel(src, sw, sh)
            this._renderer.updateTextureFromSource(
                `imageTex_step_${this._mediaStep}`,
                fit,
                { flipY: false },
            )
            const w = fit.width
            const h = fit.height
            if (!this._lastSize || this._lastSize[0] !== w || this._lastSize[1] !== h) {
                this._renderer.applyStepParameterValues?.({
                    [`step_${this._mediaStep}`]: { imageSize: [w, h] },
                })
                this._lastSize = [w, h]
            }
        } catch {
            // mid-recompile — try again next frame
        }
    }

    /** Draw `src` into the channel-aspect fit buffer with cover scaling. */
    _fitToChannel(src, sw, sh) {
        const dw = this.width
        const dh = this.height
        if (!this._fitCanvas) {
            this._fitCanvas = document.createElement('canvas')
            this._fitCtx = this._fitCanvas.getContext('2d')
        }
        if (this._fitCanvas.width !== dw || this._fitCanvas.height !== dh) {
            this._fitCanvas.width = dw
            this._fitCanvas.height = dh
        }
        const ctx = this._fitCtx
        const scale = Math.max(dw / sw, dh / sh)
        const w = sw * scale
        const h = sh * scale
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, dw, dh)
        ctx.drawImage(src, (dw - w) / 2, (dh - h) / 2, w, h)
        return this._fitCanvas
    }

    start() { this._renderer.start() }
    stop() { this._renderer.stop() }

    resize(width, height) {
        if (width === this.width && height === this.height) return
        this.width = width
        this.height = height
        this.canvas.width = width
        this.canvas.height = height
        this._renderer.resize(width, height)
        this._lastSize = null
    }

    dispose() {
        this.stop()
        this._renderer.dispose?.()
    }

    _discoverMediaStep(dsl) {
        try {
            const effects = extractEffectsFromDsl(dsl) || []
            for (const e of effects) {
                if (MEDIA_EFFECT_KEYS.has(e.effectKey)) return e.stepIndex
            }
        } catch { /* ignore */ }
        return null
    }
}
