// SPDX-License-Identifier: MIT
/**
 * Settings drawer integration — open via the gear / the "s" key; changing
 * output resolution resizes the program output and persists; theme and
 * output-fade time apply and persist.
 */
import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
})

test('opens via the gear and the "s" key, and lists the config sections', async ({ page }) => {
    expect(await page.evaluate(() => window.__hd4.settingsDrawer.isOpen)).toBe(false)
    await page.click('.hd4-settings-gear')
    expect(await page.evaluate(() => window.__hd4.settingsDrawer.isOpen)).toBe(true)
    await expect(page.locator('#hd4-set-resolution')).toHaveCount(1)
    await expect(page.locator('#hd4-set-theme')).toHaveCount(1)
    await expect(page.locator('#hd4-set-fade')).toHaveCount(1)
    await expect(page.locator('#hd4-set-beat')).toHaveCount(1)
    await expect(page.locator('.hd4-shortcut')).not.toHaveCount(0)

    await page.click('.hd4-settings-close')
    expect(await page.evaluate(() => window.__hd4.settingsDrawer.isOpen)).toBe(false)
    await page.keyboard.press('s')
    expect(await page.evaluate(() => window.__hd4.settingsDrawer.isOpen)).toBe(true)
})

test('changing resolution resizes the program output and persists', async ({ page }) => {
    await page.click('.hd4-settings-gear')
    await page.selectOption('#hd4-set-resolution', '1920x1080')
    await expect.poll(() => page.evaluate(() => window.__hd4.compositor.canvas.width), { timeout: 5_000 }).toBe(1920)
    expect(await page.evaluate(() => window.__hd4.settings.get('resolution'))).toBe('1920x1080')

    await page.reload()
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    expect(await page.evaluate(() => window.__hd4.compositor.canvas.width)).toBe(1920)
})

test('changing the theme updates data-theme and persists', async ({ page }) => {
    await page.click('.hd4-settings-gear')
    await page.selectOption('#hd4-set-theme', 'ocean')
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('ocean')
    expect(await page.evaluate(() => window.__hd4.settings.get('theme'))).toBe('ocean')

    await page.reload()
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('ocean')
})

test('changing output fade time updates the setting', async ({ page }) => {
    await page.click('.hd4-settings-gear')
    await page.locator('#hd4-set-fade').evaluate((el) => {
        el.value = '2'
        el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(await page.evaluate(() => window.__hd4.settings.get('outputFadeTime'))).toBe(2)
})
