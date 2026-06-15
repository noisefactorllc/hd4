// SPDX-License-Identifier: MIT
/**
 * Audio input device options — pure mapping from enumerateDevices() to the
 * per-channel audio-source picker (filter audio inputs, label fallback
 * before permission). The async enumeration is integration-tested.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audioInputOptionsFromDevices } from '../../js/audioDevices.js'

test('keeps only audio inputs', () => {
    const opts = audioInputOptionsFromDevices([
        { kind: 'audioinput', deviceId: 'mic-a', label: 'Built-in Mic' },
        { kind: 'videoinput', deviceId: 'cam-a', label: 'FaceTime HD' },
        { kind: 'audioinput', deviceId: 'mic-b', label: 'USB Audio' },
    ])
    assert.deepEqual(opts, [
        { deviceId: 'mic-a', label: 'Built-in Mic' },
        { deviceId: 'mic-b', label: 'USB Audio' },
    ])
})

test('falls back to a generic label pre-permission', () => {
    const opts = audioInputOptionsFromDevices([
        { kind: 'audioinput', deviceId: 'mic-a', label: '' },
        { kind: 'audioinput', deviceId: 'mic-b', label: '' },
    ])
    assert.deepEqual(opts.map((o) => o.label), ['Input 1', 'Input 2'])
})

test('tolerates non-array input', () => {
    assert.deepEqual(audioInputOptionsFromDevices(null), [])
})
