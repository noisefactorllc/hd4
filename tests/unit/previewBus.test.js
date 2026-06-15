// SPDX-License-Identifier: MIT
/**
 * PreviewBus — the PGM/PVW preview selection. A channel is queued on
 * preview, then TAKE/AUTO sends it to program; the bus flip-flops so the
 * outgoing program lands back on preview. Pure; the switcher performs the
 * actual transition.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PreviewBus } from '../../js/previewBus.js'

test('defaults to previewing channel 2', () => {
    assert.equal(new PreviewBus().preview, 2)
})

test('set selects a valid preview channel and clamps out invalid ones', () => {
    const p = new PreviewBus({ channelCount: 4 })
    assert.equal(p.set(3), 3)
    assert.equal(p.preview, 3)
    p.set(9) // out of range → ignored
    assert.equal(p.preview, 3)
    p.set(1.5) // non-integer → ignored
    assert.equal(p.preview, 3)
})

test('take returns the queued preview and flip-flops it to the outgoing program', () => {
    const p = new PreviewBus({ preview: 2 })
    const target = p.take(1) // program 1 is live
    assert.equal(target, 2) // we take the previewed channel (2)
    assert.equal(p.preview, 1) // the outgoing program (1) lands on preview
})

test('take leaves preview unchanged when the live channel is invalid', () => {
    const p = new PreviewBus({ preview: 3 })
    const target = p.take(0)
    assert.equal(target, 3)
    assert.equal(p.preview, 3)
})
