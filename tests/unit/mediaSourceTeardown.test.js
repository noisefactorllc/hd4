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
    const control = { play: null } // a test can hold play() open
    const appended = []
    const elements = []
    const created = []
    const revoked = []
    // Node's real URL.createObjectURL only accepts a Blob; the driver is handed
    // a File by the picker, which these tests stand in for with a plain object.
    URL.createObjectURL = () => {
        const url = `blob:hd4-test-${created.length}`
        created.push(url)
        return url
    }
    URL.revokeObjectURL = (u) => revoked.push(u)
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        writable: true,
        value: {
            createElement() {
                const el = {
                    style: {}, srcObject: null, src: '', readyState: 0,
                    paused: false, removed: false,
                    play: () => control.play ?? Promise.resolve(),
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
    return { appended, elements, created, revoked, control }
}

function fakeStream(label) {
    const tracks = [{ label, stopped: false, stop() { this.stopped = true } }]
    return { label, getTracks: () => tracks, tracks }
}

/** A promise plus the handle to settle it later. */
function deferred() {
    let resolve
    const promise = new Promise((res) => { resolve = res })
    return { promise, resolve }
}

function installMediaDevices(getUserMedia) {
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true, writable: true,
        value: { mediaDevices: { getUserMedia } },
    })
}

/**
 * Models mixer.js closely enough to catch ownership mistakes: one strip per
 * channel, a single `followSource`, and a `disconnect()` that is channel-wide
 * (_clearFollow) rather than per-driver. connectElement is async because the
 * real one awaits ctx.resume().
 */
function makeAudioSpy() {
    return {
        connected: [], elements: [], disconnects: 0, log: [], followSource: null,
        async connectStream(s) {
            this.log.push('connectStream'); this.connected.push(s); this.followSource = s
        },
        async connectElement(el) {
            await null
            this.log.push('connectElement'); this.elements.push(el); this.followSource = el
        },
        disconnect() { this.log.push('disconnect'); this.disconnects++; this.followSource = null },
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
    // Not merely detached afterwards: a dead driver should never have built
    // and played an element for a channel the user has already left.
    assert.deepEqual(dom.elements, [], 'no element should have been created at all')
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

    const driver = makeMediaDriver({ type: 'video' }, renderer, { audio, runtime: { file: {} } })
    const started = driver.start()
    driver.stop()
    compile.resolve()
    await started

    assert.deepEqual(dom.appended, [], 'no hidden video element may be left in the document')
    assert.deepEqual(dom.elements, [], 'no element should have been created at all')
    assert.deepEqual(dom.created, [], 'no object URL should have been created at all')
    assert.deepEqual(audio.elements, [], 'a stopped driver must not connect audio to the mixer')
})

test('a video file stopped after it starts revokes the object URL it created', async () => {
    // The mirror of the test above: here the URL genuinely exists, so the
    // revocation is a real assertion rather than a vacuously satisfied one.
    const dom = installBrowserStubs()
    installMediaDevices(async () => fakeStream('unused'))
    const renderer = { compile: async () => {}, uploadMediaFrame() {} }

    const driver = makeMediaDriver({ type: 'video' }, renderer, { runtime: { file: {} } })
    await driver.start()
    assert.equal(dom.created.length, 1, 'the object URL was created')
    assert.equal(dom.appended.length, 1, 'the hidden video element was attached')

    driver.stop()

    assert.deepEqual(dom.revoked, dom.created, 'every object URL created must be revoked')
    assert.deepEqual(dom.appended, [], 'the element must be detached')
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

test('a driver resuming after stop does not disconnect its successor\'s audio', async () => {
    // The channel's audio binding is channel-wide: disconnect() clears
    // whatever the strip currently follows, whoever put it there. A driver
    // that resumes after teardown must not reach for it.
    installBrowserStubs()
    const camStream = fakeStream('camera')
    const gum = deferred()
    installMediaDevices(() => gum.promise)
    const audio = makeAudioSpy()
    const renderer = { compile: async () => {}, uploadMediaFrame() {} }

    const a = makeMediaDriver({ type: 'camera' }, renderer, { audio })
    const startedA = a.start()
    await null; await null
    a.stop() // user swaps the channel while the permission prompt is up

    const b = makeMediaDriver({ type: 'video' }, renderer, { audio, runtime: { file: {} } })
    await b.start()
    const successorSource = audio.followSource
    assert.notEqual(successorSource, null, 'the successor connected its audio')

    gum.resolve(camStream) // the abandoned camera finally arrives
    await startedA

    assert.equal(camStream.tracks[0].stopped, true, 'the abandoned camera is still released')
    assert.equal(audio.followSource, successorSource, "the successor's audio must survive")
})

test('a video file stopped while its audio is still binding does not leave the mixer attached', async () => {
    // audio.connectElement is async (the real one awaits ctx.resume()), so a
    // stop() can land between the call and the binding taking effect.
    installBrowserStubs()
    installMediaDevices(async () => fakeStream('unused'))
    const audio = makeAudioSpy()
    const renderer = { compile: async () => {}, uploadMediaFrame() {} }

    const driver = makeMediaDriver({ type: 'video' }, renderer, { audio, runtime: { file: {} } })
    const started = driver.start()
    await null; await null // reach into startVideoFile's connectElement
    driver.stop()
    await started
    await null; await null; await null // let the binding settle

    assert.equal(audio.followSource, null, 'a torn-down driver must not hold the strip')
})

test('a mic that fails to reach the mixer is still released', async () => {
    // connectStream rejecting must not discard the only reference to a live
    // microphone stream — that is the same orphaned-hardware bug in miniature.
    installBrowserStubs()
    const camStream = fakeStream('camera')
    const micStream = fakeStream('mic')
    installMediaDevices((c) => Promise.resolve(c.audio === true ? micStream : camStream))
    const audio = makeAudioSpy()
    audio.connectStream = async () => { throw new Error('no audio context') }
    const renderer = { compile: async () => {}, uploadMediaFrame() {} }

    const driver = makeMediaDriver({ type: 'camera' }, renderer, { audio })
    await driver.start()

    assert.equal(micStream.tracks[0].stopped, true, 'the acquired mic must be released')
})

/** Stub the Image constructor the image path uses; returns the images built. */
function installImageStub() {
    const images = []
    globalThis.Image = class { constructor() { this.src = ''; images.push(this) } }
    return images
}

const STILL_ID = 'a'.repeat(64)

test('an image naming a still by id shows the Blob loadStill returns, and revokes its URL on stop', async () => {
    const dom = installBrowserStubs()
    const images = installImageStub()
    const blob = new Blob(['still'], { type: 'image/png' })
    const requested = []
    const renderer = { compile: async () => {}, uploadMediaFrame() {} }

    const driver = makeMediaDriver({ type: 'image', name: 'Still', url: '', stillId: STILL_ID }, renderer, {
        loadStill: async (id) => { requested.push(id); return blob },
    })
    await driver.start()

    assert.deepEqual(requested, [STILL_ID])
    assert.equal(dom.created.length, 1, 'the object URL was created')
    assert.equal(images.length, 1)
    assert.equal(images[0].src, dom.created[0])

    driver.stop()
    assert.deepEqual(dom.revoked, dom.created, 'every object URL created must be revoked')
})

test('an image stopped while its still is loading builds no image and no object URL', async () => {
    const dom = installBrowserStubs()
    const images = installImageStub()
    const still = deferred()
    const requested = deferred()
    const renderer = { compile: async () => {}, uploadMediaFrame() {} }

    const driver = makeMediaDriver({ type: 'image', name: 'Still', url: '', stillId: STILL_ID }, renderer, {
        loadStill: (id) => { requested.resolve(id); return still.promise },
    })
    const started = driver.start()
    await requested.promise // the read from still storage is in flight

    driver.stop() // the user recalls another memory meanwhile
    still.resolve(new Blob(['still'], { type: 'image/png' }))
    await started

    assert.deepEqual(images, [], 'no image may be built for a stopped driver')
    assert.deepEqual(dom.created, [], 'no object URL should have been created at all')
})

test('a camera stopped while the element is still playing never asks for the mic', async () => {
    // Without the guard after play(), a driver the user already navigated away
    // from goes on to raise a microphone permission prompt and light the mic
    // for a dead channel — cleaned up a moment later, but asked for regardless.
    const dom = installBrowserStubs()
    const camStream = fakeStream('camera')
    const micStream = fakeStream('mic')
    const requests = []
    installMediaDevices((c) => {
        requests.push(c.audio === true ? 'mic' : 'camera')
        return Promise.resolve(c.audio === true ? micStream : camStream)
    })
    const play = deferred()
    dom.control.play = play.promise
    const renderer = { compile: async () => {}, uploadMediaFrame() {} }
    const audio = makeAudioSpy()

    const driver = makeMediaDriver({ type: 'camera' }, renderer, { audio })
    const started = driver.start()
    await null; await null; await null // park inside play()

    driver.stop()
    play.resolve()
    await started

    assert.deepEqual(requests, ['camera'], 'the mic must never be requested')
    assert.equal(camStream.tracks[0].stopped, true, 'the camera is released')
})
