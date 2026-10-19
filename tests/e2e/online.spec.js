// SPDX-License-Identifier: MIT
/**
 * Online collaboration: Go online… at the end of a channel picker's Program
 * group opens the Seance dialog, Take Online shares the four channel
 * programs, and a second HD4 that opens the session link takes them over.
 * Cameras, video and image files stay local. Runs against a local Seance
 * server (seanceLocal.js).
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

/** Choose Go online… in a channel's picker; the picker keeps showing the channel's source. */
async function goOnlineFrom(page, channel) {
    const before = await page.locator(picker(channel)).inputValue()
    await page.selectOption(picker(channel), 'online')
    await expect(page.locator('seance-dialog dialog')).toBeVisible()
    await expect(page.locator(picker(channel))).toHaveValue(before)
}

test('Go online… ends every picker\'s Program group, and nothing else changed on screen', async ({ page }) => {
    await open(page)
    // Connect agent… follows it when the loaded handfish has the connect-agent dialog.
    const tail = await page.evaluate(() => customElements.get('agent-connect-dialog') ? ['Go online…', 'Connect agent…'] : ['Go online…'])
    for (let n = 1; n <= 4; n++) {
        const program = await page.locator(`${picker(n)} optgroup[label="Program"] option`).allTextContents()
        expect(program.slice(-tail.length)).toEqual(tail)
        expect(program[0]).toBe('Paste program')
    }
    // No other control was added: the top bar keeps its settings + info cluster.
    await expect(page.locator('.hf-topbar-cluster .hf-icon-btn')).toHaveCount(2)
    await expect(page.locator('#hd4-agent-console')).toHaveCount(0)
})

test('Take Online shares the channel programs, and a second HD4 joins with the link', async ({ page, browser }) => {
    test.setTimeout(180_000)
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e?.message || e)))
    await open(page)
    await goOnlineFrom(page, 3)
    const dialog = page.locator('seance-dialog dialog')
    await dialog.getByRole('button', { name: 'Take Online' }).click()
    await expect(page.locator('seance-dialog')).toHaveAttribute('state', 'online')
    const code = new URL(page.url()).searchParams.get('seance')
    expect(code).toMatch(/^[A-Za-z0-9]{4,32}$/)
    await expect(dialog.locator('.hf-seance-url')).toHaveValue(new RegExp(`seance=${code}`))
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
    await goOnlineFrom(page, 1)
    await dialog.getByRole('button', { name: 'Go Offline' }).click()
    await expect(page.locator('seance-dialog')).toHaveAttribute('state', 'offline')
    expect(new URL(page.url()).searchParams.get('seance')).toBeNull()
    expect(errors).toEqual([])
})

test('a refused join leaves the dialog offline, says why in the console, and leaves the mixer as it was', async ({ page }) => {
    const warnings = []
    page.on('console', (message) => { if (message.type() === 'warning') warnings.push(message.text()) })
    await open(page)
    const before = await page.evaluate(() => window.__hd4.channels.map((c) => c.source.type))
    await goOnlineFrom(page, 2)
    const dialog = page.locator('seance-dialog dialog')
    await dialog.locator('.hf-seance-join-input').fill('ZZ99ZZ')
    await dialog.getByRole('button', { name: 'Join' }).click()
    await expect.poll(() => warnings.some((text) => text.includes('that session has expired or does not exist'))).toBe(true)
    await expect(page.locator('seance-dialog')).toHaveAttribute('state', 'offline')
    expect(await page.evaluate(() => window.__hd4.channels.map((c) => c.source.type))).toEqual(before)
})
