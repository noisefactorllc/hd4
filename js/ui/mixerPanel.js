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
    onAudioSource,
    onEditStrip,
    onEditMain,
    onMonitor,
    onRecordSource,
} = {}) {
    container.innerHTML = ''
    const panel = document.createElement('div')
    panel.className = 'hd4-mixer-panel'

    const strips = []
    for (let i = 0; i < channelCount; i++) {
        const strip = buildStrip(i, initialFaders[i] ?? 0.8, { onFader, onMute, onSolo, onAudioSource, onEditStrip })
        panel.appendChild(strip.el)
        strips.push(strip)
    }
    const main = buildMainStrip(initialMainFader, onMainFader, onEditMain)
    panel.appendChild(main.el)
    const aux = buildAuxModule({ onMonitor, onRecordSource })
    panel.appendChild(aux.el)
    container.appendChild(panel)

    return {
        setMeter(i, v) { strips[i].setMeter(v) },
        setMainMeter(v) { main.setMeter(v) },
        setAuxMeter(v) { aux.setMeter(v) },
        setMuted(i, on) { strips[i].setMuted(on) },
        setSoloed(i, on) { strips[i].setSoloed(on) },
        setFader(i, pos) { strips[i].setFader(pos) },
        setMainFader(pos) { main.setFader(pos) },
        setAudioInputs(list) { strips.forEach((s) => s.setAudioInputs(list)) },
    }
}

function meterHeight(v) {
    return `${Math.min(100, Math.sqrt(Math.max(0, v)) * 120).toFixed(1)}%`
}

function buildStrip(index, fader, { onFader, onMute, onSolo, onAudioSource, onEditStrip }) {
    const el = document.createElement('div')
    el.className = 'hd4-strip'
    el.dataset.channel = String(index + 1)

    const audio = buildAudioSelect(index, onAudioSource)

    const btns = document.createElement('div')
    btns.className = 'hd4-strip-btns'
    const solo = stripButton('S', 'hd4-solo-btn', `Solo channel ${index + 1}`, () => onSolo?.(index))
    const mute = stripButton('M', 'hd4-mute-btn', `Mute channel ${index + 1}`, () => onMute?.(index))
    const edit = stripButton('EQ', 'hd4-edit-btn', `Channel ${index + 1} audio setup`, () => onEditStrip?.(index))
    btns.append(solo, mute, edit)

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

    el.append(audio.el, btns, faderRow, label)
    return {
        el,
        setMeter(v) { fill.style.height = meterHeight(v) },
        setMuted(on) { mute.classList.toggle('is-active', on) },
        setSoloed(on) { solo.classList.toggle('is-active', on) },
        setFader(pos) { range.value = String(pos) },
        setAudioInputs(list) { audio.updateDevices(list) },
    }
}

/** Per-channel audio source: Follow video / None / a specific input device. */
function buildAudioSelect(index, onAudioSource) {
    const el = document.createElement('select')
    el.className = 'hd4-strip-audio'
    el.title = 'Audio source'
    el.setAttribute('aria-label', `Channel ${index + 1} audio source`)

    const rebuild = (devices = []) => {
        const prev = el.value
        el.textContent = ''
        for (const [value, text] of [['follow', 'Follow'], ['none', 'No audio']]) {
            const o = document.createElement('option')
            o.value = value
            o.textContent = text
            el.appendChild(o)
        }
        for (const dev of devices) {
            const o = document.createElement('option')
            o.value = `device:${dev.deviceId}`
            o.textContent = dev.label
            el.appendChild(o)
        }
        if ([...el.options].some((o) => o.value === prev)) el.value = prev
        syncTitle()
    }
    rebuild()

    // Device names clip in the narrow strip; surface the full name on hover.
    function syncTitle() { el.title = el.selectedOptions[0]?.textContent || 'Audio source' }

    el.addEventListener('change', () => {
        syncTitle()
        const v = el.value
        if (v === 'follow') onAudioSource?.(index, 'follow')
        else if (v === 'none') onAudioSource?.(index, 'none')
        else if (v.startsWith('device:')) onAudioSource?.(index, 'device', v.slice(7))
    })

    return { el, updateDevices: rebuild }
}

function buildMainStrip(fader, onMainFader, onEditMain) {
    const el = document.createElement('div')
    el.className = 'hd4-strip hd4-strip-main'

    const spacer = document.createElement('div')
    spacer.className = 'hd4-strip-btns'
    spacer.appendChild(stripButton('SET', 'hd4-edit-btn hd4-main-edit-btn', 'Main bus audio setup', () => onEditMain?.()))

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

/**
 * AUX module — routes the separate AUX mix. MON auditions it on the speakers
 * (vs MAIN); REC selects it as the recording source (PGM ↔ AUX). The meter
 * shows the AUX bus level (fed by each channel's AUX send). The bus level /
 * delay / mute themselves live in the main-bus editor.
 */
function buildAuxModule({ onMonitor, onRecordSource }) {
    const el = document.createElement('div')
    el.className = 'hd4-strip hd4-aux'

    const btns = document.createElement('div')
    btns.className = 'hd4-strip-btns hd4-aux-btns'

    let monitoring = false
    const mon = document.createElement('button')
    mon.type = 'button'
    mon.className = 'hd4-strip-btn hd4-aux-mon'
    mon.textContent = 'MON'
    mon.title = 'Monitor (audition) the AUX bus on the speakers'
    mon.setAttribute('aria-label', 'Monitor the AUX bus')
    mon.addEventListener('click', () => {
        monitoring = !monitoring
        mon.classList.toggle('is-active', monitoring)
        onMonitor?.(monitoring ? 'aux' : 'main')
    })

    let toAux = false
    const rec = document.createElement('button')
    rec.type = 'button'
    rec.className = 'hd4-strip-btn hd4-aux-recsrc'
    rec.title = 'Recording source: program (PGM) or the AUX mix'
    rec.setAttribute('aria-label', 'Recording source')
    const renderRec = () => { rec.textContent = toAux ? 'AUX' : 'PGM'; rec.classList.toggle('is-active', toAux) }
    renderRec()
    rec.addEventListener('click', () => {
        toAux = !toAux
        renderRec()
        onRecordSource?.(toAux ? 'aux' : 'program')
    })

    btns.append(mon, rec)

    const faderRow = document.createElement('div')
    faderRow.className = 'hd4-strip-fader-row'
    const meter = document.createElement('div')
    meter.className = 'hd4-meter'
    const fill = document.createElement('div')
    fill.className = 'hd4-meter-fill'
    meter.appendChild(fill)
    faderRow.appendChild(meter)

    const label = document.createElement('div')
    label.className = 'hd4-strip-label hd4-strip-label-aux'
    label.textContent = 'AUX'

    el.append(btns, faderRow, label)
    return {
        el,
        setMeter(v) { fill.style.height = meterHeight(v) },
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
