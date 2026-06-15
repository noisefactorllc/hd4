// SPDX-License-Identifier: MIT
/**
 * USER buttons — the assignable macro buttons (USER 1–5). This module
 * is the pure half: the action catalog and the per-slot assignment store
 * (validated + serializable). The app supplies a handler for each action id
 * and triggers it when a USER button is pressed.
 */

function buildCatalog() {
    const a = []
    for (let i = 1; i <= 4; i++) a.push({ id: `take:${i}`, label: `Take ${i}` })
    a.push(
        { id: 'cut', label: 'CUT' }, { id: 'mix', label: 'MIX' }, { id: 'wipe', label: 'WIPE' },
        { id: 'quad', label: 'QUAD' }, { id: 'pinp', label: 'PinP' }, { id: 'split', label: 'SPLIT' },
        { id: 'key', label: 'KEY' }, { id: 'freeze', label: 'FREEZE' }, { id: 'fade', label: 'FADE' },
        { id: 'still', label: 'STILL' }, { id: 'record', label: 'REC' }, { id: 'auto', label: 'AUTO' },
    )
    for (let i = 1; i <= 8; i++) a.push({ id: `mem:${i}`, label: `Recall ${i}` })
    return a
}

export const USER_ACTIONS = buildCatalog()
const ACTION_IDS = new Set(USER_ACTIONS.map((a) => a.id))
const LABELS = new Map(USER_ACTIONS.map((a) => [a.id, a.label]))

export function isUserAction(id) { return ACTION_IDS.has(id) }
export function userActionLabel(id) { return LABELS.get(id) ?? null }

export const USER_BUTTON_COUNT = 5
const DEFAULT_ASSIGNMENTS = ['freeze', 'quad', 'pinp', 'key', 'record']

export class UserButtons {
    constructor({ count = USER_BUTTON_COUNT, assignments } = {}) {
        this.count = count
        const src = (assignments && assignments.length) ? assignments : DEFAULT_ASSIGNMENTS
        this._slots = []
        for (let i = 0; i < count; i++) {
            const id = src[i]
            this._slots.push(isUserAction(id) ? id : null)
        }
    }

    get(slot) { return this._slots[slot] ?? null }

    set(slot, id) {
        if (slot < 0 || slot >= this.count) return
        if (id === null) this._slots[slot] = null
        else if (isUserAction(id)) this._slots[slot] = id
    }

    list() { return this._slots.slice() }
    serialize() { return this._slots.slice() }
    restore(arr = []) { for (let i = 0; i < this.count; i++) this.set(i, isUserAction(arr[i]) ? arr[i] : null) }
}
