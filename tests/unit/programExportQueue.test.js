// SPDX-License-Identifier: MIT
/**
 * ProgramExportQueue's own logic — the texture upload, size checks, context
 * loss recovery and teardown — against a fake WebGL2 context and a fake SDK
 * queue. The real GPU readback is exercised by tests/e2e/sync-output.spec.js.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProgramExportQueue } from '../../js/programExportQueue.js'

const DESCRIPTOR = Object.freeze({
    width: 4, height: 2, format: 'rgba8unorm', colorSpace: 'srgb', alphaMode: 'opaque', fps: 60,
})

function fakeGpu() {
    const contexts = []
    const queues = []
    let webgl2 = true

    class FakeQueue {
        constructor({ gl, slots }) {
            this.gl = gl
            this.slots = slots
            this.events = []
            this.ready = true
            queues.push(this)
        }
        get available() { return this.ready && !this.gl.isContextLost() }
        configure(descriptor) { this.events.push(['configure', descriptor]) }
        enqueue(source, timestamp, onFrame, sequence) {
            this.events.push(['enqueue', source, timestamp, sequence, this.gl.flipY])
            return true
        }
        poll() { this.events.push(['poll']) }
        close() { this.events.push(['close']) }
    }

    function createContext() {
        let lost = false
        const gl = {
            TEXTURE_2D: 'TEXTURE_2D', RGBA8: 'RGBA8', RGBA: 'RGBA', UNSIGNED_BYTE: 'UNSIGNED_BYTE',
            FRAMEBUFFER: 'FRAMEBUFFER', COLOR_ATTACHMENT0: 'COLOR_ATTACHMENT0',
            UNPACK_FLIP_Y_WEBGL: 'UNPACK_FLIP_Y_WEBGL',
            calls: [],
            flipY: false,
            deleted: [],
            lostByApp: false,
            isContextLost: () => lost,
            loseForTest() { lost = true },
            createTexture: () => ({ kind: 'texture' }),
            createFramebuffer: () => ({ kind: 'framebuffer' }),
            bindTexture() {},
            bindFramebuffer() {},
            texStorage2D(...args) { gl.calls.push(['texStorage2D', ...args]) },
            framebufferTexture2D(...args) { gl.calls.push(['framebufferTexture2D', ...args]) },
            pixelStorei(name, value) { if (name === gl.UNPACK_FLIP_Y_WEBGL) gl.flipY = value },
            texSubImage2D(...args) { gl.calls.push(['texSubImage2D', gl.flipY, ...args]) },
            deleteTexture(t) { gl.deleted.push(t.kind) },
            deleteFramebuffer(f) { gl.deleted.push(f.kind) },
            getExtension: (name) => (name === 'WEBGL_lose_context'
                ? { loseContext() { gl.lostByApp = true; lost = true } }
                : null),
        }
        return gl
    }

    const document = {
        createElement(tag) {
            assert.equal(tag, 'canvas')
            const listeners = new Map()
            const surface = {
                width: 300,
                height: 150,
                gl: null,
                contextOptions: null,
                listeners,
                getContext(kind, options) {
                    if (kind !== 'webgl2' || !webgl2) return null
                    surface.contextOptions = options
                    surface.gl = createContext()
                    contexts.push(surface)
                    return surface.gl
                },
                addEventListener(type, fn) { listeners.set(type, fn) },
                removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type) },
                loseContext() {
                    surface.gl.loseForTest()
                    listeners.get('webglcontextlost')?.({ preventDefault() {} })
                },
            }
            return surface
        },
    }

    let now = 0
    const clock = { now: () => now }
    return {
        contexts,
        queues,
        document,
        clock,
        Queue: FakeQueue,
        advance(ms) { now += ms },
        disableWebgl2() { webgl2 = false },
        enableWebgl2() { webgl2 = true },
    }
}

function makeQueue(gpu, canvas = { width: 4, height: 2 }) {
    return new ProgramExportQueue({ canvas, slots: 3, document: gpu.document, clock: gpu.clock, Queue: gpu.Queue })
}

test('is unavailable until configured', () => {
    const gpu = fakeGpu()
    const queue = makeQueue(gpu)
    assert.equal(queue.available, false)
    assert.equal(queue.enqueue({ width: 4, height: 2 }, 0, () => {}, 1), false)
    assert.equal(gpu.contexts.length, 0)
})

test('configure builds a private 1×1 WebGL2 surface and a texture-backed SDK queue', () => {
    const gpu = fakeGpu()
    const queue = makeQueue(gpu)
    queue.configure(DESCRIPTOR)
    assert.equal(queue.available, true)
    assert.equal(gpu.contexts.length, 1)
    const surface = gpu.contexts[0]
    assert.equal(surface.width, 1)
    assert.equal(surface.height, 1)
    assert.equal(surface.contextOptions.preserveDrawingBuffer, false)
    assert.deepEqual(surface.gl.calls[0], ['texStorage2D', 'TEXTURE_2D', 1, 'RGBA8', 4, 2])
    assert.equal(gpu.queues.length, 1)
    assert.equal(gpu.queues[0].slots, 3)
    assert.deepEqual(gpu.queues[0].events, [['configure', DESCRIPTOR]])
})

test('enqueue uploads the canvas flipped into GL row order, then reads the framebuffer', () => {
    const gpu = fakeGpu()
    const canvas = { width: 4, height: 2 }
    const queue = makeQueue(gpu, canvas)
    queue.configure(DESCRIPTOR)
    const onFrame = () => {}
    assert.equal(queue.enqueue(canvas, 12.5, onFrame, 7), true)
    const { gl } = gpu.contexts[0]
    const upload = gl.calls.find((c) => c[0] === 'texSubImage2D')
    assert.deepEqual(upload, ['texSubImage2D', true, 'TEXTURE_2D', 0, 0, 0, 4, 2, 'RGBA', 'UNSIGNED_BYTE', canvas])
    assert.equal(gl.flipY, false, 'the flip is restored after the upload')
    const [, source, timestamp, sequence, flipAtEnqueue] = gpu.queues[0].events.at(-1)
    assert.equal(source.kind, 'framebuffer')
    assert.equal(timestamp, 12.5)
    assert.equal(sequence, 7)
    assert.equal(flipAtEnqueue, false)
})

test('enqueue rejects a canvas whose size no longer matches the descriptor', () => {
    const gpu = fakeGpu()
    const queue = makeQueue(gpu)
    queue.configure(DESCRIPTOR)
    assert.throws(() => queue.enqueue({ width: 8, height: 2 }, 0, () => {}, 1), RangeError)
})

test('poll forwards to the SDK queue while the context is healthy', () => {
    const gpu = fakeGpu()
    const queue = makeQueue(gpu)
    queue.configure(DESCRIPTOR)
    queue.poll()
    assert.deepEqual(gpu.queues[0].events.at(-1), ['poll'])
})

test('a lost context goes busy, then rebuilds at most once a second', () => {
    const gpu = fakeGpu()
    const queue = makeQueue(gpu)
    queue.configure(DESCRIPTOR)
    gpu.contexts[0].loseContext()
    assert.equal(queue.available, false)

    queue.poll() // within the interval of the first build: no rebuild yet
    assert.equal(gpu.contexts.length, 1)
    assert.equal(queue.available, false)

    gpu.advance(1000)
    queue.poll()
    assert.equal(gpu.contexts.length, 2)
    assert.equal(queue.available, true)
    assert.deepEqual(gpu.queues[1].events, [['configure', DESCRIPTOR]])
    assert.deepEqual(gpu.queues[0].events.at(-1), ['close'], 'the lost queue is closed')
    assert.equal(gpu.contexts[0].listeners.size, 0, 'the lost surface listener is removed')
})

test('a failed rebuild stays busy and retries after the interval', () => {
    const gpu = fakeGpu()
    const queue = makeQueue(gpu)
    queue.configure(DESCRIPTOR)
    gpu.contexts[0].loseContext()
    gpu.disableWebgl2()
    gpu.advance(1000)
    queue.poll()
    assert.equal(queue.available, false)
    gpu.enableWebgl2()
    queue.poll() // retried too soon
    assert.equal(gpu.contexts.length, 1)
    gpu.advance(1000)
    queue.poll()
    assert.equal(gpu.contexts.length, 2)
    assert.equal(queue.available, true)
})

test('reconfigure replaces the GPU resources', () => {
    const gpu = fakeGpu()
    const queue = makeQueue(gpu)
    queue.configure(DESCRIPTOR)
    queue.configure({ ...DESCRIPTOR, width: 8 })
    assert.equal(gpu.contexts.length, 2)
    assert.deepEqual(gpu.queues[0].events.at(-1), ['close'])
    assert.equal(gpu.contexts[0].gl.lostByApp, true)
    assert.deepEqual(gpu.contexts[1].gl.calls[0], ['texStorage2D', 'TEXTURE_2D', 1, 'RGBA8', 8, 2])
})

test('a reconfigure that cannot rebuild stays busy and retries, like a lost context', () => {
    const gpu = fakeGpu()
    const queue = makeQueue(gpu)
    queue.configure(DESCRIPTOR)
    gpu.disableWebgl2()
    const resized = { ...DESCRIPTOR, width: 8 }
    assert.doesNotThrow(() => queue.configure(resized))
    assert.equal(queue.available, false)
    gpu.enableWebgl2()
    queue.poll() // within the retry interval
    assert.equal(gpu.contexts.length, 1)
    gpu.advance(1000)
    queue.poll()
    assert.equal(gpu.contexts.length, 2)
    assert.equal(queue.available, true)
    assert.deepEqual(gpu.queues[1].events, [['configure', resized]])
})

test('configure throws when WebGL2 is unavailable and leaves the queue unavailable', () => {
    const gpu = fakeGpu()
    gpu.disableWebgl2()
    const queue = makeQueue(gpu)
    assert.throws(() => queue.configure(DESCRIPTOR), /WebGL2/)
    assert.equal(queue.available, false)
})

test('close releases the texture, framebuffer and context and stays closed', () => {
    const gpu = fakeGpu()
    const queue = makeQueue(gpu)
    queue.configure(DESCRIPTOR)
    queue.close()
    const { gl, listeners } = gpu.contexts[0]
    assert.deepEqual(gl.deleted.sort(), ['framebuffer', 'texture'])
    assert.equal(gl.lostByApp, true)
    assert.equal(listeners.size, 0)
    assert.deepEqual(gpu.queues[0].events.at(-1), ['close'])
    assert.equal(queue.available, false)
    queue.configure(DESCRIPTOR)
    queue.poll()
    queue.close()
    assert.equal(gpu.contexts.length, 1)
})
