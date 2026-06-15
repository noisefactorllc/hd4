// SPDX-License-Identifier: MIT
/**
 * ProgramCompositor — owns the 2D program (main output) canvas.
 *
 * Two stages:
 *   1. base  — render the scene (single live channel, a transition, or the
 *              QUAD composite) into an offscreen buffer, with the VFX
 *              filter applied. Skipped while FREEZE holds the last frame.
 *   2. composite — blit the base to the visible canvas, then overlay black
 *              at the OUTPUT FADE amount.
 *
 * Channel canvases are WebGL surfaces; drawImage reads them into 2D (the
 * same pattern visualize's compositor uses).
 */

import { vfxFilter } from './vfx.js'
import { curveFn } from './curves.js'

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
        this._curve = 'dipped' // easing for dissolve / wipe / fade

        this._base = document.createElement('canvas')
        this._base.width = width
        this._base.height = height
        this._baseCtx = this._base.getContext('2d')
    }

    setChannels(channels) { this._channels = channels }

    /** Easing curve for dissolves / wipes / fades (linear|dipped|sharp|cut). */
    setCurve(name) { this._curve = name }

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

        ctx.filter = vfxFilter(output.vfx || 'none')
        if (output.quad) this._drawQuad(ctx)
        else this._drawScene(ctx, pres, type)
        ctx.filter = 'none'
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
            this._blit(ctx, plan.to, 0, 0, w, h)
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
        const hw = this.width / 2
        const hh = this.height / 2
        this._blit(ctx, 1, 0, 0, hw, hh)
        this._blit(ctx, 2, hw, 0, hw, hh)
        this._blit(ctx, 3, 0, hh, hw, hh)
        this._blit(ctx, 4, hw, hh, hw, hh)
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
        ctx.filter = 'none'
        ctx.clearRect(0, 0, w, h)
        ctx.drawImage(this._base, 0, 0)

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
    }
}
