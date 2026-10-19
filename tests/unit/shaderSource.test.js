// SPDX-License-Identifier: MIT
/**
 * Shader driver — start() compiles the source's DSL and rejects when the
 * compile fails, so the channel falls back to its previous source.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeShaderDriver } from '../../js/sources/shaderSource.js'
import { Channel } from '../../js/channel.js'
import { createSource } from '../../js/sources/sourceModel.js'

const GOOD = 'search synth\nsolid(color: #ff00ff).write(o0)\nrender(o0)'
const BAD = 'search synth\nnotAnEffect().write(o0)\nrender(o0)'

/** A ChannelRenderer stand-in: compile resolves { success } as the real one does. */
function fakeRenderer() {
    const compiled = []
    return {
        compiled,
        async compile(dsl) {
            compiled.push(dsl)
            return dsl === BAD ? { success: false, error: "Unknown effect: 'notAnEffect'" } : { success: true }
        },
    }
}

test('start resolves when the program compiles', async () => {
    const renderer = fakeRenderer()
    const result = await makeShaderDriver({ dsl: GOOD }, renderer).start()
    assert.deepEqual(result, { success: true })
    assert.deepEqual(renderer.compiled, [GOOD])
})

test('start rejects with the compile error when the program fails', async () => {
    const renderer = fakeRenderer()
    await assert.rejects(makeShaderDriver({ dsl: BAD }, renderer).start(), /Unknown effect: 'notAnEffect'/)
})

test('a compile a newer one overtook resolves without failing', async () => {
    const renderer = { compile: async () => ({ success: false, superseded: true }) }
    assert.deepEqual(await makeShaderDriver({ dsl: GOOD }, renderer).start(), { success: false, superseded: true })
})

test('a channel given a program that fails falls back to its previous source', async () => {
    const renderer = fakeRenderer()
    const channel = new Channel({ id: 3, canvas: {}, driverFactory: (source) => makeShaderDriver(source, renderer) })
    const previous = createSource('shader', { dsl: GOOD, name: 'Custom' })
    await channel.setSource(previous)
    await assert.rejects(channel.setSource(createSource('shader', { dsl: BAD, name: 'Custom' })))
    assert.equal(channel.source, previous)
    assert.deepEqual(renderer.compiled, [GOOD, BAD, GOOD]) // the fallback recompiles the previous program
})
