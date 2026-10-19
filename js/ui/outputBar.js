// SPDX-License-Identifier: MIT
/**
 * Output bar — the top strip: the HD4 brand plus the master output
 * controls ([FREEZE] [OUTPUT FADE] [STILL] [REC] [VFX]) and the external
 * outputs ([SYNC OUT] opens the Noisedeck Sync dialog, [VIEWPORT] opens the
 * secondary-display window, or focuses it). The brand is the inline
 * instant_mix mark (js/ui/logo.js) riding handfish's industrial
 * `.hf-logotype` wordmark; the container is the `.hf-topbar` so the
 * normalized cluster (settings + info, appended by the app) aligns right. Toggle buttons call back into the OutputState;
 * setState() reflects the authoritative state each frame so the fade button
 * tracks the ramp. (Composition — QUAD / PinP / SPLIT / KEY — lives in the
 * composition bar.)
 */
import { VFX, VFX_ORDER } from '../vfx.js'
import { logoSvg } from './logo.js'

export function buildOutputBar(container, { onFreeze, onFade, onVfx, onStill, onRecord, onViewport } = {}) {
    container.innerHTML = ''

    const logo = document.createElement('div')
    logo.className = 'hf-logotype'
    logo.innerHTML = logoSvg('hd4-logo-mark')
    logo.append('HD4')

    const group = document.createElement('div')
    group.className = 'hd4-output-group'

    const freeze = toggleButton('FREEZE', onFreeze, 'Freeze the program output (key f)')
    const fade = toggleButton('FADE', onFade, 'Fade the program to black (key b)')
    const still = toggleButton('STILL', () => {
        onStill?.()
        still.setActive(true)
        setTimeout(() => still.setActive(false), 250) // momentary flash
    }, 'Capture the program as a still (KEY source / channel image)')
    const record = toggleButton('REC', onRecord, 'Record the program (key r)')
    record.el.classList.add('hd4-rec-btn')

    const vfxSelect = document.createElement('select')
    vfxSelect.className = 'hd4-vfx-select'
    vfxSelect.setAttribute('aria-label', 'Output VFX')
    for (const name of VFX_ORDER) {
        const o = document.createElement('option')
        o.value = name
        o.textContent = `VFX: ${VFX[name].label}`
        vfxSelect.appendChild(o)
    }
    vfxSelect.addEventListener('change', () => onVfx?.(vfxSelect.value))

    // External outputs. The Sync dialog binds to #sync-output-open itself.
    const syncOut = toggleButton('SYNC OUT', null, 'Send the program to Noisedeck Sync')
    syncOut.el.id = 'sync-output-open'
    syncOut.el.setAttribute('aria-haspopup', 'dialog')
    const viewport = toggleButton('VIEWPORT', onViewport, 'Open the program in a window for a secondary display (close that window to detach)')

    group.append(freeze.el, fade.el, still.el, record.el, vfxSelect, syncOut.el, viewport.el)
    container.append(logo, group)

    return {
        setState({ freeze: f, faded } = {}) {
            freeze.setActive(f)
            fade.setActive(faded)
        },
        setVfx(name) { vfxSelect.value = name },
        setRecording(on, label) {
            record.setActive(on)
            record.el.textContent = on ? (label || '● REC') : 'REC'
        },
        setSyncLive(on) { syncOut.setActive(on) },
        setViewport(on) { viewport.setActive(on) },
    }
}

function toggleButton(label, onClick, title) {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'hd4-output-btn'
    el.textContent = label
    if (title) el.title = title
    el.addEventListener('click', () => onClick?.())
    return { el, setActive(on) { el.classList.toggle('is-active', !!on) } }
}
