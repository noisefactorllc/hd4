// SPDX-License-Identifier: MIT
/**
 * Every HD4 hover tooltip goes through handfish (`.tooltip` + data-title), whose
 * layer keeps it on screen and at its full width at the edges of the page. No
 * element carries a native title, which would add the browser's own tooltip.
 */
import { test, expect } from './fixtures.js'

const nativeTitles = (page) => page.evaluate(() => [...document.querySelectorAll('body [title]')]
    .filter((el) => el.localName !== 'iframe')
    .map((el) => `${el.localName}.${el.className}: ${el.getAttribute('title')}`))

async function boot(page) {
    await page.addInitScript(() => {
        // No Sync companion answers: the Sync dialog opens without one.
        window.__HD4_SYNC_TRANSPORT__ = {
            fetch: () => Promise.reject(new TypeError('Failed to fetch')),
            WebSocket: class { constructor() { throw new Error('Sync is not running') } },
            permissions: null,
        }
    })
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
}

test('hover tooltips go through handfish, and no panel or dialog adds a native title', async ({ page }) => {
    await boot(page)
    expect(await nativeTitles(page)).toEqual([])
    const take = page.locator('.hd4-take-btn[data-channel="1"]')
    await expect(take).toHaveAttribute('data-title', 'Take channel 1 to program (key 1)')
    await expect(take).toHaveClass(/\btooltip\b/)
    await take.hover()
    await expect(page.locator('#hf-tooltip-layer')).toHaveText('Take channel 1 to program (key 1)')

    for (const [name, open] of [
        ['settings drawer', () => page.click('.hd4-settings-gear')],
        ['MIDI panel', () => page.click('.hd4-midi-open')],
        ['strip editor', () => page.locator('.hd4-edit-btn').first().click()],
        ['main bus editor', () => page.click('.hd4-main-edit-btn')],
        ['Sync dialog', () => page.click('#sync-output-open')],
        ['About dialog', () => page.getByRole('button', { name: 'About HD4' }).click()],
    ]) {
        await open()
        expect(await nativeTitles(page), name).toEqual([])
        await page.keyboard.press('Escape')
    }
})

test('a tooltip at the edge of a small window stays on screen at its full width', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 })
    await boot(page)
    // The tooltip controls nearest the left edge, the right edge and the bottom-right corner.
    const edges = await page.evaluate(() => {
        const shown = [...document.querySelectorAll('.tooltip[data-title]')].map((el) => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 0 && r.height > 0 && r.right <= innerWidth && r.bottom <= innerHeight)
        const pick = (score) => shown.reduce((best, c) => (score(c.r) > score(best.r) ? c : best))
        return [pick((r) => -r.left), pick((r) => r.right), pick((r) => r.right + r.bottom)].map(({ el }, i) => {
            el.dataset.edgeProbe = String(i)
            return el.dataset.title
        })
    })
    for (const [i, text] of edges.entries()) {
        await page.mouse.move(500, 300)
        await page.locator(`[data-edge-probe="${i}"]`).hover()
        const layer = page.locator('#hf-tooltip-layer')
        await expect(layer).toHaveText(text)
        const fit = await layer.evaluate((el) => {
            const r = el.getBoundingClientRect()
            // The same tooltip moved to the middle of the page, then put back.
            const { left, top } = el.style
            el.style.left = `${innerWidth / 2}px`
            el.style.top = `${innerHeight / 2}px`
            const free = el.getBoundingClientRect().width
            el.style.left = left
            el.style.top = top
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, free, vw: document.documentElement.clientWidth, vh: innerHeight }
        })
        expect(fit.left, `${text}: left`).toBeGreaterThanOrEqual(0)
        expect(fit.top, `${text}: top`).toBeGreaterThanOrEqual(0)
        expect(fit.right, `${text}: right`).toBeLessThanOrEqual(fit.vw)
        expect(fit.bottom, `${text}: bottom`).toBeLessThanOrEqual(fit.vh)
        expect(Math.abs(fit.width - fit.free), `${text}: width ${fit.width} at the edge, ${fit.free} away from it`).toBeLessThanOrEqual(1)
    }
})
