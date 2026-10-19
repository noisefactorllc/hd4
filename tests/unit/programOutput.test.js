// SPDX-License-Identifier: MIT
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProgramOutput, programDescriptor, PROGRAM_FPS } from '../../js/programOutput.js'

// Records what ProgramOutput asks of its SinkManager; sinks added after a
// configure receive the current descriptor, as Noisemaker's SinkManager does.
function recordingSinkManager() {
    const calls = []
    let descriptor = null
    const sinks = new Set()
    return {
        calls,
        sinks,
        add(sink) {
            calls.push(['add'])
            sinks.add(sink)
            if (descriptor) sink.configure(descriptor)
            return () => { sinks.delete(sink); sink.close() }
        },
        configure(next) {
            descriptor = next
            calls.push(['configure', next.width, next.height])
            for (const sink of sinks) sink.configure(next)
        },
        submit(source, timestamp) {
            calls.push(['submit', timestamp])
            for (const sink of sinks) sink.submit(source, timestamp)
        },
        close() { calls.push(['close']) },
    }
}

function recordingSink() {
    const events = []
    return {
        events,
        configure(d) { events.push(['configure', d.width, d.height]) },
        submit(source, timestamp) { events.push(['submit', source, timestamp]); return true },
        close() { events.push(['close']) },
    }
}

test('programDescriptor describes an opaque sRGB 60 fps RGBA program', () => {
    assert.deepEqual(programDescriptor(1280, 720), {
        width: 1280, height: 720, format: 'rgba8unorm', colorSpace: 'srgb', alphaMode: 'opaque', fps: PROGRAM_FPS,
    })
    assert.equal(PROGRAM_FPS, 60)
    assert.ok(Object.isFrozen(programDescriptor(1, 1)))
})

test('configures its sinks with the canvas size at construction', () => {
    const sinks = recordingSinkManager()
    const output = new ProgramOutput({ canvas: { width: 1280, height: 720 }, sinkManager: sinks })
    assert.deepEqual(sinks.calls, [['configure', 1280, 720]])
    assert.equal(output.descriptor.width, 1280)
    assert.equal(output.descriptor.height, 720)
})

test('publish hands the program canvas and timestamp to every sink', () => {
    const canvas = { width: 640, height: 360 }
    const output = new ProgramOutput({ canvas, sinkManager: recordingSinkManager() })
    const a = recordingSink()
    const b = recordingSink()
    output.addSink(a)
    output.addSink(b)
    output.publish(16.5)
    for (const sink of [a, b]) {
        assert.deepEqual(sink.events, [['configure', 640, 360], ['submit', canvas, 16.5]])
    }
})

test('a resolution change reconfigures the sinks before the next frame', () => {
    const canvas = { width: 1280, height: 720 }
    const sinks = recordingSinkManager()
    const output = new ProgramOutput({ canvas, sinkManager: sinks })
    const sink = recordingSink()
    output.addSink(sink)
    output.publish(1)
    canvas.width = 1920
    canvas.height = 1080
    output.publish(2)
    output.publish(3)
    assert.deepEqual(sink.events.map((e) => e.slice(0, 3).filter((v) => v !== canvas)), [
        ['configure', 1280, 720], ['submit', 1], ['configure', 1920, 1080], ['submit', 2], ['submit', 3],
    ])
    assert.equal(sinks.calls.filter((c) => c[0] === 'configure').length, 2)
})

test('reading the descriptor after a resize reports and configures the new size', () => {
    const canvas = { width: 1280, height: 720 }
    const sinks = recordingSinkManager()
    const output = new ProgramOutput({ canvas, sinkManager: sinks })
    canvas.width = 640
    canvas.height = 360
    assert.equal(output.descriptor.width, 640)
    assert.deepEqual(sinks.calls.at(-1), ['configure', 640, 360])
})

test('exposes a stable renderer identity for the Sync controller', () => {
    const output = new ProgramOutput({ canvas: { width: 2, height: 2 }, sinkManager: recordingSinkManager() })
    const identity = output.pipeline
    output.publish(1)
    assert.ok(identity)
    assert.equal(output.pipeline, identity)
})

test('createFrameExportQueue builds a queue over the program canvas', () => {
    const canvas = { width: 2, height: 2 }
    const built = []
    const output = new ProgramOutput({
        canvas,
        sinkManager: recordingSinkManager(),
        createExportQueue: (opts) => { built.push(opts); return { queue: true } },
    })
    assert.deepEqual(output.createFrameExportQueue({ slots: 3 }), { queue: true })
    assert.deepEqual(built, [{ canvas, slots: 3 }])
})

test('createFrameExportQueue returns null without a queue factory', () => {
    const output = new ProgramOutput({ canvas: { width: 2, height: 2 }, sinkManager: recordingSinkManager() })
    assert.equal(output.createFrameExportQueue({ slots: 3 }), null)
})

test('close closes the sinks and stops publishing', () => {
    const sinks = recordingSinkManager()
    const output = new ProgramOutput({
        canvas: { width: 2, height: 2 },
        sinkManager: sinks,
        createExportQueue: () => ({}),
    })
    output.close()
    output.close()
    output.publish(1)
    assert.deepEqual(sinks.calls.filter((c) => c[0] !== 'configure'), [['close']])
    assert.equal(output.createFrameExportQueue({ slots: 3 }), null)
    assert.throws(() => output.addSink(recordingSink()), /closed/)
})

test('rejects a missing canvas or sink manager', () => {
    assert.throws(() => new ProgramOutput({ sinkManager: recordingSinkManager() }), TypeError)
    assert.throws(() => new ProgramOutput({ canvas: { width: 1, height: 1 } }), TypeError)
})
