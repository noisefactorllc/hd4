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
    expect(download.suggestedFilename()).toMatch(/^hd4-\d{8}-\d{6}\.(webm|mp4)$/)
    await playableDownload(page, download)
    await expect.poll(() => savedTakes(page)).toEqual([])
    expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
    await page.reload()
    await ready(page)
    await expect(page.getByRole('button', { name: 'Save recovered take' })).toBeHidden()
})

for (const navigation of ['reload', 'tab close']) {
    test(`a take survives ${navigation} without a browser prompt`, async ({ page, context }) => {
        await page.click('.hd4-rec-btn')
        await page.waitForTimeout(4000)
        const stored = (await savedTakes(page))[0]
        expect(stored?.size).toBeGreaterThan(1000)
        const guarded = await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))
        expect(guarded).toBe(false)
        if (navigation === 'reload') await page.reload()
        else { await page.close(); page = await context.newPage(); await page.goto('/') }
        await ready(page)
        const save = page.getByRole('button', { name: 'Save recovered take' })
        await expect(save).toBeVisible()
        const [download] = await Promise.all([page.waitForEvent('download'), save.click()])
        const bytes = await playableDownload(page, download)
        expect(bytes.length).toBeGreaterThanOrEqual(stored.size)
        // A download can be cancelled: recovery is kept until the person removes it.
        await page.reload()
        await ready(page)
        await expect(save).toBeVisible()
        await page.getByRole('button', { name: 'Remove recovered take' }).click()
        await expect(save).toBeHidden()
        expect(await savedTakes(page)).toEqual([])
        expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
    })
}

test('idle navigation is unguarded and creates no recovery', async ({ page }) => {
    expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
    await page.goto('about:blank')
    await page.goBack()
    await ready(page)
    await expect(page.getByRole('button', { name: 'Save recovered take' })).toBeHidden()
    expect(await savedTakes(page)).toEqual([])
})

test('another tab cannot recover or remove an active take', async ({ page, context }) => {
    await page.click('.hd4-rec-btn')
    await checkpoint(page)
    const other = await context.newPage()
    await other.goto('/')
    await ready(other)
    await expect(other.getByRole('button', { name: 'Save recovered take' })).toBeHidden()
    await page.close()
    await other.reload()
    await ready(other)
    await expect(other.getByRole('button', { name: 'Save recovered take' })).toBeVisible()
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
    await expect(page.getByRole('button', { name: 'Save recovered take' })).toBeVisible()
    const [recovered] = await Promise.all([
        page.waitForEvent('download'), page.getByRole('button', { name: 'Save recovered take' }).click(),
    ])
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

test('ended capture tracks finish the take and release its recovery ownership', async ({ page }) => {
    await page.click('.hd4-rec-btn')
    await checkpoint(page)
    const downloadReady = page.waitForEvent('download', { timeout: 10000 })
    await page.evaluate(() => window.__hd4.recorder._rec.stream.getTracks().forEach((track) => track.stop()))
    const download = await downloadReady
    await playableDownload(page, download)
    expect(await page.evaluate(() => window.__hd4.recorder.recording)).toBe(false)
    await expect(page.getByRole('button', { name: 'Save recovered take' })).toBeVisible()
})

test('an interruption before the first checkpoint is reported', async ({ page }) => {
    await page.click('.hd4-rec-btn')
    await page.waitForFunction(() => window.__hd4.recorder.recording)
    await page.reload()
    await ready(page)
    await expect(page.locator('.hd4-rec-status')).toContainText('before any frames were saved')
    await expect(page.getByRole('button', { name: 'Save recovered take' })).toBeHidden()
    await page.getByRole('button', { name: 'Remove recovered take' }).click()
    await expect(page.locator('.hd4-rec-status')).toBeEmpty()
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
    const [recovered] = await Promise.all([
        page.waitForEvent('download'), page.getByRole('button', { name: 'Save recovered take' }).click(),
    ])
    expect((await playableDownload(page, recovered)).length).toBeGreaterThanOrEqual(original.size)
})
