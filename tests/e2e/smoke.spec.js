// SPDX-License-Identifier: MIT
/**
 * Boot smoke test — the app shell loads, the boot path runs, and the
 * window.__hd4 automation hook reports ready. Also checks the industrial top
 * bar (handfish logotype + normalized settings/info cluster + tempo-bar) is
 * present and that the About dialog opens, with zero page errors. Requires the
 * Noise Factor CDNs (handfish; or HANDFISH_LOCAL) and a Playwright browser
 * (`npx playwright install`).
 */
import { test, expect } from './fixtures.js'

test('app boots and exposes the __hd4 hook', async ({ page }) => {
    await page.goto('/')

    // 30s: the first nav of a run compiles the CDN shader pipelines on a cold
    // cache (matches the budget the integration specs use).
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })

    const version = await page.evaluate(() => window.__hd4.version)
    expect(version).toBe('0.1.0')

    await expect(page.locator('#app[data-booted="true"]')).toBeAttached()
})

test('the industrial top bar renders the logotype, cluster and tempo-bar', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })

    // Logotype wordmark (industrial .hf-logotype), normalized cluster with the
    // settings gear + info buttons, and the tempo-bar web component.
    await expect(page.locator('.hf-logotype')).toHaveText('HD4')
    await expect(page.locator('.hf-topbar-cluster .hd4-settings-gear')).toHaveCount(1)
    await expect(page.locator('.hf-topbar-cluster .hf-icon-btn')).toHaveCount(2)
    await expect(page.locator('tempo-bar')).toHaveCount(1)
    await expect(page.locator('tempo-bar .tempo-bar__bpm')).toBeVisible()

    await page.waitForTimeout(300) // let fonts / component upgrade settle
    expect(errors, errors.join('\n')).toEqual([])
})

test('the info button opens the About dialog', async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })

    await page.locator('.hf-topbar-cluster .hf-icon-btn[data-title="About HD4"]').click()
    await expect(page.locator('dialog.hf-about[open]')).toBeVisible()
    await expect(page.locator('.hf-about-name')).toHaveText('HD4')
    await expect(page.locator('.hf-about-tagline')).toHaveText('video mixer')
})
