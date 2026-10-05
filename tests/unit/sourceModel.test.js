// SPDX-License-Identifier: MIT
/**
 * Source model — the pure description of what a channel is showing.
 * A channel's source is one of: none, camera, video (file), image
 * (file), or shader (Noisemaker DSL). This module is DOM-free and
 * fully unit-tested; the runtime drivers that actually pump pixels
 * live elsewhere and are integration-tested.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    createSource,
    EMPTY_SOURCE,
    sourceKind,
    sourceLabel,
    serializeSource,
    deserializeSource,
    isStillId,
} from '../../js/sources/sourceModel.js'

const STILL_ID = 'ab'.repeat(32)

test('EMPTY_SOURCE is an empty source', () => {
    assert.equal(EMPTY_SOURCE.type, 'none')
    assert.equal(sourceKind(EMPTY_SOURCE), 'empty')
    assert.equal(sourceLabel(EMPTY_SOURCE), '—')
})

test('createSource("none") returns an empty source', () => {
    const s = createSource('none')
    assert.deepEqual(s, { type: 'none' })
})

test('camera source carries its deviceId and is media-kind', () => {
    const s = createSource('camera', { deviceId: 'cam-abc' })
    assert.equal(s.type, 'camera')
    assert.equal(s.deviceId, 'cam-abc')
    assert.equal(sourceKind(s), 'media')
    assert.equal(sourceLabel(s), 'Camera')
})

test('camera source defaults deviceId to empty (system default device)', () => {
    const s = createSource('camera')
    assert.equal(s.deviceId, '')
})

test('video and image sources are media-kind and label by file name', () => {
    const v = createSource('video', { name: 'clip.mp4' })
    assert.equal(sourceKind(v), 'media')
    assert.equal(sourceLabel(v), 'clip.mp4')

    const i = createSource('image', { name: 'still.png' })
    assert.equal(sourceKind(i), 'media')
    assert.equal(sourceLabel(i), 'still.png')
})

test('shader source carries DSL, is shader-kind, labels by name', () => {
    const s = createSource('shader', { dsl: 'noise().write(o0)\nrender(o0)', name: 'Plasma' })
    assert.equal(s.type, 'shader')
    assert.equal(s.dsl, 'noise().write(o0)\nrender(o0)')
    assert.equal(sourceKind(s), 'shader')
    assert.equal(sourceLabel(s), 'Plasma')
})

test('shader source without a name labels as "Shader"', () => {
    const s = createSource('shader', { dsl: 'render(o0)' })
    assert.equal(sourceLabel(s), 'Shader')
})

test('createSource throws on an unknown type (fail fast in code)', () => {
    assert.throws(() => createSource('hologram'), /unknown source type/i)
})

test('image and video sources can carry a bundled url (e.g. the test card)', () => {
    const i = createSource('image', { name: 'Test Card', url: 'img/testcard.png' })
    assert.equal(i.url, 'img/testcard.png')
    assert.equal(sourceLabel(i), 'Test Card')
    assert.deepEqual(serializeSource(i), { type: 'image', name: 'Test Card', url: 'img/testcard.png' })
    assert.deepEqual(deserializeSource(serializeSource(i)), i)
})

test('serializeSource keeps only persistable identity', () => {
    assert.deepEqual(
        serializeSource(createSource('camera', { deviceId: 'cam-1' })),
        { type: 'camera', deviceId: 'cam-1' },
    )
    assert.deepEqual(
        serializeSource(createSource('shader', { dsl: 'render(o0)', name: 'X' })),
        { type: 'shader', dsl: 'render(o0)', name: 'X' },
    )
})

test('serialize → deserialize round-trips a shader source', () => {
    const s = createSource('shader', { dsl: 'bloom().write(o0)\nrender(o0)', name: 'Bloom' })
    assert.deepEqual(deserializeSource(serializeSource(s)), s)
})

test('deserializeSource is lenient: bad data becomes an empty source', () => {
    assert.deepEqual(deserializeSource(null), EMPTY_SOURCE)
    assert.deepEqual(deserializeSource(undefined), EMPTY_SOURCE)
    assert.deepEqual(deserializeSource('garbage'), EMPTY_SOURCE)
    assert.deepEqual(deserializeSource({ type: 'bogus' }), EMPTY_SOURCE)
    assert.deepEqual(deserializeSource({}), EMPTY_SOURCE)
})

test('deserializeSource drops a shader with no DSL (corrupt) to empty', () => {
    assert.deepEqual(deserializeSource({ type: 'shader' }), EMPTY_SOURCE)
})

test('a stored still persists as its id alone, never a URL', () => {
    const s = createSource('image', { name: 'Still', stillId: STILL_ID })
    assert.equal(s.stillId, STILL_ID)
    assert.equal(sourceKind(s), 'media')
    assert.equal(sourceLabel(s), 'Still')
    assert.deepEqual(serializeSource(s), { type: 'image', name: 'Still', stillId: STILL_ID })
    assert.deepEqual(deserializeSource(serializeSource(s)), s)
})

test('a still id must be a SHA-256 hex digest; anything else is dropped', () => {
    assert.equal(isStillId(STILL_ID), true)
    for (const bad of ['', 'still', 'AB'.repeat(32), 'ab'.repeat(31), 42, null, undefined]) {
        assert.equal(isStillId(bad), false, String(bad))
        assert.equal('stillId' in createSource('image', { name: 'Still', stillId: bad }), false)
    }
    assert.deepEqual(deserializeSource({ type: 'image', name: 'Still', stillId: 'not-an-id' }), { type: 'image', name: 'Still', url: '' })
})
