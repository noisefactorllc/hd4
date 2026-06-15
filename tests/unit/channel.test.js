// SPDX-License-Identifier: MIT
/**
 * Channel — owns a canvas and coordinates the lifecycle of a source
 * "driver" that pumps pixels into that canvas. The driver itself
 * (camera / file / shader) is injected, so the channel's state machine
 * is unit-testable without a browser, getUserMedia, or a GPU.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Channel } from '../../js/channel.js'
import { createSource, EMPTY_SOURCE } from '../../js/sources/sourceModel.js'

/** A spy driver factory: records constructed drivers and their calls. */
function makeFakeFactory() {
    const drivers = []
    const factory = (source, ctx) => {
        const driver = {
            source,
            ctx,
            calls: [],
            start() { this.calls.push('start') },
            stop() { this.calls.push('stop') },
            tick() { this.calls.push('tick') },
        }
        drivers.push(driver)
        return driver
    }
    factory.drivers = drivers
    return factory
}

function makeChannel(overrides = {}) {
    const canvas = overrides.canvas ?? { width: 1280, height: 720 }
    const driverFactory = overrides.driverFactory ?? makeFakeFactory()
    return new Channel({ id: overrides.id ?? 1, canvas, driverFactory })
}

test('a new channel starts empty with no active driver', () => {
    const ch = makeChannel()
    assert.equal(ch.id, 1)
    assert.deepEqual(ch.source, EMPTY_SOURCE)
    assert.equal(ch.label, '—')
    assert.equal(ch.driver, null)
})

test('setSource constructs a driver, passes the canvas, and starts it', () => {
    const factory = makeFakeFactory()
    const canvas = { width: 1280, height: 720 }
    const ch = new Channel({ id: 2, canvas, driverFactory: factory })

    ch.setSource(createSource('camera', { deviceId: 'cam-1' }))

    assert.equal(factory.drivers.length, 1)
    const d = factory.drivers[0]
    assert.equal(d.source.type, 'camera')
    assert.equal(d.ctx.canvas, canvas)
    assert.deepEqual(d.calls, ['start'])
    assert.equal(ch.source.deviceId, 'cam-1')
    assert.equal(ch.label, 'Camera')
})

test('replacing a source stops the old driver before starting the new one', () => {
    const factory = makeFakeFactory()
    const ch = makeChannel({ driverFactory: factory })

    ch.setSource(createSource('camera'))
    ch.setSource(createSource('shader', { dsl: 'render(o0)', name: 'P' }))

    assert.equal(factory.drivers.length, 2)
    assert.deepEqual(factory.drivers[0].calls, ['start', 'stop'])
    assert.deepEqual(factory.drivers[1].calls, ['start'])
    assert.equal(ch.driver, factory.drivers[1])
    assert.equal(ch.label, 'P')
})

test('setting the empty source clears the driver and the label', () => {
    const factory = makeFakeFactory()
    const ch = makeChannel({ driverFactory: factory })

    ch.setSource(createSource('camera'))
    ch.setSource(EMPTY_SOURCE)

    assert.deepEqual(factory.drivers[0].calls, ['start', 'stop'])
    assert.equal(ch.driver, null)
    assert.deepEqual(ch.source, EMPTY_SOURCE)
    assert.equal(ch.label, '—')
})

test('clear() is a convenience for setting the empty source', () => {
    const factory = makeFakeFactory()
    const ch = makeChannel({ driverFactory: factory })
    ch.setSource(createSource('image', { name: 'a.png' }))
    ch.clear()
    assert.equal(ch.driver, null)
    assert.equal(sourceCalls(factory), 'start,stop')
})

test('tick delegates to the active driver, and no-ops when empty', () => {
    const factory = makeFakeFactory()
    const ch = makeChannel({ driverFactory: factory })

    ch.tick() // empty: must not throw
    ch.setSource(createSource('shader', { dsl: 'render(o0)' }))
    ch.tick()
    ch.tick()

    assert.deepEqual(factory.drivers[0].calls, ['start', 'tick', 'tick'])
})

test('serialize returns the persistable source; restore re-applies it', () => {
    const factory = makeFakeFactory()
    const ch = makeChannel({ driverFactory: factory })
    ch.setSource(createSource('shader', { dsl: 'bloom().write(o0)\nrender(o0)', name: 'Bloom' }))

    const snap = ch.serialize()
    assert.deepEqual(snap, { type: 'shader', dsl: 'bloom().write(o0)\nrender(o0)', name: 'Bloom' })

    const ch2 = makeChannel()
    ch2.restore(snap)
    assert.equal(ch2.source.type, 'shader')
    assert.equal(ch2.label, 'Bloom')
})

test('setSource forwards a runtime payload (e.g. a File) to the driver ctx', () => {
    const factory = makeFakeFactory()
    const ch = makeChannel({ driverFactory: factory })
    const file = { name: 'clip.mp4' } // stand-in for a File handle

    ch.setSource(createSource('video', { name: 'clip.mp4' }), { file })

    assert.equal(factory.drivers[0].ctx.runtime.file, file)
})

test('runtime defaults to an empty object when omitted', () => {
    const factory = makeFakeFactory()
    const ch = makeChannel({ driverFactory: factory })
    ch.setSource(createSource('camera'))
    assert.deepEqual(factory.drivers[0].ctx.runtime, {})
})

test('dispose stops the active driver', () => {
    const factory = makeFakeFactory()
    const ch = makeChannel({ driverFactory: factory })
    ch.setSource(createSource('camera'))
    ch.dispose()
    assert.deepEqual(factory.drivers[0].calls, ['start', 'stop'])
    assert.equal(ch.driver, null)
})

function sourceCalls(factory) {
    return factory.drivers[0].calls.join(',')
}
