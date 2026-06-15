// SPDX-License-Identifier: MIT
/**
 * Transition descriptors — pure mapping from a transition type to the
 * Noisemaker mixer effect that renders it and the formula that turns the
 * switcher's mix (0→1, from→to) into that effect's driver parameter.
 * Mirrors visualize's mixers.js. CUT needs no effect (the switcher snaps).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTransition, buildTransitionArgs, TRANSITIONS } from '../../js/transitions.js'

test('mix maps to mixer/blendMode in "mix" mode', () => {
    const t = getTransition('mix')
    assert.equal(t.id, 'mixer/blendMode')
    assert.equal(t.effect, 'blendMode')
    assert.equal(t.driver, 'mix')
})

test('wipe maps to mixer/split', () => {
    const t = getTransition('wipe')
    assert.equal(t.id, 'mixer/split')
    assert.equal(t.effect, 'split')
    assert.equal(t.driver, 'position')
})

test('an unknown transition type falls back to mix', () => {
    assert.equal(getTransition('cut').id, 'mixer/blendMode')
    assert.equal(getTransition('bogus').id, 'mixer/blendMode')
})

test('the mix driver formula spans pure-from to pure-to (−100→100)', () => {
    const { driverFormula } = TRANSITIONS.mix
    assert.equal(driverFormula(0), -100)
    assert.equal(driverFormula(0.5), 0)
    assert.equal(driverFormula(1), 100)
})

test('the wipe driver formula sweeps the split boundary (+1→−1)', () => {
    const { driverFormula } = TRANSITIONS.wipe
    assert.equal(driverFormula(0), 1)
    assert.equal(driverFormula(0.5), 0)
    assert.equal(driverFormula(1), -1)
})

test('buildTransitionArgs renders the mix effect call args', () => {
    assert.equal(buildTransitionArgs(getTransition('mix'), 0), 'tex: read(o1), mix: -100, mode: mix')
    assert.equal(buildTransitionArgs(getTransition('mix'), 1), 'tex: read(o1), mix: 100, mode: mix')
})

test('buildTransitionArgs renders the wipe effect call args', () => {
    assert.equal(buildTransitionArgs(getTransition('wipe'), 0), 'tex: read(o1), position: 1, softness: 0.05, rotation: 0')
})
