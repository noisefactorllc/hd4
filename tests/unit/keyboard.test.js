// SPDX-License-Identifier: MIT
/**
 * Keyboard map — pure key→action lookup for the mixer shortcuts, plus the
 * attachKeyboard guard that decides whether a keydown dispatches one.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachKeyboard, keyToAction } from '../../js/keyboard.js'

test('digits 1–4 take that channel', () => {
    assert.deepEqual(keyToAction('1'), { type: 'take', channel: 1 })
    assert.deepEqual(keyToAction('4'), { type: 'take', channel: 4 })
})

test('digits outside 1–4 are not actions', () => {
    assert.equal(keyToAction('5'), null)
    assert.equal(keyToAction('0'), null)
})

test('c/d/w select the transition type (cut/dissolve/wipe)', () => {
    assert.deepEqual(keyToAction('c'), { type: 'transitionType', value: 'cut' })
    assert.deepEqual(keyToAction('d'), { type: 'transitionType', value: 'mix' })
    assert.deepEqual(keyToAction('w'), { type: 'transitionType', value: 'wipe' })
})

test('q/f/b toggle quad / freeze / fade-to-black; a toggles auto', () => {
    assert.deepEqual(keyToAction('q'), { type: 'quad' })
    assert.deepEqual(keyToAction('f'), { type: 'freeze' })
    assert.deepEqual(keyToAction('b'), { type: 'fade' })
    assert.deepEqual(keyToAction('a'), { type: 'auto' })
    assert.deepEqual(keyToAction('s'), { type: 'settings' })
})

test('p toggles PinP and k toggles the key overlay', () => {
    assert.deepEqual(keyToAction('p'), { type: 'pinp' })
    assert.deepEqual(keyToAction('k'), { type: 'key' })
})

test('r toggles recording', () => {
    assert.deepEqual(keyToAction('r'), { type: 'record' })
})

test('the mapping is case-insensitive', () => {
    assert.deepEqual(keyToAction('C'), { type: 'transitionType', value: 'cut' })
    assert.deepEqual(keyToAction('Q'), { type: 'quad' })
})

test('unmapped keys return null', () => {
    assert.equal(keyToAction('x'), null)
    assert.equal(keyToAction('Enter'), null)
    assert.equal(keyToAction(' '), null)
})

// --- attachKeyboard guard ---

/** Minimal EventTarget stand-in that records the keydown listener. */
function fakeTarget() {
    const listeners = {}
    return {
        addEventListener(type, fn) { listeners[type] = fn },
        removeEventListener(type, fn) { if (listeners[type] === fn) delete listeners[type] },
        keydown(e) { listeners.keydown?.(e) },
    }
}

/** Synthetic keydown event, mirroring what a real keydown carries. */
function keyEvent(key, { target = { tagName: 'BODY' }, defaultPrevented = false, mods = {} } = {}) {
    let prevented = defaultPrevented
    return {
        key,
        target,
        defaultPrevented: prevented,
        get preventDefault() {
            return () => { prevented = true; this.defaultPrevented = true }
        },
        metaKey: false, ctrlKey: false, altKey: false,
        ...mods,
    }
}

test('the guard dispatches mapped keys to the matching handler', () => {
    const target = fakeTarget()
    const seen = []
    const teardown = attachKeyboard({ record: () => seen.push('record'), take: (a) => seen.push(a) }, target)
    target.keydown(keyEvent('r'))
    target.keydown(keyEvent('3'))
    assert.deepEqual(seen, ['record', { type: 'take', channel: 3 }])
    teardown()
    target.keydown(keyEvent('r'))
    assert.deepEqual(seen, ['record', { type: 'take', channel: 3 }]) // no dispatch after teardown
})

test('a keydown the focused control consumed (defaultPrevented) does not dispatch', () => {
    const target = fakeTarget()
    const seen = []
    attachKeyboard({ record: () => seen.push('record') }, target)
    // A focused BUTTON whose own handler type-ahead'ed the key and
    // preventDefault()'ed it without stopping propagation.
    const e = keyEvent('r', { target: { tagName: 'BUTTON' }, defaultPrevented: true })
    target.keydown(e)
    assert.deepEqual(seen, [])
})

test('an unconsumed key on a focused BUTTON still dispatches', () => {
    const target = fakeTarget()
    const seen = []
    attachKeyboard({ record: () => seen.push('record') }, target)
    target.keydown(keyEvent('r', { target: { tagName: 'BUTTON' } }))
    assert.deepEqual(seen, ['record'])
})

test('field targets (INPUT/SELECT/TEXTAREA/contentEditable) do not dispatch', () => {
    const target = fakeTarget()
    const seen = []
    attachKeyboard({ record: () => seen.push('record') }, target)
    for (const tag of ['INPUT', 'SELECT', 'TEXTAREA']) {
        target.keydown(keyEvent('r', { target: { tagName: tag } }))
    }
    target.keydown(keyEvent('r', { target: { tagName: 'DIV', isContentEditable: true } }))
    assert.deepEqual(seen, [])
})

test('modifier chords do not dispatch', () => {
    const target = fakeTarget()
    const seen = []
    attachKeyboard({ record: () => seen.push('record') }, target)
    target.keydown(keyEvent('r', { mods: { ctrlKey: true } }))
    target.keydown(keyEvent('r', { mods: { metaKey: true } }))
    target.keydown(keyEvent('r', { mods: { altKey: true } }))
    assert.deepEqual(seen, [])
})

test('while suspended (an overlay is open) no shortcut dispatches', () => {
    const target = fakeTarget()
    const seen = []
    let open = true
    attachKeyboard({ record: () => seen.push('record') }, target, { isSuspended: () => open })
    target.keydown(keyEvent('r'))
    target.keydown(keyEvent('s'))
    assert.deepEqual(seen, [])
    open = false
    target.keydown(keyEvent('r'))
    assert.deepEqual(seen, ['record'])
})
