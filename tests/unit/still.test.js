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
