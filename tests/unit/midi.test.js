// SPDX-License-Identifier: MIT
/**
 * MIDI control — message parsing, control signatures, and the learn/map
 * store. The live Web MIDI access is integration; the parsing and mapping
 * are pure.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMidiMessage, midiSignature, MidiMap, MIDI_FADERS } from '../../js/midi.js'

test('parseMidiMessage decodes note-on / note-off / CC and channel', () => {
    assert.deepEqual(parseMidiMessage([0x90, 60, 100]), { type: 'noteon', channel: 0, data1: 60, data2: 100 })
    assert.deepEqual(parseMidiMessage([0x80, 60, 0]), { type: 'noteoff', channel: 0, data1: 60, data2: 0 })
    assert.equal(parseMidiMessage([0x90, 60, 0]).type, 'noteoff') // velocity 0 = note-off
    assert.deepEqual(parseMidiMessage([0xB5, 7, 64]), { type: 'cc', channel: 5, data1: 7, data2: 64 })
})

test('parseMidiMessage ignores realtime / unsupported messages', () => {
    assert.equal(parseMidiMessage([0xF8]), null) // clock
    assert.equal(parseMidiMessage([]), null)
})

test('midiSignature groups note-on/off and tags CC by number', () => {
    assert.equal(midiSignature(parseMidiMessage([0x90, 60, 100])), 'note:60')
    assert.equal(midiSignature(parseMidiMessage([0x80, 60, 0])), 'note:60')
    assert.equal(midiSignature(parseMidiMessage([0xB0, 7, 10])), 'cc:7')
})

test('learn binds the next message to the armed target', () => {
    const m = new MidiMap()
    m.arm({ kind: 'action', id: 'freeze' })
    assert.equal(m.learning, true)
    const r = m.handle(parseMidiMessage([0xB0, 20, 127]))
    assert.equal(r.learned.signature, 'cc:20')
    assert.equal(m.learning, false)
    assert.equal(m.get('cc:20').id, 'freeze')
})

test('a mapped action fires on note-on / CC press, not on release', () => {
    const m = new MidiMap()
    m.bind('note:48', { kind: 'action', id: 'quad' })
    assert.deepEqual(m.handle(parseMidiMessage([0x90, 48, 100])), { action: 'quad' })
    assert.equal(m.handle(parseMidiMessage([0x80, 48, 0])), null) // release ignored
    // CC acts as a button: >=64 press, <64 release
    m.bind('cc:30', { kind: 'action', id: 'pinp' })
    assert.deepEqual(m.handle(parseMidiMessage([0xB0, 30, 127])), { action: 'pinp' })
    assert.equal(m.handle(parseMidiMessage([0xB0, 30, 0])), null)
})

test('a mapped fader returns a normalized 0..1 value', () => {
    const m = new MidiMap()
    m.bind('cc:7', { kind: 'fader', id: 'fader:main' })
    const r = m.handle(parseMidiMessage([0xB0, 7, 127]))
    assert.equal(r.fader, 'fader:main')
    assert.ok(Math.abs(r.value - 1) < 1e-9)
    assert.ok(Math.abs(m.handle(parseMidiMessage([0xB0, 7, 0])).value) < 1e-9)
})

test('unmapped messages return null', () => {
    const m = new MidiMap()
    assert.equal(m.handle(parseMidiMessage([0xB0, 99, 10])), null)
})

test('serialize / restore round-trips the mappings', () => {
    const m = new MidiMap()
    m.bind('cc:7', { kind: 'fader', id: 'fader:1' })
    m.bind('note:48', { kind: 'action', id: 'quad' })
    const m2 = new MidiMap()
    m2.restore(m.serialize())
    assert.equal(m2.get('cc:7').id, 'fader:1')
    assert.equal(m2.get('note:48').id, 'quad')
})

test('MIDI_FADERS lists the continuous targets', () => {
    assert.ok(MIDI_FADERS.some((f) => f.id === 'fader:main'))
    assert.ok(MIDI_FADERS.some((f) => f.id === 'transitionTime'))
})
