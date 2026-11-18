// SPDX-License-Identifier: MIT
/**
 * Recording integration — the REC button records the program (canvas video
 * + main-bus audio) through MediaRecorder and produces a non-empty file.
 * Clicking REC is itself the user gesture that unlocks the AudioContext.
 */
import { test, expect } from './fixtures.js'

async function ready(page) {
    await page.waitForFunction(() => window.__hd4?.ready === true)
}

async function savedTakes(page) {
    return page.evaluate(async () => {
        if (!(await indexedDB.databases()).some((db) => db.name === 'hd4-recordings')) return []
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('hd4-recordings')
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
                const db = request.result
                const tx = db.transaction('takes')
                const rows = tx.objectStore('takes').getAll()
                tx.oncomplete = () => { db.close(); resolve(rows.result) }
                tx.onerror = () => reject(tx.error)
            }
        })
    })
}

async function checkpoint(page) {
    await expect.poll(async () => (await savedTakes(page)).some((take) => take.size > 1000), { timeout: 10000 }).toBe(true)
}

async function playableDownload(page, download) {
    expect(await download.failure()).toBeNull()
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const bytes = Buffer.concat(chunks)
    expect(bytes.length).toBeGreaterThan(1000)
    const playback = await page.evaluate(async (bytes) => {
        const video = document.createElement('video')
        video.muted = true
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]))
        video.src = url
        try {
            await video.play()
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Recorded video did not advance')), 5000)
                video.ontimeupdate = () => { if (video.currentTime > 0.1) { clearTimeout(timeout); resolve() } }
                video.onerror = () => { clearTimeout(timeout); reject(new Error('Recorded video cannot decode')) }
            })
            const canvas = document.createElement('canvas')
            canvas.width = 16; canvas.height = 9
            const ctx = canvas.getContext('2d')
            ctx.drawImage(video, 0, 0, 16, 9)
            const pixels = ctx.getImageData(0, 0, 16, 9).data
            const rgb = Array.from(pixels).filter((_, i) => i % 4 !== 3)
            return { width: video.videoWidth, height: video.videoHeight,
                brightness: rgb.reduce((sum, value) => sum + value, 0) / rgb.length }
        } finally { video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url) }
    }, Array.from(bytes))
    expect(playback.width).toBeGreaterThan(0)
    expect(playback.height).toBeGreaterThan(0)
    expect(playback.brightness).toBeGreaterThan(20)
    return bytes
}

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.waitForFunction(() => window.__hd4.renderers.every((r) => r.isRunning), null, { timeout: 30_000 })
    await page.click('.hd4-take-btn[data-channel="3"]')
    await page.waitForFunction(() => window.__hd4.sampleProgramAvg().some((value) => value > 30))
})

async function storedTakeBytes(page, id) {
    return Buffer.from(await page.evaluate((id) => new Promise((resolve, reject) => {
        const request = indexedDB.open('hd4-recordings')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('chunks')
            const rows = tx.objectStore('chunks').getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]))
            tx.oncomplete = () => {
                db.close()
                const bytes = new Uint8Array(rows.result.reduce((sum, row) => sum + row.bytes.byteLength, 0))
                let offset = 0
                for (const row of rows.result) { bytes.set(new Uint8Array(row.bytes), offset); offset += row.bytes.byteLength }
                resolve(Array.from(bytes))
            }
            tx.onerror = () => reject(tx.error)
        }
    }), id))
}

async function downloadBytes(download) {
    const chunks = []
    for await (const chunk of await download.createReadStream()) chunks.push(chunk)
    return Buffer.concat(chunks)
}

// The output bar offers no recovery: no recovery button and no status text.
async function expectNoRecoverySurface(page) {
    await expect(page.locator('.hd4-output-group button').filter({ hasText: /SAVE TAKE|×/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /recovered take/i })).toHaveCount(0)
    await expect(page.locator('.hd4-rec-status')).toBeEmpty()
}

// Settings > Recover unsaved work, the only way back to an interrupted take.
async function recoverUnsavedWork(page) {
    if (await page.locator('.hd4-settings-overlay').getAttribute('data-open') !== 'true') await page.click('.hd4-settings-gear')
    await page.getByRole('button', { name: 'Recover unsaved work' }).click()
}

async function expectNoDownload(page, action) {
    const downloads = []
    const listen = (download) => downloads.push(download)
    page.on('download', listen)
    await action()
    await page.waitForTimeout(1500)
    page.off('download', listen)
    expect(downloads).toHaveLength(0)
}

async function seedInterruptedTakes(page, takes) {
    await page.evaluate((takes) => new Promise((resolve, reject) => {
        const request = indexedDB.open('hd4-recordings')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction(['takes', 'chunks'], 'readwrite')
            for (const take of takes) {
                tx.objectStore('takes').put({ id: take.id, startedAt: take.startedAt, type: 'video/webm', filename: `${take.id}.webm`, size: 4 })
                tx.objectStore('chunks').put({ id: take.id, index: 0, bytes: new Uint8Array([1, 2, 3, 4]).buffer })
            }
            tx.oncomplete = () => { db.close(); resolve() }
            tx.onerror = () => reject(tx.error)
        }
    }), takes)
}

// Only in these tests: report every WebM type unsupported, so Chrome records MP4.
const forceMp4 = () => {
    const isTypeSupported = MediaRecorder.isTypeSupported.bind(MediaRecorder)
    MediaRecorder.isTypeSupported = (type) => !/webm/i.test(type) && isTypeSupported(type)
}

function mp4Boxes(bytes) {
    const boxes = []
    for (let offset = 0; offset + 8 <= bytes.length;) {
        const size = bytes.readUInt32BE(offset)
        boxes.push(bytes.toString('latin1', offset + 4, offset + 8))
        if (size < 8) break
        offset += size
    }
    return boxes
}

test('REC records the program and yields a non-empty clip', async ({ page }) => {
    expect(await page.evaluate(() => window.__hd4.recorder.isSupported)).toBe(true)

    await page.click('.hd4-rec-btn') // start (and unlock audio)
    await page.waitForFunction(() => window.__hd4.recorder.recording === true, null, { timeout: 5_000 })
    await expect(page.locator('.hd4-rec-btn')).toHaveClass(/is-active/)

    await page.waitForTimeout(1500) // gather a couple of timeslices

    // Stopping triggers a download; capture it so nothing is left dangling.
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 10_000 }),
        page.click('.hd4-rec-btn'), // stop
    ])

    await page.waitForFunction(() => window.__hd4.recorder.recording === false, null, { timeout: 5_000 })
    const rec = await page.evaluate(() => window.__hd4.lastRecording)
    expect(rec).not.toBeNull()
    expect(rec.size).toBeGreaterThan(0)
    expect(rec.type).toMatch(/^video\//)
    expect(download.suggestedFilename()).toMatch(/^hd4-\d{8}-\d{6}\.webm$/)
    await playableDownload(page, download)
    await expect.poll(() => savedTakes(page)).toEqual([])
    expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
    await page.reload()
    await ready(page)
    await expectNoRecoverySurface(page)
    await expectNoDownload(page, () => recoverUnsavedWork(page))
})

for (const navigation of ['reload', 'tab close']) {
    test(`a take survives ${navigation} without a browser prompt and comes back only through Recover unsaved work`, async ({ page, context }) => {
        await page.click('.hd4-rec-btn')
        await page.waitForTimeout(4000)
        const stored = (await savedTakes(page))[0]
        expect(stored?.size).toBeGreaterThan(1000)
        const guarded = await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))
        expect(guarded).toBe(false)
        if (navigation === 'reload') await page.reload()
        else { await page.close(); page = await context.newPage(); await page.goto('/') }
        await ready(page)
        await expectNoRecoverySurface(page)
        await page.evaluate(() => window.dispatchEvent(new Event('focus')))
        await page.waitForTimeout(500)
        await expectNoRecoverySurface(page)
        const [kept] = await savedTakes(page)
        expect(kept.id).toBe(stored.id)
        const storedBytes = await storedTakeBytes(page, kept.id)
        expect(storedBytes.length).toBe(kept.size)

        const [download] = await Promise.all([page.waitForEvent('download'), recoverUnsavedWork(page)])
        expect(download.suggestedFilename()).toBe(kept.filename)
        expect((await downloadBytes(download)).equals(storedBytes)).toBe(true)
        await playableDownload(page, download)
        await expect.poll(() => savedTakes(page)).toEqual([])
        await expectNoDownload(page, () => recoverUnsavedWork(page))
        expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
    })
}

test('Recover unsaved work downloads every interrupted take, newest first, and empties the store', async ({ page }) => {
    const ids = []
    for (let i = 0; i < 2; i++) {
        await page.click('.hd4-take-btn[data-channel="3"]')
        await page.click('.hd4-rec-btn')
        await checkpoint(page)
        await expect.poll(async () => (await savedTakes(page)).filter((take) => !ids.includes(take.id) && take.size > 1000).length).toBe(1)
        ids.push((await savedTakes(page)).find((take) => !ids.includes(take.id)).id)
        await page.reload()
        await ready(page)
    }
    const takes = await savedTakes(page)
    const names = ids.map((id) => takes.find((take) => take.id === id).filename)
    const downloads = []
    page.on('download', (download) => downloads.push(download))
    await recoverUnsavedWork(page)
    await expect.poll(() => downloads.length).toBe(2)
    expect(downloads.map((download) => download.suggestedFilename())).toEqual([names[1], names[0]])
    for (const download of downloads) await playableDownload(page, download)
    await expect.poll(() => savedTakes(page)).toEqual([])
})

test('only the newest three interrupted takes are kept', async ({ page }) => {
    const seeded = [1, 2, 3, 4].map((n) => ({ id: `seeded-${n}`, startedAt: Date.UTC(2026, 0, n) }))
    await seedInterruptedTakes(page, seeded)
    await page.reload()
    await ready(page)
    await expect.poll(async () => (await savedTakes(page)).map((take) => take.id).sort()).toEqual(['seeded-2', 'seeded-3', 'seeded-4'])
    expect((await storedTakeBytes(page, 'seeded-1')).length).toBe(0)

    // Starting a take prunes too: three interrupted takes stay beside the active one.
    await seedInterruptedTakes(page, [{ id: 'seeded-5', startedAt: Date.UTC(2026, 0, 5) }])
    await page.click('.hd4-take-btn[data-channel="3"]')
    await page.click('.hd4-rec-btn')
    await checkpoint(page)
    const active = await page.evaluate(() => window.__hd4.recorder.take.id)
    await expect.poll(async () => (await savedTakes(page)).map((take) => take.id).sort())
        .toEqual([active, 'seeded-3', 'seeded-4', 'seeded-5'].sort())
    expect((await storedTakeBytes(page, 'seeded-2')).length).toBe(0)
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('.hd4-rec-btn')])
    await playableDownload(page, download)
    await expect.poll(async () => (await savedTakes(page)).map((take) => take.id).sort()).toEqual(['seeded-3', 'seeded-4', 'seeded-5'])
})

test('idle navigation is unguarded and creates no recovery', async ({ page }) => {
    expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
    await page.goto('about:blank')
    await page.goBack()
    await ready(page)
    await expectNoRecoverySurface(page)
    expect(await savedTakes(page)).toEqual([])
})

test('another tab cannot recover or remove an active take', async ({ page, context }) => {
    await page.click('.hd4-rec-btn')
    await checkpoint(page)
    const active = (await savedTakes(page))[0]
    const other = await context.newPage()
    await other.goto('/')
    await ready(other)
    await expectNoDownload(other, () => recoverUnsavedWork(other))
    expect((await savedTakes(other)).map((take) => take.id)).toEqual([active.id])
    await page.close()
    const [download] = await Promise.all([other.waitForEvent('download'), recoverUnsavedWork(other)])
    expect(download.suggestedFilename()).toBe(active.filename)
    await playableDownload(other, download)
    await expect.poll(() => savedTakes(other)).toEqual([])
    await other.close()
})

test('unavailable storage reports the failure and does not start a volatile take', async ({ page }) => {
    await page.addInitScript(() => {
        IDBFactory.prototype.open = function () { throw new DOMException('Storage denied', 'SecurityError') }
    })
    await page.reload()
    await ready(page)
    await page.click('.hd4-rec-btn')
    await expect(page.locator('.hd4-rec-status')).toContainText('Recording could not start')
    expect(await page.evaluate(() => window.__hd4.recorder.recording)).toBe(false)
})

test('a failed checkpoint stops with a download and keeps the last durable checkpoint', async ({ page }) => {
    await page.click('.hd4-rec-btn')
    await checkpoint(page)
    const stored = (await savedTakes(page))[0]
    const downloadReady = page.waitForEvent('download')
    await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put
        IDBObjectStore.prototype.put = function (...args) {
            if (this.name === 'chunks') throw new DOMException('Disk full', 'QuotaExceededError')
            return put.apply(this, args)
        }
    })
    const download = await downloadReady
    const bytes = await playableDownload(page, download)
    expect(bytes.length).toBeGreaterThanOrEqual(stored.size)
    await expect(page.locator('.hd4-rec-status')).toContainText('Recording stopped')
    expect(await page.evaluate(() => window.__hd4.recorder.recording)).toBe(false)
    await page.reload()
    await ready(page)
    await expectNoRecoverySurface(page)
    const [recovered] = await Promise.all([page.waitForEvent('download'), recoverUnsavedWork(page)])
    await playableDownload(page, recovered)
})

test('rapid REC input produces one take and one Stop download', async ({ page }) => {
    await page.evaluate(() => {
        const button = document.querySelector('.hd4-rec-btn')
        button.click(); button.click(); button.click()
    })
    await checkpoint(page)
    expect(await savedTakes(page)).toHaveLength(1)
    const downloads = []
    page.on('download', (download) => downloads.push(download))
    await page.evaluate(() => {
        const button = document.querySelector('.hd4-rec-btn')
        button.click(); button.click(); button.click()
    })
    await expect.poll(() => downloads.length).toBe(1)
    await expect.poll(() => savedTakes(page)).toEqual([])
    await playableDownload(page, downloads[0])
    expect(downloads).toHaveLength(1)
})

test('ended capture tracks finish the take and keep it for recovery', async ({ page }) => {
    await page.click('.hd4-rec-btn')
    await checkpoint(page)
    const downloadReady = page.waitForEvent('download', { timeout: 10000 })
    await page.evaluate(() => window.__hd4.recorder._rec.stream.getTracks().forEach((track) => track.stop()))
    const download = await downloadReady
    await playableDownload(page, download)
    expect(await page.evaluate(() => window.__hd4.recorder.recording)).toBe(false)
    await expect(page.locator('.hd4-rec-status')).toContainText('Recording stopped')
    await expect(page.getByRole('button', { name: /recovered take/i })).toHaveCount(0)
    expect(await savedTakes(page)).toHaveLength(1)
    const [recovered] = await Promise.all([page.waitForEvent('download'), recoverUnsavedWork(page)])
    await playableDownload(page, recovered)
    await expect.poll(() => savedTakes(page)).toEqual([])
})

test('an interruption before the first checkpoint shows nothing and leaves nothing to download', async ({ page }) => {
    await page.click('.hd4-rec-btn')
    await page.waitForFunction(() => window.__hd4.recorder.recording)
    await page.reload()
    await ready(page)
    await expectNoRecoverySurface(page)
    await expectNoDownload(page, () => recoverUnsavedWork(page))
    await expect.poll(() => savedTakes(page)).toEqual([])
})

test('a new take and normal Stop leave an older interrupted take intact', async ({ page }) => {
    await page.click('.hd4-rec-btn')
    await checkpoint(page)
    const original = (await savedTakes(page))[0]
    await page.reload()
    await ready(page)
    await page.click('.hd4-take-btn[data-channel="3"]')
    await page.click('.hd4-rec-btn')
    await expect.poll(async () => (await savedTakes(page)).filter((take) => take.size > 1000).length).toBe(2)
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('.hd4-rec-btn')])
    await playableDownload(page, download)
    await expect.poll(async () => (await savedTakes(page)).map((take) => take.id)).toEqual([original.id])
    await expectNoRecoverySurface(page)
    const [recovered] = await Promise.all([page.waitForEvent('download'), recoverUnsavedWork(page)])
    expect((await playableDownload(page, recovered)).length).toBeGreaterThanOrEqual(original.size)
})

test.describe('where only MP4 can be recorded', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(forceMp4)
        await page.reload()
        await ready(page)
        await page.waitForFunction(() => window.__hd4.renderers.every((r) => r.isRunning), null, { timeout: 30_000 })
        await page.click('.hd4-take-btn[data-channel="3"]')
        await page.waitForFunction(() => window.__hd4.sampleProgramAvg().some((value) => value > 30))
    })

    test('REC records MP4 and Stop downloads a playable .mp4', async ({ page }) => {
        await page.click('.hd4-rec-btn')
        await checkpoint(page)
        expect(await page.evaluate(() => window.__hd4.recorder.mimeType)).toMatch(/^video\/mp4/)
        await page.waitForTimeout(1500)
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('.hd4-rec-btn')])
        expect(download.suggestedFilename()).toMatch(/^hd4-\d{8}-\d{6}\.mp4$/)
        const bytes = await playableDownload(page, download)
        expect(mp4Boxes(bytes)).toEqual(expect.arrayContaining(['ftyp', 'moov', 'moof', 'mdat']))
        await expect.poll(() => savedTakes(page)).toEqual([])
    })

    test('an MP4 take survives a reload and comes back through Recover unsaved work', async ({ page }) => {
        await page.click('.hd4-rec-btn')
        await page.waitForTimeout(4000)
        const stored = (await savedTakes(page))[0]
        expect(stored.type).toMatch(/^video\/mp4/)
        expect(stored.size).toBeGreaterThan(1000)
        await page.reload()
        await ready(page)
        await expectNoRecoverySurface(page)
        const storedBytes = await storedTakeBytes(page, stored.id)
        const [download] = await Promise.all([page.waitForEvent('download'), recoverUnsavedWork(page)])
        expect(download.suggestedFilename()).toMatch(/^hd4-\d{8}-\d{6}\.mp4$/)
        const bytes = await playableDownload(page, download)
        expect(bytes.equals(storedBytes)).toBe(true)
        expect(mp4Boxes(bytes)).toEqual(expect.arrayContaining(['ftyp', 'moov', 'moof', 'mdat']))
        await expect.poll(() => savedTakes(page)).toEqual([])
    })
})
