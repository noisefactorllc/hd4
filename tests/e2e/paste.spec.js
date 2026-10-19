// SPDX-License-Identifier: MIT
/**
 * Program paste — a Noisemaker DSL program on the clipboard becomes a
 * channel's shader. Cmd/Ctrl+V loads it into the PVW channel; a picker's
 * Paste program loads it into that channel. Text that is not a program, and
 * a program that fails to compile, leave the channel on what it was showing.
 * The clipboard is the real one (Chromium, with read/write permission).
 */
import { test, expect } from './fixtures.js'

const MAGENTA = 'search synth\nsolid(color: #ff00ff).write(o0)\nrender(o0)'
const CYAN = 'search synth\nsolid(color: #00ffff).write(o0)\nrender(o0)'
const UNKNOWN_EFFECT = 'search synth\nnotAnEffect().write(o0)\nrender(o0)'

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const picker = (n) => `.hd4-monitor[data-channel="${n}"] .hd4-source-select`

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

let pageErrors
test.beforeEach(async ({ page }) => {
    pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)))
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    // Record what the readout shows.
    await page.evaluate(() => {
        const led = window.__hd4.led
        const show = led.show.bind(led)
        window.__ledLog = []
        led.show = (c) => { window.__ledLog.push(`${c.label} ${c.value}`); return show(c) }
    })
})

test.afterEach(() => {
    expect(pageErrors).toEqual([])
})

/** Put text on the clipboard, then press Cmd/Ctrl+V with nothing focused. */
async function pasteKeys(page, text) {
    await page.evaluate((t) => navigator.clipboard.writeText(t), text)
    await page.evaluate(() => document.activeElement?.blur?.())
    await page.keyboard.press('ControlOrMeta+v')
}

const lastReadout = (page) => page.evaluate(() => window.__ledLog.at(-1) || '')
const channelAvg = (page, i) => page.evaluate((i) => window.__hd4.sampleChannelAvg(i), i)

test('Cmd/Ctrl+V loads a pasted program into the PVW channel, ready to TAKE', async ({ page }) => {
    expect(await page.evaluate(() => window.__hd4.preview.preview)).toBe(2)
    expect(await page.evaluate(() => window.__hd4.switcher.live)).toBe(1)

    await pasteKeys(page, MAGENTA)

    await expect.poll(() => lastReadout(page)).toBe('PASTE CH 2')
    expect(await page.evaluate(() => window.__hd4.channels[1].source)).toEqual({ type: 'shader', dsl: MAGENTA, name: 'Custom' })
    await expect(page.locator('.hd4-monitor[data-channel="2"] .hd4-monitor-label')).toHaveText('Custom')
    expect(await page.locator(picker(2)).evaluate((el) => el.value)).toBe('custom')
    await expect.poll(async () => dist(await channelAvg(page, 1), [255, 0, 255]), { timeout: 15_000 }).toBeLessThan(20)
    // Only the PVW channel changed, and the program stayed on air.
    expect(await page.evaluate(() => window.__hd4.channels[0].source.type)).toBe('camera')
    expect(await page.evaluate(() => window.__hd4.switcher.live)).toBe(1)
    // Custom is listed only in the picker whose channel shows a pasted program.
    await expect(page.locator(`${picker(3)} option[value="custom"]`)).toHaveCount(0)

    await page.click('.hd4-trans-btn[data-type="cut"]')
    await page.click('.hd4-take-btn[data-channel="2"]')
    await expect.poll(async () => dist(await page.evaluate(() => window.__hd4.sampleProgramAvg()), [255, 0, 255]), { timeout: 15_000 }).toBeLessThan(20)
})

test('Cmd/Ctrl+V follows the PVW selection', async ({ page }) => {
    await page.click('.hd4-pvw-btn[data-channel="4"]')
    await pasteKeys(page, CYAN)
    await expect.poll(() => lastReadout(page)).toBe('PASTE CH 4')
    expect(await page.evaluate(() => window.__hd4.channels[3].source.dsl)).toBe(CYAN)
    expect(await page.evaluate(() => window.__hd4.channels[1].source.name)).toBe('Test Card')
})

test('text that is not a program leaves the PVW channel as it was', async ({ page }) => {
    await pasteKeys(page, 'hello world, this is not a program')
    await expect.poll(() => lastReadout(page)).toBe('PASTE INVALID')
    expect(await page.evaluate(() => window.__hd4.channels[1].source)).toEqual({ type: 'image', name: 'Test Card', url: 'img/testcard.png' })
    expect(await page.locator(picker(2)).evaluate((el) => el.value)).toBe('image')
})

test('an empty clipboard says so and changes nothing', async ({ page }) => {
    await pasteKeys(page, '   ')
    await expect.poll(() => lastReadout(page)).toBe('PASTE EMPTY')
    expect(await page.evaluate(() => window.__hd4.channels[1].source.name)).toBe('Test Card')
})

test('a program that fails to compile falls back to the channel\'s previous source', async ({ page }) => {
    await pasteKeys(page, MAGENTA)
    await expect.poll(() => lastReadout(page)).toBe('PASTE CH 2')
    await expect.poll(async () => dist(await channelAvg(page, 1), [255, 0, 255]), { timeout: 15_000 }).toBeLessThan(20)

    await pasteKeys(page, UNKNOWN_EFFECT)
    await expect.poll(() => lastReadout(page)).toBe('PASTE INVALID')
    expect(await page.evaluate(() => window.__hd4.channels[1].source.dsl)).toBe(MAGENTA)
    expect(await page.locator(picker(2)).evaluate((el) => el.value)).toBe('custom')
    await expect.poll(async () => dist(await channelAvg(page, 1), [255, 0, 255]), { timeout: 15_000 }).toBeLessThan(20)
})

test('Paste program in a picker loads the clipboard into that channel', async ({ page }) => {
    await page.evaluate((t) => navigator.clipboard.writeText(t), CYAN)
    await page.selectOption(picker(3), 'paste')

    await expect.poll(() => lastReadout(page)).toBe('PASTE CH 3')
    expect(await page.evaluate(() => window.__hd4.channels[2].source)).toEqual({ type: 'shader', dsl: CYAN, name: 'Custom' })
    expect(await page.locator(picker(3)).evaluate((el) => el.value)).toBe('custom')
    await expect.poll(async () => dist(await channelAvg(page, 2), [0, 255, 255]), { timeout: 15_000 }).toBeLessThan(20)

    // Picking a library entry drops Custom from that picker again.
    await page.selectOption(picker(3), 'shader:Grid')
    await page.waitForFunction(() => window.__hd4.channels[2].label === 'Grid', null, { timeout: 15_000 })
    await expect(page.locator(`${picker(3)} option[value="custom"]`)).toHaveCount(0)
})

test('Paste program with text that is not a program re-syncs the picker', async ({ page }) => {
    await page.evaluate(() => navigator.clipboard.writeText('not a program'))
    await page.selectOption(picker(3), 'paste')
    await expect.poll(() => lastReadout(page)).toBe('PASTE INVALID')
    expect(await page.evaluate(() => window.__hd4.channels[2].label)).toBe('Color Bars')
    expect(await page.locator(picker(3)).evaluate((el) => el.value)).toBe('shader:Color Bars')
})

test('a paste into a text field is left to the field, and an open overlay suspends paste', async ({ page }) => {
    await page.evaluate((t) => navigator.clipboard.writeText(t), MAGENTA)
    await page.evaluate(() => {
        const ta = document.createElement('textarea')
        ta.id = 'paste-target'
        document.body.appendChild(ta)
    })
    await page.focus('#paste-target')
    await page.keyboard.press('ControlOrMeta+v')
    await expect(page.locator('#paste-target')).toHaveValue(MAGENTA)
    await page.evaluate(() => document.getElementById('paste-target').remove())

    await page.click('.hd4-settings-gear')
    expect(await page.evaluate(() => window.__hd4.settingsDrawer.isOpen)).toBe(true)
    await page.keyboard.press('ControlOrMeta+v')

    // Neither paste reached a channel or the readout.
    await page.evaluate(() => new Promise((r) => setTimeout(r, 300)))
    expect(await page.evaluate(() => window.__ledLog.filter((l) => l.startsWith('PASTE')))).toEqual([])
    expect(await page.evaluate(() => window.__hd4.channels[1].source.name)).toBe('Test Card')
})

test('a pasted program is saved with a memory slot and recalled', async ({ page }) => {
    await pasteKeys(page, MAGENTA)
    await expect.poll(() => lastReadout(page)).toBe('PASTE CH 2')

    await page.click('.hd4-mem-save')
    await page.click('.hd4-mem-slot[data-slot="1"]')
    await expect(page.locator('.hd4-mem-slot[data-slot="1"]')).toHaveClass(/is-occupied/)

    await page.selectOption(picker(2), 'shader:Grid')
    await page.waitForFunction(() => window.__hd4.channels[1].label === 'Grid', null, { timeout: 15_000 })

    await page.click('.hd4-mem-slot[data-slot="1"]')
    await page.waitForFunction((dsl) => window.__hd4.channels[1].source.dsl === dsl, MAGENTA, { timeout: 15_000 })
    expect(await page.evaluate(() => window.__hd4.channels[1].label)).toBe('Custom')
    expect(await page.locator(picker(2)).evaluate((el) => el.value)).toBe('custom')
    await expect.poll(async () => dist(await channelAvg(page, 1), [255, 0, 255]), { timeout: 15_000 }).toBeLessThan(20)
})
