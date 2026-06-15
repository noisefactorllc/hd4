// SPDX-License-Identifier: MIT
/**
 * USER buttons integration — the assignable macro buttons trigger their
 * action, can be reassigned through the select, and the assignments persist
 * across a reload (localStorage).
 */
import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
    // Each Playwright test gets a fresh context (empty localStorage), so USER
    // assignments start at their defaults.
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
})

test('a USER button triggers its action and can be reassigned', async ({ page }) => {
    // Default slot 1 is FREEZE.
    await page.click('.hd4-user-btn[data-slot="1"]')
    expect(await page.evaluate(() => window.__hd4.output.freeze)).toBe(true)

    // Reassign slot 1 to QUAD and trigger it.
    await page.selectOption('.hd4-user-assign[data-slot="1"]', 'quad')
    await expect(page.locator('.hd4-user-btn[data-slot="1"]')).toHaveText('QUAD')
    await page.click('.hd4-user-btn[data-slot="1"]')
    expect(await page.evaluate(() => window.__hd4.composition.composition)).toBe('quad')
})

test('assignments persist across a reload', async ({ page }) => {
    await page.selectOption('.hd4-user-assign[data-slot="2"]', 'key')
    expect(await page.evaluate(() => window.__hd4.userButtons.get(1))).toBe('key')

    await page.reload()
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    expect(await page.evaluate(() => window.__hd4.userButtons.get(1))).toBe('key')
    await expect(page.locator('.hd4-user-assign[data-slot="2"]')).toHaveValue('key')
})
