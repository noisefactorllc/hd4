// SPDX-License-Identifier: MIT
/**
 * Keyer — KEY compositing math (chroma + luminance).
 *
 * A pixel's alpha is decided by a "keyness" m (how strongly it matches the
 * key) compared against a threshold T set by LEVEL, with a soft transition
 * band whose half-width is set by GAIN:
 *
 *   alpha = clamp((T + band - m) / (2*band), 0, 1)
 *
 * Foreground (low keyness) stays opaque; the key colour (high keyness) is
 * cut to transparent. Raising LEVEL lowers T (extracts more); raising GAIN
 * widens the band (softer edge). Chroma keyness is the key channel's lead
 * over the brighter of the other two; luminance keyness is brightness (or
 * its inverse for a black key).
 */

export const KEY_TYPES = ['chroma', 'luma']
export const CHROMA_COLORS = ['green', 'blue']
export const LUMA_COLORS = ['white', 'black']

export const KEY_DEFAULTS = {
    on: false,
    type: 'chroma',
    sourceCh: 0, // 0 = OFF; 1..4 = channel; 5 = STILL
    level: 64,
    gain: 16,
    chromaColor: 'green',
    lumaColor: 'white',
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** Soft-threshold response: foreground (low keyness) opaque, key colour cut. */
function alphaFromKeyness(m, threshold, band) {
    return Math.round(clamp((threshold + band - m) / (2 * band), 0, 1) * 255)
}

/** The configuration constants (threshold + band) for a key config. */
function keyConstants(cfg) {
    const level = cfg.level ?? KEY_DEFAULTS.level
    const gain = cfg.gain ?? KEY_DEFAULTS.gain
    const band = Math.max(1, (gain / 255) * 96)
    const luma = cfg.type === 'luma'
    return {
        band,
        luma,
        blue: cfg.chromaColor === 'blue',
        black: cfg.lumaColor === 'black',
        threshold: luma ? 220 - (level / 255) * 180 : 120 - (level / 255) * 160,
    }
}

/** Keyness m for one pixel given the (precomputed) config flags. */
function keyness(r, g, b, k) {
    if (k.luma) {
        const y = 0.299 * r + 0.587 * g + 0.114 * b
        return k.black ? 255 - y : y
    }
    return k.blue ? b - Math.max(r, g) : g - Math.max(r, b)
}

/** Opacity 0..255 for one pixel under the key configuration. */
export function keyAlpha(r, g, b, cfg = KEY_DEFAULTS) {
    const k = keyConstants(cfg)
    return alphaFromKeyness(keyness(r, g, b, k), k.threshold, k.band)
}

/**
 * Apply the key over an ImageData-shaped buffer in place (sets the A byte).
 * The config constants are computed once and the inner loop only does the
 * per-pixel keyness — this runs over ~1M pixels per frame, so the hoist
 * matters.
 */
export function applyKey(imageData, cfg = KEY_DEFAULTS) {
    const d = imageData.data
    const k = keyConstants(cfg)
    const { threshold, band } = k
    for (let i = 0; i < d.length; i += 4) {
        d[i + 3] = alphaFromKeyness(keyness(d[i], d[i + 1], d[i + 2], k), threshold, band)
    }
    return imageData
}
