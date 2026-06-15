// SPDX-License-Identifier: MIT
/**
 * AUTO bar — the auto-mixing / beat-matching controls (AUTO
 * SWITCHING). AUTO toggles beat-synced auto-switching; TAP sets the tempo
 * (with a BPM readout and a beat indicator); MODE picks scan vs random;
 * BARS sets how often it switches; SYNC matches the tempo to the audio.
 */
export function buildAutoBar(container, {
    onToggle, onTap, onMode, onBars, onMatchAudio,
    initialBpm = 120, initialBars = 4, initialMode = 'scan',
} = {}) {
    const bar = document.createElement('div')
    bar.className = 'hd4-auto-bar'

    const heading = label('hd4-section-label', 'AUTO')

    const autoBtn = button('hd4-auto-btn', 'AUTO', 'Beat-synced auto-switching', () => onToggle?.())

    const dot = document.createElement('span')
    dot.className = 'hd4-beat-dot'

    const tapBtn = button('hd4-auto-tap', 'TAP', 'Tap tempo', () => onTap?.())

    const bpm = document.createElement('span')
    bpm.className = 'hd4-auto-bpm'
    bpm.textContent = `${Math.round(initialBpm)} BPM`

    const mode = document.createElement('select')
    mode.className = 'hd4-auto-mode'
    mode.setAttribute('aria-label', 'Auto-switch mode')
    for (const [v, t] of [['scan', 'Scan'], ['random', 'Random']]) {
        const o = document.createElement('option'); o.value = v; o.textContent = t; mode.appendChild(o)
    }
    mode.value = initialMode
    mode.addEventListener('change', () => onMode?.(mode.value))

    const bars = document.createElement('input')
    bars.type = 'number'
    bars.min = '1'
    bars.max = '32'
    bars.step = '1'
    bars.value = String(initialBars)
    bars.className = 'hd4-auto-bars'
    bars.setAttribute('aria-label', 'Bars per switch')
    bars.title = 'Bars per switch'
    bars.addEventListener('change', () => onBars?.(parseInt(bars.value, 10) || 1))

    const sync = button('hd4-auto-sync', 'SYNC', 'Match the tempo to the audio', () => onMatchAudio?.())

    bar.append(heading, autoBtn, dot, tapBtn, bpm, mode, bars, sync)
    container.appendChild(bar)

    return {
        setEnabled(on) { autoBtn.classList.toggle('is-active', !!on) },
        setMatchAudio(on) { sync.classList.toggle('is-active', !!on) },
        setBpm(v) { bpm.textContent = `${Math.round(v)} BPM` },
        flashBeat(beat) {
            dot.classList.toggle('is-downbeat', !!beat.isDownbeat)
            dot.style.animation = 'none'
            void dot.offsetWidth // reflow to restart the flash
            dot.style.animation = 'hd4-beat 0.25s ease-out'
        },
    }
}

function button(cls, text, title, onClick) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = cls
    b.textContent = text
    b.title = title
    b.addEventListener('click', () => onClick?.())
    return b
}

function label(cls, text) {
    const s = document.createElement('span')
    s.className = cls
    s.textContent = text
    return s
}
