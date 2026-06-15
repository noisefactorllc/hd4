// SPDX-License-Identifier: MIT
/**
 * Harness sanity — proves the Node test runner is wired up and that the
 * pure-logic test suite runs with zero dependencies and no browser.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('node test runner executes', () => {
    assert.equal(1 + 1, 2)
})

test('ESM import works in the test environment', async () => {
    const url = await import('node:url')
    assert.equal(typeof url.pathToFileURL, 'function')
})
