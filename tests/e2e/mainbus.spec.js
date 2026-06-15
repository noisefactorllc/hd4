// SPDX-License-Identifier: MIT
/**
 * Main-bus integration — the MAIN [SETUP] editor. The SET button opens it;
 * controls drive the main-bus params. MAIN MUTE is verified audibly against
 * the main meter.
 */
import { test, expect } from '@playwright/test'

const mainMeter = (page) => page.evaluate(() => window.__hd4.audio.getMainMeter())

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.click('.hd4-take-btn[data-channel="1"]') // unlock audio
})

test('the SET button opens the main editor and controls drive the params', async ({ page }) => {
    await page.click('.hd4-main-edit-btn')
    await expect(page.locator('.hd4-stripedit-overlay--main')).toHaveAttribute('data-open', 'true')

    await page.selectOption('.hd4-se-select[data-key="reverbType"]', 'hall')
    expect(await page.evaluate(() => window.__hd4.audio.mainParam('reverbType'))).toBe('hall')

    await page.click('.hd4-se-toggle[data-key="mbComp"]')
    expect(await page.evaluate(() => window.__hd4.audio.mainParam('mbComp'))).toBe(true)
})

test('MAIN MUTE silences the main meter', async ({ page }) => {
    await page.selectOption('.hd4-monitor[data-channel="1"] .hd4-source-select', 'camera')
    await page.waitForFunction(() => window.__hd4.channels[0].source.type === 'camera', null, { timeout: 15_000 })
    await expect.poll(() => mainMeter(page), { timeout: 20_000 }).toBeGreaterThan(0)

    await page.click('.hd4-main-edit-btn')
    await page.click('.hd4-se-toggle[data-key="mainMute"]')
    expect(await page.evaluate(() => window.__hd4.audio.mainParam('mainMute'))).toBe(true)
    await expect.poll(() => mainMeter(page), { timeout: 10_000 }).toBeLessThan(0.001)

    await page.click('.hd4-se-toggle[data-key="mainMute"]')
    await expect.poll(() => mainMeter(page), { timeout: 10_000 }).toBeGreaterThan(0)
})
