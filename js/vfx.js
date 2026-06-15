// SPDX-License-Identifier: MIT
/**
 * VFX registry — output filter effects ([VFX]), expressed as canvas-
 * filter strings the program compositor applies to the composited frame.
 * The simple effects are CSS filter functions; the richer ones (posterize,
 * emboss, find-edges) reference inline SVG filter defs (see index.html).
 * All are GPU-accelerated by the browser and rock-solid.
 */
export const VFX = {
    none: { label: 'None', filter: 'none' },
    negative: { label: 'Negative', filter: 'invert(1)' },
    mono: { label: 'Mono', filter: 'grayscale(1)' },
    sepia: { label: 'Sepia', filter: 'sepia(1)' },
    posterize: { label: 'Posterize', filter: 'url(#hd4-vfx-posterize)' },
    emboss: { label: 'Emboss', filter: 'url(#hd4-vfx-emboss)' },
    edges: { label: 'Find edges', filter: 'url(#hd4-vfx-edge)' },
}

export const VFX_ORDER = ['none', 'negative', 'mono', 'sepia', 'posterize', 'emboss', 'edges']

export function vfxFilter(name) {
    return (VFX[name] || VFX.none).filter
}
