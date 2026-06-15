// SPDX-License-Identifier: MIT
/**
 * Mixer panel — the audio channel strips and the main strip (audio
 * section). Each channel strip has SOLO / MUTE buttons, a vertical fader,
 * and a post-fader level meter; the main strip has a fader and a meter.
 * Controls report via callbacks; meters are pushed in each frame.
 */
export function buildMixerPanel(container, {
    channelCount = 4,
    initialFaders = [],
    initialMainFader = 0.9,
    onFader,
    onMute,
    onSolo,
    onMainFader,
} = {}) {
    container.innerHTML = ''
    const panel = document.createElement('div')
    panel.className = 'hd4-mixer-panel'

    const strips = []
    for (let i = 0; i < channelCount; i++) {
        const strip = buildStrip(i, initialFaders[i] ?? 0.8, { onFader, onMute, onSolo })
        panel.appendChild(strip.el)
        strips.push(strip)
    }
    const main = buildMainStrip(initialMainFader, onMainFader)
    panel.appendChild(main.el)
    container.appendChild(panel)

    return {
        setMeter(i, v) { strips[i].setMeter(v) },
        setMainMeter(v) { main.setMeter(v) },
        setMuted(i, on) { strips[i].setMuted(on) },
        setSoloed(i, on) { strips[i].setSoloed(on) },
        setFader(i, pos) { strips[i].setFader(pos) },
        setMainFader(pos) { main.setFader(pos) },
    }
}

function meterHeight(v) {
    return `${Math.min(100, Math.sqrt(Math.max(0, v)) * 120).toFixed(1)}%`
}

function buildStrip(index, fader, { onFader, onMute, onSolo }) {
    const el = document.createElement('div')
    el.className = 'hd4-strip'
    el.dataset.channel = String(index + 1)

    const btns = document.createElement('div')
    btns.className = 'hd4-strip-btns'
    const solo = stripButton('S', 'hd4-solo-btn', `Solo channel ${index + 1}`, () => onSolo?.(index))
    const mute = stripButton('M', 'hd4-mute-btn', `Mute channel ${index + 1}`, () => onMute?.(index))
    btns.append(solo, mute)

    const faderRow = document.createElement('div')
    faderRow.className = 'hd4-strip-fader-row'
    const meter = document.createElement('div')
    meter.className = 'hd4-meter'
    const fill = document.createElement('div')
    fill.className = 'hd4-meter-fill'
    meter.appendChild(fill)
    const range = makeFader(fader, `Channel ${index + 1} level`, (v) => onFader?.(index, v))
    faderRow.append(meter, range)

    const label = document.createElement('div')
    label.className = 'hd4-strip-label'
    label.textContent = String(index + 1)

    el.append(btns, faderRow, label)
    return {
        el,
        setMeter(v) { fill.style.height = meterHeight(v) },
        setMuted(on) { mute.classList.toggle('is-active', on) },
        setSoloed(on) { solo.classList.toggle('is-active', on) },
        setFader(pos) { range.value = String(pos) },
    }
}

function buildMainStrip(fader, onMainFader) {
    const el = document.createElement('div')
    el.className = 'hd4-strip hd4-strip-main'

    const spacer = document.createElement('div')
    spacer.className = 'hd4-strip-btns'

    const faderRow = document.createElement('div')
    faderRow.className = 'hd4-strip-fader-row'
    const meter = document.createElement('div')
    meter.className = 'hd4-meter'
    const fill = document.createElement('div')
    fill.className = 'hd4-meter-fill'
    meter.appendChild(fill)
    const range = makeFader(fader, 'Main level', (v) => onMainFader?.(v))
    faderRow.append(meter, range)

    const label = document.createElement('div')
    label.className = 'hd4-strip-label hd4-strip-label-main'
    label.textContent = 'MAIN'

    el.append(spacer, faderRow, label)
    return {
        el,
        setMeter(v) { fill.style.height = meterHeight(v) },
        setFader(pos) { range.value = String(pos) },
    }
}

function makeFader(value, ariaLabel, onInput) {
    const range = document.createElement('input')
    range.type = 'range'
    range.min = '0'
    range.max = '1'
    range.step = '0.01'
    range.value = String(value)
    range.className = 'hd4-fader'
    range.setAttribute('aria-label', ariaLabel)
    range.addEventListener('input', () => onInput(parseFloat(range.value)))
    return range
}

function stripButton(text, cls, ariaLabel, onClick) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `hd4-strip-btn ${cls}`
    b.textContent = text
    b.setAttribute('aria-label', ariaLabel)
    b.addEventListener('click', onClick)
    return b
}
