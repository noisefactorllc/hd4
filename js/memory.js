// SPDX-License-Identifier: MIT
/**
 * Memory — 8-slot save/recall of the full mixer state.
 *
 * MemoryStore persists snapshots through an injected storage (localStorage
 * in the app, a fake in tests). captureSnapshot reads the live modules
 * into a plain serializable object; applySnapshot drives them back from
 * one. Transient output (FREEZE / OUTPUT FADE) is intentionally not saved,
 * matching the hardware.
 *
 * A channel showing a captured still is saved as a reference,
 * { type: 'image', name, stillId }. The still's bytes are stored once, as a
 * Blob in IndexedDB (stillStorage.js). A slot never carries an image as a
 * data: or blob: URL: Chrome allows 5,242,880 characters of localStorage per
 * origin, and one high-resolution still as text came close to filling it.
 */
export const MEMORY_SLOTS = 8

// data: URLs carry an image as text; blob: URLs end with the page.
const UNSAVEABLE_URL = /^(?:data|blob):/i
const isDataUrl = (url) => typeof url === 'string' && /^data:/i.test(url)

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
        const channels = Array.isArray(snapshot?.channels) ? snapshot.channels : []
        if (channels.some((src) => typeof src?.url === 'string' && UNSAVEABLE_URL.test(src.url))) {
            throw new Error('A memory slot must not carry an image as a data: or blob: URL')
        }
        this._storage.setItem(this._key(slot), JSON.stringify(snapshot, jsonReplacer))
    }

    /**
     * Save a snapshot whose channels may show a still as a data URL. The stills
     * are stored first, through `storeStills`, and the slot keeps only their
     * ids. If storing fails this rejects and the slot is not written, because
     * a slot must never name a still that is not stored.
     *
     * @param {number} slot
     * @param {object} snapshot from captureSnapshot
     * @param {(dataUrls: string[]) => Promise<Map<string, string>>} storeStills
     *        resolves, once every still is committed, with data URL -> still id
     */
    async saveWithStills(slot, snapshot, storeStills) {
        const dataUrls = embeddedStills(snapshot)
        const ids = dataUrls.length ? await storeStills(dataUrls) : new Map()
        this.save(slot, referenceStills(snapshot, ids))
    }

    /**
     * Move the stills that older saves kept in slots as data URL text out to
     * still storage, then remove the text from the slots. That frees the
     * localStorage they filled.
     *
     * A slot loses its text only after `storeStills` has committed every still
     * in it, so a failure leaves the slot exactly as it was. Each slot is read
     * again before it is rewritten: a save made meanwhile is kept.
     *
     * @param {(dataUrls: string[]) => Promise<Map<string, string>>} storeStills
     * @returns {Promise<number>} how many slots were moved
     */
    async moveEmbeddedStills(storeStills) {
        const committed = new Map() // data URL -> still id, stored during this run
        let moved = 0
        for (let i = 1; i <= this._slots; i++) {
            const key = this._key(i)
            const raw = this._storage.getItem(key)
            if (!raw) continue
            let snapshot
            try { snapshot = JSON.parse(raw, jsonReviver) } catch { continue }
            const dataUrls = embeddedStills(snapshot)
            if (!dataUrls.length) continue
            try {
                const pending = dataUrls.filter((url) => !committed.has(url))
                if (pending.length) {
                    const ids = await storeStills(pending)
                    for (const url of pending) {
                        if (!ids.has(url)) throw new Error('a still was not stored')
                        committed.set(url, ids.get(url))
                    }
                }
            } catch (err) {
                console.error(`[hd4] memory ${i} keeps its still as text: it could not be stored`, err)
                continue
            }
            if (this._storage.getItem(key) !== raw) continue // saved again meanwhile
            try {
                this.save(i, referenceStills(snapshot, committed))
                moved++
            } catch (err) {
                console.error(`[hd4] memory ${i} keeps its still as text: the slot could not be rewritten`, err)
            }
        }
        return moved
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

/** The stills a snapshot's channels show as data URL text, each once. */
export function embeddedStills(snapshot) {
    const channels = Array.isArray(snapshot?.channels) ? snapshot.channels : []
    const urls = channels.filter((src) => src?.type === 'image' && isDataUrl(src.url)).map((src) => src.url)
    return [...new Set(urls)]
}

/**
 * The snapshot with each still shown as data URL text replaced by a reference
 * to its stored copy. `ids` maps data URL -> still id; other channels are
 * unchanged.
 */
export function referenceStills(snapshot, ids) {
    if (!Array.isArray(snapshot?.channels)) return snapshot
    return {
        ...snapshot,
        channels: snapshot.channels.map((src) => (
            src?.type === 'image' && isDataUrl(src.url) && ids.has(src.url)
                ? { type: 'image', name: src.name || '', stillId: ids.get(src.url) }
                : src
        )),
    }
}

/**
 * The still ids the occupied slots name, each once, in slot order. A slot
 * keeps only the id of a still it shows (its bytes live in still storage),
 * so this is what the pickers' Capture group availability reads: the option
 * exists whenever a stored still a slot can name exists — after a reload and
 * a recall too, not only after a fresh capture.
 */
export function slotStillIds(memory) {
    const ids = []
    for (const slot of memory.list()) {
        const snapshot = memory.load(slot)
        for (const src of Array.isArray(snapshot?.channels) ? snapshot.channels : []) {
            if (src?.type === 'image' && typeof src.stillId === 'string' && !ids.includes(src.stillId)) {
                ids.push(src.stillId)
            }
        }
    }
    return ids
}

export function captureSnapshot({ channels, switcher, output, compositor, audio, renderers, preview }) {
    return {
        version: 1,
        channels: channels.map((c) => c.serialize()),
        // Per-channel fit mode (cover/contain) — a renderer setting the user
        // reaches from each multiview tile, not part of a channel's source.
        fits: channels.map((_, i) => renderers?.[i]?.fitMode || 'cover'),
        // The PVW preview-bus selection.
        preview: preview?.preview,
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

export function applySnapshot(snap, { channels, switcher, output, compositor, audio, renderers, preview }) {
    if (!snap) return
    if (Array.isArray(snap.channels)) {
        // A restore whose driver fails to start (a denied camera in a
        // recalled slot) falls back on the channel itself; swallow the
        // rejection so one bad source cannot surface unhandled.
        snap.channels.forEach((src, i) => {
            const restored = channels[i]?.restore(src)
            if (restored && typeof restored.catch === 'function') {
                restored.catch((e) => console.warn(`[hd4] channel ${i + 1} source was not recalled`, e?.message || e))
            }
        })
    }
    if (Array.isArray(snap.fits)) {
        snap.fits.forEach((mode, i) => {
            if (mode === 'cover' || mode === 'contain') renderers?.[i]?.setFitMode(mode)
        })
    }
    if (preview && Number.isInteger(snap.preview)) preview.set(snap.preview)
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
