// SPDX-License-Identifier: MIT
/**
 * VFX registry — output filter effects ([VFX]), expressed as CSS
 * canvas-filter strings the program compositor applies to the composited
 * frame. Cheap, GPU-accelerated by the browser, and rock-solid. Richer
 * effects (posterize, emboss, find-edges) that need pixel ops or a GPU
 * pass are a later enhancement.
 */
export const VFX = {
    none: { label: 'None', filter: 'none' },
    negative: { label: 'Negative', filter: 'invert(1)' },
    mono: { label: 'Mono', filter: 'grayscale(1)' },
    sepia: { label: 'Sepia', filter: 'sepia(1)' },
}

export const VFX_ORDER = ['none', 'negative', 'mono', 'sepia']

export function vfxFilter(name) {
    return (VFX[name] || VFX.none).filter
}
