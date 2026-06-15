// SPDX-License-Identifier: MIT
/**
 * Boot smoke test — the app shell loads, the boot path runs, and the
 * window.__hd4 automation hook reports ready. Requires the Noise Factor
 * CDNs (handfish) and a Playwright browser (`npx playwright install`).
 */
import { test, expect } from '@playwright/test'

test('app boots and exposes the __hd4 hook', async ({ page }) => {
    await page.goto('/')

    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 15_000 })

    const version = await page.evaluate(() => window.__hd4.version)
    expect(version).toBe('0.1.0')

    await expect(page.locator('#app[data-booted="true"]')).toBeAttached()
})
