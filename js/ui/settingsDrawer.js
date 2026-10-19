// SPDX-License-Identifier: MIT
/**
 * Settings drawer — a slide-in panel (opened from the topbar gear) with
 * Output (resolution), Output Fade (duration), Beat (SYNC sensitivity),
 * Appearance (theme), and a keyboard reference. Reads initial values from
 * the Settings store; reports changes via callbacks.
 */
import { THEMES } from '../theme.js'
import { RESOLUTIONS } from '../settings.js'
import { registerEscapeable, unregisterEscapeable } from 'handfish'

const SHORTCUTS = [
    ['1–4', 'Take channel'],
    ['c / d / w', 'CUT / MIX / WIPE'],
    ['q', 'QUAD'],
    ['p', 'PinP'],
    ['k', 'KEY overlay'],
    ['f', 'FREEZE'],
    ['b', 'FADE to black'],
    ['r', 'REC (record)'],
    ['a', 'AUTO (beat-synced)'],
    ['s', 'Settings'],
    ['⌘/Ctrl V', 'Paste program to PVW'],
]

export function buildSettingsDrawer(container, settings, { onResolution, onFadeTime, onBeatSensitivity, onTheme } = {}) {
    const overlay = document.createElement('div')
    overlay.className = 'hd4-settings-overlay'
    overlay.dataset.open = 'false'

    const panel = document.createElement('div')
    panel.className = 'hd4-settings-panel'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'Settings')

    const header = document.createElement('div')
    header.className = 'hd4-settings-header'
    const title = document.createElement('h2')
    title.textContent = 'Settings'
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'hd4-settings-close'
    closeBtn.textContent = '✕'
    closeBtn.setAttribute('aria-label', 'Close settings')
    header.append(title, closeBtn)
    panel.appendChild(header)

    // Each row by the setting it shows, so refresh() can re-read the store.
    const rows = {
        resolution: selectRow('hd4-set-resolution', 'Resolution', RESOLUTIONS.map((r) => [r, r]), settings.get('resolution'), (v) => onResolution?.(v)),
        outputFadeTime: rangeRow('hd4-set-fade', 'Fade time', 0.1, 3, 0.1, settings.get('outputFadeTime'), (v) => onFadeTime?.(v), (v) => `${v.toFixed(1)}s`),
        beatSensitivity: rangeRow('hd4-set-beat', 'Sensitivity', 1, 3, 0.1, settings.get('beatSensitivity'), (v) => onBeatSensitivity?.(v), (v) => `${v.toFixed(1)}×`),
        theme: selectRow('hd4-set-theme', 'Theme', THEMES.map((t) => [t.value, t.label]), settings.get('theme'), (v) => onTheme?.(v)),
    }
    panel.appendChild(section('Output', [rows.resolution]))
    panel.appendChild(section('Output Fade', [rows.outputFadeTime]))
    panel.appendChild(section('Beat (SYNC)', [rows.beatSensitivity]))
    panel.appendChild(section('Appearance', [rows.theme]))

    const shortcuts = document.createElement('div')
    shortcuts.className = 'hd4-settings-shortcuts'
    for (const [k, d] of SHORTCUTS) {
        const row = document.createElement('div')
        row.className = 'hd4-shortcut'
        const kbd = document.createElement('kbd')
        kbd.textContent = k
        const desc = document.createElement('span')
        desc.textContent = d
        row.append(kbd, desc)
        shortcuts.appendChild(row)
    }
    panel.appendChild(sectionWith('Shortcuts', shortcuts))

    overlay.appendChild(panel)
    container.appendChild(overlay)

    // Drawer toggle — a handfish Material-Symbol icon button. Keeps the
    // .hd4-settings-gear class (the keyboard/tests + app place it in the
    // top-bar cluster) and adds the .tooltip data-title affordance.
    const toggleButton = document.createElement('button')
    toggleButton.type = 'button'
    toggleButton.className = 'hd4-settings-gear hf-icon-btn tooltip'
    toggleButton.dataset.title = 'Settings (s)'
    toggleButton.setAttribute('aria-label', 'Settings')
    const gearIcon = document.createElement('span')
    gearIcon.className = 'hf-icon'
    gearIcon.textContent = 'settings'
    toggleButton.appendChild(gearIcon)

    // Escape closes the drawer via the handfish escape stack: while open the
    // drawer is the topmost registered escapeable, and initEscapeHandler
    // (wired once at app boot) dismisses it on Escape.
    const close = () => { overlay.dataset.open = 'false'; unregisterEscapeable(overlay) }
    const open = () => { overlay.dataset.open = 'true'; registerEscapeable(overlay, close) }
    const toggle = () => { if (overlay.dataset.open === 'true') close(); else open() }
    closeBtn.addEventListener('click', close)
    toggleButton.addEventListener('click', toggle)
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })

    /** Show the store's current values (after a change made outside the drawer). */
    const refresh = () => { for (const [key, row] of Object.entries(rows)) row.show(settings.get(key)) }

    return { el: overlay, toggleButton, open, close, toggle, refresh, get isOpen() { return overlay.dataset.open === 'true' } }
}

function section(title, rows) {
    const s = document.createElement('section')
    s.className = 'hd4-settings-section'
    const h = document.createElement('h3')
    h.textContent = title
    s.appendChild(h)
    for (const r of rows) s.appendChild(r)
    return s
}

function sectionWith(title, el) {
    const s = document.createElement('section')
    s.className = 'hd4-settings-section'
    const h = document.createElement('h3')
    h.textContent = title
    s.append(h, el)
    return s
}

function selectRow(id, label, options, value, onChange) {
    const row = document.createElement('div')
    row.className = 'hd4-settings-row'
    const lab = document.createElement('label')
    lab.textContent = label
    lab.htmlFor = id
    const sel = document.createElement('select')
    sel.id = id
    sel.className = 'hd4-settings-select'
    for (const [v, t] of options) {
        const o = document.createElement('option')
        o.value = v
        o.textContent = t
        sel.appendChild(o)
    }
    sel.value = value
    sel.addEventListener('change', () => onChange(sel.value))
    row.append(lab, sel)
    row.show = (v) => { sel.value = v }
    return row
}

function rangeRow(id, label, min, max, step, value, onChange, fmt) {
    const row = document.createElement('div')
    row.className = 'hd4-settings-row'
    const lab = document.createElement('label')
    lab.textContent = label
    lab.htmlFor = id
    const range = document.createElement('input')
    range.type = 'range'
    range.id = id
    range.className = 'hd4-settings-range'
    range.min = String(min)
    range.max = String(max)
    range.step = String(step)
    range.value = String(value)
    const readout = document.createElement('span')
    readout.className = 'hd4-settings-readout'
    readout.textContent = fmt(Number(value))
    range.addEventListener('input', () => {
        const v = parseFloat(range.value)
        readout.textContent = fmt(v)
        onChange(v)
    })
    row.append(lab, range, readout)
    row.show = (v) => { range.value = String(v); readout.textContent = fmt(Number(v)) }
    return row
}
