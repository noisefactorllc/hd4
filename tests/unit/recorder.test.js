// SPDX-License-Identifier: MIT
/**
 * Recorder helpers — codec negotiation and the download filename. The
 * MediaRecorder wiring is integration-tested in the browser; the mime
 * preference walk and the timestamped filename are pure.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickMimeType, recordingExtension, recordingFilename, RECORDING_MIME_PREFERENCES } from '../../js/recorder.js'

test('pickMimeType returns the first supported preference', () => {
    const supported = new Set(['video/webm;codecs=vp8,opus', 'video/webm'])
    const mime = pickMimeType((m) => supported.has(m))
    assert.equal(mime, 'video/webm;codecs=vp8,opus') // vp9 unsupported here, vp8 wins
})

test('pickMimeType returns empty string when nothing is supported', () => {
    assert.equal(pickMimeType(() => false), '')
})

test('pickMimeType tolerates a throwing support check', () => {
    assert.equal(pickMimeType(() => { throw new Error('boom') }), '')
})

test('the preference list prefers mp4/webm with audio codecs', () => {
    assert.ok(RECORDING_MIME_PREFERENCES.length > 0)
    assert.ok(RECORDING_MIME_PREFERENCES.some((m) => m.includes('opus')))
})

test('recordingExtension maps mime to a file extension', () => {
    assert.equal(recordingExtension('video/mp4;codecs=avc1'), 'mp4')
    assert.equal(recordingExtension('video/webm;codecs=vp9,opus'), 'webm')
    assert.equal(recordingExtension(''), 'webm') // default
})

test('recordingFilename stamps the date and matches the codec extension', () => {
    const d = new Date(2026, 5, 14, 9, 3, 7) // 2026-06-14 09:03:07 (local)
    assert.equal(recordingFilename(d, 'video/webm;codecs=vp9,opus'), 'hd4-20260614-090307.webm')
    assert.equal(recordingFilename(d, 'video/mp4'), 'hd4-20260614-090307.mp4')
})
