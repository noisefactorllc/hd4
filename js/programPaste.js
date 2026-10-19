// SPDX-License-Identifier: MIT
/**
 * Program paste — a Noisemaker DSL program from the clipboard becomes a
 * channel's shader source.
 *
 * pastedSource turns clipboard text into that source, or says why it can't.
 * Its syntax check is the engine's DSL compiler, injected as `parse`: it
 * throws on text that is not a program, while a valid program whose effects
 * are not loaded yet only collects diagnostics, so those are left to the
 * channel's own compile. Text that fails here never touches the channel.
 *
 * attachProgramPaste wires the document's paste event (Cmd/Ctrl+V) and stays
 * out of the way of text fields and suspended states (an open overlay
 * panel), like attachKeyboard.
 */
import { createSource } from './sources/sourceModel.js'
import { presetByDsl } from './sources/presets.js'

/** The name a pasted program goes by, unless it is a library entry. */
export const CUSTOM_PROGRAM_NAME = 'Custom'

/** Input types that take typed text, and so a paste of their own. */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number'])

/**
 * Clipboard text → { source } for a shader program, or
 * { error: 'empty' | 'invalid', message? } when it is not one.
 */
export function pastedSource(text, parse) {
    const dsl = typeof text === 'string' ? text.trim() : ''
    if (!dsl) return { error: 'empty' }
    try {
        parse(dsl)
    } catch (e) {
        return { error: 'invalid', message: e?.message || String(e) }
    }
    const preset = presetByDsl(dsl)
    return { source: createSource('shader', { dsl, name: preset ? preset.name : CUSTOM_PROGRAM_NAME }) }
}

/** Does this element take a paste of its own (a text field)? */
export function isTextEntry(el) {
    if (!el) return false
    if (el.isContentEditable || el.tagName === 'TEXTAREA') return true
    return el.tagName === 'INPUT' && TEXT_INPUT_TYPES.has(String(el.type || 'text').toLowerCase())
}

/**
 * Wire the paste event to onPaste(text). Returns a teardown function.
 *
 * The paste is left alone when a focused control already consumed it
 * (defaultPrevented), when it lands in a text field (read through the
 * composed path, so a field inside a component's shadow root counts), or
 * while isSuspended() returns true.
 */
export function attachProgramPaste(onPaste, target = document, { isSuspended } = {}) {
    const onPasteEvent = (e) => {
        if (e.defaultPrevented) return
        const el = e.composedPath?.()[0] || e.target
        if (isTextEntry(el)) return
        if (isSuspended?.()) return
        e.preventDefault()
        onPaste(e.clipboardData?.getData('text/plain') || '')
    }
    target.addEventListener('paste', onPasteEvent)
    return () => target.removeEventListener('paste', onPasteEvent)
}
