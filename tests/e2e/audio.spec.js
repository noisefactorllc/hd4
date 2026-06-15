// SPDX-License-Identifier: MIT
/**
 * Phase 5 integration — the WebAudio mixer. A channel switched to a camera
 * routes its mic (the fake audio device) into the channel strip; the
 * post-fader meter reflects it, MUTE silences it, and SOLO isolates it.
 *
 * The leading take-button click establishes the user gesture that lets the
 * AudioContext resume.
 */
import { test, expect } from './fixtures.js'

const meter = (page, i) => page.evaluate((idx) => window.__hd4.audio.getMeter(idx), i)

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.click('.hd4-take-btn[data-channel="1"]') // user gesture to unlock audio
})

async function setCamera(page, channel) {
    await page.selectOption(`.hd4-monitor[data-channel="${channel}"] .hd4-source-select`, 'camera')
    await page.waitForFunction((c) => window.__hd4.channels[c - 1].source.type === 'camera', channel, { timeout: 15_000 })
}

test('camera audio drives the channel meter', async ({ page }) => {
    await setCamera(page, 1)
    await expect.poll(() => meter(page, 0), { timeout: 20_000 }).toBeGreaterThan(0)
})

test('MUTE silences the channel meter', async ({ page }) => {
    await setCamera(page, 1)
    await expect.poll(() => meter(page, 0), { timeout: 20_000 }).toBeGreaterThan(0)

    await page.click('.hd4-strip[data-channel="1"] .hd4-mute-btn')
    expect(await page.evaluate(() => window.__hd4.audio.isMuted(0))).toBe(true)
    await expect(page.locator('.hd4-strip[data-channel="1"] .hd4-mute-btn')).toHaveClass(/is-active/)
    await expect.poll(() => meter(page, 0), { timeout: 10_000 }).toBeLessThan(0.001)
})

test('SOLO isolates: non-soloed channels go silent', async ({ page }) => {
    await setCamera(page, 1)
    await setCamera(page, 2)
    await expect.poll(
        async () => Math.min(await meter(page, 0), await meter(page, 1)),
        { timeout: 25_000 },
    ).toBeGreaterThan(0)

    await page.click('.hd4-strip[data-channel="2"] .hd4-solo-btn')
    expect(await page.evaluate(() => window.__hd4.audio.isSoloed(1))).toBe(true)

    await expect.poll(() => meter(page, 0), { timeout: 10_000 }).toBeLessThan(0.001) // ch1 not soloed → silent
    await expect.poll(() => meter(page, 1), { timeout: 10_000 }).toBeGreaterThan(0) // ch2 soloed → audible
})

test('a channel audio source can be set to None, independent of its video', async ({ page }) => {
    await setCamera(page, 1)
    await expect.poll(() => meter(page, 0), { timeout: 20_000 }).toBeGreaterThan(0)

    await page.selectOption('.hd4-strip[data-channel="1"] .hd4-strip-audio', 'none')
    expect(await page.evaluate(() => window.__hd4.audio.channelAudioMode(0))).toBe('none')
    await expect.poll(() => meter(page, 0), { timeout: 10_000 }).toBeLessThan(0.001)

    await page.selectOption('.hd4-strip[data-channel="1"] .hd4-strip-audio', 'follow')
    expect(await page.evaluate(() => window.__hd4.audio.channelAudioMode(0))).toBe('follow')
    await expect.poll(() => meter(page, 0), { timeout: 15_000 }).toBeGreaterThan(0)
})

test('a channel can take an independent audio input device (audio != video)', async ({ page }) => {
    // ch2's video is the bundled test card (no audio of its own).
    const sel = '.hd4-strip[data-channel="2"] .hd4-strip-audio'
    await expect.poll(() => page.evaluate((s) => {
        const el = document.querySelector(s)
        return [...el.options].filter((o) => o.value.startsWith('device:')).length
    }, sel), { timeout: 20_000 }).toBeGreaterThan(0)

    const dev = await page.evaluate((s) => {
        const el = document.querySelector(s)
        return [...el.options].find((o) => o.value.startsWith('device:'))?.value
    }, sel)
    await page.selectOption(sel, dev)
    expect(await page.evaluate(() => window.__hd4.audio.channelAudioMode(1))).toBe('device')
    await expect.poll(() => meter(page, 1), { timeout: 20_000 }).toBeGreaterThan(0)
})
