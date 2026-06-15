// SPDX-License-Identifier: MIT
/**
 * Boutique form-factor — HD4 presents as a compact, centred "device unit"
 * floating on a darker pasteboard (the Midnight house style), not a
 * full-bleed console that sprawls edge-to-edge across a wide display.
 *
 * These are layout invariants of the boutique chrome, checked against the
 * real rendered geometry at a generous viewport.
 */
import { test, expect } from './fixtures.js'

// A roomy desktop so a full-bleed layout would clearly exceed the unit cap.
test.use({ viewport: { width: 1600, height: 1200 } })

async function boot(page) {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 15_000 })
}

test('renders as a centred, width-capped, compact device unit', async ({ page }) => {
    await boot(page)
    const vp = page.viewportSize()
    const box = await page.locator('#app').boundingBox()

    // Capped width — a boutique unit, not edge-to-edge chrome.
    expect(box.width).toBeLessThanOrEqual(1320)
    expect(box.width).toBeLessThan(vp.width - 120)

    // Horizontally centred on the pasteboard (left gutter ≈ right gutter).
    const leftGap = box.x
    const rightGap = vp.width - (box.x + box.width)
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(6)

    // Compact height — the unit floats, it is not stretched to fill 100vh.
    expect(box.height).toBeLessThan(vp.height - 60)
})

test('the device panel reads against a distinct pasteboard surface', async ({ page }) => {
    await boot(page)
    const { bodyBg, appBg } = await page.evaluate(() => ({
        bodyBg: getComputedStyle(document.body).backgroundColor,
        appBg: getComputedStyle(document.getElementById('app')).backgroundColor,
    }))
    // The panel is a real (opaque) surface, distinct from the pasteboard.
    expect(appBg).not.toBe('rgba(0, 0, 0, 0)')
    expect(appBg).not.toBe(bodyBg)
})
