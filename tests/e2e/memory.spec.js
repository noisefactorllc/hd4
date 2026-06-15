// SPDX-License-Identifier: MIT
/**
 * Phase 6 integration — 8-slot MEMORY. Save a distinctive state, change
 * everything, recall, and confirm the full state (switcher, output VFX,
 * audio mute) and the UI controls are restored. Plus persistence across a
 * reload.
 */
import { test, expect } from './fixtures.js'

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

test('keyboard shortcuts take channels and toggle quad', async ({ page }) => {
    await page.keyboard.press('3')
    await page.waitForFunction(() => window.__hd4.switcher.live === 3, null, { timeout: 5_000 })

    await page.keyboard.press('q')
    expect(await page.evaluate(() => window.__hd4.composition.composition)).toBe('quad')
    await page.keyboard.press('q')
    expect(await page.evaluate(() => window.__hd4.composition.composition)).toBe('off')
})
