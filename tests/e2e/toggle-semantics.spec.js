// SPDX-License-Identifier: MIT
import { test, expect } from './fixtures.js'

async function axNode(session, selector) {
    const { root } = await session.send('DOM.getDocument')
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    const { nodes } = await session.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false })
    return nodes[0]
}

async function expectPressed(page, session, selector, on, readModel) {
    if (readModel) await expect.poll(readModel).toBe(on)
    await expect(page.locator(selector)).toHaveAttribute('aria-pressed', String(on))
    const node = await axNode(session, selector)
    expect(node.role.value).toBe('button')
    expect(node.properties.find((p) => p.name === 'pressed')?.value.value).toBe(String(on))
}

async function roundTrip(page, session, selector, readModel, initial = false, activeClass = 'is-active') {
    const button = page.locator(selector)
    const text = await button.textContent()
    await expectPressed(page, session, selector, initial, readModel)
    for (const on of [!initial, initial]) {
        await button.click()
        await expectPressed(page, session, selector, on, readModel)
        if (on) await expect(button).toHaveClass(new RegExp(activeClass))
        else await expect(button).not.toHaveClass(new RegExp(activeClass))
        await expect(button).toHaveText(text)
    }
}

for (const theme of ['neutral-dark', 'ocean']) {
    test.describe(`toggle accessibility in ${theme}`, () => {
        let session
        test.beforeEach(async ({ page }) => {
            await page.goto('/')
            await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
            if (theme !== 'neutral-dark') {
                await page.click('.hd4-settings-gear')
                await page.selectOption('#hd4-set-theme', theme)
                await page.click('.hd4-settings-close')
            }
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
            session = await page.context().newCDPSession(page)
        })
        test.afterEach(async () => { await session?.detach() })

        test('output, audio and tempo toggles expose model state to the accessibility tree', async ({ page }) => {
            await roundTrip(page, session, '.hd4-output-btn[title^="Freeze the program"]', () => page.evaluate(() => window.__hd4.output.freeze))
            await roundTrip(page, session, '.hd4-output-btn[title^="Fade the program"]', () => page.evaluate(() => window.__hd4.output.faded))
            for (let i = 0; i < 4; i++) {
                for (const [kind, method] of [['mute', 'isMuted'], ['solo', 'isSoloed']]) {
                    await roundTrip(page, session, `.hd4-strip[data-channel="${i + 1}"] .hd4-${kind}-btn`, () => page.evaluate(({ i, method }) => window.__hd4.audio[method](i), { i, method }))
                }
            }
            await roundTrip(page, session, '.hd4-aux-mon', () => page.evaluate(() => window.__hd4.audio.monitorSource() === 'aux'))
            await roundTrip(page, session, '.hd4-auto-btn', () => page.evaluate(() => window.__hd4.autoMix.enabled))
            await roundTrip(page, session, '.hd4-auto-sync', () => page.evaluate(async () => (await window.HD4Agent.getControls({ section: 'auto' })).result.matchAudio))
        })

        test('composition, inclusion and transition selections expose their actual selected state', async ({ page }) => {
            await roundTrip(page, session, '.hd4-comp-key-btn', () => page.evaluate(() => window.__hd4.composition.key.on))
            for (const [mode, label] of [['pinp', 'PinP'], ['split', 'SPLIT'], ['quad', 'QUAD']]) {
                await roundTrip(page, session, `.hd4-comp-modes button[title="${label} composition"]`, () => page.evaluate((mode) => window.__hd4.composition.composition === mode, mode))
            }
            for (let channel = 1; channel <= 4; channel++) {
                await roundTrip(page, session, `.hd4-monitor[data-channel="${channel}"] .hd4-auto-include`, () => page.evaluate((n) => window.__hd4.autoMix.isIncluded(n), channel), true, 'is-on')
            }
            const expectType = async (type) => {
                expect(await page.evaluate(() => window.__hd4.switcher.type)).toBe(type)
                for (const value of ['cut', 'mix', 'wipe']) {
                    const selector = `.hd4-trans-btn[data-type="${value}"]`
                    await expectPressed(page, session, selector, value === type)
                    await expect(page.locator(selector)).toHaveText(value.toUpperCase())
                }
            }
            await expectType('mix')
            for (const type of ['cut', 'mix', 'wipe']) {
                await page.click(`.hd4-trans-btn[data-type="${type}"]`)
                await expectType(type)
            }
            await page.keyboard.press('c')
            await expectType('cut')
        })

        test('SAVE arm and slot descriptions follow real saves, recalls and reloads', async ({ page }) => {
            const save = '.hd4-mem-save'
            const slot = '.hd4-mem-slot[data-slot="3"]'
            const expectSlot = async (saved) => {
                expect(await page.evaluate(() => window.__hd4.memory.list().includes(3))).toBe(saved)
                await expect(page.locator(slot)).toHaveAccessibleName('Memory 3')
                await expect(page.locator(slot)).toHaveAccessibleDescription(saved ? 'Saved' : 'Empty')
                expect((await axNode(session, slot)).description.value).toBe(saved ? 'Saved' : 'Empty')
                await expect(page.locator(slot)).toHaveText('3')
            }
            await expectPressed(page, session, save, false)
            await expectSlot(false)
            await page.click(save)
            await expectPressed(page, session, save, true)
            await page.click(save)
            await expectPressed(page, session, save, false)
            await page.click('.hd4-strip[data-channel="2"] .hd4-mute-btn')
            await page.click('.hd4-comp-modes button[title="PinP composition"]')
            await page.click('.hd4-trans-btn[data-type="cut"]')
            await page.click(save)
            await expectPressed(page, session, save, true)
            await page.click(slot)
            await expectPressed(page, session, save, false)
            await expect.poll(() => page.evaluate(() => window.__hd4.memory.list().includes(3))).toBe(true)
            await expectSlot(true)
            await page.click('.hd4-strip[data-channel="2"] .hd4-mute-btn')
            await page.click('.hd4-comp-modes button[title="PinP composition"]')
            await page.click('.hd4-trans-btn[data-type="wipe"]')
            await page.click(slot)
            await expectPressed(page, session, '.hd4-strip[data-channel="2"] .hd4-mute-btn', true, () => page.evaluate(() => window.__hd4.audio.isMuted(1)))
            await expectPressed(page, session, '.hd4-comp-modes button[title="PinP composition"]', true, () => page.evaluate(() => window.__hd4.composition.composition === 'pinp'))
            await expectPressed(page, session, '.hd4-trans-btn[data-type="cut"]', true, () => page.evaluate(() => window.__hd4.switcher.type === 'cut'))
            await page.reload()
            await page.waitForFunction(() => window.__hd4?.ready === true, null, { timeout: 30_000 })
            await expectSlot(true)
            await expectPressed(page, session, save, false)
        })

        test('REC and recording-source controls retain their existing changing text', async ({ page }) => {
            const source = page.locator('.hd4-aux-recsrc')
            await expect(source).toHaveText('PGM')
            expect(await page.evaluate(() => window.__hd4.recordSource)).toBe('program')
            await source.click()
            await expect(source).toHaveText('AUX')
            expect(await page.evaluate(() => window.__hd4.recordSource)).toBe('aux')
            await source.click()
            await expect(source).toHaveText('PGM')
            expect(await page.evaluate(() => window.__hd4.recordSource)).toBe('program')

            const record = page.locator('.hd4-rec-btn')
            await expect(record).toHaveText('REC')
            await record.click()
            await expect.poll(() => page.evaluate(() => window.__hd4.recorder.recording)).toBe(true)
            await expect(record).toHaveText(/^● \d{2}:\d{2}$/)
            const download = page.waitForEvent('download')
            await record.click()
            await download
            await expect.poll(() => page.evaluate(() => window.__hd4.recorder.recording)).toBe(false)
            await expect(record).toHaveText('REC')
        })
    })
}
