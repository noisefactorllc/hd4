// SPDX-License-Identifier: MIT
/**
 * Still capture integration (INPUT CAPTURE). Grabbing the program
 * while Blue is live stores a Blue still, which then drives the KEY "STILL"
 * source and is selectable as a channel image — verified against real
 * program / channel pixels. A memory slot saves the still as a reference to
 * its PNG in IndexedDB and recalls it after a reload.
 */
import { test, expect } from './fixtures.js'

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.waitForFunction(() => window.__hd4.renderers.every((r) => r.isRunning), null, { timeout: 30_000 })
    await page.selectOption('.hd4-monitor[data-channel="3"] .hd4-source-select', 'shader:Blue')
    await page.selectOption('.hd4-monitor[data-channel="4"] .hd4-source-select', 'shader:Amber')
    await page.waitForFunction(() => [2, 3].every((i) => window.__hd4.sampleChannelBrightness(i) > 0), null, { timeout: 30_000 })
    // Blue live, then grab the program as a still.
    await page.evaluate(() => { window.__hd4.switcher.setType('cut'); window.__hd4.switcher.cut(3) })
    await expect.poll(async () => {
        const [p, blue] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(2)])
        return dist(p, blue)
    }, { timeout: 15_000 }).toBeLessThan(30)
    await page.click('.hd4-output-btn:has-text("STILL")')
    await page.waitForFunction(() => window.__hd4.still.hasStill === true, null, { timeout: 5_000 })
})

test('the captured still drives the KEY STILL source', async ({ page }) => {
    // Amber live; key the Blue still over it (Blue is not green → opaque).
    await page.evaluate(() => {
        window.__hd4.switcher.cut(4)
        window.__hd4.composition.setKey({ sourceCh: 5, type: 'chroma', chromaColor: 'green', level: 200, on: true })
    })
    await expect.poll(async () => {
        const [p, blue] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(2)])
        return dist(p, blue) // program shows the Blue still
    }, { timeout: 15_000 }).toBeLessThan(40)
    const [prog, amber] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(3)])
    expect(dist(prog, amber)).toBeGreaterThan(40) // not the Amber background
})

test('re-capturing while KEY=STILL grabs the clean program, not the compounded overlay', async ({ page }) => {
    // KEY=STILL keys the captured still over the live program. A re-capture
    // must then grab the program *beneath* the key (the live channel) — not
    // the already-keyed output — or the still compounds its own overlay.
    // Amber live; key the (Blue) still over it so the program shows Blue.
    await page.evaluate(() => {
        window.__hd4.switcher.cut(4) // Amber live
        window.__hd4.composition.setKey({ sourceCh: 5, type: 'chroma', chromaColor: 'green', level: 200, on: true })
    })
    await expect.poll(async () => {
        const [p, blue] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(2)])
        return dist(p, blue) // program shows the opaque Blue still over Amber
    }, { timeout: 15_000 }).toBeLessThan(40)

    // Re-capture: the new still must be the clean program (Amber), not Blue.
    await page.click('.hd4-output-btn:has-text("STILL")')
    const still = await page.evaluate(() => {
        const c = window.__hd4.still.canvas
        const d = c.getContext('2d').getImageData(Math.floor(c.width * 0.5), Math.floor(c.height * 0.5), 1, 1).data
        return [d[0], d[1], d[2]]
    })
    const [amber, blue] = await page.evaluate(() => [window.__hd4.sampleChannelAvg(3), window.__hd4.sampleChannelAvg(2)])
    expect(dist(still, amber)).toBeLessThan(40) // grabbed the clean program (Amber)
    expect(dist(still, blue)).toBeGreaterThan(40) // not the compounded Blue overlay
})

test('the captured still is selectable as a channel image', async ({ page }) => {
    await page.selectOption('.hd4-monitor[data-channel="1"] .hd4-source-select', 'still')
    await page.waitForFunction(() => window.__hd4.channels[0].source.type === 'image', null, { timeout: 10_000 })
    await expect.poll(async () => {
        const [ch1, blue] = await page.evaluate(() => [window.__hd4.sampleChannelAvg(0), window.__hd4.sampleChannelAvg(2)])
        return dist(ch1, blue) // ch1 now shows the Blue still
    }, { timeout: 15_000 }).toBeLessThan(40)
})

test('a memory slot keeps a reference to the still, which recalls from IndexedDB after a reload', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    // Channel 1 shows the Blue still; save that state into memory 1.
    await page.selectOption('.hd4-monitor[data-channel="1"] .hd4-source-select', 'still')
    await expect.poll(async () => {
        const [ch1, blue] = await page.evaluate(() => [window.__hd4.sampleChannelAvg(0), window.__hd4.sampleChannelAvg(2)])
        return dist(ch1, blue)
    }, { timeout: 15_000 }).toBeLessThan(40)
    const shown = await page.evaluate(() => window.__hd4.sampleChannelAvg(0))
    await page.click('.hd4-mem-save')
    await page.click('.hd4-mem-slot[data-slot="1"]')
    await expect(page.locator('.hd4-mem-slot[data-slot="1"]')).toHaveClass(/is-occupied/)

    // localStorage holds only small references: no image as text, no page-bound URL.
    const saved = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])))
    for (const [key, value] of Object.entries(saved)) expect(value, key).not.toMatch(/data:|blob:/)
    const slot = JSON.parse(saved['hd4.memory.1'])
    const stillId = slot.channels[0].stillId
    expect(slot.channels[0]).toEqual({ type: 'image', name: 'Still', stillId: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(saved['hd4.memory.1'].length).toBeLessThan(20_000)

    // The still is a PNG Blob in IndexedDB, keyed by the SHA-256 of its bytes.
    const stored = await page.evaluate(async (id) => {
        const { getStill, stillIdOf } = await import('/js/stillStorage.js')
        const blob = await getStill(id)
        return blob && { type: blob.type, size: blob.size, id: await stillIdOf(blob) }
    }, stillId)
    expect(stored).toEqual({ type: 'image/png', size: expect.any(Number), id: stillId })
    expect(stored.size).toBeGreaterThan(0)

    // After a reload no still is held in memory: recall loads it from IndexedDB.
    await page.reload()
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    expect(await page.evaluate(() => window.__hd4.still.hasStill)).toBe(false)
    await page.click('.hd4-mem-slot[data-slot="1"]')
    expect(await page.evaluate(() => window.__hd4.channels[0].source)).toEqual({ type: 'image', name: 'Still', url: '', stillId })
    await expect.poll(async () => dist(await page.evaluate(() => window.__hd4.sampleChannelAvg(0)), shown), { timeout: 15_000 }).toBeLessThan(40)
    expect(errors).toEqual([])
})
