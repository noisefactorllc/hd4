// SPDX-License-Identifier: MIT
/**
 * Phase 2 integration — four channels, each rendering a source through
 * the real Noisemaker engine, shown in the multiview. Exercises both the
 * shader path (default presets) and the media path (a fake camera).
 *
 * Requires the shaders CDN and a Playwright browser. The fake media
 * device (see playwright.config.js) auto-grants camera permission.
 */
import { test, expect } from './fixtures.js'

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
})

test('renders four source monitors with canvases', async ({ page }) => {
    await expect(page.locator('.hd4-monitor')).toHaveCount(4)
    await expect(page.locator('.hd4-monitor .hd4-monitor-canvas')).toHaveCount(4)
})

test('every channel boots its default source and runs', async ({ page }) => {
    await page.waitForFunction(
        () => window.__hd4.renderers.length === 4 && window.__hd4.renderers.every((r) => r.isRunning),
        null,
        { timeout: 30_000 },
    )
    const labels = await page.evaluate(() => window.__hd4.channels.map((c) => c.label))
    expect(labels).toEqual(['Camera', 'Test Card', 'Color Bars', 'Checkerboard'])
})

test('every channel renders a non-black frame (ch2 is the bundled test card)', async ({ page }) => {
    for (let i = 0; i < 4; i++) {
        await page.waitForFunction(
            (idx) => window.__hd4.sampleChannelBrightness(idx) > 0,
            i,
            { timeout: 30_000 },
        )
    }
})

test('the fit toggle switches a media channel between crop and scale', async ({ page }) => {
    // ch1 is the 4:3 camera. In "Crop" (cover) it fills edge-to-edge; in
    // "Scale" (contain) it pillarboxes (black side bars).
    const leftEdge = (idx) => page.evaluate((i) => {
        const c = window.__hd4.channels[i].canvas
        const s = document.createElement('canvas')
        s.width = 20; s.height = 12
        const ctx = s.getContext('2d')
        ctx.drawImage(c, 0, 0, 20, 12)
        const d = ctx.getImageData(0, 0, 20, 12).data
        let sum = 0
        for (let y = 0; y < 12; y++) { const p = (y * 20 + 1) * 4; sum += d[p] + d[p + 1] + d[p + 2] }
        return sum
    }, idx)

    // The test card (ch2) defaults to scale so the whole card is visible.
    expect(await page.evaluate(() => window.__hd4.renderers[1].fitMode)).toBe('contain')

    await page.waitForFunction(() => window.__hd4.sampleChannelBrightness(0) > 0, null, { timeout: 30_000 })
    await expect.poll(() => leftEdge(0), { timeout: 15_000 }).toBeGreaterThan(0) // camera crop: filled

    await page.click('.hd4-monitor[data-channel="1"] .hd4-fit-btn')
    expect(await page.evaluate(() => window.__hd4.renderers[0].fitMode)).toBe('contain')
    await expect.poll(() => leftEdge(0), { timeout: 15_000 }).toBeLessThan(30) // scale: pillarbox
})

test('switching a channel to a camera renders the live (fake) feed', async ({ page }) => {
    const select = page.locator('.hd4-monitor[data-channel="3"] .hd4-source-select')
    await select.selectOption('camera')

    await page.waitForFunction(() => window.__hd4.channels[2].source.type === 'camera', null, { timeout: 15_000 })
    await expect.poll(
        () => page.evaluate(() => window.__hd4.sampleChannelBrightness(2)),
        { timeout: 30_000 },
    ).toBeGreaterThan(0)
    expect(await page.evaluate(() => window.__hd4.channels[2].label)).toBe('Camera')
})

test('the source picker lists camera devices and a channel can pick one', async ({ page }) => {
    const sel = '.hd4-monitor[data-channel="3"] .hd4-source-select'
    // ch1 boots as a camera → permission granted → device labels enumerate.
    await expect.poll(() => page.evaluate((s) => {
        const el = document.querySelector(s)
        return [...el.options].filter((o) => o.value.startsWith('camera:')).length
    }, sel), { timeout: 20_000 }).toBeGreaterThan(0)

    const deviceValue = await page.evaluate((s) => {
        const el = document.querySelector(s)
        return [...el.options].find((o) => o.value.startsWith('camera:'))?.value
    }, sel)
    await page.selectOption(sel, deviceValue)
    await page.waitForFunction(() => window.__hd4.channels[2].source.type === 'camera', null, { timeout: 15_000 })
})

test('switching a channel to a different shader preset updates its label', async ({ page }) => {
    const select = page.locator('.hd4-monitor[data-channel="2"] .hd4-source-select')
    await select.selectOption('shader:Grid') // "Grid"
    await page.waitForFunction(() => window.__hd4.channels[1].label === 'Grid', null, { timeout: 15_000 })
    await expect(page.locator('.hd4-monitor[data-channel="2"] .hd4-monitor-label')).toHaveText('Grid')
})
