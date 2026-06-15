// SPDX-License-Identifier: MIT
/**
 * Transition blend modes — how the incoming channel is composited over the
 * outgoing one during a MIX. "mix" is the normal alpha cross-dissolve; the
 * others are GPU-accelerated canvas blends (lighter/screen/multiply) for
 * richer transitions. Pure lookup; the ProgramCompositor applies it.
 */
export const BLEND_MODES = ['mix', 'add', 'screen', 'multiply']

export const BLEND_LABELS = {
    mix: 'Mix', add: 'Add', screen: 'Screen', multiply: 'Multiply',
}

const COMPOSITE = {
    mix: 'source-over',
    add: 'lighter',
    screen: 'screen',
    multiply: 'multiply',
}

export function blendComposite(mode) {
    return COMPOSITE[mode] || 'source-over'
}
