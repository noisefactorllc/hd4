// SPDX-License-Identifier: MIT
/**
 * Channel-strip audio integration — the per-channel EQ/dynamics editor. The
 * EQ button opens the editor; controls drive the WebAudio strip params. The
 * gate is verified audibly: a high threshold closes it (the camera meter
 * falls silent), a low threshold reopens it.
 */
import { test, expect } from '@playwright/test'

const meter = (page, i) => page.evaluate((idx) => window.__hd4.audio.getMeter(idx), i)

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.click('.hd4-take-btn[data-channel="1"]') // unlock audio
})

test('the EQ button opens the editor and controls drive the strip params', async ({ page }) => {
    await page.click('.hd4-strip[data-channel="1"] .hd4-edit-btn')
    await expect(page.locator('.hd4-stripedit-overlay--chan')).toHaveAttribute('data-open', 'true')

    await page.click('.hd4-se-toggle[data-key="hpf"]')
    expect(await page.evaluate(() => window.__hd4.audio.stripParam(0, 'hpf'))).toBe(true)

    await page.fill('.hd4-se-slider[data-key="pan"]', '-1')
    await page.dispatchEvent('.hd4-se-slider[data-key="pan"]', 'input')
    expect(await page.evaluate(() => window.__hd4.audio.stripParam(0, 'pan'))).toBeLessThan(-0.5)

    // The gate Attack control drives the (newly exposed) gateAttack param.
    await page.fill('.hd4-se-slider[data-key="gateAttack"]', '120')
    await page.dispatchEvent('.hd4-se-slider[data-key="gateAttack"]', 'input')
    expect(await page.evaluate(() => window.__hd4.audio.stripParam(0, 'gateAttack'))).toBe(120)

    // Switching tabs retargets the editor to another channel.
    await page.click('.hd4-stripedit-tab >> nth=1')
    await expect(page.locator('.hd4-stripedit-overlay--chan .hd4-stripedit-title')).toHaveText('Channel 2 audio')
})

test('the gate closes on a high threshold and reopens on a low one', async ({ page }) => {
    await page.selectOption('.hd4-monitor[data-channel="1"] .hd4-source-select', 'camera')
    await page.waitForFunction(() => window.__hd4.channels[0].source.type === 'camera', null, { timeout: 15_000 })
    await expect.poll(() => meter(page, 0), { timeout: 20_000 }).toBeGreaterThan(0)

    // Gate ON with a 0 dBFS threshold → mic is below it → gate closes → silence.
    await page.evaluate(() => {
        window.__hd4.audio.setStripParam(0, 'gateThreshold', 0)
        window.__hd4.audio.setStripParam(0, 'gate', true)
    })
    await expect.poll(() => meter(page, 0), { timeout: 10_000 }).toBeLessThan(0.001)

    // Drop the threshold → gate opens → signal returns.
    await page.evaluate(() => window.__hd4.audio.setStripParam(0, 'gateThreshold', -80))
    await expect.poll(() => meter(page, 0), { timeout: 10_000 }).toBeGreaterThan(0)
})
