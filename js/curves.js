// SPDX-License-Identifier: MIT
/**
 * Fade curves — easing for MIX dissolves, WIPEs, and OUTPUT FADE. Matches
 * visualize's FADE_CURVES. Pure functions over [0,1] → [0,1].
 */
export const CURVES = {
    linear: (x) => x,
    dipped: (x) => 0.5 - 0.5 * Math.cos(x * Math.PI),
    sharp: (x) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x)),
    cut: (x) => (x < 1 ? 0 : 1),
}

export const CURVE_ORDER = ['linear', 'dipped', 'sharp', 'cut']

export function curveFn(name) {
    return CURVES[name] || CURVES.linear
}
