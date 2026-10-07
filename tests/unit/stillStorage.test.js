// SPDX-License-Identifier: MIT
/**
 * Still storage — a captured still is stored once, as a Blob in IndexedDB
 * keyed by the SHA-256 of its bytes, and memory slots keep only that id.
 *
 * IndexedDB is a small in-memory stand-in that delivers its events
 * asynchronously and commits a transaction's writes only when it completes,
 * as a browser does. The real database is exercised by the Playwright specs.
 * Recall runs through a real Channel and media driver with the DOM stubbed
 * narrowly (Image, object URLs).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
    decodeEmbeddedStill,
    getStill,
    memoryStillsMigrated,
    migrateMemoryStills,
    stillIdOf,
    storeEmbeddedStills,
} from '../../js/stillStorage.js'
import { MemoryStore, applySnapshot } from '../../js/memory.js'
import { Channel } from '../../js/channel.js'
import { makeChannelDriverFactory } from '../../js/sources/driverFactory.js'
import { createSource, serializeSource } from '../../js/sources/sourceModel.js'

function fakeIndexedDB() {
    const databases = new Map()
    const transactions = []
    const later = (fn) => setTimeout(fn, 0)
    return {
        transactions,
        records: (db, store) => databases.get(db)?.stores.get(store)?.records,
        open(name) {
            const request = {}
            later(() => {
                const upgrading = !databases.has(name)
                if (upgrading) databases.set(name, { stores: new Map() })
                const db = databases.get(name)
                request.result = {
                    objectStoreNames: { contains: (s) => db.stores.has(s) },
                    createObjectStore: (s, { keyPath }) => db.stores.set(s, { keyPath, records: new Map() }),
                    transaction(storeName, mode, options) {
                        transactions.push({ storeName, mode, options })
                        const store = db.stores.get(storeName)
                        const staged = []
                        const tx = {
                            objectStore: () => ({
                                put(value) { staged.push(value); return {} },
                                get(key) {
                                    const req = {}
                                    later(() => { req.result = store.records.get(key) })
                                    return req
                                },
                            }),
                        }
                        later(() => later(() => {
                            for (const value of staged) store.records.set(value[store.keyPath], value)
                            tx.oncomplete?.()
                        }))
                        return tx
                    },
                    close() {},
                }
                if (upgrading) request.onupgradeneeded?.()
                request.onsuccess?.()
            })
            return request
        },
    }
}

// Installed before the module first opens its database (it keeps that connection).
const idb = fakeIndexedDB()
globalThis.indexedDB = idb
const stored = () => idb.records('hd4-stills', 'stills')

function fakeStorage() {
    const m = new Map()
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        _map: m,
    }
}

// PNG-signed bytes standing in for a captured still, and the data URL text an
// older save kept them as.
const stillBytes = (n) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, n + 1, n + 2, 0xff])
const asText = (bytes) => `data:image/png;base64,${bytes.toString('base64')}`
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const bytesOf = async (blob) => Buffer.from(await blob.arrayBuffer())

/**
 * Recall `slot` the way the app does (applySnapshot -> Channel.restore) into
 * a real channel whose image driver loads stills from still storage. Returns
 * the Blobs the driver turned into object URLs and the images it built.
 */
async function recallInto(storage, slot, t) {
    const shown = []
    const images = []
    const { createObjectURL, revokeObjectURL } = URL
    const hadImage = 'Image' in globalThis
    const OriginalImage = globalThis.Image
    URL.createObjectURL = (blob) => { shown.push(blob); return `blob:hd4-test-${shown.length}` }
    URL.revokeObjectURL = () => {}
    globalThis.Image = class { constructor() { this.src = ''; images.push(this) } }
    t.after(() => {
        URL.createObjectURL = createObjectURL
        URL.revokeObjectURL = revokeObjectURL
        if (hadImage) globalThis.Image = OriginalImage
        else delete globalThis.Image
    })
    const renderer = { compile: async () => {}, uploadMediaFrame() {} }
    const channel = new Channel({ id: 1, canvas: {}, driverFactory: makeChannelDriverFactory(renderer, null, { loadStill: getStill }) })
    const started = []
    applySnapshot(new MemoryStore(storage).load(slot), { channels: [{ restore: (src) => started.push(channel.restore(src)) }] })
    await Promise.all(started)
    return { channel, shown, images }
}

test('a still held as text decodes to its bytes and image type', async () => {
    const bytes = stillBytes(1)
    const blob = decodeEmbeddedStill(asText(bytes))
    assert.equal(blob.type, 'image/png')
    assert.deepEqual(await bytesOf(blob), bytes)
})

test('only base64 image data URLs decode', () => {
    for (const text of [
        'img/testcard.png', 'https://example.com/a.png', 'blob:http://localhost:3014/0d1e',
        'data:text/html;base64,PGh0bWw+', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png,raw',
        'data:image/png;base64,not base64!', undefined, null, 42,
    ]) {
        assert.throws(() => decodeEmbeddedStill(text), /Not an embedded still/, String(text))
    }
})

test('a still id is the SHA-256 of its bytes', async () => {
    const bytes = stillBytes(2)
    assert.equal(await stillIdOf(new Blob([bytes])), sha256(bytes))
})

test('storing commits each still once, with strict durability', async () => {
    const bytes = stillBytes(3)
    const text = asText(bytes)
    const writes = idb.transactions.length
    const ids = await storeEmbeddedStills([text, text])
    assert.deepEqual([...ids], [[text, sha256(bytes)]])
    const record = stored().get(sha256(bytes))
    assert.equal(record.id, sha256(bytes))
    // Bytes, not a Blob: Safari's private browsing refuses a Blob in IndexedDB.
    assert.ok(record.bytes instanceof ArrayBuffer)
    assert.equal(record.blob, undefined)
    assert.equal(record.type, 'image/png')
    assert.deepEqual(Buffer.from(record.bytes), bytes)
    assert.deepEqual(idb.transactions.slice(writes), [{ storeName: 'stills', mode: 'readwrite', options: { durability: 'strict' } }])
    assert.deepEqual(await bytesOf(await getStill(sha256(bytes))), bytes)
})

test('a still stored before as a Blob still reads back', async () => {
    const bytes = stillBytes(9)
    stored().set(sha256(bytes), { id: sha256(bytes), blob: new Blob([bytes], { type: 'image/png' }), storedAt: 1 })
    assert.deepEqual(await bytesOf(await getStill(sha256(bytes))), bytes)
})

test('nothing to store never opens a transaction', async () => {
    const before = idb.transactions.length
    assert.deepEqual(await storeEmbeddedStills([]), new Map())
    assert.equal(idb.transactions.length, before)
})

test('a still that is not stored, or a bad id, reads as null', async (t) => {
    t.mock.method(console, 'warn', () => {})
    assert.equal(await getStill('f'.repeat(64)), null)
    assert.equal(await getStill('not-an-id'), null)
    assert.equal(await getStill(undefined), null)
})

test('without IndexedDB, storing fails closed and slots keep their stills', async (t) => {
    delete globalThis.indexedDB
    t.after(() => { globalThis.indexedDB = idb })
    const text = asText(stillBytes(4))
    await assert.rejects(storeEmbeddedStills([text]), /unavailable/)
    assert.equal(await getStill(sha256(stillBytes(4))), null)
    const storage = fakeStorage()
    storage.setItem('hd4.memory.1', JSON.stringify({ version: 1, channels: [{ type: 'image', name: 'Still', url: text }] }))
    const before = storage.getItem('hd4.memory.1')
    assert.equal(await migrateMemoryStills(new MemoryStore(storage)), 0)
    assert.equal(storage.getItem('hd4.memory.1'), before)
})

test('older slots move their stills to IndexedDB on load and recall them after a reload', async (t) => {
    const bytes = stillBytes(5)
    const text = asText(bytes)
    const storage = fakeStorage()
    for (const slot of [1, 6]) {
        storage.setItem(`hd4.memory.${slot}`, JSON.stringify({
            version: 1,
            channels: [{ type: 'image', name: 'Still', url: text }, { type: 'camera', deviceId: '' }],
            switcher: { live: 1, type: 'cut', time: 1 },
        }))
    }

    assert.equal(await migrateMemoryStills(new MemoryStore(storage)), 2)
    await memoryStillsMigrated()

    for (const slot of [1, 6]) {
        const slotText = storage.getItem(`hd4.memory.${slot}`)
        assert.equal(/data:|blob:/.test(slotText), false)
        assert.deepEqual(JSON.parse(slotText).channels[0], { type: 'image', name: 'Still', stillId: sha256(bytes) })
    }
    assert.deepEqual(Buffer.from(stored().get(sha256(bytes)).bytes), bytes)

    // A reload: a fresh store over the same localStorage, recalled into a channel.
    const { channel, shown, images } = await recallInto(storage, 1, t)
    assert.deepEqual(channel.source, { type: 'image', name: 'Still', url: '', stillId: sha256(bytes) })
    assert.equal(shown.length, 1)
    assert.deepEqual(await bytesOf(shown[0]), bytes)
    assert.equal(images[0].src, 'blob:hd4-test-1')
})

test('a still saved this session is a reference in the slot and shows again after a reload', async (t) => {
    const bytes = stillBytes(6)
    const storage = fakeStorage()
    // Channel 1 shows the captured still the way the app sets it: by data URL.
    const showing = createSource('image', { url: asText(bytes), name: 'Still' })
    const snapshot = { version: 1, channels: [serializeSource(showing), serializeSource(createSource('camera'))] }

    await new MemoryStore(storage).saveWithStills(1, snapshot, storeEmbeddedStills)

    const slotText = storage.getItem('hd4.memory.1')
    assert.equal(/data:|blob:/.test(slotText), false)
    assert.ok(slotText.length < 200, `the slot holds a reference, not the image (${slotText.length} chars)`)
    assert.deepEqual(JSON.parse(slotText).channels[0], { type: 'image', name: 'Still', stillId: sha256(bytes) })

    const { shown, images } = await recallInto(storage, 1, t)
    assert.deepEqual(await bytesOf(shown[0]), bytes)
    assert.equal(images[0].src, 'blob:hd4-test-1')
})
