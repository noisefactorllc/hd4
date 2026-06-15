// SPDX-License-Identifier: MIT
/**
 * Memory — 8-slot save/recall of the full mixer state.
 *
 * MemoryStore persists snapshots through an injected storage (localStorage
 * in the app, a fake in tests). captureSnapshot reads the live modules
 * into a plain serializable object; applySnapshot drives them back from
 * one. Transient output (FREEZE / OUTPUT FADE) is intentionally not saved,
 * matching the hardware.
 */
export const MEMORY_SLOTS = 8

// JSON drops non-finite numbers to null; audio params legitimately use them
// (a send at -Infinity = off, a compressor ratio of Infinity = INF:1). Encode
// them as sentinels so save/recall round-trips faithfully.
function jsonReplacer(_key, value) {
    if (value === Infinity) return '__Infinity__'
    if (value === -Infinity) return '__-Infinity__'
    if (typeof value === 'number' && Number.isNaN(value)) return '__NaN__'
    return value
}
function jsonReviver(_key, value) {
    if (value === '__Infinity__') return Infinity
    if (value === '__-Infinity__') return -Infinity
    if (value === '__NaN__') return NaN
    return value
}

export class MemoryStore {
    constructor(storage, { prefix = 'hd4.memory.', slots = MEMORY_SLOTS } = {}) {
        this._storage = storage
        this._prefix = prefix
        this._slots = slots
    }

    _key(slot) { return `${this._prefix}${slot}` }

    save(slot, snapshot) {
        this._storage.setItem(this._key(slot), JSON.stringify(snapshot, jsonReplacer))
    }

    load(slot) {
        const raw = this._storage.getItem(this._key(slot))
        if (!raw) return null
        try { return JSON.parse(raw, jsonReviver) } catch { return null }
    }

    has(slot) { return this._storage.getItem(this._key(slot)) != null }

    clear(slot) { this._storage.removeItem(this._key(slot)) }

    list() {
        const out = []
        for (let i = 1; i <= this._slots; i++) if (this.has(i)) out.push(i)
        return out
    }
}

export function captureSnapshot({ channels, switcher, output, compositor, audio }) {
    return {
        version: 1,
        channels: channels.map((c) => c.serialize()),
        switcher: { live: switcher.live, type: switcher.type, time: switcher.time },
        output: { vfx: output.vfx },
        composition: compositor ? compositor.snapshot() : undefined,
        audio: {
            channels: channels.map((_, i) => ({
                fader: audio.faderOf(i),
                muted: audio.isMuted(i),
                soloed: audio.isSoloed(i),
                ...(audio.stripParams ? { strip: audio.stripParams(i) } : {}),
            })),
            main: audio.mainFader(),
            ...(audio.mainParams ? { mainBus: audio.mainParams() } : {}),
        },
    }
}

export function applySnapshot(snap, { channels, switcher, output, compositor, audio }) {
    if (!snap) return
    if (Array.isArray(snap.channels)) {
        snap.channels.forEach((src, i) => channels[i]?.restore(src))
    }
    if (snap.switcher && switcher) {
        switcher.setType(snap.switcher.type)
        switcher.setTime(snap.switcher.time)
        switcher.cut(snap.switcher.live)
    }
    if (snap.output && output) {
        output.setVfx(snap.output.vfx || 'none')
    }
    if (snap.composition && compositor) compositor.restore(snap.composition)
    if (snap.audio && audio) {
        if (Array.isArray(snap.audio.channels)) {
            snap.audio.channels.forEach((s, i) => {
                audio.setFader(i, s.fader)
                audio.setMute(i, !!s.muted)
                audio.setSolo(i, !!s.soloed)
                if (s.strip && audio.setStripParams) audio.setStripParams(i, s.strip)
            })
        }
        if (typeof snap.audio.main === 'number') audio.setMainFader(snap.audio.main)
        if (snap.audio.mainBus && audio.setMainParams) audio.setMainParams(snap.audio.mainBus)
    }
}
