// SPDX-License-Identifier: MIT
/**
 * ProgramCompositor — owns the 2D program (main output) canvas.
 *
 * Two stages each frame:
 *   1. base  — render the scene into an offscreen buffer: the live channel,
 *              a transition, or a composition (PinP / SPLIT / QUAD), then a
 *              KEY overlay if armed. Skipped while FREEZE holds the frame.
 *   2. composite — blit the base to the visible canvas through the VFX
 *              filter, then overlay black at the OUTPUT FADE amount.
 *
 * Channel canvases are WebGL surfaces; drawImage reads them into 2D (the
 * same pattern visualize's compositor uses).
 */

import { vfxFilter } from './vfx.js'
import { curveFn } from './curves.js'
import { blendComposite } from './blend.js'
import { pinpInsetRect, pinpSourceCrop, splitLayout, quadLayout, BORDER_COLORS } from './compositing.js'
import { applyKey } from './key.js'

/** Pure: decide what to draw this frame from a presentation + transition type. */
export function transitionPlan(pres, type) {
    if (!pres.transitioning) return { kind: 'single', channel: pres.to }
    if (type === 'wipe') return { kind: 'wipe', from: pres.from, to: pres.to, mix: pres.mix }
    return { kind: 'dissolve', from: pres.from, to: pres.to, mix: pres.mix }
}

export class ProgramCompositor {
    constructor(canvas, { width = 1280, height = 720 } = {}) {
        this.canvas = canvas
        this.width = width
        this.height = height
        canvas.width = width
        canvas.height = height
        this.ctx = canvas.getContext('2d')
        this._channels = []
        this._still = null // captured still (KEY source = STILL)
        this._curve = 'dipped' // easing for dissolve / wipe / fade
        this._blend = 'mix' // dissolve blend mode

        this._base = document.createElement('canvas')
        this._base.width = width
        this._base.height = height
        this._baseCtx = this._base.getContext('2d')

        // Scratch buffer for per-pixel key compositing.
        this._keyBuf = document.createElement('canvas')
        this._keyBuf.width = width
        this._keyBuf.height = height
        this._keyCtx = this._keyBuf.getContext('2d', { willReadFrequently: true })
    }

    setChannels(channels) { this._channels = channels }

    /** Set the captured still used as a KEY source (canvas/image or null). */
    setStill(source) { this._still = source }

    /** Easing curve for dissolves / wipes / fades (linear|dipped|sharp|cut). */
    setCurve(name) { this._curve = name }

    /** Blend mode for the MIX dissolve (mix|add|screen|multiply). */
    setBlend(name) { this._blend = name }

    /** Render one program frame from the switcher presentation + output state. */
    draw(pres, type, output = {}) {
        if (!output.freeze) this._renderBase(pres, type, output)
        this._composite(output)
    }

    _renderBase(pres, type, output) {
        const ctx = this._baseCtx
        const w = this.width
        const h = this.height
        ctx.globalAlpha = 1
        ctx.filter = 'none'
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, w, h)

        const comp = output.composition || 'off'
        if (comp === 'quad') {
            this._drawQuad(ctx)
        } else if (comp === 'split') {
            this._drawSplit(ctx, pres, output.split)
        } else {
            this._drawScene(ctx, pres, type)
            if (comp === 'pinp') this._drawPinp(ctx, output.pinp)
        }

        if (output.key?.on && output.key.sourceCh) this._drawKey(ctx, output.key)
    }

    _drawScene(ctx, pres, type) {
        const w = this.width
        const h = this.height
        const ease = curveFn(this._curve)
        const plan = transitionPlan(pres, type)
        if (plan.kind === 'single') {
            this._blit(ctx, plan.channel, 0, 0, w, h)
        } else if (plan.kind === 'dissolve') {
            this._blit(ctx, plan.from, 0, 0, w, h)
            ctx.globalAlpha = ease(plan.mix)
            ctx.globalCompositeOperation = blendComposite(this._blend)
            this._blit(ctx, plan.to, 0, 0, w, h)
            ctx.globalCompositeOperation = 'source-over'
            ctx.globalAlpha = 1
        } else if (plan.kind === 'wipe') {
            this._blit(ctx, plan.from, 0, 0, w, h)
            const x = Math.round(w * ease(plan.mix))
            if (x > 0) {
                ctx.save()
                ctx.beginPath()
                ctx.rect(0, 0, x, h)
                ctx.clip()
                this._blit(ctx, plan.to, 0, 0, w, h)
                ctx.restore()
            }
        }
    }

    _drawQuad(ctx) {
        for (const cell of quadLayout(this.width, this.height)) {
            this._blit(ctx, cell.channel, cell.x, cell.y, cell.w, cell.h)
        }
    }

    /** SPLIT: A = the live program channel (left/top), B = split.sourceB. */
    _drawSplit(ctx, pres, split = {}) {
        const layout = splitLayout(split.pattern, split, this.width, this.height)
        this._drawRegion(ctx, pres.to, layout.a)
        this._drawRegion(ctx, split.sourceB, layout.b)
    }

    _drawRegion(ctx, channelNumber, region) {
        const src = this._channels[channelNumber - 1]?.canvas
        const d = region.dest
        if (!src || src.width <= 0 || d.w <= 0 || d.h <= 0) return
        const c = region.crop
        ctx.drawImage(
            src,
            c.sx * src.width, c.sy * src.height, c.sw * src.width, c.sh * src.height,
            d.x, d.y, d.w, d.h,
        )
    }

    /** PinP: an inset of pinp.source over the already-drawn background. */
    _drawPinp(ctx, pinp = {}) {
        const src = this._channels[pinp.source - 1]?.canvas
        if (!src || src.width <= 0) return
        const rect = pinpInsetRect(pinp, this.width, this.height)
        const crop = pinpSourceCrop(pinp)

        ctx.save()
        shapePath(ctx, pinp.shape, rect)
        ctx.clip()
        ctx.drawImage(
            src,
            crop.sx * src.width, crop.sy * src.height, crop.sw * src.width, crop.sh * src.height,
            rect.x, rect.y, rect.w, rect.h,
        )
        ctx.restore()

        if (pinp.borderWidth > 0) {
            ctx.save()
            shapePath(ctx, pinp.shape, rect)
            ctx.lineWidth = pinp.borderWidth
            ctx.strokeStyle = BORDER_COLORS[pinp.borderColor] || '#fff'
            ctx.stroke()
            ctx.restore()
        }
    }

    /** KEY overlay: key out a colour from the key source, draw over the base. */
    _drawKey(ctx, key) {
        const w = this.width
        const h = this.height
        const src = key.sourceCh === 5 ? this._still : this._channels[key.sourceCh - 1]?.canvas
        if (!src || !src.width) return
        const kctx = this._keyCtx
        kctx.clearRect(0, 0, w, h)
        kctx.drawImage(src, 0, 0, w, h)
        const img = kctx.getImageData(0, 0, w, h)
        applyKey(img, key)
        kctx.putImageData(img, 0, 0)
        ctx.drawImage(this._keyBuf, 0, 0)
    }

    _blit(ctx, channelNumber, x, y, w, h) {
        const ch = this._channels[channelNumber - 1]
        const c = ch?.canvas
        if (c && c.width > 0 && c.height > 0) ctx.drawImage(c, x, y, w, h)
    }

    _composite(output) {
        const ctx = this.ctx
        const w = this.width
        const h = this.height
        ctx.globalAlpha = 1
        ctx.clearRect(0, 0, w, h)
        ctx.filter = vfxFilter(output.vfx || 'none')
        ctx.drawImage(this._base, 0, 0)
        ctx.filter = 'none'

        const fade = output.fade || 0
        if (fade > 0) {
            ctx.globalAlpha = Math.min(1, curveFn(this._curve)(fade))
            ctx.fillStyle = '#000'
            ctx.fillRect(0, 0, w, h)
            ctx.globalAlpha = 1
        }
    }

    resize(width, height) {
        this.width = width
        this.height = height
        this.canvas.width = width
        this.canvas.height = height
        this._base.width = width
        this._base.height = height
        this._keyBuf.width = width
        this._keyBuf.height = height
    }
}

/** Trace a PinP inset shape (square / diamond / circle / heart) as a path. */
function shapePath(ctx, shape, { x, y, w, h }) {
    ctx.beginPath()
    const cx = x + w / 2
    const cy = y + h / 2
    if (shape === 'circle') {
        ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2)
    } else if (shape === 'diamond') {
        ctx.moveTo(cx, y)
        ctx.lineTo(x + w, cy)
        ctx.lineTo(cx, y + h)
        ctx.lineTo(x, cy)
        ctx.closePath()
    } else if (shape === 'heart') {
        const top = h * 0.3
        const mid = (h + top) / 2
        ctx.moveTo(cx, y + top)
        ctx.bezierCurveTo(cx, y, x, y, x, y + top)
        ctx.bezierCurveTo(x, y + mid, cx, y + mid, cx, y + h)
        ctx.bezierCurveTo(cx, y + mid, x + w, y + mid, x + w, y + top)
        ctx.bezierCurveTo(x + w, y, cx, y, cx, y + top)
        ctx.closePath()
    } else {
        ctx.rect(x, y, w, h)
    }
}
