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
import { dbToGain, gateStep, clampStripParam, STRIP_DEFAULTS } from './strip.js'

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
            activeSource: null, // whichever is currently wired to the chain
            // Channel-strip processing: HPF → 3-band EQ → gate →
            // comp → makeup → delay → pan → fader, plus AUX/REV sends.
            params: { ...STRIP_DEFAULTS },
            inputNode: null, // chain head (HPF)
            hpf: null,
            eqLo: null,
            eqMid: null,
            eqHi: null,
            detect: null, // pre-gate level detector
            detectBuf: null,
            gateNode: null,
            comp: null,
            makeup: null,
            delayNode: null,
            panner: null,
            auxSend: null,
            revSend: null,
        }))
        this._main = { fader: 0.9, gainNode: null, limiter: null, analyser: null, meterBuf: null }
        this._aux = null // AUX bus sum (routed by the main-bus stage)
        this._reverb = null // { busGain, convolver, returnGain }
        this._lastDyn = null
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
        const head = strip.inputNode
        if (strip.activeSource === want) return
        if (strip.activeSource && head) { try { strip.activeSource.disconnect(head) } catch { /* ignore */ } }
        if (want && head) { want.connect(head); strip.activeSource = want }
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

    /** Set one channel-strip processing parameter (clamped to its range). */
    setStripParam(index, key, value) {
        const strip = this._strips[index]
        if (!strip || !(key in strip.params)) return
        strip.params[key] = clampStripParam(key, value)
        if (strip.gainNode) this._applyStrip(strip)
        return strip.params[key]
    }

    setStripParams(index, obj = {}) {
        for (const [k, v] of Object.entries(obj)) this.setStripParam(index, k, v)
    }

    stripParam(index, key) { return this._strips[index]?.params[key] }
    stripParams(index) { return { ...this._strips[index]?.params } }

    /**
     * Advance the frame-driven gates. Called each frame with the clock (ms).
     * Gates open fast when the pre-gate level clears the threshold and close
     * over the release time; bypassed gates stay open.
     */
    tickDynamics(now) {
        if (!this._ctx) return
        if (this._lastDyn === null) this._lastDyn = now
        const dt = now - this._lastDyn
        this._lastDyn = now
        if (dt <= 0) return
        for (const strip of this._strips) {
            if (!strip.gateNode) continue
            if (!strip.params.gate) { if (strip.gateNode.gain.value !== 1) strip.gateNode.gain.value = 1; continue }
            strip.detect.getFloatTimeDomainData(strip.detectBuf)
            const level = rms(strip.detectBuf)
            const dbfs = level > 0 ? 20 * Math.log10(level) : -Infinity
            const open = dbfs > strip.params.gateThreshold
            strip.gateNode.gain.value = gateStep(strip.gateNode.gain.value, open, dt, strip.params.gateRelease)
        }
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

        // AUX bus (its routing is owned by the main-bus stage).
        this._aux = ctx.createGain()

        // Reverb bus: send → busGain → convolver → returnGain → main.
        const revBus = ctx.createGain()
        const convolver = ctx.createConvolver()
        convolver.buffer = makeImpulse(ctx, 1.8, 2.6)
        const revReturn = ctx.createGain()
        revReturn.gain.value = 0.9
        revBus.connect(convolver)
        convolver.connect(revReturn)
        revReturn.connect(mainGain)
        this._reverb = { busGain: revBus, convolver, returnGain: revReturn }

        for (const strip of this._strips) {
            const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 0
            const eqLo = ctx.createBiquadFilter(); eqLo.type = 'lowshelf'
            const eqMid = ctx.createBiquadFilter(); eqMid.type = 'peaking'
            const eqHi = ctx.createBiquadFilter(); eqHi.type = 'highshelf'
            const detect = ctx.createAnalyser(); detect.fftSize = 512
            const gate = ctx.createGain()
            const comp = ctx.createDynamicsCompressor()
            const makeup = ctx.createGain()
            const delayNode = ctx.createDelay(0.5)
            const panner = ctx.createStereoPanner()
            const g = ctx.createGain()
            const a = ctx.createAnalyser(); a.fftSize = 512
            const auxSend = ctx.createGain(); auxSend.gain.value = 0
            const revSend = ctx.createGain(); revSend.gain.value = 0

            // Audio path.
            hpf.connect(eqLo); eqLo.connect(eqMid); eqMid.connect(eqHi)
            eqHi.connect(detect) // measurement tap (output unconnected)
            eqHi.connect(gate)
            gate.connect(comp); comp.connect(makeup); makeup.connect(delayNode)
            delayNode.connect(panner); panner.connect(g)
            g.connect(a); a.connect(mainGain)
            // Post-fader sends.
            g.connect(auxSend); auxSend.connect(this._aux)
            g.connect(revSend); revSend.connect(revBus)

            Object.assign(strip, {
                inputNode: hpf, hpf, eqLo, eqMid, eqHi, detect,
                detectBuf: new Float32Array(detect.fftSize),
                gateNode: gate, comp, makeup, delayNode, panner,
                gainNode: g, analyser: a, meterBuf: new Float32Array(a.fftSize),
                auxSend, revSend,
            })
            this._applyStrip(strip)
        }
        this._recompute()
    }

    /** Push a strip's processing parameters onto its WebAudio nodes. */
    _applyStrip(strip) {
        const p = strip.params
        strip.hpf.frequency.value = p.hpf ? 80 : 0
        strip.eqLo.frequency.value = p.eqLoFreq; strip.eqLo.gain.value = p.eqLo
        strip.eqMid.frequency.value = p.eqMidFreq; strip.eqMid.Q.value = p.eqMidQ; strip.eqMid.gain.value = p.eqMid
        strip.eqHi.frequency.value = p.eqHiFreq; strip.eqHi.gain.value = p.eqHi
        if (!p.gate) strip.gateNode.gain.value = 1 // open when bypassed
        if (p.comp) {
            strip.comp.threshold.value = p.compThreshold
            strip.comp.ratio.value = Number.isFinite(p.compRatio) ? Math.min(20, p.compRatio) : 20
            strip.comp.attack.value = p.compAttack / 1000
            strip.comp.release.value = p.compRelease / 1000
            strip.comp.knee.value = 6
            const auto = p.compAutoGain ? autoMakeupDb(p.compThreshold, p.compRatio) : 0
            strip.makeup.gain.value = dbToGain(Math.min(34, p.compMakeup + auto))
        } else {
            strip.comp.threshold.value = 0; strip.comp.ratio.value = 1; strip.comp.knee.value = 0
            strip.makeup.gain.value = 1
        }
        strip.delayNode.delayTime.value = p.delay / 1000
        strip.panner.pan.value = p.pan
        strip.auxSend.gain.value = dbToGain(p.auxSend)
        strip.revSend.gain.value = dbToGain(p.revSend)
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

/** Estimated auto makeup gain (dB) for a comp threshold + ratio. */
function autoMakeupDb(threshold, ratio) {
    const r = Number.isFinite(ratio) ? ratio : 20
    return Math.max(0, -threshold * (1 - 1 / r) * 0.5)
}

/** A synthetic decaying-noise impulse response for the reverb convolver. */
function makeImpulse(ctx, seconds, decay) {
    const rate = ctx.sampleRate
    const len = Math.max(1, Math.floor(rate * seconds))
    const buf = ctx.createBuffer(2, len, rate)
    for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch)
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay
    }
    return buf
}
