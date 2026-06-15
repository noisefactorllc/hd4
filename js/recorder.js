// SPDX-License-Identifier: MIT
/**
 * Recorder — capture the program (canvas video + main-bus audio) to a file
 * via MediaRecorder. The codec walk and filename are pure and unit-tested;
 * the Recorder class wraps MediaRecorder (browser-only) and is integration-
 * tested. A software mixer records its program; hardware mixers relied on an
 * external USB capture.
 */

/** Preferred container/codec combos, best first. */
export const RECORDING_MIME_PREFERENCES = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
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
    constructor({ MediaRecorderImpl } = {}) {
        this._Impl = MediaRecorderImpl || (typeof window !== 'undefined' ? window.MediaRecorder : null)
        this._rec = null
        this._chunks = []
        this.state = 'idle'
        this.mimeType = ''
        this._startTime = 0
    }

    get isSupported() { return !!this._Impl }
    get recording() { return this.state === 'recording' }

    /** Start recording a MediaStream. Returns true if it began. */
    start(stream, { now = 0 } = {}) {
        if (this.recording || !this._Impl || !stream) return false
        const mime = pickMimeType((m) => this._Impl.isTypeSupported(m))
        this._rec = new this._Impl(stream, mime ? { mimeType: mime } : {})
        this._chunks = []
        this.mimeType = this._rec.mimeType || mime
        this._rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) this._chunks.push(e.data) }
        this._rec.start(1000) // 1s timeslices so long takes still flush
        this.state = 'recording'
        this._startTime = now
        return true
    }

    /** Stop and resolve to { blob, type }, or null if not recording. */
    async stop() {
        if (!this.recording) return null
        const rec = this._rec
        const stopped = new Promise((resolve) => { rec.onstop = () => resolve() })
        rec.stop()
        await stopped
        this.state = 'idle'
        const type = this.mimeType || 'video/webm'
        const blob = new Blob(this._chunks, { type })
        this._chunks = []
        this._rec = null
        return { blob, type }
    }

    /** Milliseconds since start (0 when idle). */
    elapsed(now) { return this.recording ? Math.max(0, now - this._startTime) : 0 }
}
