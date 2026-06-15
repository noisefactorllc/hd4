// SPDX-License-Identifier: MIT
/**
 * AudioMixer — the WebAudio graph behind HD4's audio mixer.
 *
 *   source ─► channelGain ─► analyser ─┐
 *   (per channel, post-fader meter)     ├─► mainGain ─► limiter ─► mainAnalyser ─► out
 *                                       ┘
 *
 * Channel gains are post-fader and post-mute/solo (resolveChannelGains),
 * so a muted or un-soloed channel's meter reads silence. The AudioContext
 * is created lazily on the first source connection (a user gesture), which
 * avoids the autoplay-policy warning. Pure gain math lives in levels.js.
 */
import { faderToGain, resolveChannelGains, rms } from './levels.js'

export class AudioMixer {
    constructor({ channelCount = 4 } = {}) {
        this.channelCount = channelCount
        this._ctx = null
        this._strips = Array.from({ length: channelCount }, () => ({
            fader: 0.8,
            muted: false,
            soloed: false,
            gainNode: null,
            analyser: null,
            meterBuf: null,
            audioMode: 'follow', // 'follow' (video's audio) | 'device' | 'none'
            deviceId: '',
            followSource: null, // audio from the channel's video media
            deviceSource: null, // an independently-selected input device
            deviceStream: null,
            activeSource: null, // whichever is currently wired to the gain
        }))
        this._main = { fader: 0.9, gainNode: null, limiter: null, analyser: null, meterBuf: null }
    }

    get enabled() { return !!this._ctx }
    get context() { return this._ctx }

    ensureContext() {
        if (this._ctx) return this._ctx
        const Ctx = window.AudioContext || window.webkitAudioContext
        this._ctx = new Ctx()
        this._buildGraph()
        return this._ctx
    }

    async resume() {
        this.ensureContext()
        if (this._ctx.state === 'suspended') {
            try { await this._ctx.resume() } catch { /* ignore */ }
        }
    }

    /** The channel's video-following audio (camera mic). Used in 'follow' mode. */
    async connectStream(index, stream) {
        await this.resume()
        const strip = this._strips[index]
        this._clearFollow(strip)
        if (!stream?.getAudioTracks || stream.getAudioTracks().length === 0) return
        strip.followSource = this._ctx.createMediaStreamSource(stream)
        this._applyActive(strip)
    }

    /** The channel's video-following audio (a video file). Used in 'follow' mode. */
    async connectElement(index, el) {
        await this.resume()
        const strip = this._strips[index]
        this._clearFollow(strip)
        // A MediaElementSource can only be created once per element; cache it.
        let node = el._hd4MediaSource
        if (!node) { node = this._ctx.createMediaElementSource(el); el._hd4MediaSource = node }
        strip.followSource = node
        this._applyActive(strip)
    }

    /** Media driver teardown — release a channel's follow source. */
    disconnectChannel(index) {
        this._clearFollow(this._strips[index])
    }

    /**
     * Select a channel's audio source independent of its video:
     *   'follow' — the video's audio (default), 'none' — silent,
     *   'device' — an independent input (deviceId; '' = system default).
     */
    async setChannelAudioMode(index, mode, deviceId = '') {
        const strip = this._strips[index]
        this.ensureContext()
        this._clearDevice(strip)
        strip.audioMode = mode
        strip.deviceId = mode === 'device' ? deviceId : ''
        if (mode === 'device') {
            await this.resume()
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
                })
                strip.deviceStream = stream
                strip.deviceSource = this._ctx.createMediaStreamSource(stream)
            } catch {
                strip.audioMode = 'none'
            }
        }
        this._applyActive(strip)
    }

    channelAudioMode(index) { return this._strips[index].audioMode }
    channelAudioDeviceId(index) { return this._strips[index].deviceId }

    _clearFollow(strip) {
        if (!strip.followSource) return
        try { strip.followSource.disconnect() } catch { /* ignore */ }
        if (strip.activeSource === strip.followSource) strip.activeSource = null
        strip.followSource = null
    }

    _clearDevice(strip) {
        if (strip.deviceSource) {
            try { strip.deviceSource.disconnect() } catch { /* ignore */ }
            if (strip.activeSource === strip.deviceSource) strip.activeSource = null
            strip.deviceSource = null
        }
        if (strip.deviceStream) {
            for (const t of strip.deviceStream.getTracks()) { try { t.stop() } catch { /* ignore */ } }
            strip.deviceStream = null
        }
    }

    _applyActive(strip) {
        const want = strip.audioMode === 'device' ? strip.deviceSource
            : strip.audioMode === 'follow' ? strip.followSource
                : null
        if (strip.activeSource === want) return
        if (strip.activeSource) { try { strip.activeSource.disconnect(strip.gainNode) } catch { /* ignore */ } }
        if (want && strip.gainNode) { want.connect(strip.gainNode); strip.activeSource = want }
        else strip.activeSource = null
    }

    setFader(index, position) { this._strips[index].fader = position; this._recompute() }
    toggleMute(index) { const s = this._strips[index]; s.muted = !s.muted; this._recompute(); return s.muted }
    toggleSolo(index) { const s = this._strips[index]; s.soloed = !s.soloed; this._recompute(); return s.soloed }
    setMute(index, on) { this._strips[index].muted = !!on; this._recompute() }
    setSolo(index, on) { this._strips[index].soloed = !!on; this._recompute() }
    setMainFader(position) {
        this._main.fader = position
        if (this._main.gainNode) this._main.gainNode.gain.value = faderToGain(position)
    }

    isMuted(index) { return this._strips[index].muted }
    isSoloed(index) { return this._strips[index].soloed }
    faderOf(index) { return this._strips[index].fader }
    mainFader() { return this._main.fader }

    getMeter(index) {
        const s = this._strips[index]
        if (!s.analyser) return 0
        s.analyser.getFloatTimeDomainData(s.meterBuf)
        return rms(s.meterBuf)
    }

    getMainMeter() {
        const m = this._main
        if (!m.analyser) return 0
        m.analyser.getFloatTimeDomainData(m.meterBuf)
        return rms(m.meterBuf)
    }

    /** A MediaStream of the post-limiter main bus, for recording. */
    getOutputStream() {
        this.ensureContext()
        if (!this._main.streamDest) {
            this._main.streamDest = this._ctx.createMediaStreamDestination()
            this._main.analyser.connect(this._main.streamDest)
        }
        return this._main.streamDest.stream
    }

    /** Low-band (kick/bass) energy 0..1 of the main bus, for beat detection. */
    getMainEnergy() {
        const m = this._main
        if (!m.analyser) return 0
        if (!m.freqBuf) m.freqBuf = new Uint8Array(m.analyser.frequencyBinCount)
        m.analyser.getByteFrequencyData(m.freqBuf)
        const n = Math.min(8, m.freqBuf.length)
        let sum = 0
        for (let i = 0; i < n; i++) sum += m.freqBuf[i]
        return n ? (sum / n) / 255 : 0
    }

    dispose() {
        for (const strip of this._strips) this._clearDevice(strip)
        if (this._ctx) { try { this._ctx.close() } catch { /* ignore */ } this._ctx = null }
    }

    _buildGraph() {
        const ctx = this._ctx

        const mainGain = ctx.createGain()
        mainGain.gain.value = faderToGain(this._main.fader)
        const limiter = ctx.createDynamicsCompressor()
        limiter.threshold.value = -3
        limiter.knee.value = 0
        limiter.ratio.value = 20
        limiter.attack.value = 0.003
        limiter.release.value = 0.05
        const mainAnalyser = ctx.createAnalyser()
        mainAnalyser.fftSize = 512
        mainGain.connect(limiter)
        limiter.connect(mainAnalyser)
        mainAnalyser.connect(ctx.destination)
        Object.assign(this._main, {
            gainNode: mainGain,
            limiter,
            analyser: mainAnalyser,
            meterBuf: new Float32Array(mainAnalyser.fftSize),
        })

        for (const strip of this._strips) {
            const g = ctx.createGain()
            const a = ctx.createAnalyser()
            a.fftSize = 512
            g.connect(a)
            a.connect(mainGain)
            strip.gainNode = g
            strip.analyser = a
            strip.meterBuf = new Float32Array(a.fftSize)
        }
        this._recompute()
    }

    _recompute() {
        if (!this._ctx) return
        const eff = resolveChannelGains(this._strips.map((s) => ({
            gain: faderToGain(s.fader),
            muted: s.muted,
            soloed: s.soloed,
        })))
        this._strips.forEach((s, i) => { if (s.gainNode) s.gainNode.gain.value = eff[i] })
    }
}
