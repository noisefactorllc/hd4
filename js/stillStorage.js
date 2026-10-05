// SPDX-License-Identifier: MIT
/**
 * Still storage — the captured stills that memory slots use.
 *
 * A memory slot names a still by id: { type: 'image', name: 'Still', stillId }.
 * The still is stored here, in IndexedDB, as its PNG bytes in a Blob, keyed by
 * the SHA-256 of those bytes. There is one record however many slots use it.
 *
 * Slots used to carry the still itself as a data URL in localStorage. Chrome
 * allows 5,242,880 characters per origin there, and one high-resolution still
 * came close to filling it; after that, saves failed. IndexedDB is a share of
 * the disk.
 *
 * Nothing here deletes a still. A still that no slot uses any more costs disk
 * space; deleting one that a slot still needs loses it for good.
 */
import { isStillId } from './sources/sourceModel.js'

const DB_NAME = 'hd4-stills'
const DB_VERSION = 1
const STILLS_STORE = 'stills'
const EMBEDDED_STILL = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/

let dbPromise = null
let migration = null

function openDB() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION)
            request.onerror = () => reject(request.error)
            request.onblocked = () => reject(new Error('Still storage is blocked by another HD4 tab'))
            request.onupgradeneeded = () => {
                const db = request.result
                if (!db.objectStoreNames.contains(STILLS_STORE)) {
                    db.createObjectStore(STILLS_STORE, { keyPath: 'id' })
                }
            }
            request.onsuccess = () => {
                const db = request.result
                // Let a newer version in another tab upgrade the database, and
                // reopen on next use rather than hold a closed connection.
                db.onversionchange = () => {
                    db.close()
                    dbPromise = null
                }
                db.onclose = () => { dbPromise = null }
                resolve(db)
            }
        }).catch((err) => {
            dbPromise = null
            throw err
        })
    }
    return dbPromise
}

/**
 * Run `work` in one transaction and settle when the transaction commits.
 * Writes ask for strict durability, because a slot drops its text copy of a
 * still as soon as the stored copy commits.
 */
async function transact(mode, work) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const tx = mode === 'readwrite'
            ? db.transaction(STILLS_STORE, mode, { durability: 'strict' })
            : db.transaction(STILLS_STORE, mode)
        const request = work(tx.objectStore(STILLS_STORE))
        tx.oncomplete = () => resolve(request?.result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error || new Error('Still storage transaction aborted'))
    })
}

/**
 * Decode a still held as data URL text into its bytes. Only base64 image data
 * URLs are accepted.
 * @param {string} dataUrl
 * @returns {Blob}
 */
export function decodeEmbeddedStill(dataUrl) {
    const match = typeof dataUrl === 'string' ? EMBEDDED_STILL.exec(dataUrl) : null
    if (!match) throw new Error('Not an embedded still')
    const text = atob(match[2])
    const bytes = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
    return new Blob([bytes], { type: match[1] })
}

/**
 * A still's id: the SHA-256 of its bytes, as lowercase hex.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function stillIdOf(blob) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Store stills held as data URL text: the still captured this session, or one
 * an older save kept in a slot. Resolves, once every still is committed, with
 * each data URL's still id. Rejects if any is not; the caller must then not
 * write a slot that names them.
 *
 * @param {string[]} dataUrls
 * @returns {Promise<Map<string, string>>} data URL -> still id
 */
export async function storeEmbeddedStills(dataUrls = []) {
    const ids = new Map()
    if (!dataUrls.length) return ids
    if (typeof indexedDB === 'undefined') throw new Error('Still storage is unavailable')
    const records = []
    for (const dataUrl of new Set(dataUrls)) {
        const blob = decodeEmbeddedStill(dataUrl)
        const id = await stillIdOf(blob)
        ids.set(dataUrl, id)
        records.push({ id, blob })
    }
    const storedAt = Date.now()
    await transact('readwrite', (store) => {
        for (const { id, blob } of records) store.put({ id, blob, storedAt })
    })
    return ids
}

/**
 * The stored still for `id`, or null when it is not stored or storage is
 * unavailable. Never rejects.
 * @param {string} id
 * @returns {Promise<Blob|null>}
 */
export async function getStill(id) {
    if (typeof indexedDB === 'undefined' || !isStillId(id)) return null
    try {
        const record = await transact('readonly', (store) => store.get(id))
        if (record?.blob instanceof Blob) return record.blob
        console.warn(`[hd4] still ${id} is not stored on this device`)
    } catch (err) {
        console.error('[hd4] could not read a still', err)
    }
    return null
}

/**
 * Move the stills out of memory slots saved before stills had their own
 * storage. Runs once per page load; saves wait for it (memoryStillsMigrated),
 * because until it finishes a full localStorage has no room for them.
 *
 * @param {import('./memory.js').MemoryStore} memory
 * @returns {Promise<number>} how many slots were moved
 */
export function migrateMemoryStills(memory) {
    if (typeof indexedDB === 'undefined') return Promise.resolve(0)
    migration = memory.moveEmbeddedStills(storeEmbeddedStills)
    return migration
}

/**
 * Settles when the startup migration has finished, failed, or run longer than
 * `timeoutMs`. Never rejects.
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export function memoryStillsMigrated(timeoutMs = 15000) {
    if (!migration) return Promise.resolve()
    let timer
    const timeout = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs) })
    return Promise.race([migration.catch(() => {}), timeout]).finally(() => clearTimeout(timer))
}
