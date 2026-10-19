// SPDX-License-Identifier: MIT
/**
 * Program paste — clipboard text → a channel's shader source (pastedSource),
 * and the guard that decides whether a paste event loads a program
 * (attachProgramPaste).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CUSTOM_PROGRAM_NAME, attachProgramPaste, isTextEntry, pastedSource } from '../../js/programPaste.js'
import { presetByName } from '../../js/sources/presets.js'

const MAGENTA = 'search synth\nsolid(color: #ff00ff).write(o0)\nrender(o0)'
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

/** A paste event target that records its listeners. */
function fakeTarget() {
    const listeners = new Set()
    return {
        addEventListener(type, fn) { if (type === 'paste') listeners.add(fn) },
        removeEventListener(type, fn) { if (type === 'paste') listeners.delete(fn) },
        get count() { return listeners.size },
        paste(text, { target = { tagName: 'BODY' }, path = null, defaultPrevented = false } = {}) {
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
