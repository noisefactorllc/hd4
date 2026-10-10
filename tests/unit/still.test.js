// SPDX-License-Identifier: MIT
/**
 * StillStore — the INPUT CAPTURE still. capture() copies a source
 * canvas's pixels into an independent buffer and derives a data URL (so the
 * still survives the source changing), usable as a KEY source and a channel
 * image source. The canvas factory is injected so the copy logic is
 * unit-testable without a real DOM.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StillStore } from '../../js/still.js'

function fakeCanvasFactory() {
    const created = []
    const factory = () => {
        const c = {
            width: 0,
            height: 0,
            drawnFrom: null,
            getContext: () => ({
                clearRect: () => {},
                drawImage: (src) => { c.drawnFrom = src },
            }),
            toDataURL: () => `data:image/png;base64,STILL_${c.width}x${c.height}`,
        }
        created.push(c)
        return c
    }
    factory.created = created
    return factory
}

test('a fresh store has no still', () => {
    const s = new StillStore({ createCanvas: fakeCanvasFactory() })
    assert.equal(s.hasStill, false)
    assert.equal(s.canvas, null)
    assert.equal(s.dataUrl, null)
})

test('capture copies the source into a sized buffer and derives a data URL', () => {
    const factory = fakeCanvasFactory()
    const s = new StillStore({ createCanvas: factory })
    const src = { width: 960, height: 540 }
    const out = s.capture(src)
    assert.equal(s.hasStill, true)
    assert.equal(out.width, 960)
    assert.equal(out.height, 540)
    assert.equal(out.drawnFrom, src) // drew the source into the still buffer
    assert.equal(s.dataUrl, 'data:image/png;base64,STILL_960x540')
})

test('capture ignores an empty source', () => {
    const s = new StillStore({ createCanvas: fakeCanvasFactory() })
    assert.equal(s.capture(null), null)
    assert.equal(s.capture({ width: 0, height: 0 }), null)
    assert.equal(s.hasStill, false)
})

test('re-capturing at the same size reuses the buffer', () => {
    const factory = fakeCanvasFactory()
    const s = new StillStore({ createCanvas: factory })
    s.capture({ width: 960, height: 540 })
    s.capture({ width: 960, height: 540 })
    assert.equal(factory.created.length, 1)
})

test('clear() empties the store', () => {
    const s = new StillStore({ createCanvas: fakeCanvasFactory() })
    s.capture({ width: 100, height: 100 })
    s.clear()
    assert.equal(s.hasStill, false)
    assert.equal(s.canvas, null)
    assert.equal(s.dataUrl, null)
})

test('a capture names no stored copy until its bytes are stored; clear() forgets the id', () => {
    const s = new StillStore({ createCanvas: fakeCanvasFactory() })
    s.stillId = 'c'.repeat(64)
    s.capture({ width: 960, height: 540 })
    assert.equal(s.stillId, null, 'a re-capture is a new still: the old id named the old bytes')
    s.stillId = 'c'.repeat(64)
    s.clear()
    assert.equal(s.stillId, null)
})

test('store() adopts the id of the still it stored', async () => {
    const s = new StillStore({ createCanvas: fakeCanvasFactory() })
    s.capture({ width: 960, height: 540 })
    const id = await s.store((urls) => Promise.resolve(new Map([[urls[0], 'a'.repeat(64)]])))
    assert.equal(id, 'a'.repeat(64))
    assert.equal(s.stillId, 'a'.repeat(64))
})

test('store() with no still stores nothing and resolves null', async () => {
    const s = new StillStore({ createCanvas: fakeCanvasFactory() })
    let calls = 0
    const id = await s.store(() => { calls++; return Promise.resolve(new Map()) })
    assert.equal(id, null)
    assert.equal(calls, 0)
})

test('a store overtaken by a re-capture adopts nothing; the newer run owns the id', async () => {
    const s = new StillStore({ createCanvas: fakeCanvasFactory() })
    s.capture({ width: 960, height: 540 })
    const urlA = s.dataUrl
    let resolveA
    const storeA = s.store(() => new Promise((r) => { resolveA = r }))
    s.capture({ width: 640, height: 360 }) // supersedes A while A's bytes are still committing
    const urlB = s.dataUrl
    let resolveB
    const storeB = s.store(() => new Promise((r) => { resolveB = r }))
    assert.equal(s.stillId, null, 'neither still is stored yet')
    // The newer run commits first, then the stale one settles: the stale run
    // must adopt nothing, or it would strip the newer still's id (and a save
    // would fall back to carrying the still as data-URL text).
    resolveB(new Map([[urlB, 'b'.repeat(64)]]))
    assert.equal(await storeB, 'b'.repeat(64))
    assert.equal(s.stillId, 'b'.repeat(64))
    resolveA(new Map([[urlA, 'a'.repeat(64)]]))
    assert.equal(await storeA, null)
    assert.equal(s.stillId, 'b'.repeat(64), 'the stale run must not name the newer bytes')
})

test('store() resolving after clear() adopts nothing', async () => {
    const s = new StillStore({ createCanvas: fakeCanvasFactory() })
    s.capture({ width: 960, height: 540 })
    const url = s.dataUrl
    let resolveA
    const storeA = s.store(() => new Promise((r) => { resolveA = r }))
    s.clear()
    resolveA(new Map([[url, 'a'.repeat(64)]]))
    assert.equal(await storeA, null)
    assert.equal(s.stillId, null)
})
