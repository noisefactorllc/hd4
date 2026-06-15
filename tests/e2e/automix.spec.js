// SPDX-License-Identifier: MIT
/**
 * Auto-mixing + beat matching integration. With a fast tempo and cut
 * transitions, enabling AUTO scans the program through the channels on the
 * beat. Also covers the keyboard toggle and the AUTO bar controls.
 */
import { test, expect } from './fixtures.js'

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
})

test('AUTO scans the program through the channels on the beat', async ({ page }) => {
    // Fast tempo + instant cuts + switch every bar, so it scans quickly.
    await page.evaluate(() => {
        window.__hd4.switcher.setType('cut')
        window.__hd4.beatClock.setBpm(300) // 200ms/beat → 800ms/bar
        window.__hd4.autoMix.setBarsPerSwitch(1)
    })

    await page.click('.hd4-auto-btn')
    expect(await page.evaluate(() => window.__hd4.autoMix.enabled)).toBe(true)

    // Scan order from live=1 is 1→2→3→… ; reaching 3 proves two auto-takes.
    await page.waitForFunction(() => window.__hd4.switcher.live === 2, null, { timeout: 8_000 })
    await page.waitForFunction(() => window.__hd4.switcher.live === 3, null, { timeout: 8_000 })

    // Disabling AUTO stops the switching.
    await page.click('.hd4-auto-btn')
    expect(await page.evaluate(() => window.__hd4.autoMix.enabled)).toBe(false)
    const a = await page.evaluate(() => window.__hd4.switcher.live)
    await page.waitForTimeout(1200)
    const b = await page.evaluate(() => window.__hd4.switcher.live)
    expect(b).toBe(a) // no further takes while disabled
})

test('excluding a channel removes it from the AUTO rotation', async ({ page }) => {
    await page.evaluate(() => {
        window.__hd4.switcher.setType('cut')
        window.__hd4.switcher.cut(1)
        window.__hd4.beatClock.setBpm(300)
        window.__hd4.autoMix.setBarsPerSwitch(1)
    })
    // Exclude channel 2 from the rotation via its tile toggle.
    await page.click('.hd4-monitor[data-channel="2"] .hd4-auto-include')
    expect(await page.evaluate(() => window.__hd4.autoMix.isIncluded(2))).toBe(false)
    await expect(page.locator('.hd4-monitor[data-channel="2"] .hd4-auto-include')).not.toHaveClass(/is-on/)

    await page.click('.hd4-auto-btn') // enable AUTO
    // From live 1, scan must skip the excluded ch2 and land on 3.
    await page.waitForFunction(() => window.__hd4.switcher.live === 3, null, { timeout: 8_000 })
    expect(await page.evaluate(() => window.__hd4.switcher.live)).not.toBe(2)
})

test('the "a" key toggles AUTO', async ({ page }) => {
    await page.keyboard.press('a')
    expect(await page.evaluate(() => window.__hd4.autoMix.enabled)).toBe(true)
    await expect(page.locator('.hd4-auto-btn')).toHaveClass(/is-active/)
    await page.keyboard.press('a')
    expect(await page.evaluate(() => window.__hd4.autoMix.enabled)).toBe(false)
})

test('tap tempo updates the BPM, and the AUTO controls are present', async ({ page }) => {
    await expect(page.locator('.hd4-auto-btn')).toHaveCount(1)
    await expect(page.locator('.hd4-auto-mode')).toHaveCount(1)
    await expect(page.locator('.hd4-auto-sync')).toHaveCount(1)
    // TAP + BPM now live in the handfish tempo-bar.
    await expect(page.locator('.hd4-auto-bar tempo-bar .tempo-bar__tap')).toHaveCount(1)
    await expect(page.locator('.hd4-auto-bar tempo-bar .tempo-bar__bpm')).toHaveCount(1)

    const bpm = await page.evaluate(() => {
        const c = window.__hd4.beatClock
        c.tap(0); c.tap(400); c.tap(800) // 400ms → 150bpm
        return c.bpm
    })
    expect(Math.round(bpm)).toBe(150)
})

test('the tempo-bar tap re-tempos the switching clock', async ({ page }) => {
    // Tapping the tempo-bar's scheduler fires its `change`, which the app routes
    // to BeatClock.setBpm — so the beat grid that drives AUTO follows the
    // tempo-bar. Drive the scheduler with exact timestamps; 150 differs from the
    // 120 default, so the change event genuinely fires and proves the routing.
    const bpm = await page.evaluate(() => {
        const tb = document.querySelector('.hd4-auto-bar tempo-bar')
        tb.scheduler.tap(0); tb.scheduler.tap(400); tb.scheduler.tap(800) // 400ms → 150bpm
        return { tempo: Math.round(tb.bpm), clock: Math.round(window.__hd4.beatClock.bpm) }
    })
    expect(bpm.tempo).toBe(150)
    expect(bpm.clock).toBe(150) // routed into the switching clock
})
