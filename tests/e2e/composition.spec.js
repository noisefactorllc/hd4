// SPDX-License-Identifier: MIT
/**
 * Composition integration — PinP, SPLIT, and KEY against the real program
 * pixels. Channels are set to solid colours (Blue / Amber / Green) so the
 * composite regions have unambiguous identities. Params are driven through
 * the CompositorState API for precision; the mode buttons are clicked to
 * verify the UI wiring.
 */
import { test, expect } from '@playwright/test'

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.waitForFunction(() => window.__hd4.renderers.every((r) => r.isRunning), null, { timeout: 30_000 })
    // ch2 = Green, ch3 = Blue, ch4 = Amber (ch1 stays camera).
    await page.selectOption('.hd4-monitor[data-channel="2"] .hd4-source-select', 'shader:Green')
    await page.selectOption('.hd4-monitor[data-channel="3"] .hd4-source-select', 'shader:Blue')
    await page.selectOption('.hd4-monitor[data-channel="4"] .hd4-source-select', 'shader:Amber')
    await page.waitForFunction(() => [1, 2, 3].every((i) => window.__hd4.sampleChannelBrightness(i) > 0), null, { timeout: 30_000 })
    // Blue is the live program background.
    await page.evaluate(() => { window.__hd4.switcher.setType('cut'); window.__hd4.switcher.cut(3) })
})

test('PinP insets the selected channel over the live background', async ({ page }) => {
    // Inset = ch4 (Amber), centred, half-size over the Blue background.
    await page.evaluate(() => window.__hd4.composition.setPinp({ source: 4, size: '1/2', hPosition: 0, vPosition: 0, borderWidth: 0 }))
    await page.click('.hd4-comp-btn:has-text("PinP")')
    expect(await page.evaluate(() => window.__hd4.composition.composition)).toBe('pinp')

    await expect.poll(async () => {
        const [center, ch4] = await page.evaluate(() => [window.__hd4.sampleProgramRect(0.45, 0.45, 0.1, 0.1), window.__hd4.sampleChannelAvg(3)])
        return dist(center, ch4) // centre = the Amber inset
    }, { timeout: 15_000 }).toBeLessThan(40)

    const [corner, blue] = await page.evaluate(() => [window.__hd4.sampleProgramRect(0.02, 0.02, 0.08, 0.08), window.__hd4.sampleChannelAvg(2)])
    expect(dist(corner, blue)).toBeLessThan(40) // corner = the Blue background
})

test('SPLIT shows the live channel and the B source side by side', async ({ page }) => {
    await page.evaluate(() => window.__hd4.composition.setSplit({ sourceB: 4, pattern: 'v-stretch' }))
    await page.click('.hd4-comp-btn:has-text("SPLIT")')
    expect(await page.evaluate(() => window.__hd4.composition.composition)).toBe('split')

    await expect.poll(async () => {
        const [left, blue] = await page.evaluate(() => [window.__hd4.sampleProgramRect(0.08, 0.4, 0.1, 0.2), window.__hd4.sampleChannelAvg(2)])
        return dist(left, blue) // left half = Blue (live)
    }, { timeout: 15_000 }).toBeLessThan(40)

    const [right, amber] = await page.evaluate(() => [window.__hd4.sampleProgramRect(0.82, 0.4, 0.1, 0.2), window.__hd4.sampleChannelAvg(3)])
    expect(dist(right, amber)).toBeLessThan(40) // right half = Amber (B)
})

test('KEY removes the key colour but keeps other colours', async ({ page }) => {
    // Amber key source over the Blue background: amber is not green → opaque.
    await page.evaluate(() => window.__hd4.composition.setKey({ sourceCh: 4, type: 'chroma', chromaColor: 'green', level: 200 }))
    await page.click('.hd4-comp-btn:has-text("KEY")')
    expect(await page.evaluate(() => window.__hd4.composition.key.on)).toBe(true)

    await expect.poll(async () => {
        const [prog, amber] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(3)])
        return dist(prog, amber) // overlay (Amber) covers the frame
    }, { timeout: 15_000 }).toBeLessThan(40)

    // Switch the key source to Green → it keys out → the Blue background shows.
    await page.evaluate(() => window.__hd4.composition.setKey({ sourceCh: 2 }))
    await expect.poll(async () => {
        const [prog, blue] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(2)])
        return dist(prog, blue) // green removed → background Blue
    }, { timeout: 15_000 }).toBeLessThan(40)
})
