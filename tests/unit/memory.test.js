// SPDX-License-Identifier: MIT
/**
 * Memory — 8-slot save/recall of the full mixer state.
 * The slot store (injected storage) and the snapshot capture/apply are
 * pure and unit-tested; the live re-application is integration-tested.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore, captureSnapshot, applySnapshot, MEMORY_SLOTS } from '../../js/memory.js'

function fakeStorage() {
    const m = new Map()
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        _map: m,
    }
}

const sampleModulesForCapture = () => ({
    channels: [
        { serialize: () => ({ type: 'shader', dsl: 'noise().write(o0)', name: 'Noise' }) },
        { serialize: () => ({ type: 'camera', deviceId: 'cam-1' }) },
    ],
    switcher: { live: 2, type: 'wipe', time: 1.5 },
    output: { vfx: 'mono' },
    compositor: { snapshot: () => ({ composition: 'quad', key: { on: true } }) },
    audio: {
        faderOf: (i) => [0.5, 0.6][i],
        isMuted: (i) => [false, true][i],
        isSoloed: (i) => [true, false][i],
        mainFader: () => 0.8,
    },
})

test('MemoryStore round-trips a snapshot through injected storage', () => {
    const store = new MemoryStore(fakeStorage())
    const snap = { version: 1, switcher: { live: 3 } }
    store.save(2, snap)
    assert.deepEqual(store.load(2), snap)
})

test('loading an empty slot returns null; has() reflects occupancy', () => {
    const store = new MemoryStore(fakeStorage())
    assert.equal(store.load(5), null)
    assert.equal(store.has(5), false)
    store.save(5, { version: 1 })
    assert.equal(store.has(5), true)
})

test('clear() empties a slot; list() reports occupied slots', () => {
    const store = new MemoryStore(fakeStorage())
    store.save(1, { version: 1 })
    store.save(4, { version: 1 })
    assert.deepEqual(store.list(), [1, 4])
    store.clear(1)
    assert.deepEqual(store.list(), [4])
})

test('loading corrupt data returns null instead of throwing', () => {
    const storage = fakeStorage()
    storage.setItem('hd4.memory.3', '{not json')
    const store = new MemoryStore(storage)
    assert.equal(store.load(3), null)
})

test('there are 8 memory slots', () => {
    assert.equal(MEMORY_SLOTS, 8)
})

test('captureSnapshot records channels, switcher, output, and audio', () => {
    const snap = captureSnapshot(sampleModulesForCapture())
    assert.equal(snap.version, 1)
    assert.deepEqual(snap.channels, [
        { type: 'shader', dsl: 'noise().write(o0)', name: 'Noise' },
        { type: 'camera', deviceId: 'cam-1' },
    ])
    assert.deepEqual(snap.switcher, { live: 2, type: 'wipe', time: 1.5 })
    assert.deepEqual(snap.output, { vfx: 'mono' })
    assert.deepEqual(snap.composition, { composition: 'quad', key: { on: true } })
    assert.deepEqual(snap.audio, {
        channels: [
            { fader: 0.5, muted: false, soloed: true },
            { fader: 0.6, muted: true, soloed: false },
        ],
        main: 0.8,
    })
})

test('applySnapshot drives the live modules with the saved values', () => {
    const calls = []
    const modules = {
        channels: [
            { restore: (s) => calls.push(['restore', 0, s.type]) },
            { restore: (s) => calls.push(['restore', 1, s.type]) },
        ],
        switcher: {
            setType: (t) => calls.push(['setType', t]),
            setTime: (s) => calls.push(['setTime', s]),
            cut: (n) => calls.push(['cut', n]),
        },
        output: {
            setVfx: (v) => calls.push(['setVfx', v]),
        },
        compositor: {
            restore: (c) => calls.push(['restore-comp', c?.composition]),
        },
        audio: {
            setFader: (i, p) => calls.push(['setFader', i, p]),
            setMute: (i, b) => calls.push(['setMute', i, b]),
            setSolo: (i, b) => calls.push(['setSolo', i, b]),
            setMainFader: (p) => calls.push(['setMainFader', p]),
        },
    }
    const snap = captureSnapshot(sampleModulesForCapture())
    applySnapshot(snap, modules)

    assert.ok(calls.some((c) => c[0] === 'restore' && c[1] === 1 && c[2] === 'camera'))
    assert.ok(calls.some((c) => c[0] === 'setType' && c[1] === 'wipe'))
    assert.ok(calls.some((c) => c[0] === 'setTime' && c[1] === 1.5))
    assert.ok(calls.some((c) => c[0] === 'cut' && c[1] === 2))
    assert.ok(calls.some((c) => c[0] === 'restore-comp' && c[1] === 'quad'))
    assert.ok(calls.some((c) => c[0] === 'setVfx' && c[1] === 'mono'))
    assert.ok(calls.some((c) => c[0] === 'setFader' && c[1] === 1 && c[2] === 0.6))
    assert.ok(calls.some((c) => c[0] === 'setMute' && c[1] === 1 && c[2] === true))
    assert.ok(calls.some((c) => c[0] === 'setSolo' && c[1] === 0 && c[2] === true))
    assert.ok(calls.some((c) => c[0] === 'setMainFader' && c[1] === 0.8))
})

test('applySnapshot tolerates a null/empty snapshot', () => {
    assert.doesNotThrow(() => applySnapshot(null, {}))
})
