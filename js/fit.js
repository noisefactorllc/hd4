// SPDX-License-Identifier: MIT
/**
 * Media fit math — place a source of dimensions (sw, sh) into a frame of
 * (dw, dh), preserving aspect ratio. Two modes (SCALING TYPE):
 *   'cover'   — zoom/crop: fill the frame, crop the overflow
 *   'contain' — scale: fit the whole source, letterbox the remainder
 * Returns the destination rect { x, y, w, h } to drawImage into.
 */
export function computeFit(mode, sw, sh, dw, dh) {
    const ratios = [dw / sw, dh / sh]
    const scale = mode === 'contain' ? Math.min(...ratios) : Math.max(...ratios)
    const w = sw * scale
    const h = sh * scale
    return { x: (dw - w) / 2, y: (dh - h) / 2, w, h }
}
