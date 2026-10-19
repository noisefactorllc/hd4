// SPDX-License-Identifier: MIT
/**
 * HD4 Agent API: a JSON command surface on window.HD4Agent for software
 * agents that control HD4. The contract's source is llms.txt at the site
 * root. llms-full.txt adds the command reference.
 *
 * The same commands reach an agent two more ways: WebMCP page tools
 * (`hd4_<command>`), and the Seance relay that answers an agent in the
 * session this tab took online.
 *
 * @module agent
 */

import { API_VERSION, makeFailure, registerCommand, runCommand } from './dispatcher.js'
import { SCHEMAS } from './schemas.js'
import * as commands from './commands.js'
import { catalog, registerWebMCP, REMOTE } from './transports.js'
import { createAgentRelay } from './relay.js'

let _readyResolve
export const HD4Agent = {
    version: API_VERSION,
    ready: new Promise((resolve) => { _readyResolve = resolve }),
}

if (typeof window !== 'undefined') {
    window.HD4Agent = HD4Agent
}

/**
 * Register every command. Call once the channels, switcher, mixer and
 * panels are built. `ready` resolves later, from markAgentReady(). A rack
 * remount calls this again with the new instance's context.
 *
 * @param {object} ctx - The app's modules and `controls` (see commands.js).
 */
export function bootstrapAgent(ctx) {
    Object.defineProperty(HD4Agent, '_ctx', { value: ctx, enumerable: false, configurable: true, writable: true })
    for (const name of Object.keys(SCHEMAS)) {
        registerCommand(HD4Agent, name, commands[name])
    }
    registerWebMCP(HD4Agent)
}

/**
 * Resolve `ready` once app startup has finished, so an agent's first command
 * does not race the startup sources.
 */
export function markAgentReady() {
    _readyResolve()
}

function unavailable(command) {
    if (!SCHEMAS[command]) return makeFailure(command, 'NOT_FOUND_COMMAND', `Unknown command: ${command}`)
    return makeFailure(command, 'REMOTE_UNAVAILABLE',
        `${command} needs the person at the browser and is not available through a session.`)
}

/**
 * The Seance relay for this tab (see relay.js): its WebSocket class goes to the
 * Seance SDK, and sessionCreated marks a session this tab took online. Commands
 * run with `remote: true`, so they show only what the session may see.
 *
 * @param {{appVersion: string, uploadImage: (blob: Blob) => Promise<string>}} options
 * @returns {{ WebSocket: typeof WebSocket, sessionCreated: (sessionId: string) => void }}
 */
export function createSeanceAgentRelay({ appVersion, uploadImage }) {
    return createAgentRelay({
        app: 'hd4',
        appVersion,
        catalog,
        uploadImage,
        async invoke(command, args) {
            if (!REMOTE.has(command)) return { envelope: unavailable(command) }
            await HD4Agent.ready
            return runCommand(command, args, { remote: true })
        },
    })
}
