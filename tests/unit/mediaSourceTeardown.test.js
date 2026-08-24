// SPDX-License-Identifier: MIT
/**
 * Media driver teardown across the async gaps in start().
 *
 * Channel._releaseDriver() calls stop() synchronously, but the media
 * driver's start() awaits a shader compile and then, for a camera,
 * getUserMedia. A stop() landing in either gap must leave nothing running —
 * a camera whose tracks outlive its channel keeps the hardware light on.
 *
 * The DOM and getUserMedia are stubbed narrowly: this exercises the
 * driver's own lifecycle, not rendering or capture.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

function installBrowserStubs() {
    const appended = []
    const elements = []
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        writable: true,
        value: {
            createElement() {
                const el = {
                    style: {}, srcObject: null, src: '', readyState: 0,
                    paused: false, removed: false,
                    play: async () => {},
                    pause() { this.paused = true },
                    remove() {
                        this.removed = true
                        const i = appended.indexOf(this)
                        if (i !== -1) appended.splice(i, 1)
                    },
                }
                elements.push(el)
                return el
            },
            body: { appendChild(el) { appended.push(el) } },
        },
    })
    return { appended, elements }
}

function fakeStream(label) {
    const tracks = [{ label, stopped: false, stop() { this.stopped = true } }]
    return { label, getTracks: () => tracks, tracks }
}

/** A promise plus the handle to settle it later. */
function deferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

function installMediaDevices(getUserMedia) {
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true, writable: true,
        value: { mediaDevices: { getUserMedia } },
    })
}

function makeAudioSpy() {
    return {
        connected: [], elements: [], disconnects: 0,
        async connectStream(s) { this.connected.push(s) },
        connectElement(el) { this.elements.push(el) },
        disconnect() { this.disconnects++ },
    }
}

const { makeMediaDriver } = await import('../../js/sources/mediaSource.js')

test('a camera stopped while getUserMedia is pending does not leave the camera running', async () => {
    const dom = installBrowserStubs()
    const gum = deferred()
    installMediaDevices(() => gum.promise)
    const compile = deferred()
    const renderer = { compile: () => compile.promise, uploadMediaFrame() {} }

    const driver = makeMediaDriver({ type: 'camera', deviceId: 'cam-1' }, renderer)
    const started = driver.start()

    compile.resolve()
    await null // let start() advance past the compile await into getUserMedia

    driver.stop() // the user picks another source while permission is pending

    const stream = fakeStream('camera')
    gum.resolve(stream)
    await started

    assert.equal(stream.tracks[0].stopped, true, 'the acquired camera track must be stopped')
    assert.deepEqual(dom.appended, [], 'no hidden video element may be left in the document')
})

test('a camera stopped during the compile never acquires a stream at all', async () => {
    installBrowserStubs()
    let calls = 0
    installMediaDevices(async () => { calls++; return fakeStream('camera') })
    const compile = deferred()
    const renderer = { compile: () => compile.promise, uploadMediaFrame() {} }

    const driver = makeMediaDriver({ type: 'camera' }, renderer)
    const started = driver.start()
    driver.stop()
    compile.resolve()
    await started

    assert.equal(calls, 0, 'a stopped driver must not go on to request the camera')
})

test('a camera mic acquired after stop is released and never reaches the mixer', async () => {
    installBrowserStubs()
    const videoStream = fakeStream('camera')
    const micStream = fakeStream('mic')
    const mic = deferred()
    const micRequested = deferred()
    installMediaDevices((constraints) => {
        if (constraints.audio === true) {
            micRequested.resolve()
            return mic.promise
        }
        return Promise.resolve(videoStream)
    })
    const renderer = { compile: async () => {}, uploadMediaFrame() {} }
    const audio = makeAudioSpy()

    const driver = makeMediaDriver({ type: 'camera' }, renderer, { audio })
    const started = driver.start()
    // Wait for the mic request to actually be in flight. Counting microtasks
    // instead would land somewhere earlier in start() and quietly test a
    // different interleaving than the one named here.
    await micRequested.promise

    driver.stop()
    mic.resolve(micStream)
    await started

    assert.equal(micStream.tracks[0].stopped, true, 'the mic track must be stopped')
    assert.equal(videoStream.tracks[0].stopped, true, 'the camera track must be stopped too')
    assert.deepEqual(audio.connected, [], 'a stopped driver must not connect audio to the mixer')
})

test('a video file stopped during the compile leaves no element or object URL', async () => {
    const dom = installBrowserStubs()
    installMediaDevices(async () => fakeStream('unused'))
    const compile = deferred()
    const renderer = { compile: () => compile.promise, uploadMediaFrame() {} }
    const audio = makeAudioSpy()

    const revoked = []
    const realCreate = URL.createObjectURL
    const realRevoke = URL.revokeObjectURL
    URL.createObjectURL = () => 'blob:hd4-test'
    URL.revokeObjectURL = (u) => revoked.push(u)
    try {
        const driver = makeMediaDriver({ type: 'video' }, renderer, { audio, runtime: { file: {} } })
        const started = driver.start()
        driver.stop()
        compile.resolve()
        await started

        assert.deepEqual(dom.appended, [], 'no hidden video element may be left in the document')
        assert.deepEqual(audio.elements, [], 'a stopped driver must not connect audio to the mixer')
        assert.equal(revoked.length === 0 || revoked[0] === 'blob:hd4-test', true, 'any object URL created must be revoked')
    } finally {
        URL.createObjectURL = realCreate
        URL.revokeObjectURL = realRevoke
    }
})

test('stop is idempotent', async () => {
    installBrowserStubs()
    const stream = fakeStream('camera')
    installMediaDevices(async () => stream)
    const renderer = { compile: async () => {}, uploadMediaFrame() {} }
    const audio = makeAudioSpy()

    const driver = makeMediaDriver({ type: 'camera' }, renderer, { audio })
    await driver.start()
    driver.stop()
    driver.stop()
    driver.stop()

    assert.equal(stream.tracks[0].stopped, true)
})

test('an uninterrupted camera start still acquires and plays', async () => {
    const dom = installBrowserStubs()
    const stream = fakeStream('camera')
    const micStream = fakeStream('mic')
    installMediaDevices((c) => Promise.resolve(c.audio === true ? micStream : stream))
    const renderer = { compile: async () => {}, uploadMediaFrame() {} }
    const audio = makeAudioSpy()

    const driver = makeMediaDriver({ type: 'camera', deviceId: 'cam-1' }, renderer, { audio })
    await driver.start()

    assert.equal(dom.appended.length, 1, 'the hidden video element is attached')
    assert.equal(dom.appended[0].srcObject, stream)
    assert.deepEqual(audio.connected, [micStream], 'the mic reaches the mixer')
    assert.equal(stream.tracks[0].stopped, false, 'a live driver keeps its tracks')
})
