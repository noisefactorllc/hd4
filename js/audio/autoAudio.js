// SPDX-License-Identifier: MIT
/**
 * Auto-audio decision logic (pure) for the auto-audio modes.
 *
 *  - autoMixGains: AUTO MIXING gain sharing. Each enabled channel's gain is
 *    its weighted level relative to the loudest enabled channel, so the
 *    loudest sits at unity and quieter ones duck. Disabled channels and the
 *    all-silent case pass through at unity.
 *  - pickLoudest: VIDEO FOLLOWS AUDIO target — the loudest included input
 *    above the sense threshold (1-based), or null.
 *
 * Audio-follows-video is a trivial live/not-live gate applied in the mixer.
 */

export function autoMixGains(levels, weights = [], enabled = []) {
    const weighted = levels.map((l, i) => (enabled[i] ? Math.max(0, l) * (weights[i] ?? 100) : 0))
    const max = weighted.reduce((m, v) => Math.max(m, v), 0)
    return levels.map((_, i) => {
        if (!enabled[i]) return 1
        if (max <= 1e-9) return 1
        return weighted[i] / max
    })
}

export function pickLoudest(levels, included = [], threshold = 0) {
    let best = -1
    let bestLevel = threshold
    for (let i = 0; i < levels.length; i++) {
        if (included[i] && levels[i] > bestLevel) { bestLevel = levels[i]; best = i }
    }
    return best >= 0 ? best + 1 : null
}
