// SPDX-License-Identifier: MIT
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SOURCE_LIBRARY, SHADER_PRESETS, presetByName, presetByDsl } from '../../js/sources/presets.js'

test('the library is organized into named categories', () => {
    assert.deepEqual(SOURCE_LIBRARY.map((c) => c.category), ['Patterns', 'Fills'])
    for (const cat of SOURCE_LIBRARY) {
        assert.ok(cat.items.length > 0)
        for (const item of cat.items) {
            assert.equal(typeof item.name, 'string')
            assert.ok(item.dsl.includes('render(o0)'))
        }
    }
})

test('SHADER_PRESETS flattens the library and lookups work by name/dsl', () => {
    assert.equal(SHADER_PRESETS.length, 12)
    const blue = presetByName('Blue')
    assert.ok(blue && blue.dsl.includes('solid'))
    assert.equal(presetByDsl(blue.dsl).name, 'Blue')
    assert.equal(presetByName('nope'), null)
})
