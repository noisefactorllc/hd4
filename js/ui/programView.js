// SPDX-License-Identifier: MIT
/**
 * Program view — the main output monitor plus the VIDEO INPUT SELECT bus.
 * The four take buttons select the live channel (a take through the
 * current transition); the live button lights, and pulses while a
 * transition is in flight. Returns the program canvas for the compositor.
 */
export function buildProgramView(container, { onTake } = {}) {
    container.innerHTML = ''

    const wrap = document.createElement('div')
    wrap.className = 'hd4-program-wrap'

    const screen = document.createElement('div')
    screen.className = 'hd4-program-screen'

    const canvas = document.createElement('canvas')
    canvas.className = 'hd4-program-canvas'
    screen.appendChild(canvas)

    const tag = document.createElement('div')
    tag.className = 'hd4-program-tag'
    tag.textContent = 'PGM'
    screen.appendChild(tag)

    const bus = document.createElement('div')
    bus.className = 'hd4-take-bus'

    const buttons = []
    for (let i = 1; i <= 4; i++) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'hd4-take-btn'
        btn.dataset.channel = String(i)
        btn.textContent = String(i)
        btn.setAttribute('aria-label', `Take channel ${i} to program`)
        btn.addEventListener('click', () => onTake?.(i))
        bus.appendChild(btn)
        buttons.push(btn)
    }

    wrap.append(screen, bus)
    container.appendChild(wrap)

    return {
        canvas,
        setLive(live, transitioning) {
            buttons.forEach((b, idx) => {
                const isLive = idx + 1 === live
                b.classList.toggle('is-live', isLive)
                b.classList.toggle('is-transitioning', isLive && transitioning)
            })
        },
    }
}
