// SPDX-License-Identifier: MIT
/**
 * Output bar — the top strip: brand plus the master output controls
 * ([QUAD] [FREEZE] [OUTPUT FADE] [VFX]). Toggle buttons call back
 * into the OutputState; setState() reflects the authoritative state each
 * frame so the fade button tracks the ramp.
 */
import { VFX, VFX_ORDER } from '../vfx.js'

export function buildOutputBar(container, { onQuad, onFreeze, onFade, onVfx } = {}) {
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

    const quad = toggleButton('QUAD', onQuad)
    const freeze = toggleButton('FREEZE', onFreeze)
    const fade = toggleButton('FADE', onFade)

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

    group.append(quad.el, freeze.el, fade.el, vfxSelect)
    container.append(brand, spacer, group)

    return {
        setState({ quad: q, freeze: f, faded } = {}) {
            quad.setActive(q)
            freeze.setActive(f)
            fade.setActive(faded)
        },
    }
}

function toggleButton(label, onClick) {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'hd4-output-btn'
    el.textContent = label
    el.addEventListener('click', () => onClick?.())
    return { el, setActive(on) { el.classList.toggle('is-active', !!on) } }
}
