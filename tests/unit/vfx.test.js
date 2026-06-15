// SPDX-License-Identifier: MIT
/**
 * VFX registry — output filter effects ([VFX]) expressed as CSS
 * canvas-filter strings the program compositor applies to the composited
 * frame. Pure data + lookup; the application is integration-tested.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VFX, VFX_ORDER, vfxFilter } from '../../js/vfx.js'

test('vfxFilter maps known effects to canvas filter strings', () => {
    assert.equal(vfxFilter('none'), 'none')
    assert.equal(vfxFilter('negative'), 'invert(1)')
    assert.equal(vfxFilter('mono'), 'grayscale(1)')
})

test('richer effects reference inline SVG filters', () => {
    assert.equal(vfxFilter('posterize'), 'url(#hd4-vfx-posterize)')
    assert.equal(vfxFilter('emboss'), 'url(#hd4-vfx-emboss)')
    assert.equal(vfxFilter('edges'), 'url(#hd4-vfx-edge)')
})

test('vfxFilter falls back to none for unknown effects', () => {
    assert.equal(vfxFilter('hologram'), 'none')
    assert.equal(vfxFilter(undefined), 'none')
})

test('VFX_ORDER lists none first and only known effects', () => {
    assert.equal(VFX_ORDER[0], 'none')
    for (const name of VFX_ORDER) assert.ok(VFX[name], `${name} is a registered effect`)
})

test('every VFX entry has a label and a filter', () => {
    for (const [name, def] of Object.entries(VFX)) {
        assert.equal(typeof def.label, 'string', `${name} label`)
        assert.equal(typeof def.filter, 'string', `${name} filter`)
    }
})
