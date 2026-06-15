// SPDX-License-Identifier: MIT
/**
 * Keyboard map — pure key→action lookup for the mixer shortcuts. The
 * action dispatch and the typing-in-a-field guard are integration; the
 * mapping is unit-tested.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keyToAction } from '../../js/keyboard.js'

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
