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
import { joinSession } from './seanceRelay.js'
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

        // The joined HD4 does not offer Connect agent…: no agent can be answered there.
        const offered = (p) => p.locator(`${picker(1)} optgroup[label="Program"] option`).allTextContents()
        expect((await offered(other)).at(-1)).toBe('Go online…')
        expect((await offered(page)).slice(-2)).toEqual(['Go online…', 'Connect agent…'])

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

const NOISE = 'search synth\nnoise(seed: 11).write(o0)\nrender(o0)'
const MAGENTA = 'search synth\nsolid(color: #ff00ff).write(o0)\nrender(o0)'

/** Hold one effect's download until release(); hit resolves when it is asked for. */
async function holdEffect(page, path) {
    let release, hitResolve
    const released = new Promise((resolve) => { release = resolve })
    const hit = new Promise((resolve) => { hitResolve = resolve })
    await page.route(`**/effects/${path}.js`, async (route) => {
        hitResolve()
        await released
        await route.continue()
    })
    const loaded = page.waitForResponse(`**/effects/${path}.js`)
    return { hit, release, loaded }
}

/** Two animation frames: every promise the page had settled by now has run its callbacks. */
const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

/** Take the page online; resolves to the session code. */
async function takeOnline(page) {
    await page.evaluate(() => window.__hd4.online.takeOnline())
    const code = new URL(page.url()).searchParams.get('seance')
    expect(code).toBeTruthy()
    return code
}

test('a newer program from the session wins over an older one still downloading its effects', async ({ page }) => {
    await open(page)
    const peer = await joinSession(server, await takeOnline(page))
    try {
        const held = await holdEffect(page, 'synth/noise')
        await peer.editDoc('channel:3', NOISE)
        await held.hit
        await peer.editDoc('channel:3', MAGENTA)
        await expect.poll(() => page.evaluate(() => window.__hd4.channels[2].source.dsl)).toBe(MAGENTA)
        held.release()
        await held.loaded
        await expect.poll(() => page.evaluate(() => window.__hd4.renderers[2].inner.loadedEffects.has('synth/noise'))).toBe(true)
        await frames(page)
        // The older program never reaches the channel, nor goes back to the session.
        expect(await page.evaluate(() => window.__hd4.channels[2].source.dsl)).toBe(MAGENTA)
        await frames(page)
        expect(peer.docText('channel:3')).toBe(MAGENTA)
    } finally {
        peer.close()
    }
})

test('a person\'s own pick made while a session program downloads stays, and is shared', async ({ page }) => {
    await open(page)
    const peer = await joinSession(server, await takeOnline(page))
    try {
        const held = await holdEffect(page, 'synth/noise')
        await peer.editDoc('channel:3', NOISE)
        await held.hit
        await page.selectOption(picker(3), 'shader:Grid')
        await expect.poll(() => page.evaluate(() => window.__hd4.renderers[2].currentDsl)).toBe(preset('Grid'))
        held.release()
        await held.loaded
        await expect.poll(() => page.evaluate(() => window.__hd4.renderers[2].inner.loadedEffects.has('synth/noise'))).toBe(true)
        await frames(page)
        expect(await page.evaluate(() => window.__hd4.channels[2].source.dsl)).toBe(preset('Grid'))
        await expect.poll(() => peer.docText('channel:3')).toBe(preset('Grid'))
    } finally {
        peer.close()
    }
})

test('a program from the session never replaces a camera, video, image or still', async ({ page }) => {
    await open(page)
    const peer = await joinSession(server, await takeOnline(page))
    try {
        // Channel 1 runs the camera and is on air; channel 2 shows the test card.
        await peer.editDoc('channel:1', MAGENTA)
        await peer.editDoc('channel:2', MAGENTA)
        await peer.editDoc('channel:3', MAGENTA)
        await expect.poll(() => page.evaluate(() => window.__hd4.renderers[2].currentDsl)).toBe(MAGENTA)
        await frames(page)
        expect(await page.evaluate(() => window.__hd4.channels.map((c) => c.source.type))).toEqual(['camera', 'image', 'shader', 'shader'])
    } finally {
        peer.close()
    }
})

test('a change that compiles while the session is being created is shared once it exists', async ({ page }) => {
    await open(page)
    // Hold the session's creation, so the person's pick lands after the seed.
    let release, hitResolve
    const released = new Promise((resolve) => { release = resolve })
    const hit = new Promise((resolve) => { hitResolve = resolve })
    await page.route(`${server.url}/v1/sessions`, async (route) => {
        hitResolve()
        await released
        await route.continue()
    })
    const online = page.evaluate(() => window.__hd4.online.takeOnline())
    await hit
    await page.selectOption(picker(3), 'shader:Grid')
    await expect.poll(() => page.evaluate(() => window.__hd4.renderers[2].currentDsl)).toBe(preset('Grid'))
    await frames(page)
    release()
    await online
    const peer = await joinSession(server, new URL(page.url()).searchParams.get('seance'))
    try {
        await expect.poll(() => peer.docText('channel:3')).toBe(preset('Grid'))
    } finally {
        peer.close()
    }
})

test('the snapshot names a session only while the tab is in one', async ({ page }) => {
    await open(page)
    const code = await takeOnline(page)
    expect((await page.evaluate(() => window.HD4Agent.getState())).result.online).toEqual({ status: 'online', session: code })
    await page.evaluate(() => window.__hd4.online.goOffline())
    expect((await page.evaluate(() => window.HD4Agent.getState())).result.online).toEqual({ status: 'offline', session: null })
})
