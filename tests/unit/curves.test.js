// SPDX-License-Identifier: MIT
/**
 * Fade curves — the easing applied to MIX dissolves, WIPEs, and OUTPUT
 * FADE (matches visualize's FADE_CURVES). Pure; the compositor applies
 * them.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CURVES, CURVE_ORDER, curveFn } from '../../js/curves.js'

const close = (a, b, e = 1e-9) => Math.abs(a - b) <= e

test('linear is the identity', () => {
    assert.equal(curveFn('linear')(0), 0)
    assert.equal(curveFn('linear')(0.5), 0.5)
    assert.equal(curveFn('linear')(1), 1)
})

test('dipped is a cosine ease-in-out', () => {
    const f = curveFn('dipped')
    assert.ok(close(f(0), 0))
    assert.ok(close(f(0.5), 0.5))
    assert.ok(close(f(1), 1))
    assert.ok(f(0.25) < 0.25) // eases in slowly
})

test('sharp accelerates through the middle', () => {
    const f = curveFn('sharp')
    assert.ok(close(f(0.25), 0.125))
    assert.ok(close(f(0.5), 0.5))
    assert.ok(close(f(0.75), 0.875))
})

test('cut holds until the very end', () => {
    const f = curveFn('cut')
    assert.equal(f(0), 0)
    assert.equal(f(0.99), 0)
    assert.equal(f(1), 1)
})

test('an unknown curve falls back to linear', () => {
    assert.equal(curveFn('bogus')(0.3), 0.3)
})

test('CURVE_ORDER lists the registered curves, linear first', () => {
    assert.equal(CURVE_ORDER[0], 'linear')
    for (const name of CURVE_ORDER) assert.equal(typeof CURVES[name], 'function')
})
