// SPDX-License-Identifier: MIT
/**
 * Phase 4 integration — the program-output stage: QUAD composite, FREEZE,
 * OUTPUT FADE, and VFX. Verified against the real program pixels (channel
 * 3 is solid Blue and channel 4 solid Amber, which make stable targets).
 */
import { test, expect } from '@playwright/test'

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const sum = (a) => a[0] + a[1] + a[2]

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.waitForFunction(() => window.__hd4.renderers.every((r) => r.isRunning), null, { timeout: 30_000 })
    // Distinct solids on ch3/ch4 so the color-identity assertions are
    // unambiguous. (ch1 = camera, ch2 = the bundled test card.)
    await page.selectOption('.hd4-monitor[data-channel="3"] .hd4-source-select', 'shader:Blue') // Blue
    await page.selectOption('.hd4-monitor[data-channel="4"] .hd4-source-select', 'shader:Amber') // Amber
    await page.waitForFunction(() => [0, 1, 2, 3].every((i) => window.__hd4.sampleChannelBrightness(i) > 0), null, { timeout: 30_000 })
})

test('QUAD composites all four channels into quadrants', async ({ page }) => {
    await page.click('.hd4-output-btn:has-text("QUAD")')
    expect(await page.evaluate(() => window.__hd4.output.quad)).toBe(true)

    await expect.poll(async () => {
        const [q2, ch3] = await page.evaluate(() => [window.__hd4.sampleProgramQuad(2), window.__hd4.sampleChannelAvg(2)])
        return dist(q2, ch3) // bottom-left quadrant = channel 3 (Blue)
    }, { timeout: 15_000 }).toBeLessThan(45)

    const [q3, ch4, q0, q1] = await page.evaluate(() => [
        window.__hd4.sampleProgramQuad(3), window.__hd4.sampleChannelAvg(3),
        window.__hd4.sampleProgramQuad(0), window.__hd4.sampleProgramQuad(1),
    ])
    expect(dist(q3, ch4)).toBeLessThan(45) // bottom-right = channel 4 (Amber)
    expect(sum(q0)).toBeGreaterThan(0) // top-left = channel 1 has content
    expect(sum(q1)).toBeGreaterThan(0) // top-right = channel 2 has content
})

test('FREEZE holds the program even as the live channel changes', async ({ page }) => {
    await page.evaluate(() => { window.__hd4.switcher.setType('cut'); window.__hd4.switcher.cut(3) }) // Blue live
    await expect.poll(async () => {
        const [p, ch] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(2)])
        return dist(p, ch)
    }, { timeout: 15_000 }).toBeLessThan(30)

    await page.click('.hd4-output-btn:has-text("FREEZE")')
    await page.evaluate(() => window.__hd4.switcher.cut(4)) // switch to Amber while frozen
    await page.waitForTimeout(400)

    const [prog, blue, amber] = await page.evaluate(() => [
        window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(2), window.__hd4.sampleChannelAvg(3),
    ])
    expect(dist(prog, blue)).toBeLessThan(30) // still showing the frozen Blue
    expect(dist(prog, amber)).toBeGreaterThan(60) // not the new Amber

    await page.click('.hd4-output-btn:has-text("FREEZE")') // unfreeze
    await expect.poll(async () => {
        const [p, a] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(3)])
        return dist(p, a)
    }, { timeout: 15_000 }).toBeLessThan(30) // now Amber
})

test('OUTPUT FADE fades the program to black and back', async ({ page }) => {
    await page.evaluate(() => { window.__hd4.switcher.setType('cut'); window.__hd4.switcher.cut(4) }) // Amber live

    await page.click('.hd4-output-btn:has-text("FADE")')
    expect(await page.evaluate(() => window.__hd4.output.faded)).toBe(true)
    await expect.poll(() => page.evaluate(() => window.__hd4.sampleProgramAvg().reduce((a, b) => a + b, 0)), { timeout: 15_000 }).toBeLessThan(12)

    await page.click('.hd4-output-btn:has-text("FADE")')
    await expect.poll(async () => {
        const [p, a] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(3)])
        return dist(p, a)
    }, { timeout: 15_000 }).toBeLessThan(30)
})

test('VFX Negative inverts the program', async ({ page }) => {
    await page.evaluate(() => { window.__hd4.switcher.setType('cut'); window.__hd4.switcher.cut(3) }) // Blue live
    await page.selectOption('.hd4-vfx-select', 'negative')

    await expect.poll(async () => {
        const [prog, ch] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(2)])
        const inverted = [255 - ch[0], 255 - ch[1], 255 - ch[2]]
        return dist(prog, inverted)
    }, { timeout: 15_000 }).toBeLessThan(45)

    // Back to none restores the original.
    await page.selectOption('.hd4-vfx-select', 'none')
    await expect.poll(async () => {
        const [p, ch] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(2)])
        return dist(p, ch)
    }, { timeout: 15_000 }).toBeLessThan(30)
})
