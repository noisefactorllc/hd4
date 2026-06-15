// SPDX-License-Identifier: MIT
/**
 * USER buttons — the assignable macro buttons. The action catalog and
 * the per-slot assignment store are pure (validated, serializable); the app
 * maps each action id to a handler.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UserButtons, USER_ACTIONS, isUserAction, userActionLabel } from '../../js/userButtons.js'

test('the action catalog covers takes, composition, output, and memory', () => {
    const ids = USER_ACTIONS.map((a) => a.id)
    assert.ok(ids.includes('take:1'))
    assert.ok(ids.includes('quad'))
    assert.ok(ids.includes('key'))
    assert.ok(ids.includes('record'))
    assert.ok(ids.includes('mem:1'))
})

test('isUserAction / userActionLabel validate and label ids', () => {
    assert.equal(isUserAction('take:3'), true)
    assert.equal(isUserAction('nope'), false)
    assert.equal(userActionLabel('quad'), 'QUAD')
    assert.equal(userActionLabel('bogus'), null)
})

test('there are five user slots with sensible defaults', () => {
    const u = new UserButtons()
    assert.equal(u.count, 5)
    assert.equal(u.list().length, 5)
    assert.ok(u.list().every((id) => id === null || isUserAction(id)))
})

test('set assigns a valid action and rejects an invalid one', () => {
    const u = new UserButtons()
    u.set(0, 'freeze')
    assert.equal(u.get(0), 'freeze')
    u.set(0, 'not-an-action')
    assert.equal(u.get(0), 'freeze') // unchanged
})

test('a slot can be cleared with null', () => {
    const u = new UserButtons()
    u.set(2, null)
    assert.equal(u.get(2), null)
})

test('serialize / restore round-trips the assignments', () => {
    const u = new UserButtons()
    u.set(0, 'pinp'); u.set(4, 'mem:2')
    const u2 = new UserButtons({ assignments: u.serialize() })
    assert.equal(u2.get(0), 'pinp')
    assert.equal(u2.get(4), 'mem:2')
})

test('restore tolerates junk by keeping only valid ids', () => {
    const u = new UserButtons({ assignments: ['quad', 'garbage', null, 'take:2', 'key'] })
    assert.equal(u.get(0), 'quad')
    assert.equal(u.get(1), null) // junk → cleared
    assert.equal(u.get(3), 'take:2')
})
