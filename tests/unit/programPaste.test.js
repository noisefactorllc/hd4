// SPDX-License-Identifier: MIT
/**
 * Program paste — clipboard text → a channel's shader source (pastedSource),
 * the flow that checks a program before a channel gives up its source
 * (createProgramPaste), and the guard that decides whether a paste event
 * loads a program (attachProgramPaste).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    CUSTOM_PROGRAM_NAME,
    MAX_PROGRAM_LENGTH,
    attachProgramPaste,
    createProgramPaste,
    isTextEntry,
    pastedSource,
} from '../../js/programPaste.js'
import { presetByName } from '../../js/sources/presets.js'
import { Channel } from '../../js/channel.js'
import { createSource } from '../../js/sources/sourceModel.js'
import { makeShaderDriver } from '../../js/sources/shaderSource.js'

const MAGENTA = 'search synth\nsolid(color: #ff00ff).write(o0)\nrender(o0)'
const CYAN = 'search synth\nsolid(color: #00ffff).write(o0)\nrender(o0)'
const parses = () => ({ diagnostics: [] })
const rejects = () => { throw new Error("Expect '(' at line 1 col 7") }

test('a program becomes a shader source named Custom', () => {
    assert.deepEqual(pastedSource(MAGENTA, parses), {
        source: { type: 'shader', dsl: MAGENTA, name: CUSTOM_PROGRAM_NAME },
    })
})

test('surrounding whitespace is trimmed from the program', () => {
    const { source } = pastedSource(`\n  ${MAGENTA}\r\n`, parses)
    assert.equal(source.dsl, MAGENTA)
})

test('a pasted library program keeps its library name', () => {
    const bars = presetByName('Color Bars')
    assert.equal(pastedSource(bars.dsl, parses).source.name, 'Color Bars')
})

test('empty or whitespace-only text is empty, and the parser is not consulted', () => {
    const parse = () => assert.fail('parsed empty text')
    assert.deepEqual(pastedSource('', parse), { error: 'empty' })
    assert.deepEqual(pastedSource(' \n\t ', parse), { error: 'empty' })
    assert.deepEqual(pastedSource(null, parse), { error: 'empty' })
})

test('text over the length limit is refused before it is parsed', () => {
    const parse = () => assert.fail('parsed oversized text')
    assert.deepEqual(pastedSource('x'.repeat(MAX_PROGRAM_LENGTH + 1), parse), { error: 'large' })
    assert.equal(pastedSource('x'.repeat(MAX_PROGRAM_LENGTH), parses).source.dsl.length, MAX_PROGRAM_LENGTH)
})

test('the length limit applies to the program, not the whitespace around it', () => {
    const padded = MAGENTA + ' '.repeat(MAX_PROGRAM_LENGTH)
    assert.equal(pastedSource(padded, parses).source.dsl, MAGENTA)
})

test('text the parser rejects is invalid, with its message', () => {
    assert.deepEqual(pastedSource('hello world', rejects), {
        error: 'invalid',
        message: "Expect '(' at line 1 col 7",
    })
})

test('a program with diagnostics but no parse error is still a source (effects may not be loaded yet)', () => {
    const parse = () => ({ diagnostics: [{ severity: 'error', message: "Unknown effect: 'noise'" }] })
    const dsl = 'search synth, filter\nnoise(seed: 3).bloom().write(o0)\nrender(o0)'
    assert.equal(pastedSource(dsl, parse).source.dsl, dsl)
})

test('text fields take their own paste; other controls do not', () => {
    assert.equal(isTextEntry({ tagName: 'TEXTAREA' }), true)
    assert.equal(isTextEntry({ tagName: 'DIV', isContentEditable: true }), true)
    assert.equal(isTextEntry({ tagName: 'INPUT', type: 'text' }), true)
    assert.equal(isTextEntry({ tagName: 'INPUT', type: 'NUMBER' }), true)
    assert.equal(isTextEntry({ tagName: 'INPUT' }), true) // no type is a text input
    assert.equal(isTextEntry({ tagName: 'INPUT', type: 'range' }), false)
    assert.equal(isTextEntry({ tagName: 'INPUT', type: 'checkbox' }), false)
    assert.equal(isTextEntry({ tagName: 'SELECT' }), false)
    assert.equal(isTextEntry({ tagName: 'BODY' }), false)
    assert.equal(isTextEntry(null), false)
})

/** A document-like paste event target that records its listeners. */
function fakeTarget() {
    const listeners = new Set()
    const presses = new Set()
    const body = { tagName: 'BODY' }
    return {
        body,
        activeElement: body,
        addEventListener(type, fn) { if (type === 'paste') listeners.add(fn); if (type === 'pointerdown') presses.add(fn) },
        removeEventListener(type, fn) { listeners.delete(fn); presses.delete(fn) },
        get count() { return listeners.size + presses.size },
        press(target) { for (const fn of presses) fn({ target }) },
        paste(text, { target = body, path = null, defaultPrevented = false } = {}) {
            const e = {
                target,
                defaultPrevented,
                clipboardData: { getData: (type) => (type === 'text/plain' ? text : '') },
                composedPath: () => path || [target],
                preventDefault() { this.defaultPrevented = true },
            }
            for (const fn of listeners) fn(e)
            return e
        },
    }
}

test('a paste outside a text field loads its text and is consumed', () => {
    const target = fakeTarget()
    const got = []
    attachProgramPaste((text) => got.push(text), target)
    const e = target.paste(MAGENTA)
    assert.deepEqual(got, [MAGENTA])
    assert.equal(e.defaultPrevented, true)
})

test('a paste with a focused select or slider still loads (they take no text)', () => {
    const target = fakeTarget()
    const got = []
    attachProgramPaste((text) => got.push(text), target)
    target.paste('a', { target: { tagName: 'SELECT' } })
    target.paste('b', { target: { tagName: 'INPUT', type: 'range' } })
    assert.deepEqual(got, ['a', 'b'])
})

test('a paste into a text field is left to the field', () => {
    const target = fakeTarget()
    const got = []
    attachProgramPaste((text) => got.push(text), target)
    const e = target.paste(MAGENTA, { target: { tagName: 'TEXTAREA' } })
    assert.deepEqual(got, [])
    assert.equal(e.defaultPrevented, false)
})

test('a paste into a text field inside a shadow root is left to the field', () => {
    const target = fakeTarget()
    const got = []
    attachProgramPaste((text) => got.push(text), target)
    const host = { tagName: 'SLIDER-VALUE' } // the retargeted event.target
    const e = target.paste(MAGENTA, { target: host, path: [{ tagName: 'INPUT', type: 'text' }, host] })
    assert.deepEqual(got, [])
    assert.equal(e.defaultPrevented, false)
})

test('a paste a control already consumed does nothing', () => {
    const target = fakeTarget()
    const got = []
    attachProgramPaste((text) => got.push(text), target)
    target.paste(MAGENTA, { defaultPrevented: true })
    assert.deepEqual(got, [])
})

test('a paste while suspended is left alone', () => {
    const target = fakeTarget()
    const got = []
    let suspended = true
    attachProgramPaste((text) => got.push(text), target, { isSuspended: () => suspended })
    const e = target.paste(MAGENTA)
    assert.deepEqual(got, [])
    assert.equal(e.defaultPrevented, false)
    suspended = false
    target.paste(MAGENTA)
    assert.deepEqual(got, [MAGENTA])
})

test('a paste with no text loads empty text (pastedSource reports it)', () => {
    const target = fakeTarget()
    const got = []
    attachProgramPaste((text) => got.push(text), target)
    target.paste('')
    assert.deepEqual(got, [''])
})

test('the teardown removes the listener', () => {
    const target = fakeTarget()
    const detach = attachProgramPaste(() => {}, target)
    assert.equal(target.count, 1)
    detach()
    assert.equal(target.count, 0)
})

// --- createProgramPaste: the flow against a real Channel and shader driver ---

const COLOR_BARS = presetByName('Color Bars')

function deferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

/**
 * A ChannelRenderer stand-in. check() and compile() answer from the
 * handlers given (default: the program is fine), recording each call.
 */
function fakeRenderer({ check = async () => null, compile = async () => ({ success: true }) } = {}) {
    return {
        checks: [],
        compiles: [],
        check(dsl) { this.checks.push(dsl); return check(dsl) },
        compile(dsl) { this.compiles.push(dsl); return compile(dsl) },
    }
}

/** One channel already showing Color Bars, wired to a paste flow. */
async function setup(rendererOptions, { clipboard = null } = {}) {
    const renderer = fakeRenderer(rendererOptions)
    const channel = new Channel({ id: 1, canvas: {}, driverFactory: (source) => makeShaderDriver(source, renderer) })
    await channel.setSource(createSource('shader', { dsl: COLOR_BARS.dsl, name: COLOR_BARS.name }))
    renderer.compiles.length = 0
    const reports = []
    let refreshes = 0
    const flow = createProgramPaste({
        channels: [channel],
        renderers: [renderer],
        parse: (dsl) => { if (!dsl.startsWith('search')) throw new Error('not a program') },
        report: (value) => reports.push(value),
        refresh: () => { refreshes++ },
        clipboard,
    })
    return { channel, renderer, flow, reports, refreshes: () => refreshes }
}

test('a program that passes both checks goes on the channel and reports CH n', async () => {
    const t = await setup()
    await t.flow.paste(0, MAGENTA)
    assert.deepEqual(t.channel.source, { type: 'shader', dsl: MAGENTA, name: 'Custom' })
    assert.deepEqual(t.renderer.checks, [MAGENTA])
    assert.deepEqual(t.renderer.compiles, [MAGENTA])
    assert.deepEqual(t.reports, ['CH 1'])
    assert.equal(t.refreshes(), 1)
})

test('empty, oversized and unparsable text are reported and never checked', async () => {
    const t = await setup()
    const before = t.channel.source
    await t.flow.paste(0, '  ')
    await t.flow.paste(0, 'x'.repeat(MAX_PROGRAM_LENGTH + 1))
    await t.flow.paste(0, 'hello world')
    assert.deepEqual(t.reports, ['EMPTY', 'TOO BIG', 'INVALID'])
    assert.deepEqual(t.renderer.checks, [])
    assert.equal(t.channel.source, before)
    assert.equal(t.refreshes(), 3)
})

test('a program the renderer check rejects never touches the channel', async () => {
    const t = await setup({ check: async () => "Unknown effect: 'notAnEffect'" })
    const before = t.channel.source
    const driver = t.channel.driver
    await t.flow.paste(0, MAGENTA)
    assert.deepEqual(t.reports, ['INVALID'])
    assert.equal(t.channel.source, before)
    assert.equal(t.channel.driver, driver) // not restarted
    assert.deepEqual(t.renderer.compiles, [])
})

test('effects that fail to load report FAILED and leave the channel alone', async () => {
    const t = await setup({ check: async () => { throw new Error('network') } })
    const before = t.channel.source
    await t.flow.paste(0, MAGENTA)
    assert.deepEqual(t.reports, ['FAILED'])
    assert.equal(t.channel.source, before)
})

test('a choice made while the check waits wins, and the paste gives up quietly', async () => {
    const checked = deferred()
    const t = await setup({ check: () => checked.promise })
    const pasting = t.flow.paste(0, MAGENTA)
    const grid = createSource('shader', { dsl: presetByName('Grid').dsl, name: 'Grid' })
    await t.channel.setSource(grid)
    checked.resolve(null)
    await pasting
    assert.equal(t.channel.source, grid)
    assert.deepEqual(t.reports, [])
    assert.deepEqual(t.renderer.compiles, [grid.dsl])
})

test('a failed check that a newer choice overtook reports nothing', async () => {
    const checked = deferred()
    const t = await setup({ check: () => checked.promise })
    const pasting = t.flow.paste(0, MAGENTA)
    await t.channel.setSource(createSource('shader', { dsl: presetByName('Grid').dsl, name: 'Grid' }))
    checked.reject(new Error('network'))
    await pasting
    assert.deepEqual(t.reports, [])
})

test('a program that passes the check but fails to compile falls back and reports INVALID', async () => {
    const t = await setup({ compile: async (dsl) => (dsl === MAGENTA ? { success: false, error: 'GPU' } : { success: true }) })
    const before = t.channel.source
    await t.flow.paste(0, MAGENTA)
    assert.deepEqual(t.reports, ['INVALID'])
    assert.equal(t.channel.source, before)
    assert.deepEqual(t.renderer.compiles, [MAGENTA, COLOR_BARS.dsl])
})

test('a paste whose compile a newer choice overtook reports nothing', async () => {
    const compiled = deferred()
    const t = await setup({ compile: (dsl) => (dsl === MAGENTA ? compiled.promise : Promise.resolve({ success: true })) })
    const pasting = t.flow.paste(0, MAGENTA)
    await new Promise((r) => setImmediate(r)) // the check passes; the compile starts
    assert.deepEqual(t.renderer.compiles, [MAGENTA])
    const grid = createSource('shader', { dsl: presetByName('Grid').dsl, name: 'Grid' })
    await t.channel.setSource(grid)
    compiled.resolve({ success: false, superseded: true }) // as ChannelRenderer drops it
    await pasting
    assert.equal(t.channel.source, grid)
    assert.deepEqual(t.reports, [])
})

test('Paste program reads the clipboard into the channel', async () => {
    const t = await setup({}, { clipboard: { readText: async () => MAGENTA } })
    await t.flow.pasteFromClipboard(0)
    assert.equal(t.channel.source.dsl, MAGENTA)
    assert.deepEqual(t.reports, ['CH 1'])
})

test('a clipboard read that is refused, or no clipboard at all, reports DENIED', async () => {
    const refused = await setup({}, { clipboard: { readText: async () => { throw new DOMException('denied', 'NotAllowedError') } } })
    await refused.flow.pasteFromClipboard(0)
    assert.deepEqual(refused.reports, ['DENIED'])
    assert.equal(refused.refreshes(), 1)

    const none = await setup({}, { clipboard: undefined })
    await none.flow.pasteFromClipboard(0)
    assert.deepEqual(none.reports, ['DENIED'])
})

test('the newest paste wins when an older one finishes its check later', async () => {
    const slow = deferred()
    const t = await setup({ check: (dsl) => (dsl === MAGENTA ? slow.promise : Promise.resolve(null)) })
    const older = t.flow.paste(0, MAGENTA)
    await t.flow.paste(0, CYAN)
    slow.resolve(null)
    await older
    assert.equal(t.channel.source.dsl, CYAN)
    assert.deepEqual(t.reports, ['CH 1'])
})

test('the newest paste wins when an older one finishes its check first', async () => {
    const slow = deferred()
    const t = await setup({ check: (dsl) => (dsl === CYAN ? slow.promise : Promise.resolve(null)) })
    const older = t.flow.paste(0, MAGENTA)
    const newer = t.flow.paste(0, CYAN)
    await older // its check passed, but a newer paste was made: it gives up
    assert.equal(t.channel.source.dsl, COLOR_BARS.dsl)
    slow.resolve(null)
    await newer
    assert.equal(t.channel.source.dsl, CYAN)
    assert.deepEqual(t.reports, ['CH 1'])
    assert.deepEqual(t.renderer.compiles, [CYAN])
})

// --- attachProgramPaste with a scope: the rack, where HD4 shares the page ---

/** A rack slot: contains() answers for the elements inside it. */
function fakeScope(...inside) {
    const set = new Set(inside)
    return { contains: (el) => set.has(el) }
}

test('in a scope, a paste aimed inside it loads', () => {
    const target = fakeTarget()
    const picker = { tagName: 'SELECT' }
    const got = []
    attachProgramPaste((text) => got.push(text), target, { scope: fakeScope(picker) })
    target.activeElement = picker
    target.paste('a', { target: picker })
    assert.deepEqual(got, ['a'])
})

test('in a scope, a paste aimed at another module is left to the page', () => {
    const target = fakeTarget()
    const other = { tagName: 'BUTTON' }
    const got = []
    attachProgramPaste((text) => got.push(text), target, { scope: fakeScope() })
    target.press(other)
    target.activeElement = other
    const e = target.paste('a', { target: other })
    assert.deepEqual(got, [])
    assert.equal(e.defaultPrevented, false)
})

test('in a scope, a paste with nothing focused loads only after a press inside it', () => {
    const target = fakeTarget()
    const monitor = { tagName: 'CANVAS' }
    const elsewhere = { tagName: 'DIV' }
    const got = []
    attachProgramPaste((text) => got.push(text), target, { scope: fakeScope(monitor) })
    target.paste('before any press')
    target.press(monitor)
    target.paste('after a press inside')
    // Chromium aims a paste with nothing focused at the selection: focus decides.
    target.paste('aimed at the selection', { target: elsewhere })
    target.press(elsewhere)
    target.paste('after a press elsewhere')
    assert.deepEqual(got, ['after a press inside', 'aimed at the selection'])
})

test('in a scope, a press inside does not take a paste focused on another module', () => {
    const target = fakeTarget()
    const monitor = { tagName: 'CANVAS' }
    const other = { tagName: 'BUTTON' }
    const got = []
    attachProgramPaste((text) => got.push(text), target, { scope: fakeScope(monitor) })
    target.press(monitor)
    target.activeElement = other // tabbed away without a press
    target.paste('a', { target: other })
    assert.deepEqual(got, [])
})

test('the scoped teardown removes the press listener too', () => {
    const target = fakeTarget()
    const detach = attachProgramPaste(() => {}, target, { scope: fakeScope() })
    assert.equal(target.count, 2)
    detach()
    assert.equal(target.count, 0)
})
