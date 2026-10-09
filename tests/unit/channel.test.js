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

// --- Failed starts fall back instead of leaving a dead input selected ---

/**
 * A driver factory whose per-driver behaviour follows `plan`:
 * 'ok' resolves synchronously (like the sync fakes above), 'fail' starts
 * and then rejects. Drivers are constructed in call order, and a fallback
 * restart constructs a fresh driver that consumes the next plan entry.
 */
function makePlannedFactory(plan) {
    const drivers = []
    const factory = (source, ctx) => {
        const mode = plan[drivers.length] ?? 'ok'
        const driver = {
            source, ctx, calls: [],
            start() {
                this.calls.push('start')
                if (mode === 'fail') return Promise.reject(new Error('no camera'))
                return undefined
            },
            stop() { this.calls.push('stop') },
            tick() { this.calls.push('tick') },
        }
        drivers.push(driver)
        return driver
    }
    factory.drivers = drivers
    return factory
}

test('a start that rejects falls back to the previous source, and still rejects', async () => {
    const factory = makePlannedFactory(['ok', 'fail', 'ok'])
    const ch = makeChannel({ driverFactory: factory })
    const shader = createSource('shader', { dsl: 'render(o0)', name: 'P' })
    ch.setSource(shader)

    await assert.rejects(
        ch.setSource(createSource('camera', { deviceId: 'cam-1' })),
        /no camera/,
    )

    assert.deepEqual(ch.source, shader, 'the channel is back on its previous source')
    assert.equal(factory.drivers.length, 3)
    assert.deepEqual(factory.drivers[0].calls, ['start', 'stop']) // stopped for the take
    assert.deepEqual(factory.drivers[1].calls, ['start', 'stop']) // the failed camera
    assert.deepEqual(factory.drivers[2].calls, ['start']) // the shader, live again
    assert.equal(ch.driver, factory.drivers[2])
})

test('a first start that rejects falls back to the empty source', async () => {
    const factory = makePlannedFactory(['fail'])
    const ch = makeChannel({ driverFactory: factory })
    await assert.rejects(ch.setSource(createSource('camera')), /no camera/)
    assert.deepEqual(ch.source, EMPTY_SOURCE)
    assert.equal(ch.driver, null)
})

test('a failed start does not clobber a source applied while it was in flight', async () => {
    const factory = makePlannedFactory(['fail', 'ok'])
    const ch = makeChannel({ driverFactory: factory })
    const shader = createSource('shader', { dsl: 'render(o0)', name: 'P' })
    const failing = ch.setSource(createSource('camera'))
    ch.setSource(shader) // user picks again before the camera failure lands
    await assert.rejects(failing, /no camera/)
    assert.equal(ch.source, shader)
    assert.equal(ch.driver, factory.drivers[1])
    assert.deepEqual(factory.drivers[1].calls, ['start'])
})

test('a fallback whose restart also fails settles the channel empty', async () => {
    const factory = makePlannedFactory(['ok', 'fail', 'fail'])
    const ch = makeChannel({ driverFactory: factory })
    ch.setSource(createSource('shader', { dsl: 'render(o0)', name: 'P' }))
    await assert.rejects(ch.setSource(createSource('camera')), /no camera/)
    await new Promise((resolve) => setTimeout(resolve, 10)) // let the swallowed restart rejection land
    assert.deepEqual(ch.source, EMPTY_SOURCE)
    assert.equal(ch.driver, null)
    assert.deepEqual(factory.drivers[2].calls, ['start', 'stop'])
})

test('a failed start does not resurrect a source after the channel was cleared', async () => {
    const factory = makePlannedFactory(['ok', 'fail'])
    const ch = makeChannel({ driverFactory: factory })
    ch.setSource(createSource('shader', { dsl: 'render(o0)', name: 'P' }))
    const failing = ch.setSource(createSource('camera'))
    ch.clear() // explicit empty while the camera failure is still in flight
    await assert.rejects(failing, /no camera/)
    assert.deepEqual(ch.source, EMPTY_SOURCE)
    assert.equal(ch.driver, null)
    assert.deepEqual(factory.drivers[1].calls, ['start', 'stop'], 'no fallback driver was built')
})

test('a failed start does not rebuild a driver after dispose()', async () => {
    const factory = makePlannedFactory(['fail'])
    const ch = makeChannel({ driverFactory: factory })
    const failing = ch.setSource(createSource('camera'))
    ch.dispose()
    await assert.rejects(failing, /no camera/)
    assert.deepEqual(ch.source, EMPTY_SOURCE)
    assert.equal(ch.driver, null)
    assert.deepEqual(factory.drivers[0].calls, ['start', 'stop'], 'no driver was built after teardown')
})

function sourceCalls(factory) {
    return factory.drivers[0].calls.join(',')
}
