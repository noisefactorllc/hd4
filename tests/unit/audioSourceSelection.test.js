// SPDX-License-Identifier: MIT
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AudioMixer } from '../../js/audio/mixer.js'
import { AutoMix } from '../../js/autoMix.js'
import { Switcher } from '../../js/switcher.js'
import { applySnapshot } from '../../js/memory.js'

function deferred() {
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
}

function stream(name) {
    const tracks = [{ stopped: false, stop() { this.stopped = true } }, { stopped: false, stop() { this.stopped = true } }]
    return { name, getTracks: () => tracks, getAudioTracks: () => tracks }
}

async function setup(t, { channelCount = 1, follow = true } = {}) {
    const requests = new Map()
    const nodes = []
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
        getUserMedia({ audio }) {
            const request = deferred()
            requests.set(audio?.deviceId?.exact || '', request)
            return request.promise
        },
    } } })
    t.after(() => {
        if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor)
        else delete globalThis.navigator
    })
    const context = {
        state: 'running', destination: {},
        createMediaStreamSource(stream) {
            const node = {
                stream, connections: [],
                connect(head) { this.connections.push(head) },
                disconnect() { this.connections = [] },
            }
            nodes.push(node)
            return node
        },
    }
    const mixer = new AudioMixer({ channelCount, audioContext: context })
    // Stub only DSP graph construction; selection, acquisition, attachment,
    // fallback and teardown run through the actual AudioMixer methods.
    mixer._buildGraph = () => { mixer._strips.forEach((strip, i) => { strip.inputNode = { channel: i } }) }
    if (follow) {
        for (let i = 0; i < channelCount; i++) await mixer.connectStream(i, stream(`follow-${i}`))
    }
    const start = async (id, index = 0) => {
        const done = mixer.setChannelAudioMode(index, 'device', id)
        await null
        assert.ok(requests.has(id), 'the device request must be pending before a newer selection')
        return { done, request: requests.get(id) }
    }
    return { mixer, requests, nodes, context, start }
}

for (const outcome of ['resolve', 'reject']) {
    test(`a stale ${outcome} cannot replace a later Follow selection`, async (t) => {
        const { mixer, nodes, start } = await setup(t)
        const older = await start('older')
        await mixer.setChannelAudioMode(0, 'follow')
        const stale = stream('older')
        older.request[outcome](outcome === 'resolve' ? stale : new Error('unavailable'))
        await older.done
        assert.equal(mixer.channelAudioMode(0), 'follow')
        assert.equal(mixer.channelAudioDeviceId(0), '')
        assert.equal(nodes.find((n) => n.stream.name === 'follow-0').connections.length, 1)
        assert.equal(nodes.some((n) => n.stream === stale), false)
        assert.equal(mixer._strips[0].deviceStream, null)
        if (outcome === 'resolve') assert.ok(stale.getTracks().every((track) => track.stopped))
    })

    test(`a stale ${outcome} cannot replace or retain a stream beside a newer working device`, async (t) => {
        const { mixer, nodes, start } = await setup(t)
        const older = await start('older')
        const newer = await start('newer')
        const current = stream('newer')
        newer.request.resolve(current)
        await newer.done
        const stale = stream('older')
        older.request[outcome](outcome === 'resolve' ? stale : new Error('unavailable'))
        await older.done
        assert.equal(mixer.channelAudioMode(0), 'device')
        assert.equal(mixer.channelAudioDeviceId(0), 'newer')
        assert.equal(mixer._strips[0].deviceStream, current)
        assert.equal(nodes.find((n) => n.stream === current).connections.length, 1)
        assert.equal(nodes.some((n) => n.stream === stale), false)
        assert.ok(current.getTracks().every((track) => !track.stopped))
        if (outcome === 'resolve') assert.ok(stale.getTracks().every((track) => track.stopped))
    })
}

test('the current unavailable device still falls back to No audio after an older success', async (t) => {
    const { mixer, nodes, start } = await setup(t)
    const older = await start('older')
    const newer = await start('unavailable-current')
    const stale = stream('older')
    older.request.resolve(stale)
    await older.done
    newer.request.reject(new Error('unavailable'))
    await newer.done
    assert.equal(mixer.channelAudioMode(0), 'none')
    assert.equal(mixer.channelAudioDeviceId(0), 'unavailable-current')
    assert.equal(mixer._strips[0].deviceStream, null)
    assert.equal(mixer._strips[0].activeSource, null)
    assert.equal(nodes.some((n) => n.stream === stale), false)
    assert.ok(stale.getTracks().every((track) => track.stopped))
})

test('a device acquired after mixer disposal is stopped without attaching', async (t) => {
    const { mixer, nodes, start } = await setup(t, { follow: false })
    const older = await start('older')
    mixer.dispose()
    const stale = stream('older')
    older.request.resolve(stale)
    await older.done
    assert.ok(stale.getTracks().every((track) => track.stopped))
    assert.equal(nodes.length, 0)
    assert.equal(mixer._strips[0].deviceStream, null)
})

test('a superseded suspended-context selection does not acquire a device after resuming', async (t) => {
    const { mixer, context, requests } = await setup(t)
    const resumed = deferred()
    context.state = 'suspended'
    context.resume = () => resumed.promise
    const older = mixer.setChannelAudioMode(0, 'device', 'older')
    await mixer.setChannelAudioMode(0, 'follow')
    resumed.resolve()
    await null
    await null
    if (requests.has('older')) requests.get('older').resolve(stream('older'))
    await older
    assert.equal(requests.size, 0)
    assert.equal(mixer.channelAudioMode(0), 'follow')
    assert.equal(mixer.channelAudioDeviceId(0), '')
})

test('device selections on separate channels keep independent ownership', async (t) => {
    const { mixer, start } = await setup(t, { channelCount: 2 })
    const first = await start('first', 0)
    const second = await start('second', 1)
    const a = stream('first'), b = stream('second')
    second.request.resolve(b)
    await second.done
    first.request.resolve(a)
    await first.done
    assert.equal(mixer.channelAudioMode(0), 'device')
    assert.equal(mixer.channelAudioMode(1), 'device')
    assert.equal(mixer._strips[0].deviceStream, a)
    assert.equal(mixer._strips[1].deviceStream, b)
    assert.ok([...a.getTracks(), ...b.getTracks()].every((track) => !track.stopped))
})

for (const outcome of ['resolve', 'reject']) {
    test(`overlapping memory recalls retain the later scene after an older device ${outcome}`, async (t) => {
        const { mixer: audio, requests } = await setup(t)
        const programCompositor = { curve: 'dipped', blend: 'mix', setCurve(v) { this.curve = v }, setBlend(v) { this.blend = v } }
        const autoMix = new AutoMix({ channelCount: 1 })
        const switcher = new Switcher({ channelCount: 4 })
        const recording = { source: 'program' }
        const modules = { audio, programCompositor, autoMix, switcher, recording }
        const older = applySnapshot({
            switcher: { type: 'wipe', time: 2, live: 4 },
            transition: { curve: 'sharp', blend: 'screen' }, auto: { mode: 'random', bars: 8 }, recordSource: 'aux',
            audio: { monitor: 'aux', channels: [{ fader: 0.4, muted: true, soloed: true, mode: 'device', deviceId: 'older' }] },
        }, modules)
        await null
        assert.ok(requests.has('older'))
        await applySnapshot({
            switcher: { type: 'cut', time: 0.5, live: 2 },
            transition: { curve: 'linear', blend: 'add' }, auto: { mode: 'scan', bars: 2 }, recordSource: 'program',
            audio: { monitor: 'main', channels: [{ fader: 0.7, muted: false, soloed: false, mode: 'follow', deviceId: '' }] },
        }, modules)
        const stale = stream('older')
        requests.get('older')[outcome](outcome === 'resolve' ? stale : new Error('unavailable'))
        await older
        assert.deepEqual({
            curve: programCompositor.curve, blend: programCompositor.blend, mode: autoMix.mode, bars: autoMix.barsPerSwitch,
            live: switcher.live, type: switcher.type, time: switcher.time, recording: recording.source,
            monitor: audio.monitorSource(), source: audio.channelAudioMode(0), device: audio.channelAudioDeviceId(0),
            fader: audio.faderOf(0), mute: audio.isMuted(0), solo: audio.isSoloed(0),
        }, {
            curve: 'linear', blend: 'add', mode: 'scan', bars: 2, live: 2, type: 'cut', time: 0.5,
            recording: 'program', monitor: 'main', source: 'follow', device: '', fader: 0.7, mute: false, solo: false,
        })
        if (outcome === 'resolve') assert.ok(stale.getTracks().every((track) => track.stopped))
    })
}
