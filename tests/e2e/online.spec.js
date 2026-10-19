// SPDX-License-Identifier: MIT
/**
 * Online collaboration: the go-online button opens the Seance dialog, Take
 * Online shares the four channel programs, and a second HD4 that opens the
 * session link takes them over. Cameras, video and image files stay local.
 * Runs against a local Seance server (seanceLocal.js).
 */
import { test, expect } from './fixtures.js'
import { routeSeance, startSeanceServer } from './seanceLocal.js'
import { SHADER_PRESETS } from '../../js/sources/presets.js'

const preset = (name) => SHADER_PRESETS.find((p) => p.name === name).dsl
const picker = (n) => `.hd4-monitor[data-channel="${n}"] .hd4-source-select`

let server
test.beforeEach(async () => { server = await startSeanceServer() })
test.afterEach(async () => { await server?.stop() })

async function open(page, path = '/') {
    await routeSeance(page, server)
    await page.goto(path)
    await page.waitForFunction(() => window.__hd4?.ready === true && window.HD4Agent, null, { timeout: 30_000 })
    await page.evaluate(() => window.HD4Agent.ready)
}

/** Record what the readout shows from now on. */
function recordReadout(page) {
    return page.evaluate(() => {
        const led = window.__hd4.led
        const show = led.show.bind(led)
        window.__ledLog = []
        led.show = (c) => { window.__ledLog.push(`${c.label} ${c.value}`); return show(c) }
    })
}

test('Take Online shares the channel programs, and a second HD4 joins with the link', async ({ page, browser }) => {
    test.setTimeout(180_000)
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e?.message || e)))
    await open(page)
    await recordReadout(page)
    const button = page.getByRole('button', { name: 'Online collaboration' })
    await expect(button).toBeVisible()
    await button.click()
    const dialog = page.locator('seance-dialog dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Take Online' }).click()
    await expect(page.locator('seance-dialog')).toHaveAttribute('state', 'online')
    const code = new URL(page.url()).searchParams.get('seance')
    expect(code).toMatch(/^[A-Za-z0-9]{4,32}$/)
    await expect(dialog.locator('.hf-seance-url')).toHaveValue(new RegExp(`seance=${code}`))
    expect(await page.evaluate(() => window.__ledLog)).toContain('ONLINE READY')
    await page.keyboard.press('Escape')

    // A change made while online is published.
    await page.selectOption(picker(3), 'shader:Red')

    const other = await browser.newPage()
    try {
        await open(other, `/?seance=${code}`)
        await expect(other.locator('seance-dialog')).toHaveAttribute('state', 'online')
        // The session's programs replace the startup ones ...
        await expect.poll(() => other.evaluate(() => window.__hd4.channels[2].source.dsl)).toBe(preset('Red'))
        await expect(other.locator(`.hd4-monitor[data-channel="3"] .hd4-monitor-label`)).toHaveText('Red')
        // ... and empty documents (the host's camera and test card) are never applied.
        expect(await other.evaluate(() => window.__hd4.channels.map((c) => c.source.type))).toEqual(['camera', 'image', 'shader', 'shader'])

        // A change on the second HD4 reaches the first.
        await other.selectOption(picker(4), 'shader:Blue')
        await expect.poll(() => page.evaluate(() => window.__hd4.channels[3].source.dsl)).toBe(preset('Blue'))
        await expect(page.locator(picker(4))).toHaveValue('shader:Blue')

        // A channel that switches to a camera publishes empty text, which leaves the peer's program alone.
        await page.selectOption(picker(4), 'camera')
        await expect.poll(() => page.evaluate(() => window.__hd4.channels[3].source.type)).toBe('camera')
        await page.selectOption(picker(3), 'shader:Amber')
        await expect.poll(() => other.evaluate(() => window.__hd4.channels[2].source.dsl)).toBe(preset('Amber'))
        expect(await other.evaluate(() => window.__hd4.channels[3].source.dsl)).toBe(preset('Blue'))
    } finally {
        await other.close()
    }

    // Go Offline ends the session and removes it from the address.
    await button.click()
    await dialog.getByRole('button', { name: 'Go Offline' }).click()
    await expect(page.locator('seance-dialog')).toHaveAttribute('state', 'offline')
    expect(new URL(page.url()).searchParams.get('seance')).toBeNull()
    expect(await page.evaluate(() => window.__ledLog)).toContain('ONLINE OFF')
    expect(errors).toEqual([])
})

test('a refused join says why on the readout and leaves the mixer as it was', async ({ page }) => {
    await open(page)
    await recordReadout(page)
    const before = await page.evaluate(() => window.__hd4.channels.map((c) => c.source.type))
    await page.getByRole('button', { name: 'Online collaboration' }).click()
    const dialog = page.locator('seance-dialog dialog')
    await dialog.locator('.hf-seance-join-input').fill('ZZ99ZZ')
    await dialog.getByRole('button', { name: 'Join' }).click()
    await expect.poll(() => page.evaluate(() => window.__ledLog)).toContain('ONLINE EXPIRED')
    await expect(page.locator('seance-dialog')).toHaveAttribute('state', 'offline')
    expect(await page.evaluate(() => window.__hd4.channels.map((c) => c.source.type))).toEqual(before)
})
