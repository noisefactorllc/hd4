// SPDX-License-Identifier: MIT
/**
 * Recorder — capture the program (canvas video + main-bus audio) to a file
 * via MediaRecorder. The codec walk and filename are pure and unit-tested;
 * the Recorder class wraps MediaRecorder (browser-only) and is integration-
 * tested. A software mixer records its program; hardware mixers relied on an
 * external USB capture.
 */

import { beginTake, appendTakeChunk } from './recordingStorage.js'

// WebM emits usable incremental data. Some MP4 encoders buffer the entire
// take until Stop, so they cannot provide an interruption checkpoint.
export const RECORDING_MIME_PREFERENCES = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
]

/** First supported mime from the preference list, or '' if none. */
export function pickMimeType(isSupported, prefs = RECORDING_MIME_PREFERENCES) {
    if (typeof isSupported !== 'function') return ''
    for (const m of prefs) {
        try { if (isSupported(m)) return m } catch { /* keep walking */ }
    }
    return ''
}

export function recordingExtension(mime = '') {
    return /mp4/.test(mime) ? 'mp4' : 'webm'
}

/** A timestamped download name, e.g. hd4-20260614-090307.webm. */
export function recordingFilename(date, mime) {
    const p = (n) => String(n).padStart(2, '0')
    const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`
        + `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
    return `hd4-${stamp}.${recordingExtension(mime)}`
}

export class Recorder {
    constructor({ MediaRecorderImpl, onError } = {}) {
        this._Impl = MediaRecorderImpl || (typeof window !== 'undefined' ? window.MediaRecorder : null)
        this._rec = null
        this._chunks = []
        this.state = 'idle'
        this.mimeType = ''
        this._startTime = 0
        this._onError = onError
        this._pending = Promise.resolve()
        this._stopping = null
    }

    get isSupported() { return !!this._Impl }
    get recording() { return this.state === 'recording' }

    /** Start recording a MediaStream. Returns true if it began. */
    async start(stream, { now = 0 } = {}) {
        if (this.state !== 'idle' || !this._Impl || !stream) return false
        this.state = 'starting'
        const mime = pickMimeType((m) => this._Impl.isTypeSupported(m))
        try {
            if (!mime) throw new Error('This browser cannot preserve WebM recordings')
            this._rec = new this._Impl(stream, { mimeType: mime })
            this._stream = stream
            this._chunks = []
            this._pending = Promise.resolve()
            this.storageError = null
            this.mimeType = this._rec.mimeType || mime
            const date = new Date()
            this.take = { id: crypto.randomUUID(), startedAt: date.getTime(), type: this.mimeType,
                filename: recordingFilename(date, this.mimeType), size: 0 }
            this._release = await beginTake(this.take)
            this._stopped = new Promise((resolve) => {
                this._rec.onstop = () => {
                    resolve()
                    if (!this._stopping) this._onError?.(new Error('The capture stream ended'))
                }
            })
            this._rec.ondataavailable = (e) => {
                if (!e.data?.size) return
                const index = this._chunks.length
                this._chunks.push(e.data)
                this.take.size += e.data.size
                const take = { ...this.take }
                this._pending = this._pending.then(async () => {
                    if (!this.storageError) await appendTakeChunk(take, index, e.data)
                }).catch((error) => {
                    this.storageError = error
                    this._onError?.(error)
                })
            }
            this._rec.onerror = (e) => this._onError?.(e.error || new Error('Recording failed'))
            this._rec.start(500)
            this.state = 'recording'
            this._startTime = now
            return true
        } catch (error) {
            this._release?.()
            stream.getVideoTracks().forEach((track) => track.stop())
            this._rec = null
            this.state = 'idle'
            throw error
        }
    }

    /** Stop and resolve to { blob, type }, or null if not recording. */
    async stop() {
        if (this._stopping) return this._stopping
        if (!this.recording) return null
        const rec = this._rec
        if (rec.state !== 'inactive') rec.stop()
        this._stopping = (async () => {
            await this._stopped
            await this._pending
            this.state = 'idle'
            const type = this.mimeType
            const blob = new Blob(this._chunks, { type })
            this._chunks = []
            this._stream.getVideoTracks().forEach((track) => track.stop())
            this._rec = null
            this._release?.()
            this._release = null
            this._stopping = null
            return { blob, type, id: this.take.id, filename: this.take.filename }
        })()
        return this._stopping
    }

    /** Milliseconds since start (0 when idle). */
    elapsed(now) { return this.recording ? Math.max(0, now - this._startTime) : 0 }
}
