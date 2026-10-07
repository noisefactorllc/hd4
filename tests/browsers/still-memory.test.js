// SPDX-License-Identifier: MIT
/**
 * A still saved to a memory slot recalls after a reload, in Chromium, Firefox
 * or WebKit.
 *
 * The page runs in a fresh, ephemeral browser context: WebKit's ephemeral
 * contexts, like Safari's private browsing, refuse a Blob or File in IndexedDB
 * but take an ArrayBuffer. The program is grabbed as a still while Blue is
 * live, shown on channel 1, and saved to memory slot 1. After a reload the
 * slot recalls the still: channel 1 shows Blue again, and the stored bytes
 * have the SHA-256 of the captured PNG.
 *
 * No real camera or microphone is ever requested: before the page loads,
 * fake-camera.js replaces navigator.mediaDevices with a plain object whose camera
 * is a canvas, in every browser, so page code never reaches the native one. FAKE_CAMERA_SCRIPT names another such script.
 *
 * The whole app never runs in WebKit: hd4 listens for camera changes as it
 * starts, and in WebKit that alone asks macOS for the camera, which a page
 * script cannot fake. In WebKit only the still storage itself is tested, on a
 * blank page that loads nothing but js/stillStorage.js.
 *
 * The Playwright test runner drives Chromium only (tests/e2e), so this runs on
 * the Node test runner. BROWSER picks chromium (default), firefox or webkit.
 * PLAYWRIGHT_MODULE names another Playwright build to drive the browser with.
 *
 * Run: BROWSER=webkit node --test tests/browsers/still-memory.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const BROWSER = process.env.BROWSER || 'chromium'
const FAKE_CAMERA = process.env.FAKE_CAMERA_SCRIPT || fileURLToPath(new URL('./fake-camera.js', import.meta.url))
const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** Serve the repository as `npm run dev` does. */
function serve() {
    const server = createServer(async (request, response) => {
        const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
        if (path === '/__blank.html') {
            response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
            response.end('<!doctype html><meta charset="utf-8"><title>still storage</title>')
            return
        }
        const file = resolve(ROOT, '.' + (path.endsWith('/') ? `${path}index.html` : path))
        if (file !== ROOT && !file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) { response.writeHead(403); response.end(); return }
        try {
            const body = await readFile(file)
            response.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
            response.end(body)
        } catch {
            response.writeHead(404)
            response.end()
        }
    })
    return new Promise(done => server.listen(0, '127.0.0.1', () => done(server)))
}

/** Poll `read` until `accept` holds for its value, or fail with `label`. */
async function waitFor(read, accept, label, timeout = 15000) {
    const end = Date.now() + timeout
    let value
    while (Date.now() < end) {
        value = await read()
        if (accept(value)) return value
        await new Promise(done => setTimeout(done, 100))
    }
    assert.fail(`${label}: last value ${JSON.stringify(value)}`)
}

// One PNG still, as hd4 captures it: data URL text that the save turns into stored bytes.
const STILL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGOUi7rzn4GBgYEJRIAwACKqAlcy/Rx7AAAAAElFTkSuQmCC'

test(`${BROWSER}: a still is stored as bytes and reads back after a reload, with its bytes unchanged`, { timeout: 120000 }, async t => {
    const playwright = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test')
    const server = await serve()
    const browser = await playwright[BROWSER].launch({ headless: true })
    t.after(async () => {
        await browser.close()
        server.close()
    })
    // A fresh context is ephemeral: in WebKit it refuses a Blob or File in IndexedDB.
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${server.address().port}/__blank.html`)
    const dataUrl = `data:image/png;base64,${STILL_PNG}`
    const stored = await page.evaluate(async dataUrl => {
        const { storeEmbeddedStills, decodeEmbeddedStill, stillIdOf } = await import('/js/stillStorage.js')
        const ids = await storeEmbeddedStills([dataUrl])
        return { id: ids.get(dataUrl), expected: await stillIdOf(decodeEmbeddedStill(dataUrl)) }
    }, dataUrl)
    assert.equal(stored.id, stored.expected)
    await page.reload()
    const read = await page.evaluate(async id => {
        const { getStill, stillIdOf } = await import('/js/stillStorage.js')
        const blob = await getStill(id)
        const raw = await new Promise((done, fail) => {
            const open = indexedDB.open('hd4-stills')
            open.onerror = () => fail(open.error)
            open.onsuccess = () => {
                const get = open.result.transaction('stills').objectStore('stills').get(id)
                get.onsuccess = () => { open.result.close(); done(get.result) }
                get.onerror = () => { open.result.close(); fail(get.error) }
            }
        })
        return { blob: blob instanceof Blob, type: blob?.type, sha256: blob && await stillIdOf(blob),
            record: raw && { bytes: raw.bytes instanceof ArrayBuffer, blob: raw.blob instanceof Blob, type: raw.type } }
    }, stored.id)
    assert.deepEqual(read, { blob: true, type: 'image/png', sha256: stored.id, record: { bytes: true, blob: false, type: 'image/png' } })
    await context.close()
})

// The whole app only where its camera can be faked from the page: never in WebKit.
test(`${BROWSER}: a still saved to a memory slot recalls after a reload, with its bytes unchanged`, { timeout: 240000, skip: BROWSER === 'webkit' && 'hd4 asks macOS for the camera as it starts in WebKit' }, async t => {
    const playwright = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test')
    const server = await serve()
    // Channel 1 starts on a camera. Each browser also gets its own fake devices with
    // permission granted, as playwright.config.js gives Chromium, so nothing ever prompts.
    const browser = await playwright[BROWSER].launch({
        headless: true,
        args: BROWSER === 'chromium' ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] : [],
        firefoxUserPrefs: BROWSER === 'firefox' ? { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } : undefined,
    })
    t.after(async () => {
        await browser.close()
        server.close()
    })

    // A fresh context is ephemeral: in WebKit it refuses a Blob or File in IndexedDB.
    const context = await browser.newContext()
    const page = await context.newPage()
    // Before any navigation: the camera is a canvas, so no real device is opened.
    await page.addInitScript({ path: FAKE_CAMERA })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error' && /was not saved|still/i.test(message.text())) errors.push(message.text()) })
    const ready = () => page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30000 })

    // The stored still for an id as IndexedDB holds it, with the SHA-256 of its bytes.
    const storedStill = id => page.evaluate(id => new Promise((done, fail) => {
        const open = indexedDB.open('hd4-stills')
        open.onerror = () => fail(open.error)
        open.onsuccess = () => {
            const db = open.result
            const get = db.transaction('stills').objectStore('stills').get(id)
            get.onerror = () => { db.close(); fail(get.error) }
            get.onsuccess = async () => {
                db.close()
                const record = get.result
                if (!record) return done(null)
                const bytes = record.bytes instanceof ArrayBuffer ? record.bytes : record.blob instanceof Blob ? await record.blob.arrayBuffer() : null
                const digest = bytes && Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
                done({ bytes: record.bytes instanceof ArrayBuffer, blob: record.blob instanceof Blob, type: record.type || record.blob?.type, size: bytes?.byteLength, sha256: digest })
            }
        }
    }), id)

    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await ready()
    await page.waitForFunction(() => window.__hd4.renderers.every(renderer => renderer.isRunning), null, { timeout: 30000 })
    await page.selectOption('.hd4-monitor[data-channel="3"] .hd4-source-select', 'shader:Blue')
    await page.waitForFunction(() => window.__hd4.sampleChannelBrightness(2) > 0, null, { timeout: 30000 })

    // Blue live, then grab the program as a still and show it on channel 1.
    await page.evaluate(() => { window.__hd4.switcher.setType('cut'); window.__hd4.switcher.cut(3) })
    await waitFor(() => page.evaluate(() => [window.__hd4.sampleProgramAvg(), window.__hd4.sampleChannelAvg(2)]), ([program, blue]) => dist(program, blue) < 30, 'program shows Blue')
    await page.click('.hd4-output-btn:has-text("STILL")')
    await page.waitForFunction(() => window.__hd4.still.hasStill === true, null, { timeout: 5000 })
    await page.selectOption('.hd4-monitor[data-channel="1"] .hd4-source-select', 'still')
    const [, blue] = await waitFor(() => page.evaluate(() => [window.__hd4.sampleChannelAvg(0), window.__hd4.sampleChannelAvg(2)]), ([ch1, blue]) => dist(ch1, blue) < 40, 'channel 1 shows the Blue still')
    const shown = await page.evaluate(() => window.__hd4.sampleChannelAvg(0))
    // The SHA-256 of the captured PNG's bytes.
    const captured = await page.evaluate(async () => {
        const { decodeEmbeddedStill, stillIdOf } = await import('/js/stillStorage.js')
        const png = decodeEmbeddedStill(window.__hd4.still.dataUrl)
        return { type: png.type, size: png.size, sha256: await stillIdOf(png) }
    })
    console.log(`${BROWSER} captured still:`, JSON.stringify(captured), 'shown:', JSON.stringify(shown))

    // Save into memory 1. A refused save logs an error and leaves the slot empty.
    await page.click('.hd4-mem-save')
    await page.click('.hd4-mem-slot[data-slot="1"]')
    await waitFor(async () => ({
        occupied: await page.locator('.hd4-mem-slot[data-slot="1"]').evaluate(slot => slot.classList.contains('is-occupied')),
        errors: errors.length,
    }), state => state.occupied || state.errors > 0, 'memory 1 saved')
    assert.deepEqual(errors, [], 'the save was refused')
    const slot = JSON.parse(await page.evaluate(() => localStorage.getItem('hd4.memory.1')))
    assert.deepEqual(slot.channels[0], { type: 'image', name: 'Still', stillId: captured.sha256 })

    // Reload: no still is held in memory; recall loads it from IndexedDB.
    await page.reload()
    await ready()
    assert.equal(await page.evaluate(() => window.__hd4.still.hasStill), false)
    await page.click('.hd4-mem-slot[data-slot="1"]')
    assert.deepEqual(await page.evaluate(() => window.__hd4.channels[0].source), { type: 'image', name: 'Still', url: '', stillId: captured.sha256 })
    const recalled = await waitFor(() => page.evaluate(() => window.__hd4.sampleChannelAvg(0)), pixel => dist(pixel, shown) < 40, 'channel 1 shows the recalled still')
    console.log(`${BROWSER} recalled after reload:`, JSON.stringify(recalled), 'blue:', JSON.stringify(blue))

    // The still is stored as its PNG bytes in an ArrayBuffer, with its type, and reads back as a Blob.
    const stored = await storedStill(captured.sha256)
    console.log(`${BROWSER} stored still:`, JSON.stringify(stored))
    assert.deepEqual(stored, { bytes: true, blob: false, type: 'image/png', size: captured.size, sha256: captured.sha256 })
    const read = await page.evaluate(async id => {
        const { getStill, stillIdOf } = await import('/js/stillStorage.js')
        const blob = await getStill(id)
        return blob && { blob: blob instanceof Blob, type: blob.type, size: blob.size, sha256: await stillIdOf(blob) }
    }, captured.sha256)
    assert.deepEqual(read, { blob: true, type: 'image/png', size: captured.size, sha256: captured.sha256 })
    assert.deepEqual(errors, [])
    await context.close()
})
