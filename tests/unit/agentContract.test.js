// SPDX-License-Identifier: MIT
/**
 * Guards the agent contract: every command is described and has a schema and
 * a handler, llms-full.txt is current, handler defaults match the documented
 * ones, and llms.txt lists exactly the error codes the agent API returns.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { COMMAND_GROUPS } from '../../js/agent/descriptions.js'
import { SCHEMAS, validate } from '../../js/agent/schemas.js'
import { LLMS_PATH, LLMS_FULL_PATH, renderLlmsFull } from '../../scripts/build-llms-full.mjs'

const AGENT_DIR = new URL('../../js/agent/', import.meta.url)
const described = () => COMMAND_GROUPS.flatMap(group => Object.keys(group.commands))

test('every command has exactly one description and one schema entry', () => {
    const names = described()
    assert.deepEqual(names.filter((name, i) => names.indexOf(name) !== i), [], 'a command is described twice')
    assert.deepEqual([...names].sort(), Object.keys(SCHEMAS).sort())
})

test('every description says what the command does and returns', () => {
    for (const group of COMMAND_GROUPS) {
        for (const [name, entry] of Object.entries(group.commands)) {
            assert.ok(entry.does?.length > 10, `${name} does`)
            assert.ok(entry.returns?.length > 3, `${name} returns`)
            assert.ok(entry.remote === undefined || entry.remote === false, `${name} remote`)
        }
    }
})

test('every command has a handler in commands.js', async () => {
    const source = await readFile(new URL('commands.js', AGENT_DIR), 'utf8')
    const handlers = new Set([...source.matchAll(/^export (?:async )?function (\w+)/gm)].map(m => m[1]))
    assert.deepEqual(Object.keys(SCHEMAS).filter(name => !handlers.has(name)), [])
})

test('the relay keeps the shared wire protocol', async () => {
    const source = await readFile(new URL('relay.js', AGENT_DIR), 'utf8')
    assert.match(source, /export const RELAY = 'nf-agent\/1'/)
    assert.match(source, /const MAX_FRAME_BYTES = 60000\nconst MAX_SLICE_BYTES = 48000\nconst SEND_RATE = 4\nconst SEND_BURST = 8\nconst MAX_PENDING = 8\n/)
    // Only the tab that took the session online answers, while it owns the
    // session; '*' reaches only describe; no image crosses as text.
    assert.match(source, /const answering = \(\) => Boolean\(self\) && self === owner && created\.has\(session\)/)
    assert.match(source, /\} else if \(frame\.to !== tabId\) \{\n\s+return\n/)
    assert.match(source, /return \{ WebSocket: RelaySocket, tabId, sessionCreated \}/)
    assert.match(source, /'IMAGE_AS_TEXT'/)
    assert.match(source, /'OUTSIDE_LINK'/)
    assert.match(source, /onAgent\?\.\(\{ userId: frame\.user_id/)
    assert.match(source, /^import \{ API_VERSION, makeFailure, makeSuccess \} from '\.\/dispatcher\.js'$/m)
})

test('what the person keeps in the browser, and what needs them there, stays out of the session', async () => {
    const { REMOTE } = await import('../../js/agent/transports.js')
    const local = ['listMemory', 'saveMemory', 'recallMemory', 'getSettings', 'setSettings', 'setUserButton',
        'captureStill', 'listDevices', 'setCameraSource', 'setAudioInput', 'setRecording', 'openViewport']
    assert.deepEqual(local.filter(name => REMOTE.has(name)), [])
    assert.deepEqual(Object.keys(SCHEMAS).filter(name => !REMOTE.has(name)).sort(), [...local].sort())
    for (const name of ['getState', 'getProgram', 'getControls', 'setProgram', 'setSource', 'take', 'getThumbnail']) {
        assert.ok(REMOTE.has(name), name)
    }
})

test('llms-full.txt matches a fresh render (run node scripts/build-llms-full.mjs)', async () => {
    assert.equal(await readFile(LLMS_FULL_PATH, 'utf8'), await renderLlmsFull())
})

test('llms.txt lists every error code that the agent API returns', async () => {
    const codes = new Set()
    for (const name of await readdir(AGENT_DIR)) {
        if (!name.endsWith('.js')) continue
        const source = await readFile(new URL(name, AGENT_DIR), 'utf8')
        // commandError('X', ...), fail('X', ...), makeFailure(name, 'X', ...)
        const pattern = /(?:commandError|fail)\(\s*'([A-Z][A-Z_]+)'|makeFailure\(\w+,\s*'([A-Z][A-Z_]+)'/g
        for (const m of source.matchAll(pattern)) codes.add(m[1] || m[2])
    }
    for (const code of ['INVALID_PROGRAM', 'INVALID_ARGS_UNKNOWN', 'INTERNAL_ERROR', 'REMOTE_UNAVAILABLE', 'NOT_FOUND_COMMAND']) {
        assert.ok(codes.has(code), `the code scan no longer finds ${code}`)
    }
    const llms = await readFile(LLMS_PATH, 'utf8')
    assert.deepEqual([...codes].filter(code => !llms.includes(`| \`${code}\` |`)).sort(), [])
    // And the reverse: the table lists no code that the API no longer returns.
    const listed = [...llms.matchAll(/^\| `([A-Z][A-Z_]+)` \|/gm)].map(m => m[1])
    assert.deepEqual(listed.filter(code => !codes.has(code)).sort(), [])
})

test('the contract is plain text: no em dashes', async () => {
    for (const path of [LLMS_PATH, LLMS_FULL_PATH]) {
        assert.equal((await readFile(path, 'utf8')).includes(String.fromCharCode(0x2014)), false, path)
    }
})

test('a command with no arguments accepts only an empty object', () => {
    for (const [name, schema] of Object.entries(SCHEMAS)) {
        if (Object.keys(schema.properties).length) continue
        assert.equal(validate({}, schema).ok, true, name)
        assert.equal(validate({ force: true }, schema).code, 'INVALID_ARGS_UNKNOWN', name)
        assert.equal(validate('x', schema).code, 'INVALID_ARGS_TYPE', name)
    }
})

test('documented defaults match the handler defaults', async () => {
    const source = await readFile(new URL('commands.js', AGENT_DIR), 'utf8')
    for (const [name, schema] of Object.entries(SCHEMAS)) {
        for (const [field, spec] of Object.entries(schema.properties)) {
            if (spec.default === undefined) continue
            const literal = typeof spec.default === 'string' ? `'${spec.default}'` : String(spec.default)
            const signature = new RegExp(`export async function ${name}\\(\\{[^)]*\\b${field} = ${literal}[,\\s}]`)
            assert.match(source, signature, `${name}.${field} default ${literal}`)
        }
    }
})

test('schemas reject undeclared fields and accept declared ones', () => {
    assert.equal(validate({ dsl: 'x' }, SCHEMAS.setProgram).ok, true)
    assert.equal(validate({ dsl: 'x', channel: 4 }, SCHEMAS.setProgram).ok, true)
    assert.equal(validate({ dsl: 'x', force: true }, SCHEMAS.setProgram).code, 'INVALID_ARGS_UNKNOWN')
    assert.equal(validate({}, SCHEMAS.setProgram).code, 'INVALID_ARGS_REQUIRED')
    assert.equal(validate({ dsl: 'x', channel: 5 }, SCHEMAS.setProgram).code, 'INVALID_ARGS_RANGE')
    assert.equal(validate({ dsl: 'x'.repeat(64 * 1024 + 1) }, SCHEMAS.setProgram).code, 'INVALID_ARGS_RANGE')
    assert.equal(validate({ maxDimension: 2048 }, SCHEMAS.getThumbnail).code, 'INVALID_ARGS_RANGE')
    assert.equal(validate({ format: 'gif' }, SCHEMAS.getThumbnail).code, 'INVALID_ARGS_ENUM')
    assert.equal(validate({ source: 'Color Bars' }, SCHEMAS.setSource).ok, true)
    assert.equal(validate({ source: 'Noise' }, SCHEMAS.setSource).code, 'INVALID_ARGS_ENUM')
})

test('a source can be named by word or by channel number', () => {
    for (const source of ['program', 'preview', 1, 2, 3, 4]) {
        assert.equal(validate({ source }, SCHEMAS.getThumbnail).ok, true, String(source))
    }
    assert.equal(validate({ source: 5 }, SCHEMAS.getThumbnail).code, 'INVALID_ARGS_ENUM')
    assert.equal(validate({ source: '2' }, SCHEMAS.getThumbnail).code, 'INVALID_ARGS_ENUM')
    assert.equal(validate({ source: 1.5 }, SCHEMAS.getThumbnail).code, 'INVALID_ARGS_TYPE')
    assert.equal(validate({ source: true }, SCHEMAS.getThumbnail).code, 'INVALID_ARGS_TYPE')
    assert.equal(validate({ source: 'still' }, SCHEMAS.setKey).ok, true)
    assert.equal(validate({ source: 3 }, SCHEMAS.setKey).ok, true)
})

test('nested parameter sets are strict and range-checked', () => {
    assert.equal(validate({ mode: 'pinp', pinp: { source: 3, size: '1/3', shape: 'circle' } }, SCHEMAS.setComposition).ok, true)
    assert.equal(validate({ pinp: { colour: 'red' } }, SCHEMAS.setComposition).code, 'INVALID_ARGS_UNKNOWN')
    assert.equal(validate({ pinp: { hPosition: 80 } }, SCHEMAS.setComposition).code, 'INVALID_ARGS_RANGE')
    assert.equal(validate({ channel: 2, strip: { eqHi: 6, gate: true, compRatio: 4 } }, SCHEMAS.setAudioChannel).ok, true)
    assert.equal(validate({ channel: 2, strip: { eqHi: 30 } }, SCHEMAS.setAudioChannel).code, 'INVALID_ARGS_RANGE')
    assert.equal(validate({ channel: 2, strip: { auxSend: -60 } }, SCHEMAS.setAudioChannel).ok, true)
    assert.equal(validate({ bus: { reverbType: 'hall', mainMute: true } }, SCHEMAS.setAudioMain).ok, true)
    assert.equal(validate({ bus: { reverbType: 'plate' } }, SCHEMAS.setAudioMain).code, 'INVALID_ARGS_ENUM')
})
