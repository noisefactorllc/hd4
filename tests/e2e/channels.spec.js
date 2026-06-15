// SPDX-License-Identifier: MIT
/**
 * Phase 2 integration — four channels, each rendering a source through
 * the real Noisemaker engine, shown in the multiview. Exercises both the
 * shader path (default presets) and the media path (a fake camera).
 *
 * Requires the shaders CDN and a Playwright browser. The fake media
 * device (see playwright.config.js) auto-grants camera permission.
 */
import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
})

test('renders four source monitors with canvases', async ({ page }) => {
    await expect(page.locator('.hd4-monitor')).toHaveCount(4)
    await expect(page.locator('.hd4-monitor .hd4-monitor-canvas')).toHaveCount(4)
})

test('every channel compiles its default shader and runs', async ({ page }) => {
    await page.waitForFunction(
        () => window.__hd4.renderers.length === 4 && window.__hd4.renderers.every((r) => r.isRunning),
        null,
        { timeout: 30_000 },
    )
    const labels = await page.evaluate(() => window.__hd4.channels.map((c) => c.label))
    expect(labels).toEqual(['Noise', 'Gradient', 'Blue', 'Amber'])
})

test('each channel renders a non-black frame', async ({ page }) => {
    for (let i = 0; i < 4; i++) {
        await page.waitForFunction(
            (idx) => window.__hd4.sampleChannelBrightness(idx) > 0,
            i,
            { timeout: 30_000 },
        )
    }
})

test('switching a channel to a camera renders the live (fake) feed', async ({ page }) => {
    const select = page.locator('.hd4-monitor[data-channel="1"] .hd4-source-select')
    await select.selectOption('camera')

    await page.waitForFunction(() => window.__hd4.channels[0].source.type === 'camera', null, { timeout: 15_000 })
    await expect.poll(
        () => page.evaluate(() => window.__hd4.sampleChannelBrightness(0)),
        { timeout: 30_000 },
    ).toBeGreaterThan(0)
    expect(await page.evaluate(() => window.__hd4.channels[0].label)).toBe('Camera')
})

test('switching a channel to a different shader preset updates its label', async ({ page }) => {
    const select = page.locator('.hd4-monitor[data-channel="2"] .hd4-source-select')
    await select.selectOption('shader:2') // "Blue"
    await page.waitForFunction(() => window.__hd4.channels[1].label === 'Blue', null, { timeout: 15_000 })
    await expect(page.locator('.hd4-monitor[data-channel="2"] .hd4-monitor-label')).toHaveText('Blue')
})
