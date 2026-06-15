// SPDX-License-Identifier: MIT
/**
 * Preview view — the PVW monitor and its bus. The four PVW buttons queue a
 * channel on preview; TAKE cuts it to program and AUTO transitions it
 * (through the current MIX/WIPE). Appends beside the program monitor; the
 * app blits the previewed channel into the monitor each frame.
 */
export function buildPreviewView(container, { channelCount = 4, onSelect, onTake, onAuto } = {}) {
    const wrap = document.createElement('div')
    wrap.className = 'hd4-preview-wrap'

    const screen = document.createElement('div')
    screen.className = 'hd4-preview-screen'
    const canvas = document.createElement('canvas')
    canvas.className = 'hd4-preview-canvas'
    canvas.width = 320
    canvas.height = 180
    screen.appendChild(canvas)
    const tag = document.createElement('div')
    tag.className = 'hd4-program-tag hd4-preview-tag'
    tag.textContent = 'PVW'
    screen.appendChild(tag)
    const ctx = canvas.getContext('2d')

    const bus = document.createElement('div')
    bus.className = 'hd4-preview-bus'
    const buttons = []
    for (let i = 1; i <= channelCount; i++) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'hd4-pvw-btn'
        btn.dataset.channel = String(i)
        btn.textContent = String(i)
        btn.title = `Queue channel ${i} on preview`
        btn.setAttribute('aria-label', `Preview channel ${i}`)
        btn.addEventListener('click', () => onSelect?.(i))
        bus.appendChild(btn)
        buttons.push(btn)
    }

    const takeRow = document.createElement('div')
    takeRow.className = 'hd4-preview-take'
    const takeBtn = actionButton('TAKE', 'Cut preview to program', onTake)
    const autoBtn = actionButton('AUTO', 'Transition preview to program', onAuto)
    takeRow.append(takeBtn, autoBtn)

    wrap.append(screen, bus, takeRow)
    container.appendChild(wrap)

    return {
        setPreview(n) {
            buttons.forEach((b, idx) => b.classList.toggle('is-preview', idx + 1 === n))
        },
        /** Blit a channel canvas into the preview monitor. */
        drawSource(src) {
            if (src && src.width > 0 && src.height > 0) {
                ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
            } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height)
            }
        },
    }
}

function actionButton(label, title, onClick) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'hd4-preview-action'
    b.textContent = label
    b.title = title
    b.addEventListener('click', () => onClick?.())
    return b
}
