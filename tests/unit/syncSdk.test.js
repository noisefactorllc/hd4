// SPDX-License-Identifier: MIT
/**
 * The vendored Noisedeck Sync browser SDK is an immutable source snapshot:
 * its SHA256SUMS manifest is pinned here, every module must match the
 * manifest, nothing else may sit in the snapshot, and every module that loads
 * the SDK must load this snapshot.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SDK_DIR = resolve(ROOT, 'js/sync/sdk/0.3.3')
const MANIFEST_SHA256 = '4530db185a4d896799246c0e1f2ca862311ac453b563f86301f939e2c0659c97'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function filesBelow(directory, prefix = '') {
    const files = []
    for (const entry of await readdir(resolve(directory, prefix), { withFileTypes: true })) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) files.push(...await filesBelow(directory, path))
        else files.push(path)
    }
    return files.sort()
}

test('the Sync SDK 0.3.3 snapshot matches its pinned manifest exactly', async () => {
    const manifest = await readFile(resolve(SDK_DIR, 'SHA256SUMS'), 'utf8')
    assert.equal(sha256(manifest), MANIFEST_SHA256)
    const listed = []
    for (const line of manifest.trim().split('\n')) {
        const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/)
        assert.ok(match, `invalid SHA256SUMS line: ${line}`)
        listed.push(match[2])
        assert.equal(sha256(await readFile(resolve(SDK_DIR, match[2]))), match[1], match[2])
    }
    assert.deepEqual(await filesBelow(SDK_DIR), ['SHA256SUMS', ...listed].sort())
})

test('every Sync SDK consumer loads the pinned 0.3.3 snapshot', async () => {
    const jsRoot = resolve(ROOT, 'js')
    const references = []
    for (const file of await filesBelow(jsRoot)) {
        if (!file.endsWith('.js') || file.startsWith('sync/sdk/')) continue
        const source = await readFile(resolve(jsRoot, file), 'utf8')
        for (const match of source.matchAll(/sdk\/(\d+\.\d+\.\d+)\//g)) references.push([file, match[1]])
    }
    assert.deepEqual(references, [['sync/bundle.js', '0.3.3']])
})
