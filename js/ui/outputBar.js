// SPDX-License-Identifier: MIT
/**
 * Output bar — the top strip: brand plus the master output controls
 * ([FREEZE] [OUTPUT FADE] [VFX]). Toggle buttons call back into the
 * OutputState; setState() reflects the authoritative state each frame so the
 * fade button tracks the ramp. (Composition — QUAD / PinP / SPLIT / KEY —
 * lives in the composition bar.)
 */
import { VFX, VFX_ORDER } from '../vfx.js'

export function buildOutputBar(container, { onFreeze, onFade, onVfx } = {}) {
    container.innerHTML = ''

    const brand = document.createElement('div')
    brand.className = 'hd4-brand'
    const mark = document.createElement('span')
    mark.className = 'hd4-brand-mark'
    mark.textContent = 'HD4'
    const sub = document.createElement('span')
    sub.className = 'hd4-brand-sub'
    sub.textContent = 'video mixer'
    brand.append(mark, sub)

    const spacer = document.createElement('div')
    spacer.className = 'hd4-topbar-spacer'

    const group = document.createElement('div')
    group.className = 'hd4-output-group'

    const freeze = toggleButton('FREEZE', onFreeze, 'Freeze the program output (key f)')
    const fade = toggleButton('FADE', onFade, 'Fade the program to black (key b)')

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

    group.append(freeze.el, fade.el, vfxSelect)
    container.append(brand, spacer, group)

    return {
        setState({ freeze: f, faded } = {}) {
            freeze.setActive(f)
            fade.setActive(faded)
        },
        setVfx(name) { vfxSelect.value = name },
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
