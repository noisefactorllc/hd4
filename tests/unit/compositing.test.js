// SPDX-License-Identifier: MIT
/**
 * Composition geometry — the composite layouts (PinP inset rect +
 * source crop, SPLIT regions, QUAD grid) as pure math. The actual canvas
 * draws (shape clipping, borders) are integration-tested; this is the
 * placement arithmetic.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    PINP_SIZES,
    pinpInsetRect,
    pinpSourceCrop,
    splitLayout,
    quadLayout,
} from '../../js/compositing.js'

// --- PinP inset rectangle ---------------------------------------------------

test('PinP 1/2 16:9 inset is centered and half the background width', () => {
    const r = pinpInsetRect({ size: '1/2', hPosition: 0, vPosition: 0, aspect: '16:9' }, 1280, 720)
    assert.deepEqual(r, { x: 320, y: 180, w: 640, h: 360 })
})

test('PinP 1/4 16:9 inset is a quarter-width 16:9 box, centered', () => {
    const r = pinpInsetRect({ size: '1/4', hPosition: 0, vPosition: 0, aspect: '16:9' }, 1280, 720)
    assert.deepEqual(r, { x: 480, y: 270, w: 320, h: 180 })
})

test('PinP 1:1 aspect makes a square inset (height equals width)', () => {
    const r = pinpInsetRect({ size: '1/2', hPosition: 0, vPosition: 0, aspect: '1:1' }, 1280, 720)
    assert.equal(r.w, 640)
    assert.equal(r.h, 640)
    assert.equal(r.x, 320)
    assert.equal(r.y, 40) // (720 - 640) / 2
})

test('PinP position -50 pins to top-left, +50 to bottom-right', () => {
    const base = { size: '1/2', aspect: '16:9' }
    const tl = pinpInsetRect({ ...base, hPosition: -50, vPosition: -50 }, 1280, 720)
    assert.deepEqual([tl.x, tl.y], [0, 0])
    const br = pinpInsetRect({ ...base, hPosition: 50, vPosition: 50 }, 1280, 720)
    assert.deepEqual([br.x, br.y], [640, 360]) // 1280-640, 720-360
})

test('PINP_SIZES exposes the three standard inset fractions', () => {
    assert.equal(PINP_SIZES['1/2'], 0.5)
    assert.equal(PINP_SIZES['1/4'], 0.25)
    assert.ok(Math.abs(PINP_SIZES['1/3'] - 1 / 3) < 1e-9)
})

// --- PinP source crop (zoom into the inset content) -------------------------

test('PinP full crop shows the whole source', () => {
    assert.deepEqual(
        pinpSourceCrop({ hCropping: 100, vCropping: 100, hViewPosition: 0, vViewPosition: 0 }),
        { sx: 0, sy: 0, sw: 1, sh: 1 },
    )
})

test('PinP 50% horizontal crop is centered by default and pans with view position', () => {
    const c = pinpSourceCrop({ hCropping: 50, vCropping: 100, hViewPosition: 0, vViewPosition: 0 })
    assert.deepEqual(c, { sx: 0.25, sy: 0, sw: 0.5, sh: 1 })
    const left = pinpSourceCrop({ hCropping: 50, vCropping: 100, hViewPosition: -50, vViewPosition: 0 })
    assert.equal(left.sx, 0)
    const right = pinpSourceCrop({ hCropping: 50, vCropping: 100, hViewPosition: 50, vViewPosition: 0 })
    assert.equal(right.sx, 0.5)
})

// --- SPLIT layouts ----------------------------------------------------------

test('V.STRETCH splits into left/right halves filling each region', () => {
    const s = splitLayout('v-stretch', {}, 1280, 720)
    assert.equal(s.divider, 'v')
    assert.deepEqual(s.a.dest, { x: 0, y: 0, w: 640, h: 720 })
    assert.deepEqual(s.b.dest, { x: 640, y: 0, w: 640, h: 720 })
    assert.deepEqual(s.a.crop, { sx: 0, sy: 0, sw: 1, sh: 1 }) // stretched: whole source
    assert.deepEqual(s.b.crop, { sx: 0, sy: 0, sw: 1, sh: 1 })
})

test('V.CENTER keeps source aspect by cropping the sides, panning with A/B centers', () => {
    const s = splitLayout('v-center', { aCenter: 50, bCenter: 50, centerPosition: 0 }, 1280, 720)
    assert.equal(s.divider, 'v')
    assert.deepEqual(s.a.dest, { x: 0, y: 0, w: 640, h: 720 })
    // dest AR 640/720 < source AR 1280/720 → crop width to half, full height
    assert.ok(Math.abs(s.a.crop.sw - 0.5) < 1e-9)
    assert.equal(s.a.crop.sh, 1)
    assert.ok(Math.abs(s.a.crop.sx - 0.25) < 1e-9) // centered
    // A-CENTER 0 pans left, 100 pans right
    const left = splitLayout('v-center', { aCenter: 0, bCenter: 50, centerPosition: 0 }, 1280, 720)
    assert.equal(left.a.crop.sx, 0)
    const right = splitLayout('v-center', { aCenter: 100, bCenter: 50, centerPosition: 0 }, 1280, 720)
    assert.ok(Math.abs(right.a.crop.sx - 0.5) < 1e-9)
})

test('SPLIT CENTER POSITION moves the boundary', () => {
    const s = splitLayout('v-center', { aCenter: 50, bCenter: 50, centerPosition: 25 }, 1280, 720)
    assert.equal(s.a.dest.w, 960) // 1280 * (0.5 + 0.25)
    assert.equal(s.b.dest.x, 960)
    assert.equal(s.b.dest.w, 320)
})

test('H.CENTER splits top/bottom and crops height to keep aspect', () => {
    const s = splitLayout('h-center', { aCenter: 50, bCenter: 50, centerPosition: 0 }, 1280, 720)
    assert.equal(s.divider, 'h')
    assert.deepEqual(s.a.dest, { x: 0, y: 0, w: 1280, h: 360 })
    assert.deepEqual(s.b.dest, { x: 0, y: 360, w: 1280, h: 360 })
    assert.ok(Math.abs(s.a.crop.sh - 0.5) < 1e-9)
    assert.equal(s.a.crop.sw, 1)
    assert.ok(Math.abs(s.a.crop.sy - 0.25) < 1e-9)
})

// --- QUAD -------------------------------------------------------------------

test('QUAD is a 2x2 grid of the four channels', () => {
    const q = quadLayout(1280, 720)
    assert.equal(q.length, 4)
    assert.deepEqual(q[0], { channel: 1, x: 0, y: 0, w: 640, h: 360 })
    assert.deepEqual(q[1], { channel: 2, x: 640, y: 0, w: 640, h: 360 })
    assert.deepEqual(q[2], { channel: 3, x: 0, y: 360, w: 640, h: 360 })
    assert.deepEqual(q[3], { channel: 4, x: 640, y: 360, w: 640, h: 360 })
})
