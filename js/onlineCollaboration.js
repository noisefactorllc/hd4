// SPDX-License-Identifier: MIT
/**
 * HD4 ↔ Seance online collaboration.
 *
 * HD4 presents its four channels as one Seance session (dialect `hd4`) with
 * four documents, `channel:1` .. `channel:4`, of kind `noisemaker-dsl`. A
 * channel whose source is a shader program holds that program's text; any
 * other channel holds empty text. Cameras, video and image files never leave
 * this computer: empty text is never applied, so a peer's camera channel
 * keeps its camera.
 *
 * A channel change is published once its program runs. A program from the
 * session is applied to its channel like a pasted one: a program that does
 * not compile leaves the channel on its previous source, and that fallback is
 * not published back. Images a program names (image:<sha256>) travel as
 * binary uploads, never as text.
 *
 * The SDK's socket also carries the agent relay (agent/relay.js), through the
 * WebSocket class the app passes in. Status reaches the person through the
 * <seance-dialog> and HD4's readout.
 */

import { heldImage, programImageIds, setImageResolver } from './programImages.js'

export const DEFAULT_SEANCE_URL = 'https://seance.noisefactor.io'
// Bypass browsers that cached the older alias without Cache-Control, and SDKs
// from before seed images could be Blobs.
export const DEFAULT_SEANCE_SDK_URL = 'https://seance.noisefactor.io/sdk/0/index.js?v=images-20261006'
/** The session dialect: HD4 joins only sessions that HD4 created. */
export const SESSION_DIALECT = 'hd4'
export const CHANNEL_NUMBERS = [1, 2, 3, 4]

export function docIdForChannel(channel) {
    return `channel:${channel}`
}

/** The text a channel's document holds: its program, or nothing. */
export function channelProgramText(source) {
    return source?.type === 'shader' ? String(source.dsl || '') : ''
}

/**
 * Copy for a server refusal, chosen by the wire `code`, never by message text.
 *
 * Seance answers a refused join with an `error` frame and closes. `forbidden`
 * covers four different situations that share one code, so its `detail`
 * refines the wording, and only the wording: the decision to stop retrying is
 * made from the code alone.
 *
 * @param {Object} frame - error frame or Error carrying `.code` / `.frame`
 * @returns {string|null} copy for the user, or null when this is not a refusal
 */
export function refusalMessage(frame) {
    const code = frame?.code || frame?.frame?.code
    const detail = String(frame?.detail || frame?.frame?.detail || '')
    switch (code) {
        case 'unknown_session':
            return 'that session has expired or does not exist'
        case 'dialect_mismatch':
            return 'that session belongs to a different app'
        case 'unauthorized':
            return 'that session did not accept your identity'
        case 'forbidden':
            if (detail.includes('roster full') || detail.includes('too many connections')) {
                return 'that session is full'
            }
            if (detail.includes('locked')) return 'that session is locked'
            if (detail.includes('banned')) return 'you cannot rejoin that session'
            return 'that session refused the connection'
        default:
            return null
    }
}

/** The readout's short form of refusalMessage(frame), or null. */
export function refusalReadout(frame) {
    const message = refusalMessage(frame)
    if (!message) return null
    return {
        'that session has expired or does not exist': 'EXPIRED',
        'that session belongs to a different app': 'OTHER APP',
        'that session is full': 'FULL',
        'that session is locked': 'LOCKED',
        'you cannot rejoin that session': 'BANNED',
    }[message] || 'REFUSED'
}

export async function createHD4OnlineCollaboration(options) {
    const runtimeConfig = globalThis.__HD4_SEANCE_CONFIG__ || {}
    const controller = new HD4OnlineController({
        ...options,
        sdkUrl: runtimeConfig.sdkUrl || options.sdkUrl || DEFAULT_SEANCE_SDK_URL,
        seanceUrl: runtimeConfig.seanceUrl || options.seanceUrl || DEFAULT_SEANCE_URL,
    })
    controller.syncStatusUi()
    return controller
}

class HD4OnlineController {
    constructor({
        sdkUrl,
        seanceUrl,
        channels,
        renderers,
        applyRemoteText,
        createSocketClass = null,
        dialog,
        report = () => {},
        location = globalThis.location,
        history = globalThis.history,
        clipboard = globalThis.navigator?.clipboard,
    }) {
        this.ready = true
        this.online = null
        this._onlinePromise = null
        this._sdkReportsDisconnect = false
        this._refusalAnnounced = false
        this._actionInFlight = false
        this._actionVersion = 0
        this.sdkUrl = sdkUrl
        this.seanceUrl = seanceUrl
        this.channels = channels
        this.renderers = renderers
        this.applyRemoteText = applyRemoteText
        this.createSocketClass = createSocketClass
        this.dialog = dialog
        this.report = report
        this.location = location
        this.history = history
        this.clipboard = clipboard
        // What each channel document holds on this side: the SDK binding
        // reads and writes it in place of an editor's text.
        this._docText = CHANNEL_NUMBERS.map(() => '')
        // The channel source last seen by syncChannels(), and whether its
        // change still waits to be published.
        this._seen = CHANNEL_NUMBERS.map((n) => ({ source: channels[n - 1].source, pending: false }))
        // Program text whose images are uploading, per channel.
        this._publishing = CHANNEL_NUMBERS.map(() => null)
        // Image ids the current session holds.
        this._uploaded = new Set()
        this._imageSessionVersion = 0

        setImageResolver((id) => this.getImage(id))
        this._wireUi()
    }

    /**
     * Publish channel changes. Call once a frame: a change is published once
     * its program runs (or at once for a source that is not a program).
     */
    syncChannels() {
        for (const n of CHANNEL_NUMBERS) {
            const seen = this._seen[n - 1]
            const source = this.channels[n - 1].source
            if (source !== seen.source) {
                seen.source = source
                seen.pending = true
            }
            if (!seen.pending) continue
            // A program that is still compiling, or that fails and falls back, waits.
            if (source?.type === 'shader' && this.renderers[n - 1].currentDsl !== source.dsl) continue
            seen.pending = false
            this._publish(n, channelProgramText(source))
        }
    }

    _publish(n, text) {
        const i = n - 1
        if (!this.online || this._docText[i] === text || this._publishing[i] === text) return
        const status = this.getStatus()
        if (!this.getSessionId() || status === 'offline' || status === 'readonly') return
        this._publishing[i] = null
        if (programImageIds(text).some((id) => !this._uploaded.has(id))) {
            this._publishing[i] = text
            this._publishImageText(n, text)
            return
        }
        this._docText[i] = text
        this.online.updateLocalText(docIdForChannel(n), text, { source: 'channel' })
    }

    /**
     * Upload the images a program names, then publish it. A newer change or
     * session wins. An image that cannot be shared leaves its reference in the
     * program: peers then show that media step empty, as they would offline.
     */
    async _publishImageText(n, text) {
        const i = n - 1
        const online = this.online
        const session = this.getSessionId()
        const imageSession = this._imageSessionVersion
        const current = () => this._publishing[i] === text && this.online === online
            && this.getSessionId() === session && this._imageSessionVersion === imageSession
        for (const id of programImageIds(text)) {
            if (this._uploaded.has(id)) continue
            const blob = heldImage(id)
            if (!blob) continue
            let uploaded = false
            try {
                await online.uploadImage(blob)
                uploaded = true
            } catch (err) {
                if (current()) this._announce(`image ${id} was not shared: ${err?.message || err}`, 'IMAGE FAILED')
            }
            if (!current()) return
            if (uploaded) this._uploaded.add(id)
        }
        if (!current()) return
        this._publishing[i] = null
        this._docText[i] = text
        online.updateLocalText(docIdForChannel(n), text, { source: 'channel' })
    }

    async _applyRemote(n, text, context) {
        if (!String(text ?? '').trim()) return
        const outcome = await this.applyRemoteText(n, text, context)
        if (outcome?.status !== 'applied') {
            // The channel kept (or fell back to) its own source. That is no
            // local change, so it is not published over the session's text.
            this._seen[n - 1] = { source: this.channels[n - 1].source, pending: false }
        }
    }

    /** An image of the current session, as a Blob. */
    async getImage(id) {
        const online = await this._ensureOnline()
        const blob = await online.getImage(id)
        this._uploaded.add(id)
        return blob
    }

    async takeOnline() {
        if (this._actionInFlight) return
        this._actionInFlight = true
        const version = ++this._actionVersion
        try {
            this._refusalAnnounced = false
            this._setBusy(true)
            await this._ensureOnline()
            if (version !== this._actionVersion) return
            this._closeActiveSession()
            const docs = this._seedDocs()
            const images = []
            for (const id of new Set(docs.flatMap((doc) => programImageIds(doc.text)))) {
                const blob = heldImage(id)
                if (blob) images.push({ id, blob })
            }
            this._adoptLocalState(docs)
            await this.online.takeOnline(images.length ? { docs, images: images.map((image) => image.blob) } : docs)
            if (version !== this._actionVersion) return
            for (const image of images) this._uploaded.add(image.id)
            this._writeSessionToUrl(this.online.getSessionId())
            this.syncStatusUi()
            this.report('ONLINE', 'READY')
        } catch (err) {
            console.error('[seance] take online failed', err)
            if (!this._refusalAnnounced) this._announce(`online failed: ${refusalMessage(err) || err?.message || err}`, refusalReadout(err) || 'FAILED')
        } finally {
            this._actionInFlight = false
            this._setBusy(false)
        }
    }

    async joinSession(sessionId, { writeUrl = true } = {}) {
        const id = String(sessionId || '').trim()
        if (!id || this._actionInFlight) return
        this._actionInFlight = true
        try {
            this._refusalAnnounced = false
            this._setBusy(true)
            await this._ensureOnline()
            this._closeActiveSession()
            // The session's programs replace the local ones; nothing local is published on joining.
            this._adoptLocalState(this._seedDocs())
            await this.online.joinSession(id)
            if (writeUrl) this._writeSessionToUrl(id)
            this.syncStatusUi()
            this.report('ONLINE', 'JOINED')
        } catch (err) {
            console.error('[seance] join failed', err)
            if (!this._refusalAnnounced) this._announce(`join failed: ${refusalMessage(err) || err?.message || err}`, refusalReadout(err) || 'FAILED')
        } finally {
            this._actionInFlight = false
            this._setBusy(false)
        }
    }

    async joinFromUrlIfPresent() {
        const sessionId = this._readSessionFromUrl()
        if (!sessionId) return
        await this.joinSession(sessionId, { writeUrl: false })
    }

    goOffline() {
        this._actionVersion++
        this._closeActiveSession()
        this._writeSessionToUrl(null)
        this.syncStatusUi()
        this.report('ONLINE', 'OFF')
    }

    getSessionId() {
        return this.online?.getSessionId?.() || null
    }

    getStatus() {
        return this.online?.getStatus?.() || 'offline'
    }

    getShareUrl() {
        return this._writeSessionToUrlString(this.getSessionId())
    }

    syncStatusUi() {
        if (!this.dialog) return
        const status = this.getStatus()
        const onlineStatus = status === 'online' || status === 'readonly'
        const sessionId = this.getSessionId() || ''
        const shareUrl = onlineStatus ? this.getShareUrl() : ''

        // Drive the seance-dialog's internal view via its state; the dialog
        // is shown by its own trigger (the go-online top-bar button), so never
        // toggle its visibility here.
        this.dialog.state = onlineStatus ? status : (status === 'connecting' ? 'connecting' : 'offline')
        this.dialog.sessionId = onlineStatus ? sessionId : ''
        this.dialog.sessionUrl = shareUrl
    }

    /** Show a status: the full copy in the console, its short form on the readout. */
    _announce(copy, readout) {
        console.warn(`[seance] ${copy}`)
        this.report('ONLINE', readout)
    }

    async _ensureOnline() {
        if (this.online) return this.online
        if (this._onlinePromise) return this._onlinePromise

        this._onlinePromise = import(this.sdkUrl)
            .then((sdk) => {
                // The agent relay rides the SDK's own socket (agent/relay.js).
                const SocketClass = this.createSocketClass?.({ uploadImage: (blob) => this.online.uploadImage(blob) })
                this.online = sdk.createOnlineDslLayer({
                    seanceUrl: this.seanceUrl,
                    dialect: SESSION_DIALECT,
                    defaultDocId: docIdForChannel(1),
                    location: this.location,
                    publicAppUrl: this.location?.href,
                    ...(SocketClass ? { WebSocket: SocketClass } : {}),
                })
                this.online.on('status', () => this.syncStatusUi())
                this.online.on('doc-reject', (info) => {
                    if (info?.reason === 'reconnect_ambiguous' || info?.reason === 'readonly_draft') {
                        this._announce('Sync paused to protect your changes. Rejoin the session to share them again.', 'PAUSED')
                    } else if (info?.reason === 'missing_document') {
                        this._announce(`${info.docId} is not part of this session; it stays local.`, 'NOT SHARED')
                    }
                })
                this.online.on('snapshot', () => this.syncStatusUi())
                // Newer SDKs report a terminal close as its own event and stop
                // retrying by themselves. Subscribing costs nothing on the
                // bundle that never emits it, and we defer to it when it does.
                this.online.on('disconnect', (info) => {
                    this._sdkReportsDisconnect = true
                    const message = refusalMessage(info) || refusalMessage(info?.error)
                    if (message) this._announce(message, refusalReadout(info) || refusalReadout(info?.error))
                    this.syncStatusUi()
                })
                this.online.on('error', (err) => {
                    console.warn('[seance]', err?.message || err)
                    const message = refusalMessage(err)
                    if (message && this.getStatus() === 'connecting') {
                        // Terminal, but the deployed SDK retries it forever and
                        // re-emits this event every time, leaving the dialog
                        // stuck on "Connecting" whose only controls are hidden.
                        // Stop, and say why once.
                        if (!this._sdkReportsDisconnect) this._closeActiveSession()
                        if (!this._refusalAnnounced) {
                            this._refusalAnnounced = true
                            this._announce(message, refusalReadout(err))
                        }
                        this.syncStatusUi()
                        return
                    }
                    this._announce(`online: ${message || err?.message || err}`, refusalReadout(err) || 'ERROR')
                })
                this._bindChannels()
                this.syncStatusUi()
                return this.online
            })
            .catch((err) => {
                this._onlinePromise = null
                throw err
            })
        return this._onlinePromise
    }

    /**
     * Bind each channel document. HD4 has no text editor: the channel is the
     * document's view, so the binding reads and writes this side's copy of
     * the text and hands remote programs to the app.
     */
    _bindChannels() {
        for (const n of CHANNEL_NUMBERS) {
            this.online.bindEditor({
                docId: docIdForChannel(n),
                editor: { channel: n },
                getText: () => this._docText[n - 1],
                setText: (text) => { this._docText[n - 1] = String(text ?? '') },
                onRemoteText: (text, context) => {
                    this._applyRemote(n, text, context).catch((err) => console.error('[seance] remote program not applied', err))
                },
            })
        }
    }

    _wireUi() {
        // All collaboration intents arrive from the single seance-dialog as
        // semantic events.
        const dialog = this.dialog
        dialog?.addEventListener('take-online', () => this.takeOnline())
        dialog?.addEventListener('join-session', (event) => {
            this.joinSession(event.detail?.sessionId)
        })
        dialog?.addEventListener('go-offline', () => this.goOffline())
        dialog?.addEventListener('copy-url', async (event) => {
            const url = event.detail?.sessionUrl || this.getShareUrl()
            if (!url) return
            try {
                await this.clipboard?.writeText?.(url)
                this.report('ONLINE', 'URL COPIED')
            } catch {
                this._announce(`online URL: ${url}`, 'COPY FAILED')
            }
        })
    }

    _seedDocs() {
        return CHANNEL_NUMBERS.map((n) => ({
            id: docIdForChannel(n),
            title: `HD4 Channel ${n}`,
            kind: 'noisemaker-dsl',
            text: channelProgramText(this.channels[n - 1].source),
            default: n === 1,
        }))
    }

    /** Take these documents as what this side holds, with nothing left to publish. */
    _adoptLocalState(docs) {
        docs.forEach((doc, i) => {
            this._docText[i] = doc.text
            this._seen[i] = { source: this.channels[i].source, pending: false }
            this._publishing[i] = null
        })
    }

    _writeSessionToUrl(sessionId) {
        const next = this._writeSessionToUrlString(sessionId)
        this.history?.replaceState?.(null, '', next)
    }

    _writeSessionToUrlString(sessionId) {
        const url = urlFrom(this.location)
        url.searchParams.delete('code')
        if (sessionId) {
            url.searchParams.set('seance', sessionId)
        } else {
            url.searchParams.delete('seance')
        }
        return url.toString()
    }

    _readSessionFromUrl() {
        return urlFrom(this.location).searchParams.get('seance')
    }

    _closeActiveSession() {
        this._imageSessionVersion++
        this._uploaded.clear()
        this._publishing = CHANNEL_NUMBERS.map(() => null)
        if (!this.online) return
        if (this.online.getStatus?.() === 'offline' && !this.online.getSessionId?.()) return
        this.online.goOffline?.()
    }

    _setBusy(busy) {
        // The dialog owns its own DOM. Reach its two controls through their
        // stable data-action hooks so a rapid double-click can't fire
        // takeOnline()/joinSession() twice before the SDK's own 'status'
        // events start flowing through syncStatusUi().
        const takeControl = this.dialog?.querySelector?.('[data-action="take-online"]')
        const joinControl = this.dialog?.querySelector?.('[data-action="join"]')
        if (takeControl) takeControl.disabled = busy || this.getStatus() === 'online'
        if (joinControl) joinControl.disabled = busy
    }
}

function urlFrom(locationLike) {
    if (typeof locationLike === 'string') return new URL(locationLike, globalThis.location?.href || 'http://localhost/')
    if (locationLike instanceof URL) return new URL(locationLike.toString())
    if (locationLike?.href) return new URL(locationLike.href)
    return new URL(globalThis.location?.href || 'http://localhost/')
}
