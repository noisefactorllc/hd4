// SPDX-License-Identifier: MIT
/**
 * A small agent for the relay spec: it joins a Seance session as a guest, as
 * the shared agent tool does, and speaks the `nf-agent/1` relay protocol to the
 * HD4 tab (request, response, announce; bodies too large for one frame travel
 * as text slices). Images go up and down as binary HTTP bodies.
 *
 * Like the agent tool, it trusts relay frames only from the session owner's
 * tab, by the sender the server stamps on each frame (`user_id`).
 *
 * Node 22's global WebSocket sends the page origin, which the server checks.
 */
import { randomUUID } from 'node:crypto'
import { PAGE_ORIGIN } from './seanceLocal.js'

const RELAY = 'nf-agent/1'
const MAX_FRAME_BYTES = 60000
const CHUNK_UNITS = 15000
// The control lane allows 5 frames a second; stay well under it.
const SEND_INTERVAL_MS = 250

function relayFrames(head, body) {
    const whole = { type: 'clicked-button', relay: RELAY, ...head, body }
    if (Buffer.byteLength(JSON.stringify(whole)) <= MAX_FRAME_BYTES) return [whole]
    const text = JSON.stringify(body)
    const slices = []
    for (let at = 0; at < text.length; at += CHUNK_UNITS) slices.push(text.slice(at, at + CHUNK_UNITS))
    return slices.map((chunk, part) => ({ type: 'clicked-button', relay: RELAY, ...head, part, parts: slices.length, chunk }))
}

/**
 * Join `sessionId` on `server` and resolve to the agent once the session
 * snapshot arrives.
 */
export function joinSession(server, sessionId, { origin = PAGE_ORIGIN } = {}) {
    const ws = new WebSocket(`${server.url.replace(/^http/, 'ws')}/v1/sessions/${encodeURIComponent(sessionId)}/ws`, { headers: { Origin: origin } })
    const docs = new Map()
    const pending = new Map()
    const partial = new Map()
    const announcements = []
    const received = []
    const edits = new Map()
    let authorSeq = 0
    let anonToken = null
    let ownerId = null
    let lastSend = 0

    const assemble = (frame) => {
        if (frame.body !== undefined) return frame.body
        const key = `${frame.kind}:${frame.id || frame.from}`
        const slices = partial.get(key) || []
        slices[frame.part] = frame.chunk
        partial.set(key, slices)
        if (slices.filter((slice) => slice !== undefined).length < frame.parts) return undefined
        partial.delete(key)
        return JSON.parse(slices.join(''))
    }

    const send = async (frame) => {
        const wait = lastSend + SEND_INTERVAL_MS - Date.now()
        if (wait > 0) await new Promise((done) => setTimeout(done, wait))
        lastSend = Date.now()
        ws.send(JSON.stringify(frame))
    }

    const agent = {
        docs,
        announcements,
        received,
        tab: null,
        get anonToken() { return anonToken },
        get ownerId() { return ownerId },
        docText: (id) => docs.get(id)?.text,

        /**
         * Replace a document's text as any participant can, and resolve once
         * the server accepted the edit.
         */
        editDoc(docId, text) {
            const doc = docs.get(docId)
            const seq = ++authorSeq
            const accepted = new Promise((resolve, reject) => edits.set(seq, { resolve, reject }))
            ws.send(JSON.stringify({ type: 'doc-edit', docId, baseRev: doc.rev, authorSeq: seq, edit: { start: 0, end: doc.text.length, text } }))
            return accepted
        },

        /** Ask every tab to describe itself ('*' reaches only describe); remember the owner's tab. */
        async describe({ timeoutMs } = {}) {
            const reply = await agent.call('describe', {}, { to: '*', timeoutMs })
            agent.tab = reply.from
            return reply
        },

        /** Run a command in the owner's tab; resolves to its reply. */
        async call(command, args = {}, { to = agent.tab, timeoutMs = 60000 } = {}) {
            const id = randomUUID()
            const reply = new Promise((resolve, reject) => {
                const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${command}: no reply`)) }, timeoutMs)
                pending.set(id, (frame, body) => { clearTimeout(timer); resolve({ from: frame.from, app: frame.app, envelope: body }) })
            })
            for (const frame of relayFrames({ kind: 'request', id, to }, { command, args })) await send(frame)
            return reply
        },

        async uploadImage(bytes, mimeType) {
            const response = await fetch(`${server.url}/v1/sessions/${encodeURIComponent(sessionId)}/images`, {
                method: 'POST',
                headers: { Origin: origin, 'X-Seance-Anon': anonToken, 'Content-Type': mimeType },
                body: bytes,
            })
            if (!response.ok) throw new Error(`image upload failed (${response.status})`)
            return response.json()
        },

        async downloadImage(id) {
            const response = await fetch(`${server.url}/v1/sessions/${encodeURIComponent(sessionId)}/images/${id}`, {
                headers: { Origin: origin, 'X-Seance-Anon': anonToken },
            })
            if (!response.ok) throw new Error(`image download failed (${response.status})`)
            return { bytes: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type') }
        },

        close() { ws.close() },
    }

    return new Promise((resolve, reject) => {
        ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'hello', protocol: 1, dialects: ['hd4'] })))
        ws.addEventListener('error', () => reject(new Error('the session socket failed')))
        ws.addEventListener('close', (event) => reject(new Error(`the session closed (${event.code})`)))
        ws.addEventListener('message', (event) => {
            const frame = JSON.parse(event.data)
            received.push(frame)
            if (frame.type === 'welcome') {
                anonToken = frame.anon_token || anonToken
                ownerId = frame.owner?.user_id || null
            } else if (frame.type === 'owner-changed') {
                ownerId = frame.user_id || null
            } else if (frame.type === 'session-snapshot' || frame.type === 'doc-snapshot') {
                for (const doc of frame.docs || []) docs.set(doc.id, { ...doc })
                if (frame.type === 'session-snapshot') resolve(agent)
            } else if (frame.type === 'doc-ack' || frame.type === 'doc-reject') {
                const doc = docs.get(frame.docId)
                if (frame.type === 'doc-ack' && doc) {
                    doc.text = doc.text.slice(0, frame.edit.start) + frame.edit.text + doc.text.slice(frame.edit.end)
                    doc.rev = frame.rev
                }
                const waiter = edits.get(frame.authorSeq)
                edits.delete(frame.authorSeq)
                if (frame.type === 'doc-ack') waiter?.resolve(frame.rev)
                else waiter?.reject(new Error(`edit refused: ${frame.reason}`))
            } else if (frame.type === 'doc-edit') {
                const doc = docs.get(frame.docId)
                if (doc) {
                    doc.text = doc.text.slice(0, frame.edit.start) + frame.edit.text + doc.text.slice(frame.edit.end)
                    doc.rev = frame.rev
                }
            } else if (frame.type === 'clicked-button' && frame.relay === RELAY) {
                if (frame.kind !== 'response' && frame.kind !== 'announce') return
                if (!ownerId || frame.user_id !== ownerId) return
                const body = assemble(frame)
                if (body === undefined) return
                if (frame.kind === 'announce') announcements.push({ from: frame.from, app: frame.app, body })
                else pending.get(frame.id)?.(frame, body)
                pending.delete(frame.id)
            }
        })
    })
}
