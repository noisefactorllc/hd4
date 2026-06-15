// SPDX-License-Identifier: MIT
/**
 * AUX bus monitor/record integration. The AUX bus is a separate mix fed by
 * each channel's post-fader AUX send. The AUX module in the mixer lets the
 * operator audition it (MON → route to the speakers) and record it
 * (REC source PGM ↔ AUX). Here we verify the bus carries signal to its meter,
 * the record source switches and still produces a clip, and the monitor
 * routing flips.
 */
import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.click('.hd4-take-btn[data-channel="1"]') // unlock the AudioContext
})

test('a channel AUX send feeds the AUX bus meter', async ({ page }) => {
    // Give channel 1 real audio (camera follow), confirm it meters.
    await page.selectOption('.hd4-monitor[data-channel="1"] .hd4-source-select', 'camera')
    await page.waitForFunction(() => window.__hd4.channels[0].source.type === 'camera', null, { timeout: 15_000 })
    await expect.poll(() => page.evaluate(() => window.__hd4.audio.getMeter(0)), { timeout: 20_000 }).toBeGreaterThan(0)

    // Open the AUX send and the AUX bus should carry signal.
    await page.evaluate(() => window.__hd4.audio.setStripParam(0, 'auxSend', 10))
    await expect.poll(() => page.evaluate(() => window.__hd4.audio.getAuxLevel()), { timeout: 10_000 }).toBeGreaterThan(0)
})

test('the REC-source toggle selects AUX and still records a clip', async ({ page }) => {
    expect(await page.evaluate(() => window.__hd4.recordSource)).toBe('program')

    await page.click('.hd4-aux-recsrc') // PGM → AUX
    expect(await page.evaluate(() => window.__hd4.recordSource)).toBe('aux')
    await expect(page.locator('.hd4-aux-recsrc')).toHaveClass(/is-active/)

    await page.click('.hd4-rec-btn')
    await page.waitForFunction(() => window.__hd4.recorder.recording === true, null, { timeout: 5_000 })
    await page.waitForTimeout(1200)
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 10_000 }).catch(() => null),
        page.click('.hd4-rec-btn'),
    ])
    await page.waitForFunction(() => window.__hd4.recorder.recording === false, null, { timeout: 5_000 })

    const rec = await page.evaluate(() => window.__hd4.lastRecording)
    expect(rec).not.toBeNull()
    expect(rec.size).toBeGreaterThan(0)
    if (download) expect(download.suggestedFilename()).toMatch(/^hd4-\d{8}-\d{6}\.(webm|mp4)$/)
})

test('the MON toggle auditions the AUX bus on the monitor output', async ({ page }) => {
    expect(await page.evaluate(() => window.__hd4.audio.monitorSource())).toBe('main')

    await page.click('.hd4-aux-mon')
    expect(await page.evaluate(() => window.__hd4.audio.monitorSource())).toBe('aux')
    await expect(page.locator('.hd4-aux-mon')).toHaveClass(/is-active/)

    await page.click('.hd4-aux-mon')
    expect(await page.evaluate(() => window.__hd4.audio.monitorSource())).toBe('main')
    await expect(page.locator('.hd4-aux-mon')).not.toHaveClass(/is-active/)
})
