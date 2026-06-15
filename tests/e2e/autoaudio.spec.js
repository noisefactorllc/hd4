// SPDX-License-Identifier: MIT
/**
 * Auto-audio integration. AUDIO FOLLOW (audio-follows-video) is verified
 * audibly: a follow-enabled channel is heard only while its video is live.
 * AUTO MIXING (global) and VIDEO FOLLOWS AUDIO are wired through their
 * controls (the gain-sharing / loudest-pick logic is unit-tested).
 */
import { test, expect } from '@playwright/test'

const meter = (page, i) => page.evaluate((idx) => window.__hd4.audio.getMeter(idx), i)

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.click('.hd4-take-btn[data-channel="1"]') // unlock audio
    await page.selectOption('.hd4-monitor[data-channel="1"] .hd4-source-select', 'camera')
    await page.waitForFunction(() => window.__hd4.channels[0].source.type === 'camera', null, { timeout: 15_000 })
})

test('AUDIO FOLLOW: a channel is heard only while its video is live', async ({ page }) => {
    await page.evaluate(() => { window.__hd4.switcher.setType('cut'); window.__hd4.switcher.cut(1) }) // ch1 live
    await page.evaluate(() => window.__hd4.audio.setStripParam(0, 'followVideo', true))
    await expect.poll(() => meter(page, 0), { timeout: 20_000 }).toBeGreaterThan(0) // live → audible

    await page.evaluate(() => window.__hd4.switcher.cut(2)) // ch1 no longer live
    await expect.poll(() => meter(page, 0), { timeout: 10_000 }).toBeLessThan(0.001) // ducked

    await page.evaluate(() => window.__hd4.switcher.cut(1)) // live again
    await expect.poll(() => meter(page, 0), { timeout: 10_000 }).toBeGreaterThan(0)
})

test('the auto-audio controls drive their state', async ({ page }) => {
    await page.selectOption('.hd4-auto-mode', 'follows-audio')
    expect(await page.evaluate(() => window.__hd4.autoMix.mode)).toBe('follows-audio')

    await page.click('.hd4-strip[data-channel="1"] .hd4-edit-btn')
    await page.click('.hd4-se-toggle[data-key="followVideo"]')
    expect(await page.evaluate(() => window.__hd4.audio.stripParam(0, 'followVideo'))).toBe(true)
    await page.click('.hd4-stripedit-overlay--chan .hd4-stripedit-close') // close before the next modal

    await page.click('.hd4-main-edit-btn')
    await page.click('.hd4-se-toggle[data-key="autoMixing"]')
    expect(await page.evaluate(() => window.__hd4.audio.mainParam('autoMixing'))).toBe(true)
})
