// SPDX-License-Identifier: MIT
/**
 * MIDI panel — enable Web MIDI and MIDI-learn mixer controls. Each target
 * (an action or a fader) shows its bound control and a Learn / Clear pair;
 * arming Learn binds the next incoming message. Reuses the editor overlay
 * styling.
 */
import { MIDI_TARGETS } from '../midi.js'
import { registerEscapeable, unregisterEscapeable } from 'handfish'

export function buildMidiPanel(container, { onEnable, onLearn, onClear } = {}) {
    const rows = new Map() // target id → { sigEl, learnBtn }
    let armed = null

    const overlay = el('div', 'hd4-stripedit-overlay hd4-stripedit-overlay--midi')
    overlay.dataset.open = 'false'
    const panel = el('div', 'hd4-stripedit-panel')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'MIDI control')

    const header = el('div', 'hd4-stripedit-header')
    const title = el('h2', 'hd4-stripedit-title')
    title.textContent = 'MIDI control'
    const close = document.createElement('button')
    close.type = 'button'; close.className = 'hd4-stripedit-close'; close.textContent = '✕'
    close.setAttribute('aria-label', 'Close MIDI control')
    close.addEventListener('click', () => hide())
    header.append(title, close)

    const enableRow = el('div', 'hd4-midi-enable')
    const enableBtn = document.createElement('button')
    enableBtn.type = 'button'; enableBtn.className = 'hd4-comp-btn'; enableBtn.textContent = 'Enable MIDI'
    enableBtn.addEventListener('click', () => onEnable?.())
    const status = el('span', 'hd4-midi-status'); status.textContent = 'off'
    enableRow.append(enableBtn, status)

    const body = el('div', 'hd4-stripedit-body')
    const list = el('div', 'hd4-se-group')
    for (const t of MIDI_TARGETS) {
        const row = el('div', 'hd4-midi-row')
        const lab = el('span', 'hd4-midi-label'); lab.textContent = t.label
        const sig = el('span', 'hd4-midi-sig'); sig.textContent = '—'
        const learn = document.createElement('button')
        learn.type = 'button'; learn.className = 'hd4-midi-learn'; learn.textContent = 'Learn'
        learn.dataset.target = t.id
        learn.addEventListener('click', () => onLearn?.(t))
        const clr = document.createElement('button')
        clr.type = 'button'; clr.className = 'hd4-midi-clear'; clr.textContent = '✕'
        clr.title = 'Clear binding'
        clr.addEventListener('click', () => onClear?.(t))
        row.append(lab, sig, learn, clr)
        list.appendChild(row)
        rows.set(t.id, { sigEl: sig, learnBtn: learn })
    }
    body.append(enableRow, list)

    panel.append(header, body)
    overlay.appendChild(panel)
    overlay.addEventListener('click', (e) => { if (e.target === overlay) hide() })
    container.appendChild(overlay)

    function hide() {
        overlay.dataset.open = 'false'
        unregisterEscapeable(overlay)
    }

    return {
        // Register on the handfish escape stack (topmost close on Escape).
        open() { overlay.dataset.open = 'true'; registerEscapeable(overlay, hide) },
        close: hide,
        get isOpen() { return overlay.dataset.open === 'true' },
        setStatus(s) { status.textContent = s },
        setLearning(target) {
            armed = target?.id ?? null
            for (const [id, r] of rows) r.learnBtn.classList.toggle('is-armed', id === armed)
        },
        /** Reflect current bindings: list = [{signature, target}]. */
        refresh(bindings = []) {
            const byTarget = new Map()
            for (const { signature, target } of bindings) if (target?.id) byTarget.set(target.id, signature)
            for (const [id, r] of rows) r.sigEl.textContent = byTarget.get(id) || '—'
        },
    }
}

function el(tag, className) {
    const e = document.createElement(tag)
    if (className) e.className = className
    return e
}
