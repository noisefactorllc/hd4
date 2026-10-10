// SPDX-License-Identifier: MIT
/**
 * Multiview — the source→selection sync (setSelectValue). A channel showing
 * a captured still selects the picker's Still capture option (value `still`);
 * an image loaded from a file selects Image file… (value `image`). The two
 * are told apart the way the source model tells them apart: a still names
 * its stored copy by stillId, a file image does not.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setSelectValue } from '../../js/ui/multiview.js'
import { createSource } from '../../js/sources/sourceModel.js'

const STILL_ID = 'c'.repeat(64)

/** A minimal select: the option values the picker would hold. */
function fakeSelect(values) {
    return {
        options: values.map((value) => ({ value })),
        value: '',
        title: '',
        selectedOptions: [],
    }
}

const PICKER = ['camera', 'video', 'image', 'still', 'shader:Color Bars']

test('an image source that names a still by id selects the Still capture option', () => {
    const select = fakeSelect(PICKER)
    setSelectValue(select, createSource('image', { name: 'Still', url: 'data:image/png;base64,AA==', stillId: STILL_ID }))
    assert.equal(select.value, 'still')
})

test('a restored still (id only, no url) selects the Still capture option', () => {
    const select = fakeSelect(PICKER)
    setSelectValue(select, createSource('image', { name: 'Still', stillId: STILL_ID }))
    assert.equal(select.value, 'still')
})

test('an image file (a name, no stillId) selects Image file…', () => {
    const select = fakeSelect(PICKER)
    setSelectValue(select, createSource('image', { name: 'photo.png', url: 'img/testcard.png' }))
    assert.equal(select.value, 'image')
})

test('an image named Still without a stillId is a file image, not a capture', () => {
    const select = fakeSelect(PICKER)
    setSelectValue(select, createSource('image', { name: 'Still', url: 'img/testcard.png' }))
    assert.equal(select.value, 'image')
})

test('a video file selects the video option and a camera the camera option', () => {
    const select = fakeSelect(PICKER)
    setSelectValue(select, createSource('video', { name: 'clip.mp4' }))
    assert.equal(select.value, 'video')
    setSelectValue(select, createSource('camera'))
    assert.equal(select.value, 'camera')
})

test('a shader source selects its library entry by name', () => {
    const select = fakeSelect(PICKER)
    setSelectValue(select, createSource('shader', { dsl: 'search synth\ntestPattern(pattern: colorBars).write(o0)\nrender(o0)', name: 'Color Bars' }))
    assert.equal(select.value, 'shader:Color Bars')
})
