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
            sourceNode: null,
            meterBuf: null,
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

    /** Connect a MediaStream's audio (camera/mic) into a channel. */
    async connectStream(index, stream) {
        await this.resume()
        const strip = this._strips[index]
        this.disconnectChannel(index)
        if (!stream?.getAudioTracks || stream.getAudioTracks().length === 0) return
        const node = this._ctx.createMediaStreamSource(stream)
        node.connect(strip.gainNode)
        strip.sourceNode = node
    }

    /** Connect a media element's audio (a video file) into a channel. */
    async connectElement(index, el) {
        await this.resume()
        const strip = this._strips[index]
        this.disconnectChannel(index)
        // A MediaElementSource can only be created once per element; cache it.
        let node = el._hd4MediaSource
        if (!node) { node = this._ctx.createMediaElementSource(el); el._hd4MediaSource = node }
        node.connect(strip.gainNode)
        strip.sourceNode = node
    }

    disconnectChannel(index) {
        const strip = this._strips[index]
        if (strip.sourceNode) {
            try { strip.sourceNode.disconnect() } catch { /* ignore */ }
            strip.sourceNode = null
        }
    }

    setFader(index, position) { this._strips[index].fader = position; this._recompute() }
    toggleMute(index) { const s = this._strips[index]; s.muted = !s.muted; this._recompute(); return s.muted }
    toggleSolo(index) { const s = this._strips[index]; s.soloed = !s.soloed; this._recompute(); return s.soloed }
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

    dispose() {
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
