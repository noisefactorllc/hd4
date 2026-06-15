// SPDX-License-Identifier: MIT
/**
 * Camera device options — pure mapping from enumerateDevices() output to
 * the source picker's camera list (filter video inputs, fall back to a
 * generic label before permission reveals real names). The async
 * enumeration is integration-tested.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cameraOptionsFromDevices } from '../../js/sources/cameras.js'

test('keeps only video inputs', () => {
    const opts = cameraOptionsFromDevices([
        { kind: 'videoinput', deviceId: 'cam-a', label: 'FaceTime HD' },
        { kind: 'audioinput', deviceId: 'mic-a', label: 'Built-in Mic' },
        { kind: 'videoinput', deviceId: 'cam-b', label: 'USB Cam' },
    ])
    assert.deepEqual(opts, [
        { deviceId: 'cam-a', label: 'FaceTime HD' },
        { deviceId: 'cam-b', label: 'USB Cam' },
    ])
})

test('falls back to a generic label when none is reported (pre-permission)', () => {
    const opts = cameraOptionsFromDevices([
        { kind: 'videoinput', deviceId: 'cam-a', label: '' },
        { kind: 'videoinput', deviceId: 'cam-b', label: '' },
    ])
    assert.deepEqual(opts, [
        { deviceId: 'cam-a', label: 'Camera 1' },
        { deviceId: 'cam-b', label: 'Camera 2' },
    ])
})

test('tolerates a non-array input', () => {
    assert.deepEqual(cameraOptionsFromDevices(null), [])
    assert.deepEqual(cameraOptionsFromDevices(undefined), [])
})
