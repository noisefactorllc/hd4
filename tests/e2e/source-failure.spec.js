// SPDX-License-Identifier: MIT
/**
 * Failed source application — picking an input that cannot start (a denied
 * camera, a vanished device) must fall back to the channel's previous
 * source, re-sync the picker, and never surface an unhandled rejection.
 * getUserMedia is stubbed to reject before boot, so the denial path is
 * deterministic without touching OS permissions.
 */
import { test, expect } from './fixtures.js'

test('a denied camera falls back to the channel\'s previous source', async ({ page }) => {
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)))
    await page.addInitScript(() => {
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
            value: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
            configurable: true,
        })
    })
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })

    // ch3 boots on Color Bars; pick a camera on it.
    const select = page.locator('.hd4-monitor[data-channel="3"] .hd4-source-select')
    await select.selectOption('camera')

    // The failed take falls back: the channel keeps its previous source,
    // and the picker reflects it again.
    await expect.poll(
        () => page.evaluate(() => window.__hd4.channels[2].source.type),
        { timeout: 15_000 },
    ).toBe('shader')
    expect(await page.evaluate(() => window.__hd4.channels[2].label)).toBe('Color Bars')
    expect(await select.evaluate((el) => el.value)).toBe('shader:Color Bars')

    // The failure is reported, not thrown unhandled into the page.
    expect(pageErrors).toEqual([])
})
