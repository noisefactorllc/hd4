// SPDX-License-Identifier: MIT
/**
 * ProgramCompositor — owns the 2D program (main output) canvas.
 *
 * Each frame it draws from the switcher's presentation: a single live
 * channel when idle, or a cross-dissolve / wipe between the outgoing and
 * incoming channels during a take. Channel canvases are WebGL surfaces;
 * drawImage reads them into this 2D context (the same pattern visualize's
 * compositor uses). This is also the natural home for the later output
 * stages — QUAD, FREEZE, OUTPUT FADE, VFX.
 */

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
    }

    setChannels(channels) { this._channels = channels }

    /** Render one program frame from the switcher presentation + type. */
    draw(pres, type) {
        const ctx = this.ctx
        const w = this.width
        const h = this.height
        ctx.globalAlpha = 1
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, w, h)

        const plan = transitionPlan(pres, type)
        if (plan.kind === 'single') {
            this._drawChannel(plan.channel)
        } else if (plan.kind === 'dissolve') {
            this._drawChannel(plan.from)
            ctx.globalAlpha = plan.mix
            this._drawChannel(plan.to)
            ctx.globalAlpha = 1
        } else if (plan.kind === 'wipe') {
            this._drawChannel(plan.from)
            const x = Math.round(w * plan.mix)
            if (x > 0) {
                ctx.save()
                ctx.beginPath()
                ctx.rect(0, 0, x, h)
                ctx.clip()
                this._drawChannel(plan.to)
                ctx.restore()
            }
        }
    }

    _drawChannel(channelNumber) {
        const ch = this._channels[channelNumber - 1]
        const c = ch?.canvas
        if (c && c.width > 0 && c.height > 0) {
            this.ctx.drawImage(c, 0, 0, this.width, this.height)
        }
    }

    resize(width, height) {
        this.width = width
        this.height = height
        this.canvas.width = width
        this.canvas.height = height
    }
}
