// SPDX-License-Identifier: MIT
/**
 * Transition bar — the [CUT] [MIX] [WIPE] type selector and the TIME
 * control, mirroring a classic transition section. Selecting a type sets
 * how the next take switches; TIME sets the transition duration (0–4 s).
 */
export function buildTransitionBar(container, {
    onType,
    onTime,
    initialType = 'mix',
    initialTime = 1.0,
} = {}) {
    container.innerHTML = ''

    const bar = document.createElement('div')
    bar.className = 'hd4-transition-bar'

    const heading = document.createElement('span')
    heading.className = 'hd4-section-label'
    heading.textContent = 'TRANSITION'

    const typeGroup = document.createElement('div')
    typeGroup.className = 'hd4-trans-types'
    const typeBtns = {}
    for (const [value, label] of [['cut', 'CUT'], ['mix', 'MIX'], ['wipe', 'WIPE']]) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'hd4-trans-btn'
        b.dataset.type = value
        b.textContent = label
        b.addEventListener('click', () => { onType?.(value); applyType(value) })
        typeGroup.appendChild(b)
        typeBtns[value] = b
    }

    const time = document.createElement('label')
    time.className = 'hd4-time'

    const timeLabel = document.createElement('span')
    timeLabel.className = 'hd4-section-label'
    timeLabel.textContent = 'TIME'

    const range = document.createElement('input')
    range.type = 'range'
    range.min = '0'
    range.max = '4'
    range.step = '0.1'
    range.value = String(initialTime)
    range.className = 'hd4-time-range'
    range.setAttribute('aria-label', 'Transition time (seconds)')

    const readout = document.createElement('span')
    readout.className = 'hd4-time-readout'
    readout.textContent = `${initialTime.toFixed(1)}s`

    range.addEventListener('input', () => {
        const t = parseFloat(range.value)
        readout.textContent = `${t.toFixed(1)}s`
        onTime?.(t)
    })

    time.append(timeLabel, range, readout)
    bar.append(heading, typeGroup, time)
    container.appendChild(bar)

    function applyType(value) {
        for (const [k, b] of Object.entries(typeBtns)) {
            b.classList.toggle('is-active', k === value)
        }
    }
    applyType(initialType)

    return { setType: applyType }
}
