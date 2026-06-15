// SPDX-License-Identifier: MIT
/**
 * Preview (PGM/PVW) integration — queue a channel on PVW, then TAKE (cut)
 * or AUTO (transition) it to program. The bus flip-flops so the outgoing
 * program returns to preview. Verified against the real program pixels and
 * the bus state.
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
    await page.evaluate(() => { window.__hd4.switcher.setType('cut'); window.__hd4.switcher.cut(3) }) // Blue live
})

test('PVW select + TAKE cuts to preview and flip-flops the bus', async ({ page }) => {
    await page.click('.hd4-pvw-btn[data-channel="4"]') // queue Amber
    expect(await page.evaluate(() => window.__hd4.preview.preview)).toBe(4)
    await expect(page.locator('.hd4-pvw-btn[data-channel="4"]')).toHaveClass(/is-preview/)

    await page.click('.hd4-preview-action:has-text("TAKE")')
    await expect.poll(async () => {
        const [p, amber] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(3)])
        return dist(p, amber)
    }, { timeout: 15_000 }).toBeLessThan(30) // program is now Amber

    expect(await page.evaluate(() => window.__hd4.preview.preview)).toBe(3) // outgoing Blue returns to preview
    await expect(page.locator('.hd4-pvw-btn[data-channel="3"]')).toHaveClass(/is-preview/)
})

test('AUTO transitions preview to program', async ({ page }) => {
    await page.evaluate(() => { window.__hd4.switcher.setType('mix'); window.__hd4.switcher.setTime(0.5) })
    await page.click('.hd4-pvw-btn[data-channel="4"]') // queue Amber
    await page.click('.hd4-preview-action:has-text("AUTO")')

    await expect.poll(async () => {
        const [p, amber] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(3)])
        return dist(p, amber)
    }, { timeout: 15_000 }).toBeLessThan(30) // transition lands on Amber
})
