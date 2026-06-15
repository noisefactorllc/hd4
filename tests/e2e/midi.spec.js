// SPDX-License-Identifier: MIT
/**
 * MIDI integration — learn + map. Headless Chromium has no MIDI device, so
 * messages are injected through window.__hd4.midi.simulate (the same path a
 * real device's midimessage takes). Verifies learn binds the next control
 * and that a bound action fires and a bound fader moves.
 */
import { test, expect } from './fixtures.js'

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.click('.hd4-midi-open')
})

test('learn binds the next control to an action, which then fires', async ({ page }) => {
    await page.click('.hd4-midi-learn[data-target="freeze"]')
    expect(await page.evaluate(() => window.__hd4.midi.map.learning)).toBe(true)

    // First message after arming learns the binding (does not fire).
    await page.evaluate(() => window.__hd4.midi.simulate([0xB0, 21, 127]))
    expect(await page.evaluate(() => window.__hd4.midi.map.get('cc:21')?.id)).toBe('freeze')
    expect(await page.evaluate(() => window.__hd4.output.freeze)).toBe(false)
    await expect(page.locator('.hd4-midi-row', { hasText: 'FREEZE' }).locator('.hd4-midi-sig')).toHaveText('cc:21')

    // Subsequent press fires the action.
    await page.evaluate(() => window.__hd4.midi.simulate([0xB0, 21, 127]))
    expect(await page.evaluate(() => window.__hd4.output.freeze)).toBe(true)
})

test('a learned fader moves the main level', async ({ page }) => {
    await page.click('.hd4-midi-learn[data-target="fader:main"]')
    await page.evaluate(() => window.__hd4.midi.simulate([0xB0, 7, 0])) // learns cc:7 → main fader
    expect(await page.evaluate(() => window.__hd4.midi.map.get('cc:7')?.id)).toBe('fader:main')

    await page.evaluate(() => window.__hd4.midi.simulate([0xB0, 7, 127])) // full
    expect(await page.evaluate(() => window.__hd4.audio.mainFader())).toBeCloseTo(1, 2)
    await page.evaluate(() => window.__hd4.midi.simulate([0xB0, 7, 0])) // min
    expect(await page.evaluate(() => window.__hd4.audio.mainFader())).toBeCloseTo(0, 2)
})
