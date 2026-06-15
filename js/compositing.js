// SPDX-License-Identifier: MIT
/**
 * Composition geometry — pure layout math for the composite effects:
 *   PinP   — an inset screen over the background (size / position / aspect)
 *            plus a source crop (zoom into the inset content).
 *   SPLIT  — two channels side-by-side (V) or stacked (H), each either
 *            stretched to fill its half or aspect-kept and panned (CENTER).
 *   QUAD   — the four channels in a 2x2 grid.
 *
 * Positions follow a uniform convention: -50 = left/top edge, 0 = centre,
 * +50 = right/bottom edge. Source AR is taken as the program AR (channels
 * and output are both 16:9). The canvas draws (shape clipping, borders,
 * key compositing) live in the ProgramCompositor; this is just arithmetic.
 */

/** Inset width as a fraction of the background width (PinP SIZE). */
export const PINP_SIZES = { '1/2': 0.5, '1/3': 1 / 3, '1/4': 0.25 }

export const PINP_SHAPES = ['square', 'diamond', 'circle', 'heart']
export const PINP_ASPECTS = ['16:9', '1:1']

/** PinP BORDER COLOR palette. */
export const BORDER_COLORS = {
    black: '#000000',
    white: '#ffffff',
    gray: '#808080',
    red: '#e02424',
    green: '#22a522',
    blue: '#2563eb',
    yellow: '#e6c01f',
}

export const SPLIT_PATTERNS = ['v-center', 'h-center', 'v-stretch', 'h-stretch']

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
/** Map a -50..+50 control to a 0..1 fraction (-50 → 0, 0 → 0.5, +50 → 1). */
const fromCentered = (v) => clamp((Number(v) + 50) / 100, 0, 1)

/**
 * The inset rectangle for PinP, in output pixels.
 * @param size '1/2' | '1/3' | '1/4'  hPosition/vPosition -50..50  aspect '16:9'|'1:1'
 */
export function pinpInsetRect({ size = '1/4', hPosition = 0, vPosition = 0, aspect = '16:9' } = {}, outW, outH) {
    const frac = PINP_SIZES[size] ?? PINP_SIZES['1/4']
    const w = outW * frac
    const h = aspect === '1:1' ? w : w * (9 / 16)
    const x = fromCentered(hPosition) * (outW - w)
    const y = fromCentered(vPosition) * (outH - h)
    return { x, y, w, h }
}

/**
 * The source sub-rectangle (fractions 0..1) shown inside the inset — a zoom
 * window panned by the view position. cropping 1..100 %, view -50..50.
 */
export function pinpSourceCrop({ hCropping = 100, vCropping = 100, hViewPosition = 0, vViewPosition = 0 } = {}) {
    const sw = clamp(hCropping / 100, 0.01, 1)
    const sh = clamp(vCropping / 100, 0.01, 1)
    return {
        sx: fromCentered(hViewPosition) * (1 - sw),
        sy: fromCentered(vViewPosition) * (1 - sh),
        sw,
        sh,
    }
}

/** Cover-crop a source of the program AR into a dest rect, panned by center 0..100. */
function centerCrop(destW, destH, outW, outH, center) {
    const sourceAR = outW / outH
    const visibleAR = destW / destH
    if (visibleAR < sourceAR) {
        const sw = visibleAR / sourceAR
        return { sx: (center / 100) * (1 - sw), sy: 0, sw, sh: 1 }
    }
    const sh = sourceAR / visibleAR
    return { sx: 0, sy: (center / 100) * (1 - sh), sw: 1, sh }
}

const FULL_CROP = { sx: 0, sy: 0, sw: 1, sh: 1 }

/**
 * Two-region split layout. Returns { divider:'v'|'h', a, b } where each side
 * is { dest:{x,y,w,h}, crop:{sx,sy,sw,sh} }. A is the left/top region, B the
 * right/bottom. CENTER patterns keep source aspect (cropped + panned by
 * A/B-CENTER); STRETCH patterns fill each half. centerPosition (-50..50)
 * moves the boundary for CENTER patterns.
 */
export function splitLayout(pattern = 'v-center', { aCenter = 50, bCenter = 50, centerPosition = 0 } = {}, outW, outH) {
    const vertical = pattern === 'v-center' || pattern === 'v-stretch'
    const stretch = pattern === 'v-stretch' || pattern === 'h-stretch'
    const divider = vertical ? 'v' : 'h'

    // Boundary only moves for CENTER patterns.
    const t = stretch ? 0.5 : clamp(0.5 + centerPosition / 100, 0, 1)

    let aDest
    let bDest
    if (vertical) {
        const bx = Math.round(outW * t)
        aDest = { x: 0, y: 0, w: bx, h: outH }
        bDest = { x: bx, y: 0, w: outW - bx, h: outH }
    } else {
        const by = Math.round(outH * t)
        aDest = { x: 0, y: 0, w: outW, h: by }
        bDest = { x: 0, y: by, w: outW, h: outH - by }
    }

    if (stretch) {
        return { divider, a: { dest: aDest, crop: { ...FULL_CROP } }, b: { dest: bDest, crop: { ...FULL_CROP } } }
    }
    const aCrop = aDest.w > 0 && aDest.h > 0 ? centerCrop(aDest.w, aDest.h, outW, outH, aCenter) : { ...FULL_CROP }
    const bCrop = bDest.w > 0 && bDest.h > 0 ? centerCrop(bDest.w, bDest.h, outW, outH, bCenter) : { ...FULL_CROP }
    return { divider, a: { dest: aDest, crop: aCrop }, b: { dest: bDest, crop: bCrop } }
}

/** The 2x2 QUAD grid (channels 1..4), in output pixels. */
export function quadLayout(outW, outH) {
    const hw = outW / 2
    const hh = outH / 2
    return [
        { channel: 1, x: 0, y: 0, w: hw, h: hh },
        { channel: 2, x: hw, y: 0, w: hw, h: hh },
        { channel: 3, x: 0, y: hh, w: hw, h: hh },
        { channel: 4, x: hw, y: hh, w: hw, h: hh },
    ]
}
