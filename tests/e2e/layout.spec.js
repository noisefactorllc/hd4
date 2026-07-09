// SPDX-License-Identifier: MIT
/**
 * Standalone layout density: the app should present as a single-screen
 * control surface in a normal desktop browser window.
 */
import { test, expect } from './fixtures.js'

test('standalone app fits in a 1280x720 desktop viewport without page scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.waitForTimeout(300)

    const metrics = await page.evaluate(() => {
        const app = document.querySelector('#app').getBoundingClientRect()
        const required = ['#hd4-topbar', '#hd4-stage', '#hd4-compositor', '#hd4-transition', '#hd4-mixer']
            .map((selector) => {
                const rect = document.querySelector(selector).getBoundingClientRect()
                return { selector, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
            })
        return {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            document: {
                scrollWidth: document.documentElement.scrollWidth,
                scrollHeight: document.documentElement.scrollHeight,
            },
            app: { top: app.top, bottom: app.bottom, left: app.left, right: app.right },
            required,
        }
    })

    expect(metrics.document.scrollHeight).toBeLessThanOrEqual(metrics.viewport.height)
    expect(metrics.document.scrollWidth).toBeLessThanOrEqual(metrics.viewport.width)
    expect(metrics.app.top).toBeGreaterThanOrEqual(0)
    expect(metrics.app.bottom).toBeLessThanOrEqual(metrics.viewport.height)
    expect(metrics.app.left).toBeGreaterThanOrEqual(0)
    expect(metrics.app.right).toBeLessThanOrEqual(metrics.viewport.width)
    expect(metrics.app.top).toBeLessThanOrEqual(1)
    expect(metrics.app.left).toBeLessThanOrEqual(1)
    expect(metrics.app.bottom).toBeGreaterThanOrEqual(metrics.viewport.height - 1)
    expect(metrics.app.right).toBeGreaterThanOrEqual(metrics.viewport.width - 1)

    for (const rect of metrics.required) {
        expect(rect.top, `${rect.selector} top`).toBeGreaterThanOrEqual(0)
        expect(rect.bottom, `${rect.selector} bottom`).toBeLessThanOrEqual(metrics.viewport.height)
        expect(rect.left, `${rect.selector} left`).toBeGreaterThanOrEqual(0)
        expect(rect.right, `${rect.selector} right`).toBeLessThanOrEqual(metrics.viewport.width)
        expect(rect.left, `${rect.selector} left edge`).toBeLessThanOrEqual(1)
        expect(rect.right, `${rect.selector} right edge`).toBeGreaterThanOrEqual(metrics.viewport.width - 1)
    }
})
