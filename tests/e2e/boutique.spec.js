// SPDX-License-Identifier: MIT
/**
 * Standalone form-factor — HD4 presents as a single viewport-fitted control
 * surface with no outer page margin.
 *
 * These are layout invariants of the boutique chrome, checked against the
 * real rendered geometry at a generous viewport.
 */
import { test, expect } from './fixtures.js'

// A roomy desktop so any leftover standalone margin is easy to catch.
test.use({ viewport: { width: 1600, height: 1200 } })

async function boot(page) {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 15_000 })
}

test('renders as an edge-to-edge viewport-fitted control surface', async ({ page }) => {
    await boot(page)
    const vp = page.viewportSize()
    const box = await page.locator('#app').boundingBox()
    const scroll = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
    }))

    // Viewport-fitted and marginless: the standalone surface owns the window.
    expect(scroll.width).toBeLessThanOrEqual(vp.width)
    expect(scroll.height).toBeLessThanOrEqual(vp.height)
    expect(box.x).toBeLessThanOrEqual(1)
    expect(box.y).toBeLessThanOrEqual(1)
    expect(box.x + box.width).toBeGreaterThanOrEqual(vp.width - 1)
    expect(box.y + box.height).toBeGreaterThanOrEqual(vp.height - 1)
})

test('the app panel is an opaque surface', async ({ page }) => {
    await boot(page)
    const { appBg } = await page.evaluate(() => ({
        appBg: getComputedStyle(document.getElementById('app')).backgroundColor,
    }))
    // The panel is a real opaque surface.
    expect(appBg).not.toBe('rgba(0, 0, 0, 0)')
})
