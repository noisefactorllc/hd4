// SPDX-License-Identifier: MIT
/**
 * The Seance route of the agent contract: HD4 goes online, and an agent that
 * joins the session runs commands in the tab through the relay, sees the
 * channel documents change, and gets images as uploaded bytes, never as text.
 * Runs against a local Seance server (seanceLocal.js).
 */
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { test, expect } from './fixtures.js'
import { PAGE_ORIGIN, routeHandfishDist, routeSeance, startSeanceServer } from './seanceLocal.js'
import { joinSession } from './seanceRelay.js'

const MAGENTA = 'search synth\nsolid(color: #ff00ff).write(o0)\nrender(o0)'
const GRID = 'search synth\ntestPattern(pattern: gridLines).write(o0)\nrender(o0)'

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** A 2x2 PNG of one colour. */
function png(red, green, blue) {
    const chunk = (type, data) => {
        const body = Buffer.concat([Buffer.from(type), data])
        let crc = 0xffffffff
        for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
        const length = Buffer.alloc(4)
        const checksum = Buffer.alloc(4)
        length.writeUInt32BE(data.length)
        checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
        return Buffer.concat([length, body, checksum])
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(2, 0)
    header.writeUInt32BE(2, 4)
    header[8] = 8
    header[9] = 6
    const row = [0, red, green, blue, 255, red, green, blue, 255]
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.from([...row, ...row]))),
        chunk('IEND', Buffer.alloc(0)),
    ])
}

/** The centre pixel of a channel's canvas (a 2x2 image renders at its own size there). */
function channelCenter(page, channel) {
    return page.evaluate((index) => {
        const canvas = window.__hd4.channels[index].canvas
        const sample = document.createElement('canvas')
        sample.width = sample.height = 1
        const ctx = sample.getContext('2d')
        ctx.drawImage(canvas, canvas.width / 2, canvas.height / 2, 1, 1, 0, 0, 1, 1)
        return Array.from(ctx.getImageData(0, 0, 1, 1).data)
    }, channel - 1)
}

let server
test.beforeEach(async () => { server = await startSeanceServer() })
test.afterEach(async () => { await server?.stop() })

async function openOnline(page) {
    await routeSeance(page, server)
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true && window.HD4Agent, null, { timeout: 30_000 })
    await page.evaluate(() => window.HD4Agent.ready)
    await page.evaluate(() => window.__hd4.online.takeOnline())
    const code = new URL(page.url()).searchParams.get('seance')
    expect(code).toBeTruthy()
    return code
}

test('an agent in the session drives the owner\'s tab and sees its monitors as image files', async ({ page, browser }) => {
    test.setTimeout(180_000)
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e?.message || e)))
    const sent = []
    page.on('websocket', (socket) => socket.on('framesent', (frame) => sent.push(String(frame.payload))))
    const uploads = []
    page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/images')) {
            uploads.push({ type: request.headers()['content-type'], body: request.postDataBuffer() })
        }
    })
    // The page under test takes the channels online, so its tab is the owner's.
    const code = await openOnline(page)
    // A second person opens the session link in HD4. Their tab is no owner's.
    const visitor = await browser.newPage()
    const visitorSent = []
    visitor.on('websocket', (socket) => socket.on('framesent', (frame) => visitorSent.push(String(frame.payload))))
    await routeSeance(visitor, server)
    await visitor.goto(`/?seance=${code}`)
    await visitor.waitForFunction(() => window.__hd4?.ready === true && window.HD4Agent, null, { timeout: 30_000 })
    await visitor.evaluate(() => window.HD4Agent.ready)
    await expect.poll(() => visitor.evaluate(() => window.__hd4.online.getStatus())).toBe('online')
    const agent = await joinSession(server, code)
    try {
        // The session holds one document per channel: programs, and empty
        // text for the camera and the test card image.
        expect([...agent.docs.keys()].sort()).toEqual(['channel:1', 'channel:2', 'channel:3', 'channel:4'])
        expect(agent.docText('channel:1')).toBe('')
        expect(agent.docText('channel:2')).toBe('')
        expect(agent.docText('channel:3')).toContain('colorBars')

        // describe: only the owner's tab answers, and names itself and its commands.
        const described = await agent.describe()
        expect(described).toMatchObject({ app: 'hd4', envelope: { ok: true, result: { app: 'hd4', apiVersion: '1.0' } } })
        const commands = Object.fromEntries(described.envelope.result.commands.map((command) => [command.name, command]))
        expect(commands.setProgram.args.required).toEqual(['dsl'])
        expect(commands.getThumbnail.args.properties.source.enum).toEqual(['program', 'preview', 1, 2, 3, 4])
        expect(commands.setRecording.remote).toBe(false)
        expect(commands.saveMemory.remote).toBe(false)
        expect(commands.take.remote).toBe(true)

        // A read command.
        const state = await agent.call('getState')
        expect(state.envelope.ok).toBe(true)
        expect(state.envelope.result.online).toEqual({ status: 'online', session: code })

        // A program change shows in the owner's page and in the channel's
        // document, and the visitor's HD4 takes it from the document.
        const set = await agent.call('setProgram', { dsl: MAGENTA, channel: 3 })
        expect(set.envelope).toMatchObject({ ok: true, result: { applied: true, channel: 3 } })
        expect(await page.evaluate(() => window.__hd4.channels[2].source.dsl)).toBe(MAGENTA)
        await expect.poll(() => agent.docText('channel:3')).toBe(MAGENTA)
        await expect.poll(async () => dist(await page.evaluate(() => window.__hd4.sampleChannelAvg(2)), [255, 0, 255])).toBeLessThan(40)
        await expect.poll(() => visitor.evaluate(() => window.__hd4.channels[2].source.dsl)).toBe(MAGENTA)

        // Through the session a program reads as the session holds it.
        const read = await agent.call('getProgram', { channel: 3 })
        expect(read.envelope.result).toEqual({ channel: 3, source: 'shader', dsl: agent.docText('channel:3'), running: true })
        expect(read.envelope.state.channels[0]).toMatchObject({ channel: 1, source: 'camera', name: 'Camera', chars: 0 })

        // An image never crosses the session as text.
        const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
        const asText = await agent.call('setProgram', { dsl: `search synth\nmedia(url: "${pixel}").write(o0)\nrender(o0)`, channel: 3 })
        expect(asText.envelope.error.code).toBe('IMAGE_AS_TEXT')
        // Nor may a session program make the person's browser fetch an outside link.
        const linked = await agent.call('setProgram', { dsl: 'search synth\nmedia(url: "https://example.com/a.png").write(o0)\nrender(o0)', channel: 3 })
        expect(linked.envelope.error.code).toBe('OUTSIDE_LINK')

        // A program that does not compile is refused and changes nothing.
        const refused = await agent.call('setProgram', { dsl: 'search synth\nsolid(colour: #ff0000).write(o0)\nrender(o0)', channel: 3 })
        expect(refused.envelope.error.code).toBe('INVALID_PROGRAM')
        expect(await page.evaluate(() => window.__hd4.channels[2].source.dsl)).toBe(MAGENTA)

        // A switch through the session.
        const taken = await agent.call('take', { channel: 3, transition: 'cut' })
        expect(taken.envelope.result).toEqual({ live: 3, preview: 2, transitioning: false })

        // While the camera feeds channel 1 no image leaves the tab, not even of another channel.
        const hidden = await agent.call('getThumbnail', { maxDimension: 48, format: 'png', source: 3 })
        expect(hidden.envelope.error).toMatchObject({ code: 'REMOTE_UNAVAILABLE', details: { reason: 'channel 1 shows a camera' } })
        expect(uploads).toEqual([])
        // The person replaces the camera; the built-in test card on channel 2 may be seen.
        await page.selectOption('.hd4-monitor[data-channel="1"] .hd4-source-select', 'shader:Black')
        await expect.poll(() => page.evaluate(() => window.__hd4.channels[0].source.type)).toBe('shader')

        // getThumbnail: the image is uploaded as its own bytes and named by its SHA-256.
        const look = await agent.call('getThumbnail', { maxDimension: 48, format: 'png', source: 3 })
        expect(look.envelope.ok).toBe(true)
        const result = look.envelope.result
        expect(result).toMatchObject({ mimeType: 'image/png', width: 48, height: 27, source: 3, channel: 3 })
        expect(result.bytes).toBeUndefined()
        const image = await agent.downloadImage(result.image.id)
        expect(image.bytes.subarray(1, 4).toString()).toBe('PNG')
        expect(digest(image.bytes)).toBe(result.image.id)
        expect(result.image).toMatchObject({ mimeType: 'image/png', bytes: image.bytes.length })
        expect(uploads.some((upload) => upload.type === 'image/png' && upload.body.equals(image.bytes))).toBe(true)
        // Images are images: no WebSocket frame from the tab carried image text.
        expect(sent.filter((frame) => frame.includes(image.bytes.toString('base64')) || /data:image|[A-Za-z0-9+/]{200,}/.test(frame))).toEqual([])

        // FREEZE can hold a frame of a camera, so it hides images too.
        await page.evaluate(() => window.HD4Agent.setOutput({ freeze: true }))
        const frozen = await agent.call('getThumbnail', { maxDimension: 16 })
        expect(frozen.envelope.error).toMatchObject({ code: 'REMOTE_UNAVAILABLE', details: { reason: 'FREEZE holds a frame' } })
        await page.evaluate(() => window.HD4Agent.setOutput({ freeze: false }))

        // What needs the person at the browser, or what their browser keeps,
        // is refused through the session.
        for (const [command, args] of [['setRecording', { recording: true }], ['saveMemory', { slot: 1 }], ['getSettings', {}], ['listDevices', {}]]) {
            const answer = await agent.call(command, args)
            expect(answer.envelope.error.code, command).toBe('REMOTE_UNAVAILABLE')
        }
        expect(await page.evaluate(() => [window.__hd4.recorder.recording, window.__hd4.memory.list()])).toEqual([false, []])
        const unknown = await agent.call('noSuchCommand')
        expect(unknown.envelope.error.code).toBe('NOT_FOUND_COMMAND')

        // The person's own change reaches the agent through the documents.
        await page.selectOption('.hd4-monitor[data-channel="4"] .hd4-source-select', 'shader:Grid')
        await expect.poll(() => agent.docText('channel:4')).toBe(GRID)

        // The visitor's tab, which is no owner's, sent no relay frame at all.
        expect(visitorSent.filter((frame) => frame.includes('nf-agent/1'))).toEqual([])
        // Every answer the agent took came from the owner's connection.
        const answers = agent.received.filter((frame) => frame.relay === 'nf-agent/1' && frame.kind !== 'request')
        expect(answers.length).toBeGreaterThan(0)
        expect(answers.every((frame) => frame.user_id === agent.ownerId)).toBe(true)
        expect(errors).toEqual([])
    } finally {
        agent.close()
        await visitor.close()
    }
})

test('a program and its image move into a channel through the session', async ({ page }) => {
    test.setTimeout(180_000)
    const code = await openOnline(page)
    const agent = await joinSession(server, code)
    try {
        const red = png(255, 0, 0)
        const stored = await agent.uploadImage(red, 'image/png')
        expect(stored.id).toBe(digest(red))
        const dsl = `search synth\nmedia(url: "image:${stored.id}").write(o0)\nrender(o0)`
        await agent.describe()
        const set = await agent.call('setProgram', { dsl, channel: 4 })
        expect(set.envelope.ok, JSON.stringify(set.envelope.error)).toBe(true)
        expect(set.envelope.warnings).toBeUndefined()
        await expect.poll(() => channelCenter(page, 4)).toEqual([255, 0, 0, 255])
        await expect.poll(() => agent.docText('channel:4')).toBe(dsl)
        // The agent reads the program back as the transfer command does.
        const read = await agent.call('getProgram', { channel: 4 })
        expect(read.envelope.result).toEqual({ channel: 4, source: 'shader', dsl, running: true })
    } finally {
        agent.close()
    }
})

test('the tab takes at most 16 images in ten minutes', async ({ page }) => {
    test.setTimeout(180_000)
    const code = await openOnline(page)
    // No camera, so the tab may send images of the mix.
    await page.selectOption('.hd4-monitor[data-channel="1"] .hd4-source-select', 'shader:Black')
    const agent = await joinSession(server, code)
    try {
        await agent.describe()
        for (let n = 0; n < 16; n++) {
            const look = await agent.call('getThumbnail', { maxDimension: 16 })
            expect(look.envelope.ok, `look ${n}`).toBe(true)
        }
        const refused = await agent.call('getThumbnail', { maxDimension: 16 })
        expect(refused.envelope.error).toMatchObject({ code: 'IMAGE_LIMIT', details: { retryAfter: expect.any(Number) } })
        expect(refused.envelope.error.details.retryAfter).toBeGreaterThan(500)
    } finally {
        agent.close()
    }
})

test('a tab that inherits the session does not answer, and the person\'s tab answers again after a reload', async ({ page, browser }) => {
    test.setTimeout(180_000)
    const code = await openOnline(page)
    const visitor = await browser.newPage()
    const visitorSent = []
    visitor.on('websocket', (socket) => socket.on('framesent', (frame) => visitorSent.push(String(frame.payload))))
    await routeSeance(visitor, server)
    await visitor.goto(`/?seance=${code}`)
    await visitor.waitForFunction(() => window.__hd4?.ready === true && window.HD4Agent, null, { timeout: 30_000 })
    await visitor.evaluate(() => window.HD4Agent.ready)
    await expect.poll(() => visitor.evaluate(() => window.__hd4.online.getStatus())).toBe('online')
    const agent = await joinSession(server, code)
    try {
        const first = await agent.describe()
        const firstOwner = agent.ownerId

        // The person's tab reloads: it took the session online, so it answers again.
        await page.reload()
        await page.waitForFunction(() => window.__hd4?.ready === true && window.HD4Agent, null, { timeout: 30_000 })
        await expect.poll(() => page.evaluate(() => window.__hd4.online.getStatus())).toBe('online')
        await expect.poll(async () => (await agent.describe({ timeoutMs: 3000 }).catch(() => null))?.from, { timeout: 30_000 }).not.toBe(first.from)
        expect((await agent.call('getState')).envelope.ok).toBe(true)

        // The person's tab leaves for good. Seance hands the session to another
        // participant, but no tab that did not take the session online answers.
        await page.close()
        await expect.poll(() => agent.ownerId, { timeout: 20_000 }).not.toBe(firstOwner)
        await expect(agent.describe({ timeoutMs: 3000 })).rejects.toThrow('describe: no reply')
        expect(visitorSent.filter((frame) => frame.includes('nf-agent/1'))).toEqual([])
    } finally {
        agent.close()
        await visitor.close()
    }
})

test('connect agent walks the person through going online, copying the prompt and the agent joining', async ({ page, context }) => {
    test.setTimeout(180_000)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: PAGE_ORIGIN })
    await routeHandfishDist(page)
    await routeSeance(page, server)
    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true && window.HD4Agent, null, { timeout: 30_000 })
    expect(await page.evaluate(() => Boolean(customElements.get('agent-connect-dialog'))),
        'Set HANDFISH_DIST to a handfish build that has <agent-connect-dialog>.').toBe(true)

    // Connect agent… sits right under Go online…, and the picker keeps its source.
    const picker = '.hd4-monitor[data-channel="2"] .hd4-source-select'
    const program = await page.locator(`${picker} optgroup[label="Program"] option`).allTextContents()
    expect(program.slice(-2)).toEqual(['Go online…', 'Connect agent…'])
    await page.selectOption(picker, 'agent')
    await expect(page.locator(picker)).toHaveValue('image')
    const dialog = page.locator('#agent-connect-dialog dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.hf-agent-lead')).toHaveText('To connect an agent, follow these steps:')
    const states = () => dialog.locator('.hf-agent-step').evaluateAll((items) => items.map((item) => item.dataset.state))
    expect(await states()).toEqual(['active', 'pending', 'pending'])

    await dialog.locator('[data-action="go-online"]').click()
    await expect.poll(states, { timeout: 30_000 }).toEqual(['done', 'active', 'pending'])
    const code = new URL(page.url()).searchParams.get('seance')
    expect(code).toBeTruthy()

    await dialog.locator('[data-action="copy-prompt"]').click()
    await expect.poll(states).toEqual(['done', 'done', 'active'])
    const prompt = (await page.evaluate(() => navigator.clipboard.readText())).trim().split('\n')
    expect(prompt.slice(0, 4)).toEqual([
        'Connect to my HD4 session and help me with it.',
        'Read https://hd4.noisefactor.io/llms-full.txt first.',
        'Then run:',
        '  curl -fsSLO https://noisedeck.app/agent/seance-agent.mjs',
    ])
    expect(prompt[4]).toMatch(/^ {2}node seance-agent\.mjs join /)
    // The agent follows the prompt's last line: the session link.
    const link = new URL(prompt[4].trim().split(' ').at(-1).replace(/['"]/g, ''))
    expect(`${link.origin}${link.pathname}`).toBe(`${PAGE_ORIGIN}/`)
    expect(link.searchParams.get('seance')).toBe(code)

    const agent = await joinSession(server, link.searchParams.get('seance'))
    try {
        expect((await agent.describe()).envelope.result.app).toBe('hd4')
        await expect.poll(states).toEqual(['done', 'done', 'done'])
        await expect(dialog).toBeHidden({ timeout: 10_000 })
        // Opened again while online, the dialog starts at the prompt.
        await page.selectOption(picker, 'agent')
        await expect(dialog).toBeVisible()
        await expect.poll(states).toEqual(['done', 'active', 'pending'])
    } finally {
        agent.close()
    }
})
