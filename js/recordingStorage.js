// SPDX-License-Identifier: MIT
// Append binary chunks as they arrive; never depend on an unload transaction.
const DB_NAME = 'hd4-recordings'
const lockName = (id) => `hd4-recording:${id}`
let connection

function openDB() {
    if (!connection) {
        connection = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1)
            request.onerror = () => reject(request.error)
            request.onblocked = () => reject(new Error('Recording storage is blocked by another tab'))
            request.onupgradeneeded = () => {
                request.result.createObjectStore('takes', { keyPath: 'id' })
                request.result.createObjectStore('chunks', { keyPath: ['id', 'index'] })
            }
            request.onsuccess = () => {
                const db = request.result
                db.onversionchange = () => { db.close(); connection = null }
                db.onclose = () => { connection = null }
                resolve(db)
            }
        }).catch((error) => { connection = null; throw error })
    }
    return connection
}

async function transact(mode, work) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['takes', 'chunks'], mode, { durability: 'strict' })
        const result = work(tx.objectStore('takes'), tx.objectStore('chunks'))
        tx.oncomplete = () => resolve(result?.result)
        tx.onabort = tx.onerror = () => reject(tx.error || new Error('Recording storage transaction aborted'))
    })
}

const chunkRange = (id) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])

export async function beginTake(take) {
    if (!globalThis.navigator?.locks) throw new Error('Recording recovery needs browser lock support')
    // The browser releases this lock on tab close or reload. A different tab
    // must not offer an active recording for recovery or removal.
    let release
    let acquired
    const held = new Promise((resolve) => { release = resolve })
    const ready = new Promise((resolve) => { acquired = resolve })
    const lock = navigator.locks.request(lockName(take.id), () => { acquired(); return held })
    await Promise.race([ready, lock])
    try { await transact('readwrite', (takes) => takes.put(take)) }
    catch (error) { release(); throw error }
    return release
}

export async function appendTakeChunk(take, index, blob) {
    const bytes = await blob.arrayBuffer()
    await transact('readwrite', (takes, chunks) => {
        chunks.put({ id: take.id, index, bytes })
        takes.put(take)
    })
}

export async function recoverableTakes() {
    if (!globalThis.navigator?.locks) return []
    const takes = await transact('readonly', (store) => store.getAll())
    const { held } = await navigator.locks.query()
    const active = new Set(held.map((lock) => lock.name))
    return takes.filter((take) => !active.has(lockName(take.id)))
        .sort((a, b) => a.startedAt - b.startedAt)
}

export async function readTake(take) {
    return navigator.locks.request(lockName(take.id), { ifAvailable: true }, async (lock) => {
        if (!lock) return null
        const chunks = await transact('readonly', (_, store) => store.getAll(chunkRange(take.id)))
        return new Blob(chunks.map((chunk) => chunk.bytes), { type: take.type })
    })
}

export async function removeTake(id) {
    return navigator.locks.request(lockName(id), { ifAvailable: true }, async (lock) => {
        if (!lock) return false
        await transact('readwrite', (takes, chunks) => {
            takes.delete(id)
            chunks.delete(chunkRange(id))
        })
        return true
    })
}
