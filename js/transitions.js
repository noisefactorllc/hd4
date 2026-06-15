// SPDX-License-Identifier: MIT
/**
 * Transition descriptors — how each transition type renders.
 *
 * Each entry names the Noisemaker mixer effect, the parameter the
 * switcher's mix drives, and the formula mapping mix∈[0,1] (from→to) into
 * that parameter's native range. Extra static params live in `defaults`.
 * Mirrors visualize's mixers.js. CUT has no entry — the switcher snaps,
 * so no GPU blend ever runs for a cut.
 *
 *   mix  → mixer/blendMode (mode "mix"): mixAmt −100 = pure from, +100 = to
 *   wipe → mixer/split: position +1 = all from, −1 = all to (boundary sweep)
 */
export const TRANSITIONS = {
    mix: {
        id: 'mixer/blendMode',
        effect: 'blendMode',
        driver: 'mix',
        driverFormula: (x) => x * 200 - 100,
        defaults: { mode: 'mix' },
    },
    wipe: {
        id: 'mixer/split',
        effect: 'split',
        driver: 'position',
        driverFormula: (x) => 1 - x * 2,
        defaults: { softness: 0.05, rotation: 0 },
    },
}

export function getTransition(type) {
    return TRANSITIONS[type] || TRANSITIONS.mix
}

/**
 * Build the inner-arg string for a transition's mixer call: the second
 * input (deck/channel B = `to`), the driver value for the current mix,
 * then the static defaults. Same serialization as visualize's buildDslArgs.
 */
export function buildTransitionArgs(transition, mix, overrides = {}) {
    const args = ['tex: read(o1)']

    const driverArg = formatDslArg(transition.driver, transition.driverFormula(mix))
    if (driverArg) args.push(driverArg)

    const merged = { ...transition.defaults, ...overrides }
    for (const [name, value] of Object.entries(merged)) {
        if (name === transition.driver) continue
        const arg = formatDslArg(name, value)
        if (arg) args.push(arg)
    }
    return args.join(', ')
}

function formatDslArg(name, value) {
    if (value === null || value === undefined) return null
    if (typeof value === 'string') return `${name}: ${value}`
    if (typeof value === 'number') {
        return `${name}: ${Number.isInteger(value) ? value : Number(value.toFixed(4))}`
    }
    if (typeof value === 'boolean') return `${name}: ${value ? 'on' : 'off'}`
    return null
}
