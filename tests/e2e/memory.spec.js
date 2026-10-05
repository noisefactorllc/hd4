// SPDX-License-Identifier: MIT
/**
 * Phase 6 integration — 8-slot MEMORY. Save a distinctive state, change
 * everything, recall, and confirm the full state (switcher, output VFX,
 * audio mute) and the UI controls are restored. Plus persistence across a
 * reload, and the move of stills that older saves kept in a slot as text.
 */
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { test, expect } from './fixtures.js'

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
})
function crc32(buf) {
    let c = 0xffffffff
    for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}

/** A solid RGBA PNG, stored uncompressed: as large as a busy still of that size. */
function solidPng(width, height, [r, g, b]) {
    const chunk = (type, data) => {
        const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
        const out = Buffer.alloc(body.length + 8)
        out.writeUInt32BE(data.length, 0)
        body.copy(out, 4)
        out.writeUInt32BE(crc32(body), body.length + 4)
        return out
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(width, 0)
    header.writeUInt32BE(height, 4)
    header[8] = 8 // bit depth
    header[9] = 6 // RGBA
    const row = Buffer.alloc(1 + width * 4) // filter byte 0, then pixels
    for (let x = 0; x < width; x++) row.set([r, g, b, 255], 1 + x * 4)
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)), { level: 0 })),
        chunk('IEND', Buffer.alloc(0)),
    ])
}

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
})

test('saves a state, then recalls it after changes', async ({ page }) => {
    // State A: cut to channel 4, mute channel 2, VFX negative.
    await page.click('.hd4-trans-btn[data-type="cut"]')
    await page.click('.hd4-take-btn[data-channel="4"]')
    await page.click('.hd4-strip[data-channel="2"] .hd4-mute-btn')
    await page.selectOption('.hd4-vfx-select', 'negative')

    // Save into slot 1.
    await page.click('.hd4-mem-save')
    await page.click('.hd4-mem-slot[data-slot="1"]')
    await expect(page.locator('.hd4-mem-slot[data-slot="1"]')).toHaveClass(/is-occupied/)

    // State B: different channel, unmute, no VFX.
    await page.click('.hd4-take-btn[data-channel="3"]')
    await page.click('.hd4-strip[data-channel="2"] .hd4-mute-btn')
    await page.selectOption('.hd4-vfx-select', 'none')
    expect(await page.evaluate(() => window.__hd4.switcher.live)).toBe(3)
    expect(await page.evaluate(() => window.__hd4.audio.isMuted(1))).toBe(false)

    // Recall slot 1 → State A is restored, model and UI.
    await page.click('.hd4-mem-slot[data-slot="1"]')
    expect(await page.evaluate(() => window.__hd4.switcher.live)).toBe(4)
    expect(await page.evaluate(() => window.__hd4.output.vfx)).toBe('negative')
    expect(await page.evaluate(() => window.__hd4.audio.isMuted(1))).toBe(true)
    await expect(page.locator('.hd4-strip[data-channel="2"] .hd4-mute-btn')).toHaveClass(/is-active/)
    expect(await page.evaluate(() => document.querySelector('.hd4-vfx-select').value)).toBe('negative')
})

test('memory persists across a reload', async ({ page }) => {
    await page.click('.hd4-trans-btn[data-type="cut"]')
    await page.click('.hd4-take-btn[data-channel="4"]')
    await page.click('.hd4-mem-save')
    await page.click('.hd4-mem-slot[data-slot="2"]')

    await page.reload()
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })

    await expect(page.locator('.hd4-mem-slot[data-slot="2"]')).toHaveClass(/is-occupied/)
    await page.click('.hd4-mem-slot[data-slot="2"]')
    expect(await page.evaluate(() => window.__hd4.switcher.live)).toBe(4)
})

test('a still an older save kept as text moves to IndexedDB on load, which frees localStorage', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    // A 720p still as older saves stored it: its PNG bytes as data URL text.
    const png = solidPng(1280, 720, [0, 0, 255])
    const stillId = createHash('sha256').update(png).digest('hex')
    const text = `data:image/png;base64,${png.toString('base64')}`
    expect(text.length).toBeGreaterThan(4_500_000) // most of Chrome's 5,242,880-character localStorage

    // Slot 3 as an older save wrote it, the still on channel 1; then fill the
    // rest of localStorage.
    await page.click('.hd4-mem-save')
    await page.click('.hd4-mem-slot[data-slot="3"]')
    await expect(page.locator('.hd4-mem-slot[data-slot="3"]')).toHaveClass(/is-occupied/)
    await page.evaluate((url) => {
        const slot = JSON.parse(localStorage.getItem('hd4.memory.3'))
        slot.channels[0] = { type: 'image', name: 'Still', url }
        localStorage.setItem('hd4.memory.3', JSON.stringify(slot))
        for (let i = 0, n = 1 << 20; n >= 64;) {
            try { localStorage.setItem(`hd4-test-fill-${i}`, 'x'.repeat(n)); i++ } catch { n >>= 1 }
        }
    }, text)

    // Full: a save fails, says so, and leaves the slot empty.
    await page.click('.hd4-mem-save')
    await page.click('.hd4-mem-slot[data-slot="5"]')
    await expect(page.locator('.hf-toast-error')).toContainText('Memory 5 was not saved')
    await expect(page.locator('.hd4-mem-slot[data-slot="5"]')).not.toHaveClass(/is-occupied/)
    expect(await page.evaluate(() => localStorage.getItem('hd4.memory.5'))).toBeNull()

    // On load the still moves to IndexedDB, and the slot keeps only its id.
    await page.reload()
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await expect.poll(() => page.evaluate(() => localStorage.getItem('hd4.memory.3')), { timeout: 15_000 }).not.toContain('data:')
    const slot = JSON.parse(await page.evaluate(() => localStorage.getItem('hd4.memory.3')))
    expect(slot.channels[0]).toEqual({ type: 'image', name: 'Still', stillId })
    const stored = await page.evaluate(async (id) => {
        const { getStill, stillIdOf } = await import('/js/stillStorage.js')
        const blob = await getStill(id)
        return blob && { type: blob.type, size: blob.size, id: await stillIdOf(blob) }
    }, stillId)
    expect(stored).toEqual({ type: 'image/png', size: png.length, id: stillId })

    // Recalling the slot shows the still, and saves work again.
    await page.click('.hd4-mem-slot[data-slot="3"]')
    await expect.poll(async () => dist(await page.evaluate(() => window.__hd4.sampleChannelAvg(0)), [0, 0, 255]), { timeout: 15_000 }).toBeLessThan(40)
    await page.click('.hd4-mem-save')
    await page.click('.hd4-mem-slot[data-slot="4"]')
    await expect(page.locator('.hd4-mem-slot[data-slot="4"]')).toHaveClass(/is-occupied/)
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('hd4.memory.4'))).channels[0]).toEqual({ type: 'image', name: 'Still', stillId })
    const everything = await page.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n'))
    expect(everything).not.toMatch(/data:|blob:/)
    expect(errors).toEqual([])
})

test('keyboard shortcuts take channels and toggle quad', async ({ page }) => {
    await page.keyboard.press('3')
    await page.waitForFunction(() => window.__hd4.switcher.live === 3, null, { timeout: 5_000 })

    await page.keyboard.press('q')
    expect(await page.evaluate(() => window.__hd4.composition.composition)).toBe('quad')
    await page.keyboard.press('q')
    expect(await page.evaluate(() => window.__hd4.composition.composition)).toBe('off')
})
