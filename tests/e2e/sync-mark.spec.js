// SPDX-License-Identifier: MIT
/**
 * The official Sync mark on every HD4 button that connects to Sync: SYNC OUT
 * in the top bar and the Sync dialog's action button.
 */
import { test, expect } from './fixtures.js'

const SYNC_BUTTONS = ['#sync-output-open', '#sync-output-action']

// The mark's place in its button, its computed mask image and its rendered box.
const markOf = (page, selector) => page.locator(selector).evaluate((button) => {
    const mark = button.querySelector(':scope > .sync-mark')
    if (!mark) return null
    const style = getComputedStyle(mark)
    const image = style.maskImage && style.maskImage !== 'none' ? style.maskImage : style.webkitMaskImage
    const box = mark.getBoundingClientRect()
    return {
        first: button.firstElementChild === mark,
        hidden: mark.getAttribute('aria-hidden'),
        url: /^url\("(.+)"\)$/.exec(image || '')?.[1] ?? null,
        width: box.width,
        height: box.height,
    }
})

test('every Sync button shows the official Sync mark', async ({ page }) => {
    await page.addInitScript(() => {
        // No Sync companion answers, so the dialog's action reads "Check again".
        window.__HD4_SYNC_TRANSPORT__ = {
            fetch: () => Promise.reject(new TypeError('Failed to fetch')),
            WebSocket: class { constructor() { throw new Error('Sync is not running') } },
            permissions: null,
        }
    })
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await expect(page.locator('#sync-output-open')).toHaveText('SYNC OUT')
    await page.click('#sync-output-open')
    await expect(page.locator('#sync-output-action')).toHaveText('Check again')
    // Measure once the dialog has finished opening.
    await page.locator('#sync-output-dialog').evaluate((dialog) => Promise.all(
        dialog.getAnimations({ subtree: true }).map((animation) => animation.finished)))

    const urls = new Set()
    for (const selector of SYNC_BUTTONS) {
        const mark = await markOf(page, selector)
        expect(mark, `${selector} has a .sync-mark`).not.toBeNull()
        expect(mark.first, `${selector} shows the mark before its label`).toBe(true)
        expect(mark.hidden).toBe('true')
        expect(mark.url, `${selector} mask image`).toMatch(/\/css\/sync-mark\.svg$/)
        expect(mark.width, `${selector} mark width`).toBeGreaterThan(0)
        expect(mark.height).toBeCloseTo(mark.width, 2)
        urls.add(mark.url)
    }

    for (const url of urls) {
        const response = await page.request.get(url)
        expect(response.status(), url).toBe(200)
        expect(response.headers()['content-type']).toContain('image/svg+xml')
        expect(await response.text()).toContain('data-sync-mark="overpass"')
    }
})
