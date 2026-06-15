// SPDX-License-Identifier: MIT
/**
 * Keyer math — KEY compositing. keyAlpha() decides a pixel's opacity
 * (0 = keyed out / transparent, 255 = opaque foreground) for chroma keying
 * (blue/green extraction) and luminance keying (black/white). LEVEL sets how
 * aggressively the colour is extracted; GAIN softens the edge. applyKey()
 * runs the same math over an ImageData-shaped buffer.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keyAlpha, applyKey, KEY_DEFAULTS } from '../../js/key.js'

const D = KEY_DEFAULTS

test('green chroma key: pure green is removed, other colours stay opaque', () => {
    const cfg = { ...D, type: 'chroma', chromaColor: 'green' }
    assert.equal(keyAlpha(0, 255, 0, cfg), 0) // pure green → transparent
    assert.equal(keyAlpha(255, 0, 0, cfg), 255) // red → opaque
    assert.equal(keyAlpha(255, 255, 255, cfg), 255) // white → opaque
    assert.equal(keyAlpha(200, 150, 120, cfg), 255) // skin → opaque
})

test('green chroma key removes a realistic green-screen colour', () => {
    const cfg = { ...D, type: 'chroma', chromaColor: 'green' }
    assert.equal(keyAlpha(60, 180, 75, cfg), 0)
})

test('blue chroma key removes blue, not green', () => {
    const cfg = { ...D, type: 'chroma', chromaColor: 'blue' }
    assert.equal(keyAlpha(0, 0, 255, cfg), 0) // blue → transparent
    assert.equal(keyAlpha(0, 255, 0, cfg), 255) // green → opaque under a blue key
})

test('higher LEVEL extracts more (a borderline pixel becomes transparent)', () => {
    const px = [90, 150, 95] // mildly green
    const low = keyAlpha(...px, { ...D, type: 'chroma', chromaColor: 'green', level: 0 })
    const high = keyAlpha(...px, { ...D, type: 'chroma', chromaColor: 'green', level: 255 })
    assert.ok(high < low, `expected more extraction at high level (low=${low}, high=${high})`)
    assert.equal(high, 0)
})

test('GAIN softens the edge: a near-threshold pixel is binary at gain 0, partial when wide', () => {
    const px = [70, 150, 80] // keyness sits just under the default threshold
    const hard = keyAlpha(...px, { ...D, type: 'chroma', chromaColor: 'green', gain: 0 })
    const soft = keyAlpha(...px, { ...D, type: 'chroma', chromaColor: 'green', gain: 255 })
    assert.ok(hard === 0 || hard === 255, `hard edge should be binary (got ${hard})`)
    assert.ok(soft > 0 && soft < 255, `wide gain should give a partial alpha (got ${soft})`)
})

test('luma key (white) removes bright pixels, keeps dark ones', () => {
    const cfg = { ...D, type: 'luma', lumaColor: 'white' }
    assert.equal(keyAlpha(255, 255, 255, cfg), 0) // white → transparent
    assert.equal(keyAlpha(0, 0, 0, cfg), 255) // black → opaque
    assert.equal(keyAlpha(128, 128, 128, cfg), 255) // mid grey → opaque (only bright keyed)
})

test('luma key (black) removes dark pixels, keeps bright ones', () => {
    const cfg = { ...D, type: 'luma', lumaColor: 'black' }
    assert.equal(keyAlpha(0, 0, 0, cfg), 0) // black → transparent
    assert.equal(keyAlpha(255, 255, 255, cfg), 255) // white → opaque
})

test('applyKey writes the alpha channel over an ImageData buffer, leaving RGB intact', () => {
    // two pixels: green (keyed) then red (kept)
    const img = { width: 2, height: 1, data: new Uint8ClampedArray([0, 255, 0, 255, 255, 0, 0, 255]) }
    applyKey(img, { ...D, type: 'chroma', chromaColor: 'green' })
    assert.equal(img.data[3], 0) // green pixel alpha → 0
    assert.equal(img.data[7], 255) // red pixel alpha → 255
    assert.deepEqual([...img.data.slice(0, 3)], [0, 255, 0]) // RGB untouched
    assert.deepEqual([...img.data.slice(4, 7)], [255, 0, 0])
})

test('KEY_DEFAULTS match the factory defaults (chroma green, level 64)', () => {
    assert.equal(KEY_DEFAULTS.type, 'chroma')
    assert.equal(KEY_DEFAULTS.chromaColor, 'green')
    assert.equal(KEY_DEFAULTS.level, 64)
})
