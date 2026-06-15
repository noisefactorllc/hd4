// SPDX-License-Identifier: MIT
/**
 * Output bar — the top strip: the HD4 logotype plus the master output
 * controls ([FREEZE] [OUTPUT FADE] [VFX]). The logotype uses
 * handfish's industrial `.hf-logotype` wordmark; the container is the
 * `.hf-topbar` so the normalized cluster (settings + info, appended by the
 * app) aligns to the right. Toggle buttons call back into the OutputState;
 * setState() reflects the authoritative state each frame so the fade button
 * tracks the ramp. (Composition — QUAD / PinP / SPLIT / KEY — lives in the
 * composition bar.)
 */
import { VFX, VFX_ORDER } from '../vfx.js'

export function buildOutputBar(container, { onFreeze, onFade, onVfx, onStill, onRecord } = {}) {
    container.innerHTML = ''

    const logo = document.createElement('div')
    logo.className = 'hf-logotype'
    logo.textContent = 'HD4'

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

    group.append(freeze.el, fade.el, still.el, record.el, vfxSelect)
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
