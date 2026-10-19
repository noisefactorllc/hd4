// SPDX-License-Identifier: MIT
/**
 * Noisedeck Sync output — the SYNC OUT dialog pairs with a fake Sync
 * companion (injected as window.__HD4_SYNC_TRANSPORT__), publishes real
 * SDK-framed program pixels through the GPU export queue, keeps them
 * upright, and tears the sender down on pagehide. The companion reports
 * NDI + Spout, so frames take the RGBA readback path.
 */
import { test, expect } from './fixtures.js'

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        const calls = []
        const frames = []
        const capture = { requested: false, frame: null }
        const token = 'b'.repeat(64)
        const senderId = 'hd4-program'
        const ticket = `ticket.${'c'.repeat(32)}`
        const capabilities = {
            send: true,
            receive: false,
            providers: [
                { id: 'ndi', direction: 'send', available: true, selected: true },
                { id: 'spout', direction: 'send', available: true, selected: true },
            ],
        }
        const health = {
            product: 'Sync',
            status: 'ok',
            version: '0.2.19',
            protocolVersions: [1],
            instanceId: 'sync-browser-test',
            capabilities,
        }
        const welcome = {
            type: 'welcome',
            protocolVersion: 1,
            version: health.version,
            instanceId: health.instanceId,
            capabilities,
        }

        function frameBytes(value) {
            return value instanceof ArrayBuffer
                ? new Uint8Array(value)
                : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        }

        function summarizeFrame(value) {
            const bytes = frameBytes(value)
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            let rgbNonZero = false
            for (let offset = 64; offset < bytes.length; offset++) {
                if ((offset - 64) % 4 !== 3 && bytes[offset] !== 0) { rgbNonZero = true; break }
            }
            return {
                byteLength: bytes.byteLength,
                magic: view.getUint32(0, true),
                version: view.getUint16(4, true),
                headerBytes: view.getUint16(6, true),
                width: view.getUint32(20, true),
                height: view.getUint32(24, true),
                rowStride: view.getUint32(28, true),
                payloadBytes: view.getUint32(32, true),
                sequence: Number(view.getBigUint64(36, true)),
                presentationTimeUs: Number(view.getBigUint64(44, true)),
                rgbNonZero,
            }
        }

        // Mean RGB and alpha of the rows in [fromRow, toRow) of a frame payload.
        function bandAverage(value, fromFraction, toFraction) {
            const bytes = frameBytes(value)
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            const width = view.getUint32(20, true)
            const height = view.getUint32(24, true)
            const stride = view.getUint32(28, true)
            const sum = [0, 0, 0, 0]
            let count = 0
            for (let row = Math.floor(height * fromFraction); row < Math.floor(height * toFraction); row++) {
                for (let col = 0; col < width; col += 4) {
                    const i = 64 + row * stride + col * 4
                    sum[0] += bytes[i]; sum[1] += bytes[i + 1]; sum[2] += bytes[i + 2]; sum[3] += bytes[i + 3]
                    count++
                }
            }
            return sum.map((v) => v / count)
        }

        class SyncTransportSocket extends EventTarget {
            static CONNECTING = 0
            static OPEN = 1
            static CLOSING = 2
            static CLOSED = 3

            constructor(url, protocol) {
                super()
                this.url = String(url)
                this.path = new URL(this.url).pathname
                this.protocol = typeof protocol === 'string' ? protocol : ''
                this.readyState = SyncTransportSocket.CONNECTING
                this.bufferedAmount = 0
                this.binaryType = 'blob'
                calls.push(['socket-create', this.path, this.protocol])
                queueMicrotask(() => {
                    if (this.readyState !== SyncTransportSocket.CONNECTING) return
                    this.readyState = SyncTransportSocket.OPEN
                    this.dispatchEvent(new Event('open'))
                })
            }

            send(value) {
                if (this.readyState !== SyncTransportSocket.OPEN) {
                    throw new DOMException('socket is not open', 'InvalidStateError')
                }
                if (this.path === '/pair') {
                    const request = JSON.parse(value)
                    calls.push(['pair', request.name, request.protocolVersions])
                    this._reply({ type: 'paired', protocolVersion: 1, token })
                    queueMicrotask(() => this.close(1000, 'paired'))
                    return
                }
                if (this.path === '/control') {
                    const request = JSON.parse(value)
                    if (request.type === 'hello') {
                        calls.push(['hello', request.token, request.protocolVersions])
                        this._reply(welcome)
                        return
                    }
                    if (request.type === 'createSender') {
                        calls.push(['create-sender', request.name])
                        this._reply({
                            type: 'senderCreated',
                            id: senderId,
                            name: request.name,
                            path: `/senders/${senderId}`,
                            ticket,
                        })
                        return
                    }
                    if (request.type === 'closeSender') {
                        calls.push(['close-sender', request.senderId])
                        this._reply({ type: 'senderClosed', id: request.senderId })
                        return
                    }
                    throw new Error(`unexpected control request: ${request.type}`)
                }
                if (this.path === `/senders/${senderId}`) {
                    if (frames.length < 2) frames.push(summarizeFrame(value))
                    if (capture.requested) {
                        capture.requested = false
                        capture.frame = {
                            ...summarizeFrame(value),
                            top: bandAverage(value, 0.05, 0.25),
                            bottom: bandAverage(value, 0.75, 0.95),
                        }
                    }
                    calls.push(['frame'])
                    return
                }
                throw new Error(`unexpected Sync socket path: ${this.path}`)
            }

            close(code = 1000, reason = '') {
                if (this.readyState >= SyncTransportSocket.CLOSING) return
                this.readyState = SyncTransportSocket.CLOSING
                queueMicrotask(() => {
                    this.readyState = SyncTransportSocket.CLOSED
                    calls.push(['socket-close', this.path])
                    this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean: code === 1000 }))
                })
            }

            _reply(value) {
                queueMicrotask(() => {
                    if (this.readyState !== SyncTransportSocket.OPEN) return
                    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }))
                })
            }
        }

        async function syncFetch(url, options) {
            calls.push(['health', String(url), options?.credentials, options?.targetAddressSpace])
            return new Response(JSON.stringify(health), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        }

        window.__hd4SyncTest = { calls, frames, capture }
        window.__HD4_SYNC_TRANSPORT__ = { fetch: syncFetch, WebSocket: SyncTransportSocket, permissions: null }
    })

    await page.goto('/')
    await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
    await page.waitForFunction(() => window.__hd4.renderers.every((r) => r.isRunning), null, { timeout: 30_000 })
})

async function startSending(page, name) {
    await page.click('#sync-output-open')
    await expect(page.locator('#sync-output-dialog')).toBeVisible()
    await expect(page.locator('#sync-output-state')).toHaveText('Ready')
    await expect(page.locator('#sync-output-action')).toHaveText('Connect Sync')
    await page.click('#sync-output-action')
    await expect(page.locator('#sync-output-state')).toHaveText('Connected')
    await page.fill('#sync-output-name', name)
    await page.click('#sync-output-action')
    await expect(page.locator('#sync-output-state')).toHaveText('Sending')
}

test('SYNC OUT pairs, publishes SDK-framed program pixels, and disposes on pagehide', async ({ page }) => {
    await page.click('#sync-output-open')
    const dialog = page.locator('#sync-output-dialog')
    await expect(dialog).toBeVisible()
    const centered = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return Math.abs((rect.left + rect.width / 2) - window.innerWidth / 2) < 2 &&
            Math.abs((rect.top + rect.height / 2) - window.innerHeight / 2) < 2
    })
    expect(centered).toBe(true)
    await expect(page.locator('#sync-output-name')).toHaveValue('HD4')
    await expect(page.locator('#sync-output-state')).toHaveText('Ready')
    await expect(page.locator('#sync-output-action')).toHaveText('Connect Sync')

    await page.click('#sync-output-action')
    await expect(page.locator('#sync-output-state')).toHaveText('Connected')
    await expect(page.locator('#sync-output-provider')).toHaveText('NDI, Spout')

    const syncOut = page.locator('#sync-output-open')
    await expect(syncOut).not.toHaveClass(/is-active/)
    await page.fill('#sync-output-name', 'HD4 Main')
    await page.click('#sync-output-action')
    await expect(page.locator('#sync-output-state')).toHaveText('Sending')
    await expect(page.locator('#sync-output-live')).toBeVisible()
    await expect(page.locator('#sync-output-format')).toHaveText('1280×720 · 60 fps')
    await expect(syncOut).toHaveClass(/is-active/)
    await page.waitForFunction(() => window.__hd4SyncTest.frames.length >= 2)

    const transport = await page.evaluate(() => ({
        calls: window.__hd4SyncTest.calls,
        frames: window.__hd4SyncTest.frames,
    }))
    expect(transport.calls).toContainEqual(['pair', 'HD4', [1]])
    expect(transport.calls).toContainEqual(['create-sender', 'HD4 Main'])
    for (const frame of transport.frames) {
        expect(frame).toMatchObject({
            magic: 0x434e5953,
            version: 1,
            headerBytes: 64,
            width: 1280,
            height: 720,
            rowStride: 1280 * 4,
            payloadBytes: 1280 * 720 * 4,
            byteLength: 64 + 1280 * 720 * 4,
            rgbNonZero: true,
        })
        expect(frame.presentationTimeUs).toBeGreaterThan(0)
    }
    expect(transport.frames[0].sequence).toBeGreaterThan(0)
    expect(transport.frames[1].sequence).toBeGreaterThan(transport.frames[0].sequence)

    await page.click('#sync-output-action')
    await expect(page.locator('#sync-output-state')).toHaveText('Ready')
    await expect(syncOut).not.toHaveClass(/is-active/)
    await page.waitForFunction(() => window.__hd4SyncTest.calls.some((entry) => entry[0] === 'close-sender'))

    await page.setViewportSize({ width: 700, height: 480 })
    const shortViewportLayout = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return {
            contained: rect.top >= 0 && rect.bottom <= window.innerHeight,
            overflowY: getComputedStyle(element).overflowY,
        }
    })
    expect(shortViewportLayout.contained).toBe(true)
    expect(shortViewportLayout.overflowY).toBe('auto')

    await page.click('#sync-output-action')
    await expect(page.locator('#sync-output-state')).toHaveText('Connected')
    await page.click('#sync-output-action')
    await expect(page.locator('#sync-output-state')).toHaveText('Sending')
    const closesBefore = await page.evaluate(() => (
        window.__hd4SyncTest.calls.filter((entry) => entry[0] === 'socket-close').length
    ))
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
    await page.waitForTimeout(100)
    const closesAfterPersisted = await page.evaluate(() => (
        window.__hd4SyncTest.calls.filter((entry) => entry[0] === 'socket-close').length
    ))
    expect(closesAfterPersisted).toBe(closesBefore)
    await expect(page.locator('#sync-output-state')).toHaveText('Sending')

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
    await page.waitForFunction((before) => (
        window.__hd4SyncTest.calls.filter((entry) => entry[0] === 'socket-close').length >= before + 2
    ), closesBefore, { timeout: 5_000 })
})

// Top half Blue (live ch3), bottom half Amber (ch4): an image that reads
// differently when flipped.
async function showSplitProgram(page) {
    await page.selectOption('.hd4-monitor[data-channel="3"] .hd4-source-select', 'shader:Blue')
    await page.selectOption('.hd4-monitor[data-channel="4"] .hd4-source-select', 'shader:Amber')
    await page.waitForFunction(() => [2, 3].every((i) => window.__hd4.sampleChannelBrightness(i) > 0), null, { timeout: 30_000 })
    await page.evaluate(() => {
        window.__hd4.switcher.setType('cut')
        window.__hd4.switcher.cut(3)
        window.__hd4.composition.setSplit({ sourceB: 4, pattern: 'h-stretch' })
        window.__hd4.composition.setComposition('split')
    })
    await expect.poll(async () => {
        const [top, bottom] = await page.evaluate(() => [
            window.__hd4.sampleProgramRect(0, 0.05, 1, 0.2),
            window.__hd4.sampleProgramRect(0, 0.75, 1, 0.2),
        ])
        return dist(top, bottom)
    }, { timeout: 15_000 }).toBeGreaterThan(100)
}

// Capture the next Sync frame and compare its top/bottom bands with the program.
async function expectUprightFrame(page, width, height) {
    await page.evaluate(() => {
        window.__hd4SyncTest.capture.frame = null
        window.__hd4SyncTest.capture.requested = true
    })
    await page.waitForFunction(() => window.__hd4SyncTest.capture.frame !== null)
    const [frame, programTop, programBottom] = await page.evaluate(() => [
        window.__hd4SyncTest.capture.frame,
        window.__hd4.sampleProgramRect(0, 0.05, 1, 0.2),
        window.__hd4.sampleProgramRect(0, 0.75, 1, 0.2),
    ])
    expect(frame).toMatchObject({ width, height, rowStride: width * 4, payloadBytes: width * height * 4 })
    const rgb = (v) => v.slice(0, 3)
    expect(dist(rgb(frame.top), programTop)).toBeLessThan(40)
    expect(dist(rgb(frame.bottom), programBottom)).toBeLessThan(40)
    expect(dist(rgb(frame.top), programBottom)).toBeGreaterThan(100)
    expect(frame.top[3]).toBe(255)
    expect(frame.bottom[3]).toBe(255)
}

test('Sync frames carry the program upright and opaque', async ({ page }) => {
    await showSplitProgram(page)
    await startSending(page, 'HD4 Orientation')
    await expectUprightFrame(page, 1280, 720)
})

test('changing the program resolution while sending keeps frames flowing at the new size', async ({ page }) => {
    await showSplitProgram(page)
    await startSending(page, 'HD4 Resize')
    await expectUprightFrame(page, 1280, 720)

    // What Settings → Resolution applies.
    await page.evaluate(() => window.__hd4.compositor.resize(1920, 1080))
    await expect(page.locator('#sync-output-format')).toHaveText('1920×1080 · 60 fps')
    await expect(page.locator('#sync-output-state')).toHaveText('Sending')
    await expectUprightFrame(page, 1920, 1080)

    await page.evaluate(() => window.__hd4.compositor.resize(640, 360))
    await expect(page.locator('#sync-output-format')).toHaveText('640×360 · 60 fps')
    await expectUprightFrame(page, 640, 360)
    await expect(page.locator('#sync-output-state')).toHaveText('Sending')
})

test('Escape closes the Sync dialog, and shortcuts wait while it is open', async ({ page }) => {
    const type = () => page.evaluate(() => window.__hd4.switcher.type)
    const before = await type()
    const key = before === 'cut' ? 'w' : 'c'
    await page.click('#sync-output-open')
    await expect(page.locator('#sync-output-dialog')).toBeVisible()
    await page.focus('#sync-output-action')
    await page.keyboard.press(key)
    expect(await type()).toBe(before)

    await page.keyboard.press('Escape')
    await expect(page.locator('#sync-output-dialog')).toBeHidden()
    await page.keyboard.press(key)
    await expect.poll(type).not.toBe(before)
})
