// SPDX-License-Identifier: MIT
/**
 * Main-bus editor — the MAIN [SETUP]: main mute + limiter, the main
 * 3-band EQ, reverb (return / time / type), the multiband compressor, and
 * the AUX bus (level / mute / delay). One slide-in panel; controls report
 * through onParam(key, value). Reuses the channel-editor styling.
 */
import { COMP_RATIOS } from '../audio/strip.js'
import { REVERB_TYPES } from '../audio/mainBus.js'

const ratioLabel = (r) => (Number.isFinite(r) ? `${r.toFixed(2)}:1` : 'INF:1')

export function buildMainBusEditor(container, { onParam } = {}) {
    const controls = {}

    const overlay = el('div', 'hd4-stripedit-overlay hd4-stripedit-overlay--main')
    overlay.dataset.open = 'false'
    const panel = el('div', 'hd4-stripedit-panel')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'Main bus audio')

    const header = el('div', 'hd4-stripedit-header')
    const title = el('h2', 'hd4-stripedit-title')
    title.textContent = 'Main bus audio'
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'hd4-stripedit-close'
    close.textContent = '✕'
    close.setAttribute('aria-label', 'Close main bus audio')
    close.addEventListener('click', () => hide())
    header.append(title, close)

    const body = el('div', 'hd4-stripedit-body')
    body.append(
        group('Output', [
            toggleRow('MAIN MUTE', 'mainMute'),
            toggleRow('LIMITER', 'mainLimiter'),
            rangeRow('Threshold', 'mainLimiterThreshold', -40, 0, 1, dB),
        ]),
        group('EQ', [
            rangeRow('LO', 'eqLo', -15, 15, 1, dB),
            rangeRow('LO freq', 'eqLoFreq', 20, 500, 5, hz),
            rangeRow('MID', 'eqMid', -15, 15, 1, dB),
            rangeRow('MID freq', 'eqMidFreq', 20, 20000, 10, hz),
            rangeRow('MID Q', 'eqMidQ', 0.5, 16, 0.1, (v) => v.toFixed(1)),
            rangeRow('HI', 'eqHi', -15, 15, 1, dB),
            rangeRow('HI freq', 'eqHiFreq', 1000, 20000, 100, hz),
        ]),
        group('Reverb', [
            rangeRow('Return', 'reverbReturn', -60, 10, 1, dB),
            rangeRow('Time', 'reverbTime', 0, 5, 0.1, (v) => `${v.toFixed(1)} s`),
            selectRow('Type', 'reverbType', REVERB_TYPES.map((t) => [t, t[0].toUpperCase() + t.slice(1)])),
        ]),
        group('Multiband comp', [
            toggleRow('MB COMP', 'mbComp'),
            rangeRow('LO thresh', 'mbLoThres', -40, 0, 1, dB),
            selectRow('LO ratio', 'mbLoRatio', COMP_RATIOS.map((r) => [String(r), ratioLabel(r)])),
            rangeRow('MID thresh', 'mbMidThres', -40, 0, 1, dB),
            selectRow('MID ratio', 'mbMidRatio', COMP_RATIOS.map((r) => [String(r), ratioLabel(r)])),
            rangeRow('HI thresh', 'mbHiThres', -40, 0, 1, dB),
            selectRow('HI ratio', 'mbHiRatio', COMP_RATIOS.map((r) => [String(r), ratioLabel(r)])),
        ]),
        group('AUX bus', [
            toggleRow('AUX MUTE', 'auxMute'),
            rangeRow('Level', 'auxLevel', -60, 10, 1, dB),
            rangeRow('Delay', 'auxDelay', 0, 500, 1, ms),
        ]),
        group('Auto mixing', [
            toggleRow('AUTO MIX', 'autoMixing'),
        ]),
    )

    panel.append(header, body)
    overlay.appendChild(panel)
    overlay.addEventListener('click', (e) => { if (e.target === overlay) hide() })
    container.appendChild(overlay)

    function open(params) {
        if (params) update(params)
        overlay.dataset.open = 'true'
    }
    function hide() { overlay.dataset.open = 'false' }
    function update(params) {
        for (const [key, c] of Object.entries(controls)) if (key in params) c.set(params[key])
    }

    return { open, close: hide, update, get isOpen() { return overlay.dataset.open === 'true' } }

    function toggleRow(label, key) {
        const row = el('label', 'hd4-se-row')
        const lab = el('span', 'hd4-se-label'); lab.textContent = label
        const btn = document.createElement('button')
        btn.type = 'button'; btn.className = 'hd4-se-toggle'; btn.dataset.key = key
        let on = false
        const render = () => { btn.classList.toggle('is-on', on); btn.textContent = on ? 'ON' : 'OFF' }
        btn.addEventListener('click', () => { on = !on; render(); onParam?.(key, on) })
        controls[key] = { set: (v) => { on = !!v; render() } }
        row.append(lab, btn)
        return row
    }

    function rangeRow(label, key, min, max, step, fmt) {
        const row = el('label', 'hd4-se-row')
        const lab = el('span', 'hd4-se-label'); lab.textContent = label
        const input = document.createElement('input')
        input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step)
        input.className = 'hd4-se-slider'; input.dataset.key = key; input.setAttribute('aria-label', label)
        const out = el('span', 'hd4-se-readout')
        const setOut = (v) => { out.textContent = fmt(Number(v)) }
        input.addEventListener('input', () => { setOut(input.value); onParam?.(key, Number(input.value)) })
        controls[key] = { set: (v) => { const n = Number.isFinite(v) ? v : min; input.value = String(n); setOut(n) } }
        row.append(lab, input, out)
        return row
    }

    function selectRow(label, key, options) {
        const row = el('label', 'hd4-se-row')
        const lab = el('span', 'hd4-se-label'); lab.textContent = label
        const sel = document.createElement('select')
        sel.className = 'hd4-se-select'; sel.dataset.key = key; sel.setAttribute('aria-label', label)
        for (const [v, t] of options) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o) }
        const numeric = options.every(([v]) => !Number.isNaN(Number(v)))
        sel.addEventListener('change', () => onParam?.(key, numeric ? Number(sel.value) : sel.value))
        controls[key] = { set: (v) => { sel.value = String(v) } }
        row.append(lab, sel)
        return row
    }
}

const dB = (v) => `${v > 0 ? '+' : ''}${v} dB`
const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`)
const ms = (v) => `${v} ms`

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
