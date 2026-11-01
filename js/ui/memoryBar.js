// SPDX-License-Identifier: MIT
/**
 * Memory bar — the MEMORY slots. Eight numbered buttons recall a
 * saved state; arming SAVE turns the next slot click into a save. Occupied
 * slots are marked. Appends to its container (sits beside the brand /
 * output controls in the top bar).
 */
export function buildMemoryBar(container, { slots = 8, onSave, onRecall } = {}) {
    const wrap = document.createElement('div')
    wrap.className = 'hd4-memory'

    const label = document.createElement('span')
    label.className = 'hd4-section-label'
    label.textContent = 'MEM'

    const saveBtn = document.createElement('button')
    saveBtn.type = 'button'
    saveBtn.className = 'hd4-mem-save'
    saveBtn.textContent = 'SAVE'
    saveBtn.setAttribute('aria-pressed', 'false')
    saveBtn.setAttribute('aria-label', 'Arm save: the next memory slot click stores the current state')

    const slotsWrap = document.createElement('div')
    slotsWrap.className = 'hd4-mem-slots'

    const status = document.createElement('span')
    status.className = 'hd4-mem-status'
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    status.setAttribute('aria-atomic', 'true')

    let armed = false
    const slotBtns = []
    for (let i = 1; i <= slots; i++) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'hd4-mem-slot'
        b.dataset.slot = String(i)
        b.textContent = String(i)
        b.setAttribute('aria-label', `Memory ${i}`)
        b.setAttribute('aria-description', 'Empty')
        b.addEventListener('click', () => {
            if (armed) { onSave?.(i); setArmed(false) }
            else onRecall?.(i)
        })
        slotsWrap.appendChild(b)
        slotBtns.push(b)
    }

    saveBtn.addEventListener('click', () => setArmed(!armed))

    function setArmed(on) {
        armed = !!on
        saveBtn.classList.toggle('is-active', armed)
        saveBtn.setAttribute('aria-pressed', String(armed))
        wrap.classList.toggle('is-arming', armed)
    }

    wrap.append(label, saveBtn, slotsWrap, status)
    container.appendChild(wrap)

    return {
        el: wrap,
        setOccupied(list) {
            const set = new Set(list)
            slotBtns.forEach((b, idx) => {
                const occupied = set.has(idx + 1)
                b.classList.toggle('is-occupied', occupied)
                b.setAttribute('aria-description', occupied ? 'Saved' : 'Empty')
            })
        },
        setSaveFailure(slot) { status.textContent = slot == null ? '' : `memory ${slot} was not saved` },
        setArmed,
    }
}
