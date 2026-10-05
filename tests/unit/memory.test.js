// SPDX-License-Identifier: MIT
/**
 * Memory — 8-slot save/recall of the full mixer state.
 * The slot store (injected storage) and the snapshot capture/apply are
 * pure and unit-tested; the live re-application is integration-tested.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    MemoryStore,
    captureSnapshot,
    applySnapshot,
    MEMORY_SLOTS,
    embeddedStills,
    referenceStills,
} from '../../js/memory.js'

function fakeStorage() {
    const m = new Map()
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        _map: m,
    }
}

const sampleModulesForCapture = () => ({
    channels: [
        { serialize: () => ({ type: 'shader', dsl: 'noise().write(o0)', name: 'Noise' }) },
        { serialize: () => ({ type: 'camera', deviceId: 'cam-1' }) },
    ],
    switcher: { live: 2, type: 'wipe', time: 1.5 },
    output: { vfx: 'mono' },
    compositor: { snapshot: () => ({ composition: 'quad', key: { on: true } }) },
    audio: {
        faderOf: (i) => [0.5, 0.6][i],
        isMuted: (i) => [false, true][i],
        isSoloed: (i) => [true, false][i],
        mainFader: () => 0.8,
        stripParams: (i) => ({ pan: [-0.5, 0.5][i], eqHi: 3 }),
        mainParams: () => ({ reverbType: 'hall', eqLo: 2 }),
    },
})

test('MemoryStore round-trips a snapshot through injected storage', () => {
    const store = new MemoryStore(fakeStorage())
    const snap = { version: 1, switcher: { live: 3 } }
    store.save(2, snap)
    assert.deepEqual(store.load(2), snap)
})

test('MemoryStore preserves Infinity / -Infinity across save+load (JSON would lose them)', () => {
    const store = new MemoryStore(fakeStorage())
    // e.g. comp ratio INF:1 and an audio send turned fully off (-Infinity).
    store.save(1, { audio: { channels: [{ strip: { compRatio: Infinity, auxSend: -Infinity } }] } })
    const r = store.load(1)
    assert.equal(r.audio.channels[0].strip.compRatio, Infinity)
    assert.equal(r.audio.channels[0].strip.auxSend, -Infinity)
})

test('loading an empty slot returns null; has() reflects occupancy', () => {
    const store = new MemoryStore(fakeStorage())
    assert.equal(store.load(5), null)
    assert.equal(store.has(5), false)
    store.save(5, { version: 1 })
    assert.equal(store.has(5), true)
})

test('clear() empties a slot; list() reports occupied slots', () => {
    const store = new MemoryStore(fakeStorage())
    store.save(1, { version: 1 })
    store.save(4, { version: 1 })
    assert.deepEqual(store.list(), [1, 4])
    store.clear(1)
    assert.deepEqual(store.list(), [4])
})

test('loading corrupt data returns null instead of throwing', () => {
    const storage = fakeStorage()
    storage.setItem('hd4.memory.3', '{not json')
    const store = new MemoryStore(storage)
    assert.equal(store.load(3), null)
})

test('there are 8 memory slots', () => {
    assert.equal(MEMORY_SLOTS, 8)
})

test('captureSnapshot records channels, switcher, output, and audio', () => {
    const snap = captureSnapshot(sampleModulesForCapture())
    assert.equal(snap.version, 1)
    assert.deepEqual(snap.channels, [
        { type: 'shader', dsl: 'noise().write(o0)', name: 'Noise' },
        { type: 'camera', deviceId: 'cam-1' },
    ])
    assert.deepEqual(snap.switcher, { live: 2, type: 'wipe', time: 1.5 })
    assert.deepEqual(snap.output, { vfx: 'mono' })
    assert.deepEqual(snap.composition, { composition: 'quad', key: { on: true } })
    assert.deepEqual(snap.audio, {
        channels: [
            { fader: 0.5, muted: false, soloed: true, strip: { pan: -0.5, eqHi: 3 } },
            { fader: 0.6, muted: true, soloed: false, strip: { pan: 0.5, eqHi: 3 } },
        ],
        main: 0.8,
        mainBus: { reverbType: 'hall', eqLo: 2 },
    })
})

test('applySnapshot drives the live modules with the saved values', () => {
    const calls = []
    const modules = {
        channels: [
            { restore: (s) => calls.push(['restore', 0, s.type]) },
            { restore: (s) => calls.push(['restore', 1, s.type]) },
        ],
        switcher: {
            setType: (t) => calls.push(['setType', t]),
            setTime: (s) => calls.push(['setTime', s]),
            cut: (n) => calls.push(['cut', n]),
        },
        output: {
            setVfx: (v) => calls.push(['setVfx', v]),
        },
        compositor: {
            restore: (c) => calls.push(['restore-comp', c?.composition]),
        },
        audio: {
            setFader: (i, p) => calls.push(['setFader', i, p]),
            setMute: (i, b) => calls.push(['setMute', i, b]),
            setSolo: (i, b) => calls.push(['setSolo', i, b]),
            setMainFader: (p) => calls.push(['setMainFader', p]),
            setStripParams: (i, s) => calls.push(['setStripParams', i, s?.pan]),
            setMainParams: (m) => calls.push(['setMainParams', m?.reverbType]),
        },
    }
    const snap = captureSnapshot(sampleModulesForCapture())
    applySnapshot(snap, modules)

    assert.ok(calls.some((c) => c[0] === 'restore' && c[1] === 1 && c[2] === 'camera'))
    assert.ok(calls.some((c) => c[0] === 'setType' && c[1] === 'wipe'))
    assert.ok(calls.some((c) => c[0] === 'setTime' && c[1] === 1.5))
    assert.ok(calls.some((c) => c[0] === 'cut' && c[1] === 2))
    assert.ok(calls.some((c) => c[0] === 'restore-comp' && c[1] === 'quad'))
    assert.ok(calls.some((c) => c[0] === 'setVfx' && c[1] === 'mono'))
    assert.ok(calls.some((c) => c[0] === 'setFader' && c[1] === 1 && c[2] === 0.6))
    assert.ok(calls.some((c) => c[0] === 'setMute' && c[1] === 1 && c[2] === true))
    assert.ok(calls.some((c) => c[0] === 'setSolo' && c[1] === 0 && c[2] === true))
    assert.ok(calls.some((c) => c[0] === 'setStripParams' && c[1] === 1 && c[2] === 0.5))
    assert.ok(calls.some((c) => c[0] === 'setMainParams' && c[1] === 'hall'))
    assert.ok(calls.some((c) => c[0] === 'setMainFader' && c[1] === 0.8))
})

test('applySnapshot tolerates a null/empty snapshot', () => {
    assert.doesNotThrow(() => applySnapshot(null, {}))
})

test('applySnapshot applies a legacy v1 snapshot (no composition/strip/mainBus)', () => {
    const calls = []
    const modules = {
        channels: [{ restore: () => calls.push('restore') }],
        switcher: { setType: () => {}, setTime: () => {}, cut: () => {} },
        output: { setVfx: () => {} },
        compositor: { restore: () => calls.push('comp') },
        audio: {
            setFader: () => {}, setMute: () => {}, setSolo: () => {}, setMainFader: () => {},
            setStripParams: () => calls.push('strip'), setMainParams: () => calls.push('main'),
        },
    }
    const legacy = {
        version: 1,
        channels: [{ type: 'shader' }],
        switcher: { live: 1, type: 'mix', time: 1 },
        output: { vfx: 'none' },
        audio: { channels: [{ fader: 0.5, muted: false, soloed: false }], main: 0.8 },
    }
    assert.doesNotThrow(() => applySnapshot(legacy, modules))
    assert.ok(calls.includes('restore')) // v1 fields applied
    assert.ok(!calls.includes('comp')) // no composition in a legacy snapshot
    assert.ok(!calls.includes('strip'))
    assert.ok(!calls.includes('main'))
})

// --- Stills: a slot keeps a reference; the bytes live in still storage ---

// A channel showing the captured still serializes with the still as data URL
// text; older saves wrote exactly that into the slot.
const STILL_TEXT = 'data:image/png;base64,iVBORw0KGgoAAAA='
const STILL_ID = 'c'.repeat(64)
const stillSnapshot = () => ({
    version: 1,
    channels: [
        { type: 'image', name: 'Still', url: STILL_TEXT },
        { type: 'shader', dsl: 'noise().write(o0)', name: 'Noise' },
    ],
    switcher: { live: 1, type: 'mix', time: 1 },
    audio: { channels: [{ fader: 0.5, strip: { compRatio: Infinity, auxSend: -Infinity } }], main: 0.8 },
})
// The slot text an older save wrote (same sentinels for non-finite numbers).
const legacyText = (snap) => JSON.stringify(snap, (_k, v) => (
    v === Infinity ? '__Infinity__' : v === -Infinity ? '__-Infinity__' : v
))
const slotText = (storage, slot) => storage._map.get(`hd4.memory.${slot}`)
const storesStill = async () => new Map([[STILL_TEXT, STILL_ID]])

test('a slot never carries an image as a data: or blob: URL', () => {
    const store = new MemoryStore(fakeStorage())
    for (const url of [STILL_TEXT, 'DATA:image/png;base64,AAAA', 'blob:http://localhost:3014/0d1e']) {
        assert.throws(() => store.save(1, { version: 1, channels: [{ type: 'image', name: 'Still', url }] }), /data: or blob: URL/)
    }
    assert.equal(store.has(1), false)
    store.save(1, { version: 1, channels: [{ type: 'image', name: 'Test Card', url: 'img/testcard.png' }] })
    assert.equal(store.has(1), true)
})

test('saving a still stores it first, and the slot keeps only its id', async () => {
    const storage = fakeStorage()
    const store = new MemoryStore(storage)
    const requests = []
    await store.saveWithStills(2, stillSnapshot(), async (urls) => {
        requests.push(urls)
        assert.equal(store.has(2), false, 'the slot is written only after the still is stored')
        return storesStill()
    })
    assert.deepEqual(requests, [[STILL_TEXT]])
    assert.equal(slotText(storage, 2).includes('data:'), false)
    const saved = store.load(2)
    assert.deepEqual(saved.channels, [
        { type: 'image', name: 'Still', stillId: STILL_ID },
        { type: 'shader', dsl: 'noise().write(o0)', name: 'Noise' },
    ])
    assert.equal(saved.audio.channels[0].strip.compRatio, Infinity)
})

test('a still that cannot be stored leaves the slot as it was', async () => {
    const storage = fakeStorage()
    const store = new MemoryStore(storage)
    store.save(3, { version: 1, switcher: { live: 2 } })
    const before = slotText(storage, 3)
    await assert.rejects(
        store.saveWithStills(3, stillSnapshot(), async () => { throw new Error('IndexedDB unavailable') }),
        /IndexedDB unavailable/,
    )
    assert.equal(slotText(storage, 3), before)
})

test('a snapshot without a still saves without touching still storage', async () => {
    const store = new MemoryStore(fakeStorage())
    const snap = { version: 1, channels: [{ type: 'camera', deviceId: '' }, { type: 'image', name: 'Test Card', url: 'img/testcard.png' }] }
    await store.saveWithStills(1, snap, async () => { throw new Error('must not be called') })
    assert.deepEqual(store.load(1), snap)
})

test('embeddedStills lists each still held as text once; referenceStills swaps in ids', () => {
    const snap = stillSnapshot()
    snap.channels.push({ type: 'image', name: 'Still', url: STILL_TEXT }, { type: 'image', name: 'Test Card', url: 'img/testcard.png' })
    assert.deepEqual(embeddedStills(snap), [STILL_TEXT])
    assert.deepEqual(embeddedStills({ version: 1 }), [])
    const referenced = referenceStills(snap, new Map([[STILL_TEXT, STILL_ID]]))
    assert.deepEqual(embeddedStills(referenced), [])
    assert.deepEqual(referenced.channels[2], { type: 'image', name: 'Still', stillId: STILL_ID })
    assert.deepEqual(referenced.channels[3], { type: 'image', name: 'Test Card', url: 'img/testcard.png' })
    assert.equal(snap.channels[0].url, STILL_TEXT, 'the input snapshot is not modified')
})

test('older slots lose their still text only after the still is stored', async () => {
    const storage = fakeStorage()
    storage.setItem('hd4.memory.1', legacyText(stillSnapshot()))
    storage.setItem('hd4.memory.2', legacyText({ version: 1, channels: [{ type: 'camera', deviceId: 'cam-1' }] }))
    storage.setItem('hd4.memory.3', legacyText(stillSnapshot())) // the same still in a second slot
    const plain = slotText(storage, 2)
    let commit
    const committed = new Promise((resolve) => { commit = resolve })
    const requests = []
    const moving = new MemoryStore(storage).moveEmbeddedStills((urls) => { requests.push(urls); return committed })

    assert.ok(slotText(storage, 1).includes(STILL_TEXT), 'the text stays until the still has committed')
    commit(new Map([[STILL_TEXT, STILL_ID]]))
    assert.equal(await moving, 2)

    assert.deepEqual(requests, [[STILL_TEXT]], 'one still, stored once for both slots')
    for (const slot of [1, 3]) {
        assert.equal(slotText(storage, slot).includes('data:'), false)
        const snap = new MemoryStore(storage).load(slot)
        assert.deepEqual(snap.channels[0], { type: 'image', name: 'Still', stillId: STILL_ID })
        assert.equal(snap.audio.channels[0].strip.auxSend, -Infinity)
    }
    assert.equal(slotText(storage, 2), plain, 'a slot without a still is not rewritten')
})

test('a slot whose still cannot be stored keeps it', async (t) => {
    t.mock.method(console, 'error', () => {})
    const storage = fakeStorage()
    storage.setItem('hd4.memory.1', legacyText(stillSnapshot()))
    const before = slotText(storage, 1)
    const store = new MemoryStore(storage)
    assert.equal(await store.moveEmbeddedStills(async () => { throw new Error('IndexedDB unavailable') }), 0)
    assert.equal(await store.moveEmbeddedStills(async () => new Map()), 0, 'a still the store did not report')
    assert.equal(slotText(storage, 1), before)
})

test('a slot saved while its still is moving keeps the new save', async () => {
    const storage = fakeStorage()
    storage.setItem('hd4.memory.1', legacyText(stillSnapshot()))
    const store = new MemoryStore(storage)
    const moved = await store.moveEmbeddedStills(async () => {
        store.save(1, { version: 1, switcher: { live: 4 } }) // the user saves over slot 1 meanwhile
        return storesStill()
    })
    assert.equal(moved, 0)
    assert.deepEqual(store.load(1), { version: 1, switcher: { live: 4 } })
})

test('a slot that cannot be rewritten keeps its still text', async (t) => {
    t.mock.method(console, 'error', () => {})
    const storage = fakeStorage()
    storage.setItem('hd4.memory.1', legacyText(stillSnapshot()))
    const before = slotText(storage, 1)
    storage.setItem = () => { throw new Error('QuotaExceededError') }
    assert.equal(await new MemoryStore(storage).moveEmbeddedStills(storesStill), 0)
    assert.equal(slotText(storage, 1), before)
})

test('a corrupt slot is left alone by the move', async () => {
    const storage = fakeStorage()
    storage.setItem('hd4.memory.4', '{not json')
    assert.equal(await new MemoryStore(storage).moveEmbeddedStills(async () => { throw new Error('must not be called') }), 0)
    assert.equal(slotText(storage, 4), '{not json')
})
