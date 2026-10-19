// SPDX-License-Identifier: MIT
/**
 * VIEWPORT — the program mirrored in a popup for a secondary display: it
 * opens from the top bar, shows the live program, goes full screen on F,
 * is only focused (never closed) by the button once open, detaches when the
 * operator closes it, and reports a blocked popup without opening anything.
 */
import { test, expect } from './fixtures.js'

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

const viewportButton = (page) => page.locator('.hd4-output-btn:has-text("VIEWPORT")')

// Mean RGB of the popup canvas' central tenth.
const sampleCenter = (popup) => popup.evaluate(() => {
    const c = document.querySelector('canvas')
    const w = Math.max(1, Math.floor(c.width / 10))
    const h = Math.max(1, Math.floor(c.height / 10))
    const d = c.getContext('2d').getImageData(Math.floor((c.width - w) / 2), Math.floor((c.height - h) / 2), w, h).data
    const sum = [0, 0, 0]
    for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2] }
    return sum.map((v) => v / (d.length / 4))
})

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.waitForFunction(() => window.__hd4.renderers.every((r) => r.isRunning), null, { timeout: 30_000 })
    // A solid live program (ch3 = Blue) makes a stable mirror target.
    await page.selectOption('.hd4-monitor[data-channel="3"] .hd4-source-select', 'shader:Blue')
    await page.waitForFunction(() => window.__hd4.sampleChannelBrightness(2) > 0, null, { timeout: 30_000 })
    await page.evaluate(() => { window.__hd4.switcher.setType('cut'); window.__hd4.switcher.cut(3) })
})

test('VIEWPORT mirrors the live program in a popup and goes full screen on F', async ({ page }) => {
    const button = viewportButton(page)
    const [popup] = await Promise.all([page.waitForEvent('popup'), button.click()])
    await expect(button).toHaveClass(/is-active/)
    expect(await page.evaluate(() => window.__hd4.viewport.isOpen)).toBe(true)
    await expect(popup).toHaveTitle('HD4 — Viewport')
    await expect(popup.locator('.hint')).toContainText('press F for fullscreen')

    await expect.poll(async () => {
        const [mirror, program] = [await sampleCenter(popup), await page.evaluate(() => window.__hd4.sampleProgramRect(0.45, 0.45, 0.1, 0.1))]
        return dist(mirror, program)
    }, { timeout: 15_000 }).toBeLessThan(40)

    await popup.keyboard.press('f')
    await expect.poll(() => popup.evaluate(() => !!document.fullscreenElement)).toBe(true)
    await popup.keyboard.press('f')
    await expect.poll(() => popup.evaluate(() => !!document.fullscreenElement)).toBe(false)
})

test('VIEWPORT on an open window focuses it and never closes the live display', async ({ page, context }) => {
    const button = viewportButton(page)
    const [popup] = await Promise.all([page.waitForEvent('popup'), button.click()])
    await expect(button).toHaveClass(/is-active/)
    const pagesBefore = context.pages().length
    await button.click()
    await page.waitForTimeout(300)
    expect(popup.isClosed()).toBe(false)
    expect(context.pages().length).toBe(pagesBefore)
    await expect(button).toHaveClass(/is-active/)
    expect(await page.evaluate(() => window.__hd4.viewport.isOpen)).toBe(true)
})

test('closing the popup detaches the viewport', async ({ page }) => {
    const button = viewportButton(page)
    const [popup] = await Promise.all([page.waitForEvent('popup'), button.click()])
    await expect(button).toHaveClass(/is-active/)
    await popup.close()
    await expect(button).not.toHaveClass(/is-active/)
    await expect.poll(() => page.evaluate(() => window.__hd4.viewport.isOpen)).toBe(false)
    // It reopens cleanly afterwards.
    const [again] = await Promise.all([page.waitForEvent('popup'), button.click()])
    await expect(again).toHaveTitle('HD4 — Viewport')
    await expect(button).toHaveClass(/is-active/)
})

test('a blocked popup opens nothing and leaves VIEWPORT off', async ({ page }) => {
    await page.evaluate(() => { window.open = () => null })
    await viewportButton(page).click()
    await expect(viewportButton(page)).not.toHaveClass(/is-active/)
    expect(await page.evaluate(() => window.__hd4.viewport.isOpen)).toBe(false)
})
