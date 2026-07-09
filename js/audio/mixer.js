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
import { MAIN_DEFAULTS, clampMainParam, reverbIRParams } from './mainBus.js'
import { autoMixGains } from './autoAudio.js'

// Short glide for continuous controls (pan / sends) so fast drags don't
// "zipper" (audible stepping from abrupt .value jumps). ~30 ms to settle.
const SMOOTH_TC = 0.01

export class AudioMixer {
    constructor({ channelCount = 4, audioContext = null, destination = null } = {}) {
        this.channelCount = channelCount
        // Rack integration: an externally-supplied AudioContext is adopted
        // instead of the lazy singleton, and the main/monitor bus is routed
        // into `_destination` (the rack's per-module destination) rather than
        // the speakers. Standalone passes neither, so `_ctx` stays lazy and the
        // bus routes to `ctx.destination` — byte-for-byte the previous graph.
        this._ctx = audioContext || null
        this._injectedCtx = audioContext || null
        this._destNode = destination || null
        this._graphBuilt = false
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
            autoNode: null, // follow / auto-mix ducking gain
            auxSend: null,
            revSend: null,
        }))
        this._main = { fader: 0.9, gainNode: null, limiter: null, analyser: null, meterBuf: null }
        this._mainParams = { ...MAIN_DEFAULTS }
        this._mbOn = false
        this._revCache = { time: null, type: null }
        this._aux = null // AUX bus sum (channels' AUX sends land here)
        this._auxChain = null // { delay, level, mute, analyser, meterBuf, streamDest }
        this._monitor = 'main' // what the speakers hear: 'main' | 'aux'
        this._reverb = null // { busGain, convolver, returnGain }
        this._lastDyn = null
        this._liveChannel = 1 // for audio-follows-video ducking
        this._lastInputLevels = []
    }

    get enabled() { return !!this._ctx && this._graphBuilt }
    get context() { return this._ctx }

    /** The node the main/monitor bus feeds into (rack destination, or speakers). */
    get _destination() { return this._destNode || this._ctx.destination }

    ensureContext() {
        // Build the graph exactly once, against either the injected context
        // (rack) or a freshly created lazy singleton (standalone).
        if (this._graphBuilt) return this._ctx
        if (!this._ctx) {
            const Ctx = window.AudioContext || window.webkitAudioContext
            this._ctx = new Ctx()
        }
        this._buildGraph()
        this._graphBuilt = true
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

        // One detector read per strip drives both the gate and the auto-audio.
        const levels = this._strips.map((strip) => {
            if (!strip.detect) return 0
            strip.detect.getFloatTimeDomainData(strip.detectBuf)
            const level = rms(strip.detectBuf)
            if (strip.gateNode) {
                if (!strip.params.gate) {
                    if (strip.gateNode.gain.value !== 1) strip.gateNode.gain.value = 1
                } else {
                    const dbfs = level > 0 ? 20 * Math.log10(level) : -Infinity
                    const open = dbfs > strip.params.gateThreshold
                    strip.gateNode.gain.value = gateStep(strip.gateNode.gain.value, open, dt, strip.params.gateRelease, strip.params.gateAttack)
                }
            }
            return level
        })
        this._lastInputLevels = levels

        // Auto-audio: audio-follows-video gate × AUTO MIXING share, glided.
        const mix = this._mainParams.autoMixing
            ? autoMixGains(levels, this._strips.map((s) => s.params.autoMixWeight), this._strips.map((s) => s.params.autoMixEnabled))
            : null
        const glide = dt / 80 // ~80 ms to reach target (avoids clicks)
        this._strips.forEach((strip, i) => {
            if (!strip.autoNode) return
            let target = 1
            if (strip.params.followVideo && (i + 1) !== this._liveChannel) target = 0
            if (mix) target *= mix[i]
            const cur = strip.autoNode.gain.value
            strip.autoNode.gain.value = cur + Math.max(-glide, Math.min(glide, target - cur))
        })
    }

    /** Tell the mixer which channel is live (for audio-follows-video). */
    setLiveChannel(n) { this._liveChannel = n }

    /** Per-channel input levels (pre-gate RMS), updated each tickDynamics. */
    getInputLevels() {
        return this._strips.map((_, i) => this._lastInputLevels[i] || 0)
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
        if (this._injectedCtx) {
            // Rack: the context is host-owned and shared across modules, so we
            // must NOT close it. Instead detach our bus from the shared
            // destination so this module stops feeding the rack mix.
            const dest = this._destNode
            try { this._main.analyser?.disconnect(dest) } catch { /* not connected */ }
            try { this._auxChain?.mute?.disconnect(dest) } catch { /* not connected */ }
            return
        }
        if (this._ctx) { try { this._ctx.close() } catch { /* ignore */ } this._ctx = null }
        this._graphBuilt = false
    }

    _buildGraph() {
        const ctx = this._ctx

        // Main bus: gain → 3-band EQ → [MB comp] → limiter → mute → meter → out
        const mainGain = ctx.createGain()
        mainGain.gain.value = faderToGain(this._main.fader)
        const mEqLo = ctx.createBiquadFilter(); mEqLo.type = 'lowshelf'
        const mEqMid = ctx.createBiquadFilter(); mEqMid.type = 'peaking'
        const mEqHi = ctx.createBiquadFilter(); mEqHi.type = 'highshelf'
        const limiter = ctx.createDynamicsCompressor()
        limiter.attack.value = 0.003
        limiter.release.value = 0.05
        const muteGain = ctx.createGain()
        const mainAnalyser = ctx.createAnalyser()
        mainAnalyser.fftSize = 512
        mainGain.connect(mEqLo); mEqLo.connect(mEqMid); mEqMid.connect(mEqHi)
        mEqHi.connect(limiter) // default: MB comp bypassed
        limiter.connect(muteGain)
        muteGain.connect(mainAnalyser)
        mainAnalyser.connect(this._destination)

        // Multiband compressor sub-graph (3 crossover bands, bypassed until on).
        const mbInput = ctx.createGain()
        const mbOutput = ctx.createGain()
        const mb = buildMultiband(ctx, mbInput, mbOutput)

        Object.assign(this._main, {
            gainNode: mainGain,
            eqLo: mEqLo, eqMid: mEqMid, eqHi: mEqHi,
            limiter, muteGain,
            analyser: mainAnalyser,
            meterBuf: new Float32Array(mainAnalyser.fftSize),
            mbInput, mbOutput, mb,
        })

        // AUX bus: sum → delay → level → mute → analyser (meter) + (stream tap, lazy).
        this._aux = ctx.createGain()
        const auxDelay = ctx.createDelay(0.5)
        const auxLevel = ctx.createGain()
        const auxMute = ctx.createGain()
        const auxAnalyser = ctx.createAnalyser(); auxAnalyser.fftSize = 512
        this._aux.connect(auxDelay); auxDelay.connect(auxLevel); auxLevel.connect(auxMute)
        auxMute.connect(auxAnalyser)
        this._auxChain = {
            delay: auxDelay, level: auxLevel, mute: auxMute,
            analyser: auxAnalyser, meterBuf: new Float32Array(auxAnalyser.fftSize),
            streamDest: null,
        }

        // Reverb bus: send → busGain → convolver → returnGain → main.
        const revBus = ctx.createGain()
        const convolver = ctx.createConvolver()
        const rev = reverbIRParams(this._mainParams.reverbType, this._mainParams.reverbTime)
        convolver.buffer = makeImpulse(ctx, rev.seconds, rev.decay)
        const revReturn = ctx.createGain()
        revReturn.gain.value = 0
        revBus.connect(convolver)
        convolver.connect(revReturn)
        revReturn.connect(mainGain)
        this._reverb = { busGain: revBus, convolver, returnGain: revReturn }
        this._revCache = { time: this._mainParams.reverbTime, type: this._mainParams.reverbType }

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
            const autoNode = ctx.createGain() // follow / auto-mix ducking
            const a = ctx.createAnalyser(); a.fftSize = 512
            const auxSend = ctx.createGain(); auxSend.gain.value = 0
            const revSend = ctx.createGain(); revSend.gain.value = 0

            // Audio path.
            hpf.connect(eqLo); eqLo.connect(eqMid); eqMid.connect(eqHi)
            eqHi.connect(detect) // measurement tap (output unconnected)
            eqHi.connect(gate)
            gate.connect(comp); comp.connect(makeup); makeup.connect(delayNode)
            delayNode.connect(panner); panner.connect(g); g.connect(autoNode)
            autoNode.connect(a); a.connect(mainGain)
            // Post-fader (post-auto) sends.
            autoNode.connect(auxSend); auxSend.connect(this._aux)
            autoNode.connect(revSend); revSend.connect(revBus)

            Object.assign(strip, {
                inputNode: hpf, hpf, eqLo, eqMid, eqHi, detect,
                detectBuf: new Float32Array(detect.fftSize),
                gateNode: gate, comp, makeup, delayNode, panner,
                gainNode: g, autoNode, analyser: a, meterBuf: new Float32Array(a.fftSize),
                auxSend, revSend,
            })
            this._applyStrip(strip)
        }
        this._applyMain()
        this._recompute()
    }

    /** Push the main-bus parameters onto their nodes. */
    _applyMain() {
        const m = this._main
        const p = this._mainParams
        if (!m.gainNode) return
        m.eqLo.frequency.value = p.eqLoFreq; m.eqLo.gain.value = p.eqLo
        m.eqMid.frequency.value = p.eqMidFreq; m.eqMid.Q.value = p.eqMidQ; m.eqMid.gain.value = p.eqMid
        m.eqHi.frequency.value = p.eqHiFreq; m.eqHi.gain.value = p.eqHi
        if (p.mainLimiter) {
            m.limiter.threshold.value = p.mainLimiterThreshold; m.limiter.ratio.value = 20; m.limiter.knee.value = 0
        } else {
            m.limiter.threshold.value = 0; m.limiter.ratio.value = 1; m.limiter.knee.value = 0
        }
        m.muteGain.gain.value = p.mainMute ? 0 : 1
        // Reverb return + (re)generate the impulse when time/type change.
        this._ramp(this._reverb.returnGain.gain, dbToGain(p.reverbReturn))
        if (this._revCache.time !== p.reverbTime || this._revCache.type !== p.reverbType) {
            const rev = reverbIRParams(p.reverbType, p.reverbTime)
            this._reverb.convolver.buffer = makeImpulse(this._ctx, rev.seconds, rev.decay)
            this._revCache = { time: p.reverbTime, type: p.reverbType }
        }
        // Multiband comp band params + bypass routing.
        const bands = [['Lo', m.mb.lo], ['Mid', m.mb.mid], ['Hi', m.mb.hi]]
        for (const [name, band] of bands) {
            band.comp.threshold.value = p[`mb${name}Thres`]
            const ratio = p[`mb${name}Ratio`]
            band.comp.ratio.value = Number.isFinite(ratio) ? Math.min(20, ratio) : 20
        }
        this._setMbComp(p.mbComp)
        // AUX bus (level glides; mute stays snappy/exact).
        this._auxChain.delay.delayTime.value = p.auxDelay / 1000
        this._ramp(this._auxChain.level.gain, dbToGain(p.auxLevel))
        this._auxChain.mute.gain.value = p.auxMute ? 0 : 1
    }

    _setMbComp(on) {
        if (on === this._mbOn) return
        const m = this._main
        try { m.eqHi.disconnect() } catch { /* ignore */ }
        try { m.mbOutput.disconnect() } catch { /* ignore */ }
        if (on) { m.eqHi.connect(m.mbInput); m.mbOutput.connect(m.limiter) }
        else { m.eqHi.connect(m.limiter) }
        this._mbOn = on
    }

    /** Set one main-bus parameter (clamped). */
    setMainParam(key, value) {
        if (!(key in this._mainParams)) return
        this._mainParams[key] = clampMainParam(key, value)
        if (this._main.gainNode) this._applyMain()
        return this._mainParams[key]
    }

    setMainParams(obj = {}) { for (const [k, v] of Object.entries(obj)) this.setMainParam(k, v) }
    mainParam(key) { return this._mainParams[key] }
    mainParams() { return { ...this._mainParams } }

    /** A MediaStream of the AUX bus (a separate monitor/record mix). */
    getAuxStream() {
        this.ensureContext()
        if (!this._auxChain.streamDest) {
            this._auxChain.streamDest = this._ctx.createMediaStreamDestination()
            this._auxChain.mute.connect(this._auxChain.streamDest)
        }
        return this._auxChain.streamDest.stream
    }

    /** Post-fader RMS of the AUX bus (for the AUX meter). */
    getAuxLevel() {
        const a = this._auxChain?.analyser
        if (!a) return 0
        a.getFloatTimeDomainData(this._auxChain.meterBuf)
        return rms(this._auxChain.meterBuf)
    }

    /** Route the monitor (speaker) output to MAIN or AUX. The program/record
     *  taps (mainAnalyser/aux streamDest) are separate, so auditioning AUX
     *  never alters what is output or recorded. */
    setMonitor(which) {
        const next = which === 'aux' ? 'aux' : 'main'
        this._monitor = next
        this.ensureContext()
        const ctx = this._ctx
        const dest = this._destination
        const main = this._main.analyser
        const aux = this._auxChain?.mute
        if (!ctx || !main || !aux) return next
        try { main.disconnect(dest) } catch { /* was not connected */ }
        try { aux.disconnect(dest) } catch { /* was not connected */ }
        if (next === 'aux') aux.connect(dest)
        else main.connect(dest)
        return next
    }

    monitorSource() { return this._monitor }

    /** Glide an AudioParam toward a value (de-zipper), or set it directly if
     *  there is no context clock yet. */
    _ramp(param, value) {
        if (this._ctx && typeof param.setTargetAtTime === 'function') {
            param.setTargetAtTime(value, this._ctx.currentTime, SMOOTH_TC)
        } else {
            param.value = value
        }
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
        // Continuous controls glide to avoid zipper noise on fast drags.
        this._ramp(strip.panner.pan, p.pan)
        this._ramp(strip.auxSend.gain, dbToGain(p.auxSend))
        this._ramp(strip.revSend.gain, dbToGain(p.revSend))
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

/**
 * A 3-band (low/mid/high) compressor split, wired input→bands→output but
 * left disconnected from the main chain until enabled. Crossovers ~250 Hz
 * and ~4 kHz. Returns the per-band { comp } for parameterization.
 */
function buildMultiband(ctx, input, output) {
    const LOW = 250
    const HIGH = 4000
    const band = (filters) => {
        const comp = ctx.createDynamicsCompressor()
        comp.attack.value = 0.01
        comp.release.value = 0.15
        let node = input
        for (const f of filters) { node.connect(f); node = f }
        node.connect(comp)
        comp.connect(output)
        return { comp, filters }
    }
    const lp = (freq) => { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; return f }
    const hp = (freq) => { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq; return f }
    return {
        lo: band([lp(LOW)]),
        mid: band([hp(LOW), lp(HIGH)]),
        hi: band([hp(HIGH)]),
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
