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
    compile as compileDsl,
    extractEffectNamesFromDsl,
    extractEffectsFromDsl,
} from './noisemaker/bundle.js'
import { computeFit } from './fit.js'

// The longest an engine compile holds up the next one. A compile that never
// settles (say, after a lost GPU context) must not freeze the channel: past
// this, the next compile goes ahead while the stuck one keeps running.
const ENGINE_TURN_LIMIT_MS = 10_000

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
        this._compileSeq = 0 // the newest compile; an older one that finishes late is dropped
        this._engineTurn = Promise.resolve() // engine compiles run one at a time, in order
        this._currentDsl = ''
        this._mediaStep = null
        this._lastSize = null
        this._fitMode = 'cover' // 'cover' (zoom/crop) | 'contain' (scale)
    }

    get currentDsl() { return this._currentDsl }
    get isRunning() { return !!this._renderer.isRunning }
    get fitMode() { return this._fitMode }
    setFitMode(mode) { this._fitMode = mode === 'contain' ? 'contain' : 'cover' }
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
     * message via onError. A compile that a newer one overtook while it
     * waited (effects can take seconds to download) is dropped, resolving
     * { success: false, superseded: true }, so it never replaces the newer
     * program on screen. Engine compiles run one at a time, so the newest
     * program is always the last one compiled (unless one is stuck for
     * longer than ENGINE_TURN_LIMIT_MS).
     */
    async compile(dsl) {
        const seq = ++this._compileSeq
        const superseded = () => seq !== this._compileSeq
        if (!this._initialized) await this.init()
        try {
            await this._loadEffectsFor(dsl)
            if (superseded()) return { success: false, superseded: true }
            // The limit counts from this turn's start, not from when it queued.
            const prior = this._engineTurn
            let timer
            const limit = prior.then(() => new Promise((resolve) => { timer = setTimeout(resolve, ENGINE_TURN_LIMIT_MS) }))
            const turn = prior.then(() => (superseded() ? null : this._renderer.compile(dsl)))
            const settled = turn
                .catch(() => { /* the compile reports its own error below */ })
                .finally(() => clearTimeout(timer))
            this._engineTurn = Promise.race([settled, limit])
            await turn
            if (superseded()) return { success: false, superseded: true }
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

    /**
     * Check a program without running it: load the effects it names, then
     * return the engine compiler's first error, or null. The running
     * program is untouched, so a bad program is caught before a channel
     * gives up its source. Throws if the effects fail to load.
     */
    async check(dsl) {
        if (!this._initialized) await this.init()
        await this._loadEffectsFor(dsl)
        const error = (compileDsl(dsl).diagnostics || []).find((d) => d.severity === 'error')
        return error ? error.message : null
    }

    async _loadEffectsFor(dsl) {
        const ids = extractEffectNamesFromDsl(dsl, this._renderer.manifest || {})
            .map((e) => e.effectId)
        if (ids.length) await this._renderer.loadEffects(ids)
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
        const { x, y, w, h } = computeFit(this._fitMode, sw, sh, dw, dh)
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, dw, dh)
        ctx.drawImage(src, x, y, w, h)
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
