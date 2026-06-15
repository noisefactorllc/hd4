// SPDX-License-Identifier: MIT
/**
 * Enhancements — richer VFX (SVG-filter find-edges) and MIX blend modes.
 * find-edges over a flat solid program yields near-black (no internal
 * edges); a non-default blend MIX still completes on its target.
 */
import { test, expect } from '@playwright/test'

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const sum = (a) => a[0] + a[1] + a[2]

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.waitForFunction(() => window.__hd4.renderers.every((r) => r.isRunning), null, { timeout: 30_000 })
    await page.selectOption('.hd4-monitor[data-channel="3"] .hd4-source-select', 'shader:Blue')
    await page.selectOption('.hd4-monitor[data-channel="4"] .hd4-source-select', 'shader:Amber')
    await page.waitForFunction(() => [2, 3].every((i) => window.__hd4.sampleChannelBrightness(i) > 0), null, { timeout: 30_000 })
})

test('find-edges flattens a solid program toward black', async ({ page }) => {
    await page.evaluate(() => { window.__hd4.switcher.setType('cut'); window.__hd4.switcher.cut(3) }) // solid Blue
    // Confirm the solid Blue is on program before filtering.
    await expect.poll(() => page.evaluate(() => window.__hd4.sampleProgramAvg().reduce((a, b) => a + b, 0)), { timeout: 10_000 })
        .toBeGreaterThan(60)

    await page.selectOption('.hd4-vfx-select', 'edges')
    await expect.poll(() => page.evaluate(() => window.__hd4.sampleProgramAvg().reduce((a, b) => a + b, 0)), { timeout: 15_000 })
        .toBeLessThan(40) // solid → no internal edges → near black

    await page.selectOption('.hd4-vfx-select', 'none')
    await expect.poll(async () => {
        const [p, blue] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(2)])
        return dist(p, blue)
    }, { timeout: 15_000 }).toBeLessThan(30) // restored
})

test('a MIX with a non-default blend mode completes on its target', async ({ page }) => {
    await page.evaluate(() => { window.__hd4.switcher.setType('cut'); window.__hd4.switcher.cut(3) }) // Blue live
    await page.selectOption('.hd4-blend-select', 'screen')
    await expect(page.locator('.hd4-blend-select')).toHaveValue('screen')

    await page.evaluate(() => { window.__hd4.switcher.setType('mix'); window.__hd4.switcher.setTime(0.4); window.__hd4.switcher.take(4, performance.now()) })
    await expect.poll(async () => {
        const [p, amber] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(3)])
        return dist(p, amber)
    }, { timeout: 15_000 }).toBeLessThan(30) // lands on Amber
})
