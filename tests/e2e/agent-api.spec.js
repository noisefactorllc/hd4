// SPDX-License-Identifier: MIT
/**
 * HD4Agent: the in-page command surface that llms.txt documents. Each command
 * drives the app through its own controls, so the panels show the change.
 */
import { test, expect } from './fixtures.js'

const MAGENTA = 'search synth\nsolid(color: #ff00ff).write(o0)\nrender(o0)'
const CYAN = 'search synth\nsolid(color: #00ffff).write(o0)\nrender(o0)'
const VALID = [
    'search synth, mixer',
    'noise(ridges: true).write(o0)',
    'gradient().blendMode(tex: read(o0), mode: overlay, mix: 25).write(o1)',
    'render(o1)',
].join('\n')

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

let pageErrors
test.beforeEach(async ({ page }) => {
    pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)))
})

test.afterEach(() => {
    expect(pageErrors).toEqual([])
})

async function loadAgent(page, query = '') {
    await page.goto(`/${query}`)
    await page.waitForFunction(() => window.__hd4?.ready === true && window.HD4Agent, null, { timeout: 30_000 })
    await page.evaluate(() => window.HD4Agent.ready)
}

test('exposes exactly the described commands', async ({ page }) => {
    await loadAgent(page)
    const { live, described, version } = await page.evaluate(async () => {
        const agent = window.HD4Agent
        const live = Object.keys(agent).filter(k => typeof agent[k] === 'function')
        const { COMMAND_GROUPS } = await import('/js/agent/descriptions.js')
        return { live, described: COMMAND_GROUPS.flatMap(g => Object.keys(g.commands)), version: agent.version }
    })
    expect([...live].sort()).toEqual([...described].sort())
    expect(version).toBe('1.0')
})

test('setProgram runs a program on the PVW channel, and take puts it on program', async ({ page }) => {
    await loadAgent(page)
    const out = await page.evaluate(async (dsl) => {
        const A = window.HD4Agent
        const set = await A.setProgram({ dsl })
        const read = await A.getProgram()
        const label = document.querySelector('.hd4-monitor[data-channel="2"] .hd4-monitor-label').textContent
        const picker = document.querySelector('.hd4-monitor[data-channel="2"] .hd4-source-select').value
        const taken = await A.take({ transition: 'cut' })
        return { set, read: read.result, label, picker, taken: taken.result }
    }, MAGENTA)
    expect(out.set.ok).toBe(true)
    expect(out.set.result).toMatchObject({ applied: true, channel: 2 })
    expect(out.set.state.channels[1]).toMatchObject({ channel: 2, source: 'shader', name: 'Custom', running: true })
    expect(out.read).toEqual({ channel: 2, source: 'shader', dsl: MAGENTA, running: true })
    expect(out.label).toBe('Custom')
    expect(out.picker).toBe('custom')
    // TAKE flip-flops: channel 2 goes to program, the outgoing channel 1 to PVW.
    expect(out.taken).toEqual({ live: 2, preview: 1, transitioning: false })
    await expect.poll(async () => dist(await page.evaluate(() => window.__hd4.sampleProgramAvg()), [255, 0, 255])).toBeLessThan(40)
})

test('a program that does not compile changes nothing', async ({ page }) => {
    await loadAgent(page)
    const out = await page.evaluate(async (dsl) => {
        const A = window.HD4Agent
        const before = (await A.getProgram({ channel: 3 })).result
        const bad = dsl.replace('mix: 25', 'mixAmt: 25')
        const check = await A.validateProgram({ dsl: bad })
        const set = await A.setProgram({ dsl: bad, channel: 3 })
        const syntax = await A.setProgram({ dsl: 'search synth\nnoise(.write(o0)', channel: 3 })
        const good = await A.validateProgram({ dsl })
        return { before, check: check.result, set: set.error, syntax: syntax.error, good: good.result, after: (await A.getProgram({ channel: 3 })).result }
    }, VALID)
    expect(out.check.valid).toBe(false)
    expect(out.check.diagnostics.some(d => d.code === 'S001' && d.message.includes('mixAmt'))).toBe(true)
    expect(out.set.code).toBe('INVALID_PROGRAM')
    expect(out.set.details.diagnostics.length).toBeGreaterThan(0)
    expect(out.syntax.code).toBe('INVALID_PROGRAM')
    expect(out.syntax.details.diagnostics[0].code).toBe('SYNTAX')
    expect(out.good).toEqual({ valid: true, diagnostics: [] })
    expect(out.after).toEqual(out.before)
    expect(out.after.dsl).toContain('colorBars')
})

test('effect lookup returns current parameter names', async ({ page }) => {
    await loadAgent(page)
    const out = await page.evaluate(async () => {
        const A = window.HD4Agent
        const search = await A.searchEffects({ query: 'blend', namespace: 'mixer' })
        const def = await A.getEffectDefinition({ effectId: 'mixer/blendMode' })
        const missing = await A.getEffectDefinition({ effectId: 'mixer/nope' })
        return { search: search.result, def: def.result, missing: missing.error }
    })
    expect(out.search.effects.map(e => e.effectId)).toContain('mixer/blendMode')
    expect(out.def.func).toBe('blendMode')
    expect(out.def.params.map(p => p.name)).toContain('mix')
    expect(out.def.params.map(p => p.name)).not.toContain('mixAmt')
    expect(out.missing.code).toBe('NOT_FOUND_EFFECT')
})

test('arguments are checked and thumbnails come back as small images of any monitor', async ({ page }) => {
    await loadAgent(page)
    await page.evaluate((dsl) => window.HD4Agent.setProgram({ dsl, channel: 4 }), CYAN)
    const out = await page.evaluate(async () => {
        const A = window.HD4Agent
        const pixel = async (env) => {
            const data = Uint8Array.from(atob(env.result.bytes), char => char.charCodeAt(0))
            const image = await createImageBitmap(new Blob([data], { type: env.result.mimeType }))
            const canvas = document.createElement('canvas')
            canvas.width = image.width
            canvas.height = image.height
            const ctx = canvas.getContext('2d')
            ctx.drawImage(image, 0, 0)
            return Array.from(ctx.getImageData(image.width >> 1, image.height >> 1, 1, 1).data)
        }
        const unknown = await A.setProgram({ dsl: 'x', force: true })
        const noArgs = await A.getState({ force: true })
        const range = await A.setProgram({ dsl: 'x', channel: 5 })
        const program = await A.getThumbnail({ maxDimension: 64, format: 'png' })
        const channel = await A.getThumbnail({ maxDimension: 64, format: 'png', source: 4 })
        const preview = await A.getThumbnail({ source: 'preview' })
        return {
            unknown: unknown.error.code,
            noArgs: noArgs.error.code,
            range: range.error.code,
            program: { ...program.result, bytes: undefined, png: atob(program.result.bytes.slice(0, 8)).slice(1, 4) },
            channel: { width: channel.result.width, source: channel.result.source, channel: channel.result.channel, pixel: await pixel(channel) },
            preview: { mimeType: preview.result.mimeType, width: preview.result.width, source: preview.result.source, channel: preview.result.channel },
        }
    })
    expect(out.unknown).toBe('INVALID_ARGS_UNKNOWN')
    expect(out.noArgs).toBe('INVALID_ARGS_UNKNOWN')
    expect(out.range).toBe('INVALID_ARGS_RANGE')
    expect(out.program).toMatchObject({ mimeType: 'image/png', width: 64, height: 36, source: 'program', channel: null, png: 'PNG' })
    expect(out.channel).toMatchObject({ width: 64, source: 4, channel: 4 })
    expect(dist(out.channel.pixel, [0, 255, 255])).toBeLessThan(30)
    expect(out.preview).toEqual({ mimeType: 'image/jpeg', width: 256, source: 'preview', channel: 2 })
})

test('switching: preview, take, cut and transitions move the buses and the panels', async ({ page }) => {
    await loadAgent(page)
    const out = await page.evaluate(async () => {
        const A = window.HD4Agent
        const transition = await A.setTransition({ type: 'wipe', time: 2.5, curve: 'sharp', blend: 'screen' })
        const ui = {
            active: document.querySelector('.hd4-trans-btn.is-active')?.dataset.type,
            curve: document.querySelector('.hd4-curve-select').value,
            blend: document.querySelector('.hd4-blend-select').value,
        }
        const preview = await A.setPreview({ channel: 3 })
        const pvwButton = document.querySelector('.hd4-pvw-btn.is-preview')?.dataset.channel
        const auto = await A.take()
        const busy = await A.take({ channel: 4 })
        const cut = await A.take({ channel: 4, transition: 'cut' })
        return { transition: transition.result, ui, preview: preview.result, pvwButton, auto: auto.result, busy: busy.error, cut: cut.result }
    })
    expect(out.transition).toEqual({ type: 'wipe', time: 2.5, curve: 'sharp', blend: 'screen' })
    expect(out.ui).toEqual({ active: 'wipe', curve: 'sharp', blend: 'screen' })
    expect(out.preview).toEqual({ live: 1, preview: 3, transitioning: false })
    expect(out.pvwButton).toBe('3')
    expect(out.auto).toEqual({ live: 3, preview: 1, transitioning: true })
    expect(out.busy.code).toBe('CONFLICT_TRANSITION_RUNNING')
    expect(out.cut).toEqual({ live: 4, preview: 1, transitioning: false })
})

test('composition, key and output follow the commands and the panels show them', async ({ page }) => {
    await loadAgent(page)
    await page.evaluate(async ({ magenta, cyan }) => {
        await window.HD4Agent.setProgram({ dsl: magenta, channel: 2 })
        await window.HD4Agent.setProgram({ dsl: cyan, channel: 4 })
    }, { magenta: MAGENTA, cyan: CYAN })
    const out = await page.evaluate(async () => {
        const A = window.HD4Agent
        const quad = await A.setComposition({ mode: 'quad' })
        const pinp = await A.setComposition({ mode: 'pinp', pinp: { source: 4, size: '1/2', shape: 'circle', hPosition: 50 } })
        const key = await A.setKey({ on: true, type: 'luma', source: 'still', level: 100 })
        const keyOff = await A.setKey({ on: false })
        const output = await A.setOutput({ freeze: true, vfx: 'mono' })
        const ui = {
            pinp: document.querySelector('.hd4-comp-modes .is-active')?.textContent,
            vfx: document.querySelector('.hd4-vfx-select').value,
        }
        const unfrozen = await A.setOutput({ freeze: false, vfx: 'none' })
        const controls = await A.getControls({ section: 'composition' })
        return { quad: quad.result.mode, pinp: pinp.result.pinp, key: key.result, keyOff: keyOff.result.on, output: output.result, ui, unfrozen: unfrozen.result, controls: controls.result }
    })
    expect(out.quad).toBe('quad')
    expect(out.pinp).toMatchObject({ source: 4, size: '1/2', shape: 'circle', hPosition: 50 })
    expect(out.key).toMatchObject({ on: true, type: 'luma', source: 'still', level: 100 })
    expect(out.keyOff).toBe(false)
    expect(out.output).toEqual({ freeze: true, fade: false, vfx: 'mono' })
    expect(out.ui).toEqual({ pinp: 'PinP', vfx: 'mono' })
    expect(out.unfrozen).toEqual({ freeze: false, fade: false, vfx: 'none' })
    expect(out.controls).toMatchObject({ section: 'composition', mode: 'pinp', key: { on: false, source: 'still' } })
    // QUAD shows the four channels: channel 2 (magenta) top right, channel 4 (cyan) bottom right.
    await page.evaluate(() => window.HD4Agent.setComposition({ mode: 'quad' }))
    await expect.poll(async () => dist(await page.evaluate(() => window.__hd4.sampleProgramQuad(1)), [255, 0, 255])).toBeLessThan(40)
    await expect.poll(async () => dist(await page.evaluate(() => window.__hd4.sampleProgramQuad(3)), [0, 255, 255])).toBeLessThan(40)
})

test('audio: faders, mute, solo and processing reach the mixer and its panel', async ({ page }) => {
    await loadAgent(page)
    const out = await page.evaluate(async () => {
        const A = window.HD4Agent
        const strip = await A.setAudioChannel({ channel: 2, fader: 0.25, mute: true, source: 'none', strip: { eqHi: 6, pan: -0.5 } })
        const main = await A.setAudioMain({ fader: 0.5, monitor: 'aux', recordSource: 'aux', bus: { reverbType: 'hall' } })
        const controls = (await A.getControls({ section: 'audio' })).result
        const panel = {
            fader: document.querySelector('.hd4-strip[data-channel="2"] .hd4-fader').value,
            muted: document.querySelector('.hd4-strip[data-channel="2"] .hd4-mute-btn').classList.contains('is-active'),
            source: document.querySelector('.hd4-strip[data-channel="2"] .hd4-strip-audio').value,
            monitor: document.querySelector('.hd4-aux-mon').classList.contains('is-active'),
            record: document.querySelector('.hd4-aux-recsrc').textContent,
        }
        return { strip: strip.result, main: main.result, controls, panel, recordSource: window.__hd4.recordSource }
    })
    expect(out.strip).toEqual({ channel: 2, fader: 0.25, mute: true, solo: false, source: 'none' })
    expect(out.main).toEqual({ fader: 0.5, monitor: 'aux', recordSource: 'aux' })
    expect(out.controls.channels[1]).toMatchObject({ fader: 0.25, mute: true, source: 'none', strip: { eqHi: 6, pan: -0.5 } })
    expect(out.controls.main).toMatchObject({ fader: 0.5, monitor: 'aux', recordSource: 'aux', bus: { reverbType: 'hall' } })
    expect(out.panel).toEqual({ fader: '0.25', muted: true, source: 'none', monitor: true, record: 'AUX' })
    expect(out.recordSource).toBe('aux')
})

test('auto-switching, channel options, sources and stills', async ({ page }) => {
    await loadAgent(page)
    const out = await page.evaluate(async () => {
        const A = window.HD4Agent
        const auto = await A.setAuto({ mode: 'random', bars: 8, bpm: 96 })
        const autoUi = {
            mode: document.querySelector('.hd4-auto-mode').value,
            bars: document.querySelector('.hd4-auto-bars').value,
        }
        const options = await A.setChannelOptions({ channel: 3, fit: 'contain', autoInclude: false })
        const includeUi = document.querySelector('.hd4-monitor[data-channel="3"] .hd4-auto-include').classList.contains('is-on')
        const noStill = await A.setSource({ channel: 3, source: 'still' })
        const grid = await A.setSource({ channel: 3, source: 'Grid' })
        const picker = document.querySelector('.hd4-monitor[data-channel="3"] .hd4-source-select').value
        const still = await A.captureStill()
        const fromStill = await A.setSource({ channel: 4, source: 'still' })
        const channels = (await A.getControls({ section: 'channels' })).result
        return { auto: auto.result, autoUi, options: options.result, includeUi, noStill: noStill.error, grid: grid.result, picker, still: still.result, fromStill: fromStill.result, channels }
    })
    expect(out.auto).toEqual({ on: false, mode: 'random', bars: 8, bpm: 96, matchAudio: false })
    expect(out.autoUi).toEqual({ mode: 'random', bars: '8' })
    expect(out.options).toEqual({ channel: 3, fit: 'contain', autoInclude: false })
    expect(out.includeUi).toBe(false)
    expect(out.noStill.code).toBe('NOT_FOUND_STILL')
    expect(out.grid).toEqual({ channel: 3, source: 'shader', name: 'Grid' })
    expect(out.picker).toBe('shader:Grid')
    expect(out.still).toEqual({ captured: true, width: 1280, height: 720 })
    expect(out.fromStill).toEqual({ channel: 4, source: 'image', name: 'Still' })
    expect(out.channels.stillCaptured).toBe(true)
    expect(out.channels.channels[2]).toMatchObject({ channel: 3, name: 'Grid', fit: 'contain', autoInclude: false })
})

test('memory, settings and USER buttons persist through the app', async ({ page }) => {
    await loadAgent(page)
    const out = await page.evaluate(async (dsl) => {
        const A = window.HD4Agent
        const empty = await A.recallMemory({ slot: 7 })
        await A.setProgram({ dsl, channel: 3 })
        const saved = await A.saveMemory({ slot: 7 })
        const listed = (await A.listMemory()).result.slots.find(s => s.slot === 7)
        const occupied = document.querySelector('.hd4-mem-slot[data-slot="7"]').classList.contains('is-occupied')
        await A.setSource({ channel: 3, source: 'Black' })
        const recalled = await A.recallMemory({ slot: 7 })
        const program = (await A.getProgram({ channel: 3 })).result.dsl
        const settings = await A.setSettings({ resolution: '640x360', theme: 'ocean' })
        const settingsUi = {
            resolution: document.querySelector('#hd4-set-resolution').value,
            theme: document.documentElement.dataset.theme,
            canvas: [window.__hd4.programCanvas.width, window.__hd4.programCanvas.height],
        }
        const user = await A.setUserButton({ button: 1, action: 'take:3' })
        const userNone = await A.setUserButton({ button: 2, action: 'none' })
        const read = (await A.getSettings()).result
        const devices = (await A.listDevices()).result
        return { empty: empty.error, saved: saved.result, listed, occupied, recalled: recalled.result, program, settings: settings.result, settingsUi, user: user.result, userNone: userNone.result, stored: localStorage.getItem('hd4.userButtons'), read, devices }
    }, MAGENTA)
    expect(out.empty.code).toBe('NOT_FOUND_MEMORY')
    expect(out.saved).toEqual({ saved: true, slot: 7 })
    expect(out.listed).toEqual({ slot: 7, occupied: true })
    expect(out.occupied).toBe(true)
    expect(out.recalled).toEqual({ recalled: true, slot: 7 })
    expect(out.program).toBe(MAGENTA)
    expect(out.settings).toMatchObject({ resolution: '640x360', theme: 'ocean' })
    expect(out.settingsUi).toEqual({ resolution: '640x360', theme: 'ocean', canvas: [640, 360] })
    expect(out.user).toEqual({ button: 1, action: 'take:3' })
    expect(out.userNone).toEqual({ button: 2, action: 'none' })
    expect(JSON.parse(out.stored).slice(0, 2)).toEqual(['take:3', null])
    expect(out.read.settings).toMatchObject({ resolution: '640x360', theme: 'ocean' })
    expect(out.read.userButtons.slice(0, 2)).toEqual([{ button: 1, action: 'take:3' }, { button: 2, action: 'none' }])
    expect(out.read.actions).toContainEqual({ id: 'take:3', label: 'Take 3' })
    expect(out.devices.cameras.length).toBeGreaterThan(0)
    expect(Array.isArray(out.devices.audioInputs)).toBe(true)
})

test('a program that names an image it cannot find runs and warns', async ({ page }) => {
    await loadAgent(page)
    const id = 'a'.repeat(64)
    const out = await page.evaluate(async (dsl) => {
        const A = window.HD4Agent
        const check = await A.validateProgram({ dsl })
        const set = await A.setProgram({ dsl, channel: 4 })
        return { check: check.result, ok: set.ok, warnings: set.warnings, read: (await A.getProgram({ channel: 4 })).result }
    }, `search synth\nmedia(url: "image:${id}").write(o0)\nrender(o0)`)
    expect(out.check).toEqual({ valid: true, diagnostics: [] })
    expect(out.ok).toBe(true)
    expect(out.warnings).toEqual([expect.objectContaining({ code: 'IMAGE_UNAVAILABLE', imageIds: [id] })])
    expect(out.read).toMatchObject({ channel: 4, source: 'shader', running: true })
})
