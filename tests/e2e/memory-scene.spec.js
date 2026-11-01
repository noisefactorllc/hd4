// SPDX-License-Identifier: MIT
import { test, expect } from './fixtures.js'

const audioSelect = (n) => `.hd4-strip[data-channel="${n}"] .hd4-strip-audio`
const slot = (n) => `.hd4-mem-slot[data-slot="${n}"]`
const glyphs = {
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    D: ['11100', '10010', '10001', '10001', '10001', '10010', '11100'],
}

async function oledWord(page, word, y, scale) {
    return page.locator('.hd4-led canvas').evaluate((canvas, { word, y, scale }) => {
        const box = canvas.getBoundingClientRect()
        const cell = Math.max(1, Math.min((box.width - 8) / 128, (box.height - 8) / 32))
        const ox = (box.width - cell * 128) / 2
        const oy = (box.height - cell * 32) / 2
        const ctx = canvas.getContext('2d')
        const at = (x, y) => Array.from(ctx.getImageData(
            Math.floor((ox + (x + 0.5) * cell) * canvas.width / box.width),
            Math.floor((oy + (y + 0.5) * cell) * canvas.height / box.height), 1, 1,
        ).data).slice(0, 3)
        const background = at(125, 30)
        const distance = (rgb) => Math.hypot(...rgb.map((v, i) => v - background[i]))
        const threshold = distance(at(1, y)) / 2
        return [...word].map((_, char) => Array.from({ length: 7 }, (_, row) => Array.from({ length: 5 }, (_, col) =>
            distance(at(1 + char * 6 * scale + col * scale, y + row * scale)) > threshold ? '1' : '0',
        ).join('')))
    }, { word, y, scale })
}

async function failureFeedback(page, n, testInfo) {
    const message = `memory ${n} was not saved`
    const status = page.locator('.hd4-mem-status')
    await expect(status).toHaveText(message)
    await expect(status).toHaveAttribute('role', 'status')
    await expect(status).toHaveAttribute('aria-live', 'polite')
    const session = await page.context().newCDPSession(page)
    try {
        const { root } = await session.send('DOM.getDocument')
        const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.hd4-mem-status' })
        const { nodes } = await session.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: true })
        expect(nodes.some((node) => node.role?.value === 'status' && node.properties?.some((p) => p.name === 'live' && p.value.value === 'polite'))).toBe(true)
        expect(nodes.some((node) => node.name?.value === message)).toBe(true)
    } finally { await session.detach() }
    await expect(page.locator('.hd4-led')).toBeVisible()
    await expect.poll(() => oledWord(page, 'MEM', 0, 1)).toEqual([...'MEM'].map((c) => glyphs[c]))
    await expect.poll(() => oledWord(page, 'FAILED', 11, 2)).toEqual([...'FAILED'].map((c) => glyphs[c]))
    await expect(page.locator('.hd4-mem-save')).toHaveAttribute('aria-pressed', 'false')
    const capture = testInfo.outputPath(`memory-${n}-failure-${testInfo.attachments.length}.png`)
    await page.locator('.hd4-led').screenshot({ path: capture })
    await testInfo.attach(`memory-${n}-failure`, { path: capture, contentType: 'image/png' })
}

async function save(page, n) {
    await page.click('.hd4-mem-save')
    await page.click(slot(n))
    await expect(page.locator(slot(n))).toHaveAccessibleDescription('Saved')
}

async function autoMode(page, mode) {
    await page.locator('.hd4-auto-mode .select-trigger').click()
    await page.locator(`.hd4-auto-mode .inline-dropdown .option[data-value="${mode}"]`).click()
}

async function bars(page, value) {
    await page.locator('.hd4-auto-bars').fill(String(value))
    await page.locator('.hd4-auto-bars').press('Enter')
    await page.locator('.hd4-auto-bars').blur()
}

async function scene(page) {
    return page.evaluate(() => ({
        transition: { curve: window.__hd4.compositor.curve, blend: window.__hd4.compositor.blend },
        modes: [0, 1, 2, 3].map((i) => window.__hd4.audio.channelAudioMode(i)),
        devices: [0, 1, 2, 3].map((i) => window.__hd4.audio.channelAudioDeviceId(i)),
        auto: { mode: window.__hd4.autoMix.mode, bars: window.__hd4.autoMix.barsPerSwitch },
        monitor: window.__hd4.audio.monitorSource(),
        recordSource: window.__hd4.recordSource,
    }))
}

async function setScene(page, a, device) {
    await page.selectOption('.hd4-curve-select', a ? 'sharp' : 'linear')
    await page.selectOption('.hd4-blend-select', a ? 'screen' : 'add')
    await page.selectOption(audioSelect(2), a ? 'none' : 'follow')
    await page.selectOption(audioSelect(3), a ? device : 'follow')
    await autoMode(page, a ? 'random' : 'scan')
    await bars(page, a ? 8 : 2)
    const current = await scene(page)
    if (current.monitor !== (a ? 'aux' : 'main')) await page.click('.hd4-aux-mon')
    if (current.recordSource !== (a ? 'aux' : 'program')) await page.click('.hd4-aux-recsrc')
}

async function deviceOption(page) {
    await expect.poll(() => page.locator(audioSelect(3)).locator('option[value^="device:"]').count()).toBeGreaterThan(0)
    return page.locator(audioSelect(3)).locator('option[value^="device:"]').first().getAttribute('value')
}

async function expectSceneUi(page, a, device) {
    await expect(page.locator('.hd4-curve-select')).toHaveValue(a ? 'sharp' : 'linear')
    await expect(page.locator('.hd4-blend-select')).toHaveValue(a ? 'screen' : 'add')
    await expect(page.locator(audioSelect(2))).toHaveValue(a ? 'none' : 'follow')
    await expect(page.locator(audioSelect(3))).toHaveValue(a ? device : 'follow')
    await expect(page.locator('.hd4-auto-mode')).toHaveJSProperty('value', a ? 'random' : 'scan')
    await expect(page.locator('.hd4-auto-bars')).toHaveValue(a ? '8' : '2')
    await expect(page.locator('.hd4-aux-mon')).toHaveAttribute('aria-pressed', String(a))
    await expect(page.locator('.hd4-aux-recsrc')).toHaveText(a ? 'AUX' : 'PGM')
}

for (const theme of ['neutral-dark', 'ocean']) {
    test.describe(`memory scene in ${theme}`, () => {
        test.beforeEach(async ({ page }) => {
            await page.goto('/')
            await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
            if (theme !== 'neutral-dark') {
                await page.click('.hd4-settings-gear')
                await page.selectOption('#hd4-set-theme', theme)
                await page.click('.hd4-settings-close')
            }
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        })

        test('real SAVE and recall restore the approved existing scene settings and controls after reload', async ({ page }) => {
            const device = await deviceOption(page)
            await setScene(page, true, device)
            const want = {
                transition: { curve: 'sharp', blend: 'screen' },
                modes: ['follow', 'none', 'device', 'follow'],
                devices: ['', '', device.slice(7), ''],
                auto: { mode: 'random', bars: 8 }, monitor: 'aux', recordSource: 'aux',
            }
            await expect.poll(() => scene(page)).toEqual(want)
            await save(page, 3)
            const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hd4.memory.3')))
            expect(stored.transition).toEqual(want.transition)
            expect(stored.auto).toEqual(want.auto)
            expect(stored.audio.monitor).toBe('aux')
            expect(stored.recordSource).toBe('aux')
            expect(stored.audio.channels[2]).toMatchObject({ mode: 'device', deviceId: device.slice(7) })
            expect(stored.output).not.toHaveProperty('freeze')
            expect(stored.output).not.toHaveProperty('fade')
            await setScene(page, false, device)
            await page.click(slot(3))
            await expect.poll(() => scene(page)).toEqual(want)
            await expectSceneUi(page, true, device)
            await page.reload()
            await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
            await page.click(slot(3))
            await expect.poll(() => scene(page)).toEqual(want)
            await expectSceneUi(page, true, device)
        })

        test('legacy missing values stay current and unavailable audio devices keep the existing No audio fallback', async ({ page }) => {
            const device = await deviceOption(page)
            await setScene(page, true, device)
            await save(page, 3)
            await page.evaluate(() => {
                const snap = JSON.parse(localStorage.getItem('hd4.memory.3'))
                delete snap.transition; delete snap.auto; delete snap.recordSource; delete snap.audio.monitor
                for (const channel of snap.audio.channels) { delete channel.mode; delete channel.deviceId }
                localStorage.setItem('hd4.memory.3', JSON.stringify(snap))
            })
            await setScene(page, false, device)
            const current = await scene(page)
            await page.click(slot(3))
            await expect.poll(() => scene(page)).toEqual(current)
            await expectSceneUi(page, false, device)
            await page.evaluate(() => {
                const snap = JSON.parse(localStorage.getItem('hd4.memory.3'))
                snap.audio.channels[2].mode = 'device'
                snap.audio.channels[2].deviceId = 'unavailable-audio-input'
                localStorage.setItem('hd4.memory.3', JSON.stringify(snap))
            })
            await page.click(slot(3))
            await expect.poll(() => page.evaluate(() => window.__hd4.audio.channelAudioMode(2))).toBe('none')
            await expect(page.locator(audioSelect(3))).toHaveValue('none')
            await expect(page.locator('.hd4-aux-mon')).toHaveAttribute('aria-pressed', 'false')
        })

        test('refused localStorage writes report MEM/FAILED and accessible failure without changing saved contents', async ({ page }, testInfo) => {
            await save(page, 3)
            const previous = await page.evaluate(() => localStorage.getItem('hd4.memory.3'))
            await page.evaluate(() => {
                window.__memoryOriginalSetItem = Storage.prototype.setItem
                Storage.prototype.setItem = function (key, value) {
                    if (key.startsWith('hd4.memory.')) throw new DOMException('persisted storage is full', 'QuotaExceededError')
                    return window.__memoryOriginalSetItem.call(this, key, value)
                }
            })
            await page.click('.hd4-trans-btn[data-type="cut"]')
            for (const n of [3, 4]) {
                await page.click('.hd4-mem-save'); await page.click(slot(n))
                await failureFeedback(page, n, testInfo)
            }
            expect(await page.evaluate(() => localStorage.getItem('hd4.memory.3'))).toBe(previous)
            expect(await page.evaluate(() => localStorage.getItem('hd4.memory.4'))).toBeNull()
            await expect(page.locator(slot(3))).toHaveAccessibleDescription('Saved')
            await expect(page.locator(slot(4))).toHaveAccessibleDescription('Empty')
            await page.evaluate(() => { Storage.prototype.setItem = window.__memoryOriginalSetItem })
            await save(page, 4)
            await expect(page.locator('.hd4-mem-status')).toHaveText('')
            await expect.poll(() => oledWord(page, 'FAILED', 11, 2)).not.toEqual([...'FAILED'].map((c) => glyphs[c]))
        })

        test('persistent IndexedDB refusal reports each failed still save and preserves occupied and empty slots', async ({ page }, testInfo) => {
            await save(page, 2)
            const previous = await page.evaluate(() => localStorage.getItem('hd4.memory.2'))
            await page.evaluate(() => {
                const original = IDBDatabase.prototype.transaction
                IDBDatabase.prototype.transaction = function (names, mode, options) {
                    if (mode === 'readwrite' && [names].flat().includes('stills')) throw new DOMException('persisted storage is full', 'QuotaExceededError')
                    return original.call(this, names, mode, options)
                }
            })
            await page.locator('.hd4-output-btn').filter({ hasText: /^STILL$/ }).click()
            await page.selectOption('.hd4-monitor[data-channel="4"] .hd4-source-select', 'still')
            await page.waitForFunction(() => window.__hd4.channels[3].source.type === 'image' && window.__hd4.channels[3].source.name === 'Still')
            for (const n of [2, 4, 4]) {
                await page.click('.hd4-mem-save'); await page.click(slot(n))
                await failureFeedback(page, n, testInfo)
            }
            expect(await page.evaluate(() => localStorage.getItem('hd4.memory.2'))).toBe(previous)
            expect(await page.evaluate(() => localStorage.getItem('hd4.memory.4'))).toBeNull()
            await expect(page.locator(slot(2))).toHaveAccessibleDescription('Saved')
            await expect(page.locator(slot(4))).toHaveAccessibleDescription('Empty')
        })
    })
}
