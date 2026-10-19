// SPDX-License-Identifier: MIT
/**
 * A real Seance server on loopback for the online-collaboration and agent
 * relay specs, and the routing that points the page at it.
 *
 * Configure a local Seance build with three environment variables:
 *   SEANCE_ROOT       a Seance checkout (default ../seance)
 *   SEANCE_PYTHON     a Python with the server's requirements (default <root>/.venv/bin/python)
 *   SEANCE_DIST_DIR   the browser SDK bundle directory, holding index.js (default <root>/dist)
 *
 * The page imports the SDK from its production URL; the route serves the
 * local bundle in its place, and __HD4_SEANCE_CONFIG__ names the local server.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import net from 'node:net'

const root = resolve(process.env.SEANCE_ROOT || '../seance')
const dist = resolve(process.env.SEANCE_DIST_DIR || join(root, 'dist'))
const python = process.env.SEANCE_PYTHON || join(root, '.venv/bin/python')

/** The origin the Playwright pages load HD4 from (playwright.config.js). */
export const PAGE_ORIGIN = 'http://localhost:3014'

export async function routeSeance(page, server) {
    await page.addInitScript((seanceUrl) => { window.__HD4_SEANCE_CONFIG__ = { seanceUrl } }, server.url)
    await page.route('https://seance.noisefactor.io/sdk/0/**', (route) => {
        const relative = new URL(route.request().url()).pathname.slice('/sdk/0/'.length)
        const file = resolve(dist, relative)
        if (!file.startsWith(`${dist}${sep}`) || !existsSync(file)) return route.fulfill({ status: 404 })
        return route.fulfill({ path: file, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } })
    })
}

function freePort() {
    return new Promise((resolvePort, reject) => {
        const listener = net.createServer()
        listener.on('error', reject)
        listener.listen(0, '127.0.0.1', () => {
            const { port } = listener.address()
            listener.close(() => resolvePort(port))
        })
    })
}

/** Start a Seance server with an empty database. Resolves to { url, stop }. */
export async function startSeanceServer() {
    if (!existsSync(join(dist, 'index.js')) || !existsSync(python)) {
        throw new Error('Set SEANCE_ROOT, SEANCE_DIST_DIR and SEANCE_PYTHON to a local Seance build for this integration test.')
    }
    const port = await freePort()
    const directory = mkdtempSync(join(tmpdir(), 'hd4-seance-'))
    const proc = spawn(python, [join(root, 'bin/app.py')], {
        cwd: root,
        env: {
            ...process.env,
            PYTHONPATH: [root, process.env.PYTHONPATH].filter(Boolean).join(':'),
            SEANCE_BIND: `127.0.0.1:${port}`,
            SEANCE_SECRET: randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
            SEANCE_DB: join(directory, 'seance.db'),
            SEANCE_ALLOWED_ORIGINS: PAGE_ORIGIN,
            SEANCE_TRUSTED_PROXIES: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let logs = ''
    proc.stdout.on('data', (data) => { logs += data })
    proc.stderr.on('data', (data) => { logs += data })
    const url = `http://127.0.0.1:${port}`
    const stop = async () => {
        if (proc.exitCode === null) {
            proc.kill('SIGTERM')
            await new Promise((done) => {
                const timer = setTimeout(() => { proc.kill('SIGKILL'); done() }, 1500)
                proc.once('exit', () => { clearTimeout(timer); done() })
            })
        }
        rmSync(directory, { recursive: true, force: true })
    }
    try {
        const deadline = Date.now() + 15000
        while (Date.now() < deadline) {
            if (proc.exitCode !== null) throw new Error(`Seance startup failed: ${logs}`)
            try {
                if ((await fetch(`${url}/up`, { signal: AbortSignal.timeout(1000) })).ok) return { url, stop }
            } catch { /* the server is still starting */ }
            await new Promise((done) => setTimeout(done, 100))
        }
        throw new Error(`Seance startup timed out: ${logs}`)
    } catch (error) {
        await stop()
        throw error
    }
}
