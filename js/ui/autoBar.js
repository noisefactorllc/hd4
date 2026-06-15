// SPDX-License-Identifier: MIT
/**
 * AUTO bar — the auto-mixing / beat-matching controls (AUTO
 * SWITCHING). The TEMPO portion (TAP + BPM readout + beat indicator + phase)
 * is the handfish <tempo-bar> web component; the auto-switching extras sit
 * beside it: AUTO toggles beat-synced auto-switching, MODE picks scan vs
 * random vs follows-audio, BARS sets how often it switches, and SYNC matches
 * the tempo to the audio.
 *
 * tempo-bar runs in `manual` mode (the app owns its start/stop and keeps it in
 * lockstep with the BeatClock that actually drives switching). Editing the BPM
 * or tapping fires the component's `change` event, reported via onTempoChange
 * so the app re-tempos the BeatClock; the app pushes BPM back (setBpm) when the
 * clock changes programmatically or the audio SYNC re-anchors it.
 */
const MODES = [
    ['scan', 'Scan'],
    ['random', 'Random'],
    ['follows-audio', 'Follows audio'],
]

export function buildAutoBar(container, {
    onToggle, onTempoChange, onMode, onBars, onMatchAudio,
    initialBpm = 120, initialBars = 4, initialMode = 'scan',
} = {}) {
    const bar = document.createElement('div')
    bar.className = 'hd4-auto-bar'

    const heading = label('hd4-section-label', 'AUTO')

    const autoBtn = button('hd4-auto-btn', 'AUTO', 'Beat-synced auto-switching', () => onToggle?.())

    // TEMPO: handfish tempo-bar (TAP + BPM + beat dots + phase). Manual so the
    // app drives start/stop; no divider chrome is needed for HD4's beat grid,
    // but the component renders it — it is harmless and left at the default.
    const tempo = document.createElement('tempo-bar')
    tempo.className = 'hd4-tempo'
    tempo.setAttribute('manual', '')
    tempo.setAttribute('bpm', String(Math.round(initialBpm)))
    tempo.addEventListener('change', (e) => onTempoChange?.(e.detail?.bpm ?? tempo.bpm))

    const mode = document.createElement('select-dropdown')
    mode.className = 'hd4-auto-mode'
    mode.setAttribute('aria-label', 'Auto-switch mode')
    for (const [v, t] of MODES) {
        const o = document.createElement('option')
        o.value = v
        o.textContent = t
        mode.appendChild(o)
    }
    mode.setAttribute('value', initialMode)
    mode.addEventListener('change', () => onMode?.(mode.value))

    const bars = document.createElement('input')
    bars.type = 'number'
    bars.min = '1'
    bars.max = '32'
    bars.step = '1'
    bars.value = String(initialBars)
    bars.className = 'hd4-auto-bars hf-number'
    bars.setAttribute('aria-label', 'Bars per switch')
    bars.title = 'Bars per switch'
    bars.addEventListener('change', () => onBars?.(parseInt(bars.value, 10) || 1))

    const sync = button('hd4-auto-sync', 'SYNC', 'Match the tempo to the audio', () => onMatchAudio?.())

    bar.append(heading, autoBtn, tempo, mode, bars, sync)
    container.appendChild(bar)

    return {
        el: bar,
        tempoBar: tempo,
        setEnabled(on) { autoBtn.classList.toggle('is-active', !!on) },
        setMatchAudio(on) { sync.classList.toggle('is-active', !!on) },
        /** Reflect a programmatic / audio-SYNC tempo onto the tempo-bar. */
        setBpm(v) { tempo.bpm = v },
        /** Start/stop the tempo-bar's beat animation (kept in lockstep with the clock). */
        startTempo() { tempo.start() },
        stopTempo() { tempo.stop() },
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
