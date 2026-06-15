// SPDX-License-Identifier: MIT
/**
 * Recording integration — the REC button records the program (canvas video
 * + main-bus audio) through MediaRecorder and produces a non-empty file.
 * Clicking REC is itself the user gesture that unlocks the AudioContext.
 */
import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.waitForFunction(() => window.__hd4.renderers.every((r) => r.isRunning), null, { timeout: 30_000 })
})

test('REC records the program and yields a non-empty clip', async ({ page }) => {
    expect(await page.evaluate(() => window.__hd4.recorder.isSupported)).toBe(true)

    await page.click('.hd4-rec-btn') // start (and unlock audio)
    await page.waitForFunction(() => window.__hd4.recorder.recording === true, null, { timeout: 5_000 })
    await expect(page.locator('.hd4-rec-btn')).toHaveClass(/is-active/)

    await page.waitForTimeout(1500) // gather a couple of timeslices

    // Stopping triggers a download; capture it so nothing is left dangling.
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 10_000 }).catch(() => null),
        page.click('.hd4-rec-btn'), // stop
    ])

    await page.waitForFunction(() => window.__hd4.recorder.recording === false, null, { timeout: 5_000 })
    const rec = await page.evaluate(() => window.__hd4.lastRecording)
    expect(rec).not.toBeNull()
    expect(rec.size).toBeGreaterThan(0)
    expect(rec.type).toMatch(/^video\//)
    if (download) expect(download.suggestedFilename()).toMatch(/^hd4-\d{8}-\d{6}\.(webm|mp4)$/)
})
