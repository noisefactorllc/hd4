// SPDX-License-Identifier: MIT
/**
 * Source model — the pure, DOM-free description of what a channel shows.
 *
 * A descriptor is plain serializable data. It never holds runtime
 * handles (MediaStream, File, <video>, renderer) — those live in the
 * driver that consumes the descriptor. That separation is what keeps
 * this module unit-testable with no browser.
 *
 * Types:
 *   none    — nothing
 *   camera  — live camera; deviceId persists across sessions
 *   video   — a video file; only its name persists (the File can't)
 *   image   — an image file; only its name persists
 *   shader  — a Noisemaker DSL program; the DSL persists in full
 */

export const EMPTY_SOURCE = Object.freeze({ type: 'none' })

const MEDIA_TYPES = new Set(['camera', 'video', 'image'])

/** Construct a normalized source descriptor. Throws on unknown types. */
export function createSource(type, params = {}) {
    switch (type) {
        case 'none':
            return { type: 'none' }
        case 'camera':
            return { type: 'camera', deviceId: params.deviceId || '' }
        case 'video':
            return { type: 'video', name: params.name || '' }
        case 'image':
            return { type: 'image', name: params.name || '' }
        case 'shader':
            return { type: 'shader', dsl: params.dsl || '', name: params.name || '' }
        default:
            throw new Error(`unknown source type: ${type}`)
    }
}

/** Classify a source as 'empty' | 'media' | 'shader'. */
export function sourceKind(source) {
    if (!source || source.type === 'none') return 'empty'
    if (source.type === 'shader') return 'shader'
    if (MEDIA_TYPES.has(source.type)) return 'media'
    return 'empty'
}

/** Human-facing label for a source. */
export function sourceLabel(source) {
    if (!source) return '—'
    switch (source.type) {
        case 'camera': return 'Camera'
        case 'video': return source.name || 'Video'
        case 'image': return source.name || 'Image'
        case 'shader': return source.name || 'Shader'
        default: return '—'
    }
}

/** Reduce a descriptor to only the fields worth persisting. */
export function serializeSource(source) {
    switch (source?.type) {
        case 'camera': return { type: 'camera', deviceId: source.deviceId || '' }
        case 'video': return { type: 'video', name: source.name || '' }
        case 'image': return { type: 'image', name: source.name || '' }
        case 'shader': return { type: 'shader', dsl: source.dsl || '', name: source.name || '' }
        default: return { type: 'none' }
    }
}

/** Rebuild a descriptor from persisted data. Lenient: bad/corrupt
 *  input (including a shader with no DSL) collapses to EMPTY_SOURCE. */
export function deserializeSource(obj) {
    if (!obj || typeof obj !== 'object') return EMPTY_SOURCE
    try {
        switch (obj.type) {
            case 'camera': return createSource('camera', { deviceId: obj.deviceId })
            case 'video': return createSource('video', { name: obj.name })
            case 'image': return createSource('image', { name: obj.name })
            case 'shader':
                if (!obj.dsl) return EMPTY_SOURCE
                return createSource('shader', { dsl: obj.dsl, name: obj.name })
            default: return EMPTY_SOURCE
        }
    } catch {
        return EMPTY_SOURCE
    }
}
