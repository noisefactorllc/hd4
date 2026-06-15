// SPDX-License-Identifier: MIT
/**
 * transitionPlan — pure mapping from a switcher presentation + transition
 * type to a draw plan the 2D program compositor executes. The plan is the
 * testable decision ("single source / cross-dissolve / wipe"); the actual
 * drawImage calls are integration-tested.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transitionPlan } from '../../js/programCompositor.js'

test('idle presentation draws a single source (the live channel)', () => {
    const plan = transitionPlan({ transitioning: false, from: 3, to: 3, mix: 1 }, 'mix')
    assert.deepEqual(plan, { kind: 'single', channel: 3 })
})

test('an in-flight mix is a cross-dissolve from→to', () => {
    const plan = transitionPlan({ transitioning: true, from: 1, to: 2, mix: 0.3 }, 'mix')
    assert.deepEqual(plan, { kind: 'dissolve', from: 1, to: 2, mix: 0.3 })
})

test('an in-flight wipe is a wipe from→to', () => {
    const plan = transitionPlan({ transitioning: true, from: 1, to: 4, mix: 0.7 }, 'wipe')
    assert.deepEqual(plan, { kind: 'wipe', from: 1, to: 4, mix: 0.7 })
})

test('a non-wipe in-flight type defaults to a dissolve', () => {
    const plan = transitionPlan({ transitioning: true, from: 2, to: 3, mix: 0.5 }, 'cut')
    assert.equal(plan.kind, 'dissolve')
})
