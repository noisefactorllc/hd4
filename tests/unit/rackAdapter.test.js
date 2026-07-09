// SPDX-License-Identifier: MIT
/**
 * rackAdapter.test.js — dependency-light spec for js/rack-adapter.js (HD4 as a rack module).
 *
 * createModule(host) is built purely against the rack-core `host` contract. The heavy browser
 * boot (bootInto in app.js, which pulls in the browser-only `handfish` ESM + WebGL/WebAudio) is
 * imported DYNAMICALLY inside mount(); the jack CONTRACT — getJacks() and resolveJack() — needs
 * none of that, so this test runs under plain `node --test` with a hand-built fake host.
 *
 * It asserts the static jack set and the documented endpoint shapes (module-sdk §4, §8;
 * rack-core router.js): hd4.vout is a video out exposing a frameSource.getFrame(); hd4.out is an
 * audio out resolving to host.audio.destination; the four hd4.vinN are declared video inputs;
 * unknown ids resolve to undefined. The full mount()/bootInto wiring is exercised in the browser
 * by the standalone Playwright suite, which stays green at its baseline.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import createModule from '../../js/rack-adapter.js'

/** A minimal fake host — only the fields the jack contract reads. No DOM needed. */
function buildHost() {
    const destination = { kind: 'gain', connect() {}, disconnect() {} } // stands in for the rack's per-module destination node
    const registered = [] // { defs, resolve } captured if registerJacks is called
    const host = {
        moduleId: 'hd4',
        container: { classList: { add() {}, remove() {} }, appendChild() {} },
        audio: { context: {}, destination, sampleRate: 48000 },
        transport: { bpm: 120, playing: false, subscribe() { return () => {} }, positionBeats() { return 0 } },
        registerJacks(defs, resolve) { registered.push({ defs, resolve }) },
        log() {},
    }
    return { host, destination, registered }
}

const EXPECTED = [
    ['hd4.vout', 'out', 'video'],
    ['hd4.out', 'out', 'audio'],
    ['hd4.vin1', 'in', 'video'],
    ['hd4.vin2', 'in', 'video'],
    ['hd4.vin3', 'in', 'video'],
    ['hd4.vin4', 'in', 'video'],
]

test('createModule returns the module instance shape', () => {
    const { host } = buildHost()
    const mod = createModule(host)
    for (const fn of ['mount', 'unmount', 'getJacks', 'resolveJack']) {
        assert.equal(typeof mod[fn], 'function', `instance exposes ${fn}()`)
    }
})

test('getJacks declares exactly the six HD4 jacks with correct dir + kind', () => {
    const { host } = buildHost()
    const mod = createModule(host)
    const jacks = mod.getJacks()
    assert.equal(jacks.length, 6, 'six jacks')
    const got = jacks.map((j) => [j.id, j.dir, j.kind]).sort()
    assert.deepEqual(got, [...EXPECTED].sort())
    // PGM / AUD / IN1..4 labels are present (faceplate + manifest use them).
    const labels = Object.fromEntries(jacks.map((j) => [j.id, j.label]))
    assert.equal(labels['hd4.vout'], 'PGM')
    assert.equal(labels['hd4.out'], 'AUD')
    assert.equal(labels['hd4.vin1'], 'IN1')
})

test('resolveJack(hd4.vout) returns a video endpoint with a frameSource.getFrame()', () => {
    const { host } = buildHost()
    const mod = createModule(host)
    const ep = mod.resolveJack('hd4.vout')
    assert.equal(ep.kind, 'video', 'video kind')
    assert.ok(ep.frameSource, 'has a frameSource')
    assert.equal(typeof ep.frameSource.getFrame, 'function', 'frameSource exposes getFrame()')
    // Before mount there is no program canvas yet; getFrame() must be safe (null), not throw.
    assert.doesNotThrow(() => ep.frameSource.getFrame())
    assert.equal(ep.frameSource.getFrame(), null, 'getFrame() is null until mounted')
})

test('resolveJack(hd4.out) returns an audio endpoint at host.audio.destination', () => {
    const { host, destination } = buildHost()
    const mod = createModule(host)
    const ep = mod.resolveJack('hd4.out')
    assert.equal(ep.kind, 'audio', 'audio kind')
    assert.equal(ep.node, destination, 'audio-out resolves to host.audio.destination (HD4 master bus)')
})

test('resolveJack(hd4.vinN) returns a declared video input endpoint for all four', () => {
    const { host } = buildHost()
    const mod = createModule(host)
    for (const id of ['hd4.vin1', 'hd4.vin2', 'hd4.vin3', 'hd4.vin4']) {
        const ep = mod.resolveJack(id)
        assert.deepEqual(ep, { kind: 'video' }, `${id} resolves to a bare video input`)
    }
})

test('resolveJack returns undefined for an unknown jack', () => {
    const { host } = buildHost()
    const mod = createModule(host)
    assert.equal(mod.resolveJack('nope'), undefined)
})
