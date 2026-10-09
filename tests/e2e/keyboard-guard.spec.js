// SPDX-License-Identifier: MIT
/**
 * Keyboard guard — the global single-key shortcuts must stay out of the way
 * of focused composed controls (the handfish select-dropdown trigger's
 * type-ahead consumes letters) and must be suspended while any overlay panel
 * (settings drawer, channel-strip / main-bus editor, MIDI panel) is open.
 */
import { test, expect } from './fixtures.js'

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.click('.hd4-take-btn[data-channel="1"]') // unlock audio
})

/** Snapshot of the mixer state a stray global shortcut would disturb. */
const mixerState = (page) => page.evaluate(() => ({
    live: window.__hd4.switcher.live,
    type: window.__hd4.switcher.type,
    freeze: window.__hd4.output.freeze,
    faded: window.__hd4.output.faded,
    recording: window.__hd4.recorder.recording,
    settings: window.__hd4.settingsDrawer.isOpen,
}))

test('a focused select-dropdown trigger consumes s/r/f without firing global shortcuts', async ({ page }) => {
    const trigger = page.locator('.hd4-auto-mode .select-trigger')
    await trigger.focus()
    expect(await page.evaluate(() => document.activeElement?.className)).toContain('select-trigger')

    // s (Scan) must not open Settings.
    await page.keyboard.press('s')
    expect(await page.evaluate(() => window.__hd4.settingsDrawer.isOpen)).toBe(false)

    // r (Random) still type-ahead's the mode — and must not start REC.
    await page.keyboard.press('r')
    await expect.poll(() => page.evaluate(() => window.__hd4.autoMix.mode), { timeout: 5_000 }).toBe('random')
    expect(await page.evaluate(() => window.__hd4.recorder.recording)).toBe(false)

    // Fresh load for the next leg so the type-ahead buffer starts empty.
    await page.reload()
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.locator('.hd4-auto-mode .select-trigger').focus()

    // f (Follows audio) — and must not freeze the program.
    await page.keyboard.press('f')
    await expect.poll(() => page.evaluate(() => window.__hd4.autoMix.mode), { timeout: 5_000 }).toBe('follows-audio')
    expect(await page.evaluate(() => window.__hd4.output.freeze)).toBe(false)
})

const panels = [
    {
        name: 'settings drawer',
        open: '.hd4-settings-gear',
        overlay: '.hd4-settings-overlay',
        close: '.hd4-settings-close',
    },
    {
        name: 'channel-strip editor',
        open: '.hd4-strip[data-channel="1"] .hd4-edit-btn',
        overlay: '.hd4-stripedit-overlay--chan',
        close: '.hd4-stripedit-overlay--chan .hd4-stripedit-close',
    },
    {
        name: 'main-bus editor',
        open: '.hd4-main-edit-btn',
        overlay: '.hd4-stripedit-overlay--main',
        close: '.hd4-stripedit-overlay--main .hd4-stripedit-close',
    },
    {
        name: 'MIDI panel',
        open: '.hd4-midi-open',
        overlay: '.hd4-stripedit-overlay--midi',
        close: '.hd4-stripedit-overlay--midi .hd4-stripedit-close',
    },
]

for (const p of panels) {
    test(`keys pressed while the ${p.name} is open do not reach the mixer`, async ({ page }) => {
        // Live on channel 2 so a stray "1" is observable.
        await page.keyboard.press('2')
        await page.waitForFunction(() => window.__hd4.switcher.live === 2, null, { timeout: 5_000 })

        await page.click(p.open)
        await expect(page.locator(p.overlay)).toHaveAttribute('data-open', 'true')
        const before = await mixerState(page)

        for (const key of ['1', 'c', 'b', 'r', 's']) await page.keyboard.press(key)

        expect(await mixerState(page)).toEqual(before)

        // The panel itself is unaffected and still closes normally.
        await page.click(p.close)
        await expect(page.locator(p.overlay)).toHaveAttribute('data-open', 'false')
    })
}