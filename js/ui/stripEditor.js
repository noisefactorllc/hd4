// SPDX-License-Identifier: MIT
/**
 * Channel-strip editor — the per-channel audio [SETUP]: HPF, 3-band
 * EQ, gate, compressor, pan, delay, and AUX/REV sends. A single slide-in
 * panel switched between channels by the tab row; every control reports
 * through onParam(channelIndex, key, value). open(i, params) reflects the
 * channel's current settings.
 */
import { COMP_RATIOS } from '../audio/strip.js'

const ratioLabel = (r) => (Number.isFinite(r) ? `${r.toFixed(2)}:1` : 'INF:1')

export function buildStripEditor(container, { channelCount = 4, onParam } = {}) {
    let current = 0
    const controls = {}

    const overlay = el('div', 'hd4-stripedit-overlay hd4-stripedit-overlay--chan')
    overlay.dataset.open = 'false'
    const panel = el('div', 'hd4-stripedit-panel')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'Channel audio')

    const header = el('div', 'hd4-stripedit-header')
    const title = el('h2', 'hd4-stripedit-title')
    title.textContent = 'Channel audio'
    const tabs = el('div', 'hd4-stripedit-tabs')
    const tabBtns = []
    for (let i = 0; i < channelCount; i++) {
        const t = document.createElement('button')
        t.type = 'button'
        t.className = 'hd4-stripedit-tab'
        t.textContent = String(i + 1)
        t.addEventListener('click', () => open(i))
        tabs.appendChild(t)
        tabBtns.push(t)
    }
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'hd4-stripedit-close'
    close.textContent = '✕'
    close.setAttribute('aria-label', 'Close channel audio')
    close.addEventListener('click', () => hide())
    header.append(title, tabs, close)

    const body = el('div', 'hd4-stripedit-body')
    body.append(
        group('EQ', [
            toggleRow('HPF', 'hpf'),
            rangeRow('LO', 'eqLo', -15, 15, 1, dB),
            rangeRow('LO freq', 'eqLoFreq', 20, 500, 5, hz),
            rangeRow('MID', 'eqMid', -15, 15, 1, dB),
            rangeRow('MID freq', 'eqMidFreq', 20, 20000, 10, hz),
            rangeRow('MID Q', 'eqMidQ', 0.5, 16, 0.1, (v) => v.toFixed(1)),
            rangeRow('HI', 'eqHi', -15, 15, 1, dB),
            rangeRow('HI freq', 'eqHiFreq', 1000, 20000, 100, hz),
        ]),
        group('Gate', [
            toggleRow('GATE', 'gate'),
            rangeRow('Thresh', 'gateThreshold', -80, 0, 1, dB),
            rangeRow('Attack', 'gateAttack', 0.5, 200, 0.5, ms),
            rangeRow('Release', 'gateRelease', 30, 5000, 10, ms),
        ]),
        group('Compressor', [
            toggleRow('COMP', 'comp'),
            rangeRow('Thresh', 'compThreshold', -60, 0, 1, dB),
            selectRow('Ratio', 'compRatio', COMP_RATIOS.map((r) => [String(r), ratioLabel(r)])),
            rangeRow('Attack', 'compAttack', 0.2, 100, 0.1, ms),
            rangeRow('Release', 'compRelease', 30, 5000, 10, ms),
            rangeRow('Makeup', 'compMakeup', -40, 40, 1, dB),
            toggleRow('AUTO GAIN', 'compAutoGain'),
        ]),
        group('Output', [
            rangeRow('Pan', 'pan', -1, 1, 0.05, pan),
            rangeRow('Delay', 'delay', 0, 500, 1, ms),
        ]),
        group('Sends', [
            rangeRow('AUX', 'auxSend', -60, 10, 1, dB),
            rangeRow('REV', 'revSend', -60, 10, 1, dB),
        ]),
        group('Auto audio', [
            toggleRow('FOLLOW VID', 'followVideo'),
            toggleRow('AUTO MIX', 'autoMixEnabled'),
            rangeRow('Mix weight', 'autoMixWeight', 0, 100, 1, (v) => `${v}`),
        ]),
    )

    panel.append(header, body)
    overlay.appendChild(panel)
    overlay.addEventListener('click', (e) => { if (e.target === overlay) hide() })
    container.appendChild(overlay)

    function open(i, params) {
        current = i
        title.textContent = `Channel ${i + 1} audio`
        tabBtns.forEach((t, idx) => t.classList.toggle('is-active', idx === i))
        if (params) update(params)
        overlay.dataset.open = 'true'
    }
    function hide() { overlay.dataset.open = 'false' }
    function update(params) {
        for (const [key, c] of Object.entries(controls)) if (key in params) c.set(params[key])
    }

    return {
        open,
        close: hide,
        update,
        get isOpen() { return overlay.dataset.open === 'true' },
        get channel() { return current },
    }

    // --- control builders (register into `controls`) ---
    function toggleRow(label, key) {
        const row = el('label', 'hd4-se-row')
        const lab = el('span', 'hd4-se-label'); lab.textContent = label
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'hd4-se-toggle'
        btn.dataset.key = key
        let on = false
        btn.textContent = 'OFF'
        btn.addEventListener('click', () => { on = !on; render(); onParam?.(current, key, on) })
        const render = () => { btn.classList.toggle('is-on', on); btn.textContent = on ? 'ON' : 'OFF' }
        controls[key] = { set: (v) => { on = !!v; render() } }
        row.append(lab, btn)
        return row
    }

    function rangeRow(label, key, min, max, step, fmt) {
        const row = el('label', 'hd4-se-row')
        const lab = el('span', 'hd4-se-label'); lab.textContent = label
        const input = document.createElement('input')
        input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step)
        input.className = 'hd4-se-slider'
        input.dataset.key = key
        input.setAttribute('aria-label', `${label}`)
        const out = el('span', 'hd4-se-readout')
        const setOut = (v) => { out.textContent = fmt(Number(v)) }
        input.addEventListener('input', () => { setOut(input.value); onParam?.(current, key, Number(input.value)) })
        controls[key] = { set: (v) => { const n = Number.isFinite(v) ? v : min; input.value = String(n); setOut(n) } }
        row.append(lab, input, out)
        return row
    }

    function selectRow(label, key, options) {
        const row = el('label', 'hd4-se-row')
        const lab = el('span', 'hd4-se-label'); lab.textContent = label
        const sel = document.createElement('select')
        sel.className = 'hd4-se-select'
        sel.dataset.key = key
        sel.setAttribute('aria-label', label)
        for (const [v, t] of options) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o) }
        sel.addEventListener('change', () => onParam?.(current, key, Number(sel.value)))
        controls[key] = { set: (v) => { sel.value = String(v) } }
        row.append(lab, sel)
        return row
    }
}

// --- formatting + DOM helpers ----------------------------------------------

const dB = (v) => `${v > 0 ? '+' : ''}${v} dB`
const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`)
const ms = (v) => `${v} ms`
const pan = (v) => (Math.abs(v) < 0.025 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)

function el(tag, className) {
    const e = document.createElement(tag)
    if (className) e.className = className
    return e
}

function group(name, rows) {
    const g = el('div', 'hd4-se-group')
    const h = el('div', 'hd4-se-grouptitle')
    h.textContent = name
    g.append(h, ...rows)
    return g
}
