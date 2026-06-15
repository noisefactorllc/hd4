// SPDX-License-Identifier: MIT
/**
 * Composition integration — PinP, SPLIT, and KEY against the real program
 * pixels. Channels are set to solid colours (Blue / Amber / Green) so the
 * composite regions have unambiguous identities. Params are driven through
 * the CompositorState API for precision; the mode buttons are clicked to
 * verify the UI wiring.
 */
import { test, expect } from './fixtures.js'

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

test('SPLIT region A honors an in-flight transition (dissolves, not a hard cut)', async ({ page }) => {
    // Region A is the live program, so during a take it must show the
    // dissolve from→to — not jump straight to `to`. Drive a deterministic
    // mid-dissolve and a settled frame in a single evaluate (immune to the
    // rAF loop clobbering the canvas) and read region A back: a mid-dissolve
    // must differ from the settled `to`. Region B (sourceB) stays put.
    const { mid, done, b } = await page.evaluate(() => {
        const { compositor } = window.__hd4
        const out = { composition: 'split', split: { sourceB: 4, pattern: 'v-stretch' } }
        const c = compositor.canvas
        const ctx = c.getContext('2d')
        const at = (fx, fy) => {
            const d = ctx.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data
            return [d[0], d[1], d[2]]
        }
        compositor.draw({ transitioning: true, from: 3, to: 2, mix: 0.5 }, 'mix', out) // Blue→Green, mid
        const mid = at(0.25, 0.5) // region A (left half)
        const b = at(0.75, 0.5) // region B (right half) = sourceB (Amber)
        compositor.draw({ transitioning: false, from: 2, to: 2, mix: 1 }, 'mix', out) // settled on Green
        const done = at(0.25, 0.5)
        return { mid, done, b }
    })
    expect(dist(mid, done)).toBeGreaterThan(40) // region A reflected the dissolve, not the settled `to`
    const amber = await page.evaluate(() => window.__hd4.sampleChannelAvg(3))
    expect(dist(b, amber)).toBeLessThan(40) // region B is unaffected by the program take
})

test('QUAD ignores the program transition (fixed 4-up multiviewer, by design)', async ({ page }) => {
    // QUAD shows channels 1–4 in fixed cells, so a program take has no pane
    // to dissolve — the grid must look identical whether or not a take is in
    // flight. Guards the deliberate choice to leave QUAD as a multiviewer.
    const { mid, done } = await page.evaluate(() => {
        const { compositor } = window.__hd4
        const out = { composition: 'quad' }
        const c = compositor.canvas
        const ctx = c.getContext('2d')
        const cell2 = () => {
            const d = ctx.getImageData(Math.floor(c.width * 0.75), Math.floor(c.height * 0.25), 1, 1).data
            return [d[0], d[1], d[2]] // top-right cell = channel 2 (Green)
        }
        compositor.draw({ transitioning: true, from: 3, to: 4, mix: 0.5 }, 'mix', out)
        const mid = cell2()
        compositor.draw({ transitioning: false, from: 1, to: 1, mix: 1 }, 'mix', out)
        const done = cell2()
        return { mid, done }
    })
    const green = await page.evaluate(() => window.__hd4.sampleChannelAvg(1))
    expect(dist(mid, done)).toBeLessThan(12) // grid unchanged by the take
    expect(dist(mid, green)).toBeLessThan(40) // top-right cell stays channel 2 (Green)
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
