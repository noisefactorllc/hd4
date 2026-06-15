// SPDX-License-Identifier: MIT
/**
 * CompositorState — the composition section.
 *
 * Holds one mutually-exclusive COMPOSITION TYPE (OFF / PinP / SPLIT / QUAD)
 * and an independent KEY overlay, with every parameter validated against its
 * legal range. The ProgramCompositor reads snapshot() each frame; memory
 * save/recall round-trips the same shape. Pure (no DOM, no clock).
 */
import { PINP_SIZES, PINP_SHAPES, PINP_ASPECTS, BORDER_COLORS, SPLIT_PATTERNS } from './compositing.js'
import { KEY_DEFAULTS, KEY_TYPES, CHROMA_COLORS, LUMA_COLORS } from './key.js'

export const COMPOSITION_MODES = ['off', 'pinp', 'split', 'quad']

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v)))
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback)

export class CompositorState {
    constructor({ channelCount = 4 } = {}) {
        this.channelCount = channelCount
        this.composition = 'off'
        this.pinp = {
            source: 2,
            size: '1/4',
            hPosition: 32,
            vPosition: 32,
            aspect: '16:9',
            shape: 'square',
            borderWidth: 3,
            borderColor: 'white',
            hCropping: 100,
            vCropping: 100,
            hViewPosition: 0,
            vViewPosition: 0,
        }
        this.split = { sourceB: 2, pattern: 'v-center', aCenter: 50, bCenter: 50, centerPosition: 0 }
        this.key = { ...KEY_DEFAULTS }
    }

    setComposition(mode) {
        if (COMPOSITION_MODES.includes(mode)) this.composition = mode
        return this.composition
    }

    /** Press a composition button: turn it on, or off if it is already on. */
    toggleComposition(mode) {
        if (!COMPOSITION_MODES.includes(mode) || mode === 'off') return this.composition
        this.composition = this.composition === mode ? 'off' : mode
        return this.composition
    }

    setPinp(partial = {}) {
        const p = this.pinp
        if ('source' in partial) p.source = clamp(partial.source, 1, this.channelCount)
        if ('size' in partial) p.size = oneOf(partial.size, Object.keys(PINP_SIZES), p.size)
        if ('aspect' in partial) p.aspect = oneOf(partial.aspect, PINP_ASPECTS, p.aspect)
        if ('shape' in partial) p.shape = oneOf(partial.shape, PINP_SHAPES, p.shape)
        if ('borderColor' in partial) p.borderColor = oneOf(partial.borderColor, Object.keys(BORDER_COLORS), p.borderColor)
        if ('borderWidth' in partial) p.borderWidth = Math.round(clamp(partial.borderWidth, 0, 15))
        if ('hPosition' in partial) p.hPosition = clamp(partial.hPosition, -50, 50)
        if ('vPosition' in partial) p.vPosition = clamp(partial.vPosition, -50, 50)
        if ('hCropping' in partial) p.hCropping = clamp(partial.hCropping, 1, 100)
        if ('vCropping' in partial) p.vCropping = clamp(partial.vCropping, 1, 100)
        if ('hViewPosition' in partial) p.hViewPosition = clamp(partial.hViewPosition, -50, 50)
        if ('vViewPosition' in partial) p.vViewPosition = clamp(partial.vViewPosition, -50, 50)
        return p
    }

    setSplit(partial = {}) {
        const s = this.split
        if ('sourceB' in partial) s.sourceB = clamp(partial.sourceB, 1, this.channelCount)
        if ('pattern' in partial) s.pattern = oneOf(partial.pattern, SPLIT_PATTERNS, s.pattern)
        if ('aCenter' in partial) s.aCenter = clamp(partial.aCenter, 0, 100)
        if ('bCenter' in partial) s.bCenter = clamp(partial.bCenter, 0, 100)
        if ('centerPosition' in partial) s.centerPosition = clamp(partial.centerPosition, -50, 50)
        return s
    }

    setKey(partial = {}) {
        const k = this.key
        if ('on' in partial) k.on = !!partial.on
        if ('type' in partial) k.type = oneOf(partial.type, KEY_TYPES, k.type)
        if ('sourceCh' in partial) k.sourceCh = Math.round(clamp(partial.sourceCh, 0, 5)) // 0=off..4, 5=STILL
        if ('level' in partial) k.level = Math.round(clamp(partial.level, 0, 255))
        if ('gain' in partial) k.gain = Math.round(clamp(partial.gain, 0, 255))
        if ('chromaColor' in partial) k.chromaColor = oneOf(partial.chromaColor, CHROMA_COLORS, k.chromaColor)
        if ('lumaColor' in partial) k.lumaColor = oneOf(partial.lumaColor, LUMA_COLORS, k.lumaColor)
        return k
    }

    toggleKey() {
        this.key.on = !this.key.on
        // Arming with no source selected would draw nothing; pick CH1 so the
        // KEY toggle (button / k-key) is visibly meaningful.
        if (this.key.on && !this.key.sourceCh) this.key.sourceCh = 1
        return this.key.on
    }

    /** An independent plain-object copy for the compositor / memory. */
    snapshot() {
        return {
            composition: this.composition,
            pinp: { ...this.pinp },
            split: { ...this.split },
            key: { ...this.key },
        }
    }

    /** Restore from a snapshot (memory recall). Tolerant of partial data. */
    restore(snap = {}) {
        if (snap.composition) this.setComposition(snap.composition)
        if (snap.pinp) this.setPinp(snap.pinp)
        if (snap.split) this.setSplit(snap.split)
        if (snap.key) this.setKey(snap.key)
    }
}
