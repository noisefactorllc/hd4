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

test('every top-bar control is fully visible at 1280x720, even with the REC timer running', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    // The widest REC label: the running timer.
    await page.evaluate(() => {
        const rec = document.querySelector('.hd4-rec-btn')
        rec.classList.add('is-active')
        rec.textContent = '● 00:00:00'
    })
    await page.waitForTimeout(100)

    const layout = await page.evaluate(() => {
        const bar = document.querySelector('#hd4-topbar').getBoundingClientRect()
        const controls = [...document.querySelectorAll('#hd4-topbar button, #hd4-topbar select, #hd4-topbar led-matrix')]
            .filter((el) => el.getClientRects().length > 0)
            .map((el) => {
                const r = el.getBoundingClientRect()
                return { name: el.textContent.trim() || el.getAttribute('aria-label') || el.tagName, left: r.left, right: r.right, top: r.top, bottom: r.bottom }
            })
        return { bar: { left: bar.left, right: bar.right, top: bar.top, bottom: bar.bottom }, controls }
    })
    expect(layout.controls.map((c) => c.name)).toEqual(expect.arrayContaining(['SYNC OUT', 'VIEWPORT']))
    for (const c of layout.controls) {
        expect(c.left, `${c.name} left`).toBeGreaterThanOrEqual(layout.bar.left)
        expect(c.right, `${c.name} right`).toBeLessThanOrEqual(layout.bar.right)
        expect(c.top, `${c.name} top`).toBeGreaterThanOrEqual(layout.bar.top)
        expect(c.bottom, `${c.name} bottom`).toBeLessThanOrEqual(layout.bar.bottom)
    }
    // Neighbouring controls never overlap.
    const sorted = [...layout.controls].sort((a, b) => a.left - b.left)
    for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].left, `${sorted[i].name} after ${sorted[i - 1].name}`).toBeGreaterThanOrEqual(sorted[i - 1].right - 0.5)
    }
})
