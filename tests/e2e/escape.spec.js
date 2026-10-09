// SPDX-License-Identifier: MIT
/**
 * Escape-to-dismiss — every overlay panel (settings drawer, channel-strip /
 * main-bus editor, MIDI panel) closes on one Escape keypress via the handfish
 * escape stack: topmost-first when several are stacked, and a stray Escape
 * with nothing open never disturbs the mixer.
 */
import { test, expect } from './fixtures.js'

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.click('.hd4-take-btn[data-channel="1"]') // unlock audio
})

const isOpen = (page, sel) => page.evaluate((s) => document.querySelector(s).dataset.open, sel)
const mixerState = (page) => page.evaluate(() => ({
    live: window.__hd4.switcher.live,
    freeze: window.__hd4.output.freeze,
    faded: window.__hd4.output.faded,
}))

test('Escape closes the settings drawer opened with the s shortcut', async ({ page }) => {
    await page.keyboard.press('s')
    await expect(page.locator('.hd4-settings-overlay')).toHaveAttribute('data-open', 'true')

    await page.keyboard.press('Escape')
    await expect(page.locator('.hd4-settings-overlay')).toHaveAttribute('data-open', 'false')
})

test('Escape closes each audio/MIDI overlay, and a stray Escape changes nothing', async ({ page }) => {
    const panels = [
        { name: 'channel-strip editor', open: '.hd4-strip[data-channel="1"] .hd4-edit-btn', overlay: '.hd4-stripedit-overlay--chan' },
        { name: 'main-bus editor', open: '.hd4-main-edit-btn', overlay: '.hd4-stripedit-overlay--main' },
        { name: 'MIDI panel', open: '.hd4-midi-open', overlay: '.hd4-stripedit-overlay--midi' },
    ]

    // Live on channel 2 so a stray shortcut would be observable.
    await page.keyboard.press('2')
    await page.waitForFunction(() => window.__hd4.switcher.live === 2, null, { timeout: 5_000 })

    for (const p of panels) {
        await page.click(p.open)
        await expect(page.locator(p.overlay)).toHaveAttribute('data-open', 'true')

        await page.keyboard.press('Escape')
        await expect(page.locator(p.overlay)).toHaveAttribute('data-open', 'false')

        // A second Escape with no overlay open must not disturb the mixer.
        const before = await mixerState(page)
        await page.keyboard.press('Escape')
        expect(await mixerState(page)).toEqual(before)
    }
})

test('Escape closes stacked overlays topmost-first, one per press', async ({ page }) => {
    await page.click('.hd4-strip[data-channel="1"] .hd4-edit-btn')
    await expect(page.locator('.hd4-stripedit-overlay--chan')).toHaveAttribute('data-open', 'true')

    // Stack the settings drawer on top of the open strip editor. Both
    // overlays are full-viewport scrims, so the gear is not pointer-reachable
    // underneath — the click handler is driven directly to reach the stack.
    await page.evaluate(() => document.querySelector('.hd4-settings-gear').click())
    await expect(page.locator('.hd4-settings-overlay')).toHaveAttribute('data-open', 'true')

    await page.keyboard.press('Escape') // closes the drawer (topmost)
    await expect(page.locator('.hd4-settings-overlay')).toHaveAttribute('data-open', 'false')
    await expect(page.locator('.hd4-stripedit-overlay--chan')).toHaveAttribute('data-open', 'true')

    await page.keyboard.press('Escape') // closes the strip editor
    await expect(page.locator('.hd4-stripedit-overlay--chan')).toHaveAttribute('data-open', 'false')
})
