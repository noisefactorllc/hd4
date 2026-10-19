// SPDX-License-Identifier: MIT
/**
 * Program paste — a Noisemaker DSL program from the clipboard becomes a
 * channel's shader source.
 *
 * pastedSource turns clipboard text into that source, or says why it can't.
 * Its syntax check is the engine's DSL compiler, injected as `parse`: it
 * throws on text that is not a program, while a valid program whose effects
 * are not loaded yet only collects diagnostics, so those wait for the
 * channel renderer's check, which loads the effects first.
 *
 * createProgramPaste is the whole flow for one channel: the syntax check,
 * then the renderer's check, then the source swap. A program that fails
 * either check never touches the channel, so a live camera or clip keeps
 * running. Each outcome is reported for the readout.
 *
 * attachProgramPaste wires the paste event (Cmd/Ctrl+V) and stays out of
 * the way of text fields and suspended states (an open overlay panel), like
 * attachKeyboard.
 */
import { createSource } from './sources/sourceModel.js'
import { presetByDsl } from './sources/presets.js'

/** The name a pasted program goes by, unless it is a library entry. */
export const CUSTOM_PROGRAM_NAME = 'Custom'

/**
 * The longest clipboard text taken as a program. Programs run to a few
 * kilobytes; a pasted one is saved with memory slots, so anything far
 * larger is refused before it is parsed.
 */
export const MAX_PROGRAM_LENGTH = 64 * 1024

/** Readout values for clipboard text that is not a program. */
const PASTE_ERRORS = { empty: 'EMPTY', invalid: 'INVALID', large: 'TOO BIG' }

/** Input types that take typed text, and so a paste of their own. */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number'])

/**
 * Clipboard text → { source } for a shader program, or
 * { error: 'empty' | 'large' | 'invalid', message? } when it is not one.
 */
export function pastedSource(text, parse) {
    const dsl = typeof text === 'string' ? text.trim() : ''
    if (!dsl) return { error: 'empty' }
    if (dsl.length > MAX_PROGRAM_LENGTH) return { error: 'large' }
    try {
        parse(dsl)
    } catch (e) {
        return { error: 'invalid', message: e?.message || String(e) }
    }
    const preset = presetByDsl(dsl)
    return { source: createSource('shader', { dsl, name: preset ? preset.name : CUSTOM_PROGRAM_NAME }) }
}

/**
 * The paste flow, bound to the app's channels and their renderers.
 * report(value) shows the outcome on the readout (CH n, EMPTY, INVALID,
 * TOO BIG, FAILED, DENIED); refresh() re-syncs the pickers.
 *
 * A choice made on the channel while a paste waits (its effects can take
 * seconds to download) owns the channel, and so does a newer paste: the
 * older paste then gives up quietly.
 */
export function createProgramPaste({ channels, renderers, parse, report, refresh, clipboard }) {
    const latest = [] // per channel: the newest paste's number

    async function paste(index, text) {
        const channel = channels[index]
        const token = latest[index] = (latest[index] || 0) + 1
        const before = channel.source
        const overtaken = () => token !== latest[index] || channel.source !== before
        const pasted = pastedSource(text, parse)
        if (pasted.error) {
            if (pasted.message) console.warn('[hd4] the clipboard holds no program:', pasted.message)
            report(PASTE_ERRORS[pasted.error])
            refresh()
            return
        }
        let problem
        try {
            problem = await renderers[index].check(pasted.source.dsl)
        } catch (e) {
            if (overtaken()) return
            console.warn(`[hd4] the pasted program's effects did not load`, e?.message || e)
            report('FAILED')
            refresh()
            return
        }
        if (overtaken()) return
        if (problem) {
            console.warn(`[hd4] channel ${index + 1} pasted program does not compile:`, problem)
            report('INVALID')
            refresh()
            return
        }
        try {
            await channel.setSource(pasted.source)
            if (channel.source !== pasted.source) return
            report(`CH ${index + 1}`)
        } catch (e) {
            // The channel fell back to its previous source, unless a newer
            // choice or paste has taken it over since.
            if (overtaken()) return
            console.warn(`[hd4] channel ${index + 1} pasted program was not applied`, e?.message || e)
            report('INVALID')
        }
        refresh()
    }

    async function pasteFromClipboard(index) {
        let text
        try {
            text = await clipboard.readText()
        } catch (e) {
            console.warn('[hd4] the clipboard was not read', e?.message || e)
            report('DENIED')
            refresh()
            return
        }
        await paste(index, text)
    }

    return { paste, pasteFromClipboard }
}

/** Does this element take a paste of its own (a text field)? */
export function isTextEntry(el) {
    if (!el) return false
    if (el.isContentEditable || el.tagName === 'TEXTAREA') return true
    return el.tagName === 'INPUT' && TEXT_INPUT_TYPES.has(String(el.type || 'text').toLowerCase())
}

/**
 * Wire the paste event on target to onPaste(text). Returns a teardown
 * function.
 *
 * The paste is left alone when a focused control already consumed it
 * (defaultPrevented), when it lands in a text field (read through the
 * composed path, so a field inside a component's shadow root counts), or
 * while isSuspended() returns true.
 *
 * With a scope (HD4's root in the rack, which shares the page with other
 * modules), only pastes meant for HD4 are taken: those aimed inside the
 * scope, and those made with nothing focused when the last pointer press
 * was inside it, with focus not moved to another module since. A click on
 * a monitor leaves nothing focused, so Cmd/Ctrl+V still works after it.
 * (With nothing focused, Chromium aims the paste at the selection, so the
 * focus decides, not the event's target.)
 */
export function attachProgramPaste(onPaste, target = document, { isSuspended, scope = null } = {}) {
    let pressedInside = false
    const onPointerDown = (e) => { pressedInside = !!scope?.contains(e.target) }
    const onFocusIn = (e) => { if (!scope?.contains(e.target)) pressedInside = false }
    const nothingFocused = () => !target.activeElement || target.activeElement === target.body
    const inScope = (el) => !scope || scope.contains(el) || (pressedInside && nothingFocused())
    const onPasteEvent = (e) => {
        if (e.defaultPrevented) return
        const el = e.composedPath?.()[0] || e.target
        if (isTextEntry(el)) return
        if (!inScope(e.target)) return
        if (isSuspended?.()) return
        e.preventDefault()
        onPaste(e.clipboardData?.getData('text/plain') || '')
    }
    target.addEventListener('paste', onPasteEvent)
    if (scope) {
        target.addEventListener('pointerdown', onPointerDown, true)
        target.addEventListener('focusin', onFocusIn, true)
    }
    return () => {
        target.removeEventListener('paste', onPasteEvent)
        if (scope) {
            target.removeEventListener('pointerdown', onPointerDown, true)
            target.removeEventListener('focusin', onFocusIn, true)
        }
    }
}
