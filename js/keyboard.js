// SPDX-License-Identifier: MIT
/**
 * Keyboard shortcuts.
 *
 *   1–4  take that channel    c  CUT    d  MIX (dissolve)   w  WIPE
 *   q  QUAD   p  PinP   k  KEY   f  FREEZE   b  FADE   r  REC   a  AUTO   s  Settings
 *
 * keyToAction is a pure lookup; attachKeyboard wires it to the document
 * and stays out of the way of text fields, keys a focused control already
 * consumed, and suspended states (an open overlay panel).
 */
const TRANSITION_KEYS = { c: 'cut', d: 'mix', w: 'wipe' }
const TOGGLE_KEYS = { q: 'quad', p: 'pinp', k: 'key', f: 'freeze', b: 'fade', r: 'record', a: 'auto', s: 'settings' }

export function keyToAction(key) {
    if (typeof key !== 'string') return null
    if (/^[1-4]$/.test(key)) return { type: 'take', channel: Number(key) }
    const k = key.toLowerCase()
    if (TRANSITION_KEYS[k]) return { type: 'transitionType', value: TRANSITION_KEYS[k] }
    if (TOGGLE_KEYS[k]) return { type: TOGGLE_KEYS[k] }
    return null
}

/**
 * Wire keyboard shortcuts to the document. Returns a teardown function.
 *
 * Options:
 *   isSuspended  — predicate consulted before every dispatch; while it
 *                  returns true (e.g. an overlay panel is open) the global
 *                  single-key shortcuts are suspended.
 *
 * The handler also stays out of the way of focused composed controls: a
 * keydown the focused control already consumed (defaultPrevented, e.g. the
 * select-dropdown trigger's type-ahead) never dispatches a global action.
 */
export function attachKeyboard(handlers, target = document, { isSuspended } = {}) {
    const onKeyDown = (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return
        // OS key repeat must not retrigger the shortcuts: holding a toggle
        // (FREEZE / FADE / REC / AUTO / …) would otherwise flip it on and off
        // at the repeat rate instead of latching like a hardware button.
        if (e.repeat) return
        if (e.defaultPrevented) return
        const el = e.target
        const tag = el?.tagName
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el?.isContentEditable) return
        if (isSuspended?.()) return
        const action = keyToAction(e.key)
        if (!action) return
        e.preventDefault()
        handlers[action.type]?.(action)
    }
    target.addEventListener('keydown', onKeyDown)
    return () => target.removeEventListener('keydown', onKeyDown)
}
