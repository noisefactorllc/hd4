// SPDX-License-Identifier: MIT
/**
 * Settings — persisted global config (output resolution, output-fade time,
 * beat sensitivity, theme). Injected storage so the round-trip is
 * unit-tested; the drawer UI is integration.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Settings, SETTINGS_DEFAULTS, parseResolution } from '../../js/settings.js'

function fakeStorage(init = {}) {
    const m = new Map(Object.entries(init))
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
    }
}

test('starts from defaults', () => {
    const s = new Settings(fakeStorage())
    assert.equal(s.get('resolution'), SETTINGS_DEFAULTS.resolution)
    assert.equal(s.get('theme'), 'neutral-dark')
    assert.equal(s.get('outputFadeTime'), 0.5)
    assert.equal(s.get('beatSensitivity'), 1.4)
})

test('set() persists and reloads', () => {
    const storage = fakeStorage()
    const s = new Settings(storage)
    s.set('resolution', '1920x1080')
    s.set('theme', 'ocean')
    const s2 = new Settings(storage)
    assert.equal(s2.get('resolution'), '1920x1080')
    assert.equal(s2.get('theme'), 'ocean')
    // unset keys still fall back to defaults
    assert.equal(s2.get('outputFadeTime'), 0.5)
})

test('corrupt storage falls back to defaults', () => {
    const storage = fakeStorage({ 'hd4.settings.v1': '{bad json' })
    const s = new Settings(storage)
    assert.equal(s.get('resolution'), SETTINGS_DEFAULTS.resolution)
})

test('all() returns a copy', () => {
    const s = new Settings(fakeStorage())
    const a = s.all()
    a.resolution = 'mutated'
    assert.equal(s.get('resolution'), SETTINGS_DEFAULTS.resolution)
})

test('parseResolution splits WxH into numbers', () => {
    assert.deepEqual(parseResolution('1920x1080'), { width: 1920, height: 1080 })
    assert.deepEqual(parseResolution('640x360'), { width: 640, height: 360 })
})
