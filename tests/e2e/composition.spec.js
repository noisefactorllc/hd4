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
const SOLIDS = {
    green: [0x46, 0xa7, 0x58],
    blue: [0x4a, 0x88, 0xfb],
    amber: [0xf5, 0xa6, 0x23],
}

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.waitForFunction(() => window.__hd4.renderers.every((r) => r.isRunning), null, { timeout: 30_000 })
    // ch2 = Green, ch3 = Blue, ch4 = Amber (ch1 stays camera).
    await page.selectOption('.hd4-monitor[data-channel="2"] .hd4-source-select', 'shader:Green')
    await page.selectOption('.hd4-monitor[data-channel="3"] .hd4-source-select', 'shader:Blue')
    await page.selectOption('.hd4-monitor[data-channel="4"] .hd4-source-select', 'shader:Amber')
    await page.waitForFunction((targets) => {
        const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
        return [
            [1, targets.green],
            [2, targets.blue],
            [3, targets.amber],
        ].every(([i, target]) => d(window.__hd4.sampleChannelAvg(i), target) < 45)
    }, SOLIDS, { timeout: 30_000 })
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

    // Poll (not one-shot): the left-half check can pass while the canvas still
    // shows the previous composition — left is Blue under PinP too — so only
    // the right half proves the split redraw actually landed.
    await expect.poll(async () => {
        const [right, amber] = await page.evaluate(() => [window.__hd4.sampleProgramRect(0.82, 0.4, 0.1, 0.2), window.__hd4.sampleChannelAvg(3)])
        return dist(right, amber) // right half = Amber (B)
    }, { timeout: 15_000 }).toBeLessThan(40)
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

const KEY_REGIONS = {
    blue: [0.8, 0.45, 0.025, 0.025],
    green: [0.425, 0.45, 0.025, 0.025],
    white: [0.05, 0.45, 0.025, 0.025],
    black: [0.925, 0.45, 0.025, 0.025],
}

async function keyRegion(page, name) {
    return page.evaluate((rect) => window.__hd4.sampleProgramRect(...rect), KEY_REGIONS[name])
}

async function setupKeyPattern(page) {
    const chooser = page.waitForEvent('filechooser')
    await page.getByLabel('Channel 1 source', { exact: true }).selectOption('image')
    await (await chooser).setFiles('img/testcard.png')
    await page.getByLabel('Channel 3 source', { exact: true }).selectOption('shader:Color Bars')
    await page.getByLabel('Take channel 1 to program', { exact: true }).click()
    await page.waitForFunction(() => window.__hd4.channels[0].source.type === 'image')
    await expect.poll(async () => {
        const [program, source] = await page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(0)])
        return dist(program, source)
    }).toBeLessThan(10)
    const background = {}
    for (const name of Object.keys(KEY_REGIONS)) background[name] = await keyRegion(page, name)

    // Verify the actual pattern against literal SMPTE colours before keying.
    await page.getByLabel('Take channel 3 to program', { exact: true }).click()
    for (const [name, rgb] of Object.entries({ blue: [0, 0, 255], green: [0, 255, 0], white: [255, 255, 255], black: [0, 0, 0] })) {
        await expect.poll(async () => dist(await keyRegion(page, name), rgb)).toBeLessThan(12)
        expect(dist(background[name], rgb)).toBeGreaterThan(80)
    }
    await page.getByLabel('Take channel 1 to program', { exact: true }).click()
    await page.click('.hd4-comp-btn:has-text("KEY")')
    await page.getByLabel('KEY source channel', { exact: true }).selectOption('3')
    return background
}

test('KEY restores Blue after a Chroma → Luma → Chroma round trip', async ({ page }) => {
    const background = await setupKeyPattern(page)
    const colour = page.getByLabel('KEY colour', { exact: true })
    const type = page.getByLabel('KEY type', { exact: true })
    await colour.selectOption('blue')
    await type.selectOption('luma')
    await type.selectOption('chroma')
    expect(await page.evaluate(() => window.__hd4.composition.key.chromaColor)).toBe('blue')
    await expect(colour).toHaveValue('blue')
    await expect.poll(async () => dist(await keyRegion(page, 'blue'), background.blue)).toBeLessThan(12)
    await expect.poll(async () => dist(await keyRegion(page, 'green'), [0, 255, 0])).toBeLessThan(12)

    await colour.selectOption('green')
    expect(await page.evaluate(() => window.__hd4.composition.key.chromaColor)).toBe('green')
    await expect.poll(async () => dist(await keyRegion(page, 'green'), background.green)).toBeLessThan(12)
    await expect.poll(async () => dist(await keyRegion(page, 'blue'), [0, 0, 255])).toBeLessThan(12)
})

test('KEY restores Black after a Luma → Chroma → Luma round trip', async ({ page }) => {
    const background = await setupKeyPattern(page)
    const colour = page.getByLabel('KEY colour', { exact: true })
    const type = page.getByLabel('KEY type', { exact: true })
    await type.selectOption('luma')
    await colour.selectOption('black')
    await type.selectOption('chroma')
    await type.selectOption('luma')
    expect(await page.evaluate(() => window.__hd4.composition.key.lumaColor)).toBe('black')
    await expect(colour).toHaveValue('black')
    await expect.poll(async () => dist(await keyRegion(page, 'black'), background.black)).toBeLessThan(12)
    await expect.poll(async () => dist(await keyRegion(page, 'white'), [255, 255, 255])).toBeLessThan(12)

    await colour.selectOption('white')
    expect(await page.evaluate(() => window.__hd4.composition.key.lumaColor)).toBe('white')
    await expect.poll(async () => dist(await keyRegion(page, 'white'), background.white)).toBeLessThan(12)
    await expect.poll(async () => dist(await keyRegion(page, 'black'), [0, 0, 0])).toBeLessThan(12)
})
