// SPDX-License-Identifier: MIT
/**
 * USER bar — the assignable USER 1–5 macro buttons. Each slot is a
 * trigger button (showing its assigned action) plus a select to reassign it.
 * Triggers report through onTrigger(slot); reassignments through
 * onAssign(slot, actionId|null).
 */
import { USER_ACTIONS, userActionLabel } from '../userButtons.js'

const GROUPS = [
    ['Take', (id) => id.startsWith('take:')],
    ['Transition', (id) => ['cut', 'mix', 'wipe'].includes(id)],
    ['Composite', (id) => ['quad', 'pinp', 'split', 'key'].includes(id)],
    ['Output', (id) => ['freeze', 'fade', 'still', 'record', 'auto'].includes(id)],
    ['Memory', (id) => id.startsWith('mem:')],
]

export function buildUserBar(container, { count = 5, initial = [], onTrigger, onAssign } = {}) {
    const bar = document.createElement('div')
    bar.className = 'hd4-user-bar'

    const heading = document.createElement('span')
    heading.className = 'hd4-section-label'
    heading.textContent = 'USER'
    bar.appendChild(heading)

    const slots = []
    for (let i = 0; i < count; i++) {
        const col = document.createElement('div')
        col.className = 'hd4-user-slot'

        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'hd4-user-btn'
        btn.dataset.slot = String(i + 1)
        btn.addEventListener('click', () => onTrigger?.(i))

        const sel = document.createElement('select')
        sel.className = 'hd4-user-assign'
        sel.dataset.slot = String(i + 1)
        sel.setAttribute('aria-label', `USER ${i + 1} assignment`)
        const none = document.createElement('option')
        none.value = ''
        none.textContent = '— none —'
        sel.appendChild(none)
        for (const [name, match] of GROUPS) {
            const g = document.createElement('optgroup')
            g.label = name
            for (const a of USER_ACTIONS) if (match(a.id)) { const o = document.createElement('option'); o.value = a.id; o.textContent = a.label; g.appendChild(o) }
            sel.appendChild(g)
        }
        sel.addEventListener('change', () => onAssign?.(i, sel.value || null))

        col.append(btn, sel)
        bar.appendChild(col)
        slots.push({ btn, sel })
        setAssignment(i, initial[i] ?? null)
    }
    container.appendChild(bar)

    function setAssignment(i, id) {
        const s = slots[i]
        if (!s) return
        s.sel.value = id || ''
        s.btn.textContent = id ? userActionLabel(id) : `U${i + 1}`
        s.btn.title = id ? `USER ${i + 1}: ${userActionLabel(id)}` : `USER ${i + 1} (unassigned)`
        s.btn.classList.toggle('is-unassigned', !id)
    }

    return {
        setAssignment,
        setAll(list = []) { for (let i = 0; i < count; i++) setAssignment(i, list[i] ?? null) },
    }
}
