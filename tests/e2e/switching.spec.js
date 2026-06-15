// SPDX-License-Identifier: MIT
/**
 * Phase 3 integration — the program-bus switcher driving the 2D program
 * compositor. Takes through CUT / MIX / WIPE land the right channel on the
 * program output, verified by matching the program's average color to the
 * live channel's (both read through the same path, so the invariant is
 * "program shows channel N" rather than a literal color).
 */
import { test, expect } from '@playwright/test'

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.waitForFunction(() => window.__hd4.renderers.every((r) => r.isRunning), null, { timeout: 30_000 })
    // Distinct solids on the channels these tests switch to, so program/
    // channel color comparisons are unambiguous.
    await page.selectOption('.hd4-monitor[data-channel="3"] .hd4-source-select', 'shader:Blue') // Blue
    await page.selectOption('.hd4-monitor[data-channel="4"] .hd4-source-select', 'shader:Amber') // Amber
    await page.waitForFunction(() => window.__hd4.sampleChannelBrightness(2) > 0 && window.__hd4.sampleChannelBrightness(3) > 0, null, { timeout: 30_000 })
})

test('program monitor and four take buttons are present and rendering', async ({ page }) => {
    await expect(page.locator('.hd4-program-canvas')).toHaveCount(1)
    await expect(page.locator('.hd4-take-btn')).toHaveCount(4)
    await expect.poll(
        () => page.evaluate(() => window.__hd4.sampleProgramAvg().reduce((a, b) => a + b, 0)),
        { timeout: 30_000 },
    ).toBeGreaterThan(0)
})

test('CUT takes the selected channel to program instantly', async ({ page }) => {
    await page.click('.hd4-trans-btn[data-type="cut"]')
    await page.click('.hd4-take-btn[data-channel="4"]')

    const st = await page.evaluate(() => ({
        live: window.__hd4.switcher.live,
        transitioning: window.__hd4.switcher.transitioning,
    }))
    expect(st.live).toBe(4)
    expect(st.transitioning).toBe(false)

    await expect.poll(async () => {
        const [prog, ch] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(3)])
        return dist(prog, ch)
    }, { timeout: 15_000 }).toBeLessThan(30)

    await expect(page.locator('.hd4-take-btn[data-channel="4"]')).toHaveClass(/is-live/)
})

test('MIX take starts a transition and settles on the target channel', async ({ page }) => {
    await page.click('.hd4-trans-btn[data-type="mix"]')
    await page.evaluate(() => window.__hd4.switcher.setTime(1.5))

    await page.click('.hd4-take-btn[data-channel="3"]')

    // Synchronously after the take, the transition is in flight to ch 3.
    const mid = await page.evaluate(() => ({
        live: window.__hd4.switcher.live,
        transitioning: window.__hd4.switcher.transitioning,
    }))
    expect(mid.live).toBe(3)
    expect(mid.transitioning).toBe(true)

    // It completes, and the program shows channel 3.
    await page.waitForFunction(() => window.__hd4.switcher.transitioning === false, null, { timeout: 10_000 })
    await expect.poll(async () => {
        const [prog, ch] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(2)])
        return dist(prog, ch)
    }, { timeout: 15_000 }).toBeLessThan(30)
})

test('the transition curve selector is present and a curved MIX settles', async ({ page }) => {
    await expect(page.locator('.hd4-curve-select')).toHaveCount(1)
    await page.selectOption('.hd4-curve-select', 'sharp')
    await page.click('.hd4-trans-btn[data-type="mix"]')
    await page.evaluate(() => window.__hd4.switcher.setTime(0.5))
    await page.click('.hd4-take-btn[data-channel="4"]')
    await page.waitForFunction(() => window.__hd4.switcher.transitioning === false, null, { timeout: 10_000 })
    expect(await page.evaluate(() => window.__hd4.switcher.live)).toBe(4)
})

test('WIPE take transitions and completes', async ({ page }) => {
    await page.click('.hd4-trans-btn[data-type="wipe"]')
    await page.evaluate(() => window.__hd4.switcher.setTime(1.5))
    await page.click('.hd4-take-btn[data-channel="2"]')

    expect(await page.evaluate(() => window.__hd4.switcher.transitioning)).toBe(true)
    await page.waitForFunction(() => window.__hd4.switcher.transitioning === false, null, { timeout: 10_000 })
    expect(await page.evaluate(() => window.__hd4.switcher.live)).toBe(2)
})
