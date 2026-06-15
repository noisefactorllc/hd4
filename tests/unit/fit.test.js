// SPDX-License-Identifier: MIT
/**
 * Media fit math — how a source of one aspect is placed into the channel
 * frame: "cover" (zoom/crop — fill, crop overflow) or "contain" (scale —
 * fit, letterbox). Pure geometry; the canvas draw that uses it is
 * integration-tested.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeFit } from '../../js/fit.js'

test('cover fills the frame and crops the overflow (4:3 into 16:9)', () => {
    const f = computeFit('cover', 640, 480, 960, 540)
    assert.equal(f.w, 960) // fills width
    assert.equal(f.h, 720) // overflows height (cropped top/bottom)
    assert.equal(f.x, 0)
    assert.equal(f.y, -90)
})

test('contain fits the whole source and letterboxes (4:3 into 16:9)', () => {
    const f = computeFit('contain', 640, 480, 960, 540)
    assert.equal(f.w, 720) // narrower than the frame (pillarbox)
    assert.equal(f.h, 540) // fits height
    assert.equal(f.x, 120)
    assert.equal(f.y, 0)
})

test('a matching-aspect source fills exactly under either mode', () => {
    for (const mode of ['cover', 'contain']) {
        const f = computeFit(mode, 1920, 1080, 960, 540)
        assert.deepEqual([f.x, f.y, f.w, f.h], [0, 0, 960, 540], `${mode}`)
    }
})

test('unknown mode falls back to cover', () => {
    assert.deepEqual(computeFit('wat', 640, 480, 960, 540), computeFit('cover', 640, 480, 960, 540))
})
