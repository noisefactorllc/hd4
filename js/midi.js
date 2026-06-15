// SPDX-License-Identifier: MIT
/**
 * MIDI control — pure message parsing and the learn/map store. The live Web
 * MIDI access is wired in the app; this module turns raw bytes into events,
 * tags each control with a stable signature, and maps signatures to mixer
 * targets (an action button or a continuous fader). MIDI-learn binds the
 * next incoming control to the armed target.
 */
import { USER_ACTIONS } from './userButtons.js'

/** Continuous (fader) MIDI targets. */
export const MIDI_FADERS = [
    { id: 'fader:1', label: 'CH1 fader' },
    { id: 'fader:2', label: 'CH2 fader' },
    { id: 'fader:3', label: 'CH3 fader' },
    { id: 'fader:4', label: 'CH4 fader' },
    { id: 'fader:main', label: 'Main fader' },
    { id: 'transitionTime', label: 'Transition time' },
]

/** All learnable targets (actions + faders) for the learn UI. */
export const MIDI_TARGETS = [
    ...USER_ACTIONS.map((a) => ({ kind: 'action', id: a.id, label: a.label })),
    ...MIDI_FADERS.map((f) => ({ kind: 'fader', id: f.id, label: f.label })),
]

/** Decode a raw MIDI message; null for unsupported (realtime, sysex, …). */
export function parseMidiMessage(bytes) {
    if (!bytes || bytes.length < 2) return null
    const status = bytes[0] & 0xf0
    const channel = bytes[0] & 0x0f
    const data1 = bytes[1] ?? 0
    const data2 = bytes[2] ?? 0
    if (status === 0x90) return { type: data2 > 0 ? 'noteon' : 'noteoff', channel, data1, data2 }
    if (status === 0x80) return { type: 'noteoff', channel, data1, data2 }
    if (status === 0xb0) return { type: 'cc', channel, data1, data2 }
    return null
}

/** A stable per-control key (channel-agnostic): 'note:<n>' or 'cc:<n>'. */
export function midiSignature(msg) {
    if (!msg) return null
    if (msg.type === 'noteon' || msg.type === 'noteoff') return `note:${msg.data1}`
    if (msg.type === 'cc') return `cc:${msg.data1}`
    return null
}

export class MidiMap {
    constructor() {
        this._map = new Map() // signature → { kind, id }
        this._learning = null
    }

    get learning() { return this._learning !== null }

    arm(target) { this._learning = target || null }
    cancel() { this._learning = null }

    bind(signature, target) { if (signature) this._map.set(signature, target) }
    get(signature) { return this._map.get(signature) || null }
    clear(signature) { this._map.delete(signature) }
    list() { return [...this._map.entries()].map(([signature, target]) => ({ signature, target })) }

    /**
     * Process a message. While learning, binds the control and returns
     * { learned }. Otherwise returns { action } / { fader, value } / null.
     */
    handle(msg) {
        const sig = midiSignature(msg)
        if (!sig) return null
        if (this._learning) {
            const target = this._learning
            this._map.set(sig, target)
            this._learning = null
            return { learned: { signature: sig, target } }
        }
        const target = this._map.get(sig)
        if (!target) return null
        if (target.kind === 'fader') return { fader: target.id, value: msg.data2 / 127 }
        // action: fire on note-on / CC press (>=64), ignore releases
        const pressed = msg.type === 'noteon' || (msg.type === 'cc' && msg.data2 >= 64)
        return pressed ? { action: target.id } : null
    }

    serialize() { return this.list().map(({ signature, target }) => [signature, target]) }
    restore(arr = []) {
        this._map.clear()
        for (const [signature, target] of arr) if (signature && target?.id) this._map.set(signature, target)
    }
}
