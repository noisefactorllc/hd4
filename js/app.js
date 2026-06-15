// SPDX-License-Identifier: MIT
/**
 * HD4 — application boot.
 *
 * Owns the central `state`, instantiates the subsystems, and wires their
 * callbacks together. Each subsystem lives in its own module and is
 * testable on its own (pure logic in Node, browser/GPU pieces in
 * Playwright).
 *
 * Wires the full v1 mixer: four channels + multiview, the program-bus
 * switcher and 2D program compositor (CUT / MIX / WIPE), the output stage
 * (QUAD / FREEZE / FADE / VFX), the WebAudio mixer, 8-slot memory, and
 * keyboard shortcuts.
 */

import { Channel } from './channel.js'
import { ChannelRenderer } from './channelRenderer.js'
import { makeChannelDriverFactory } from './sources/driverFactory.js'
import { createSource } from './sources/sourceModel.js'
import { presetByName } from './sources/presets.js'
import { listCameras } from './sources/cameras.js'
import { listAudioInputs } from './audioDevices.js'
import { buildMultiview } from './ui/multiview.js'
import { Switcher } from './switcher.js'
import { PreviewBus } from './previewBus.js'
import { ProgramCompositor } from './programCompositor.js'
import { OutputState } from './outputState.js'
import { CompositorState } from './compositorState.js'
import { AudioMixer } from './audio/mixer.js'
import { MemoryStore, captureSnapshot, applySnapshot } from './memory.js'
import { StillStore } from './still.js'
import { Recorder, recordingFilename } from './recorder.js'
import { Settings, parseResolution } from './settings.js'
import { applyTheme } from './theme.js'
import { attachKeyboard } from './keyboard.js'
import { BeatClock } from './beatClock.js'
import { AutoMix } from './autoMix.js'
import { pickLoudest } from './audio/autoAudio.js'
import { BeatDetector } from './beatDetect.js'
import { buildProgramView } from './ui/programView.js'
import { buildPreviewView } from './ui/previewView.js'
import { buildTransitionBar } from './ui/transitionBar.js'
import { buildOutputBar } from './ui/outputBar.js'
import { buildCompositionBar } from './ui/compositionBar.js'
import { buildMixerPanel } from './ui/mixerPanel.js'
import { buildMemoryBar } from './ui/memoryBar.js'
import { buildAutoBar } from './ui/autoBar.js'
import { buildSettingsDrawer } from './ui/settingsDrawer.js'
import { buildStripEditor } from './ui/stripEditor.js'
import { UserButtons } from './userButtons.js'
import { buildUserBar } from './ui/userBar.js'
import { buildMainBusEditor } from './ui/mainBusEditor.js'

const VERSION = '0.1.0'
const CHANNEL_COUNT = 4
const CHANNEL_W = 960
const CHANNEL_H = 540
const PROGRAM_W = 1280
const PROGRAM_H = 720
const FOLLOW_AUDIO_SENSE = 0.02 // RMS threshold for VIDEO FOLLOWS AUDIO
const FOLLOW_AUDIO_HOLD_MS = 1500 // min dwell before following again

const state = {
    version: VERSION,
    ready: false,
    channels: [],
    renderers: [],
    switcher: null,
    compositor: null,
}

let _rafId = null

async function boot() {
    const app = document.getElementById('app')
    if (app) app.dataset.booted = 'true'

    // --- Audio mixer (WebAudio; context created lazily on first source) ---
    const audio = new AudioMixer({ channelCount: CHANNEL_COUNT })
    state.audio = audio

    // --- Channels: each a persistent renderer with a pluggable source ---
    for (let i = 0; i < CHANNEL_COUNT; i++) {
        const canvas = document.createElement('canvas')
        const renderer = new ChannelRenderer(canvas, { width: CHANNEL_W, height: CHANNEL_H })
        const audioBinding = {
            connectStream: (s) => audio.connectStream(i, s),
            connectElement: (el) => audio.connectElement(i, el),
            disconnect: () => audio.disconnectChannel(i),
        }
        const channel = new Channel({
            id: i + 1,
            canvas,
            driverFactory: makeChannelDriverFactory(renderer, audioBinding),
        })
        state.channels.push(channel)
        state.renderers.push(renderer)
    }

    // Per-channel default fit: the test card (ch2) shows the whole card
    // (scale); the camera and clips fill the frame (crop). Media-only —
    // shader sources fill natively and ignore it.
    const DEFAULT_FITS = ['cover', 'contain', 'cover', 'cover']
    state.renderers.forEach((r, i) => r.setFitMode(DEFAULT_FITS[i]))

    // --- Switcher (program-bus state machine) + output stage ---
    const switcher = new Switcher({ channelCount: CHANNEL_COUNT, live: 1, type: 'mix', time: 1.0 })
    state.switcher = switcher
    const output = new OutputState({ fadeTime: 0.5 })
    state.output = output
    const compositorState = new CompositorState({ channelCount: CHANNEL_COUNT })
    state.compositorState = compositorState
    const stillStore = new StillStore()
    state.still = stillStore
    const recorder = new Recorder()
    state.recorder = recorder

    // --- Top bar: brand + master output controls ---
    const outputBar = buildOutputBar(document.getElementById('hd4-topbar'), {
        onFreeze: () => output.toggleFreeze(),
        onFade: () => output.toggleFade(now()),
        onVfx: (name) => output.setVfx(name),
        onStill: () => captureStill(),
        onRecord: () => toggleRecording(),
    })

    // --- Program view + preview bus + compositor ---
    const previewBus = new PreviewBus({ channelCount: CHANNEL_COUNT, preview: 2 })
    state.previewBus = previewBus
    const programEl = document.getElementById('hd4-program')
    const programView = buildProgramView(programEl, {
        onTake: (i) => switcher.take(i, now()),
    })
    const takeToProgram = (mode) => {
        const target = previewBus.take(switcher.live) // flip-flops preview to the outgoing program
        if (mode === 'cut') switcher.cut(target)
        else switcher.take(target, now())
        previewView.setPreview(previewBus.preview)
    }
    const previewView = buildPreviewView(programEl, {
        channelCount: CHANNEL_COUNT,
        onSelect: (i) => { previewBus.set(i); previewView.setPreview(i) },
        onTake: () => takeToProgram('cut'),
        onAuto: () => takeToProgram('auto'),
    })
    previewView.setPreview(previewBus.preview)
    const compositor = new ProgramCompositor(programView.canvas, { width: PROGRAM_W, height: PROGRAM_H })
    compositor.setChannels(state.channels)
    state.compositor = compositor

    // --- Composition bar (PinP / SPLIT / QUAD / KEY) ---
    const compositionBar = buildCompositionBar(document.getElementById('hd4-compositor'), {
        channelCount: CHANNEL_COUNT,
        onComposition: (mode) => { compositorState.toggleComposition(mode); syncComposition() },
        onToggleKey: () => { compositorState.toggleKey(); syncComposition() },
        onPinp: (p) => compositorState.setPinp(p),
        onSplit: (p) => compositorState.setSplit(p),
        onKey: (p) => compositorState.setKey(p),
    })
    const syncComposition = () => compositionBar.setState(compositorState.snapshot())
    syncComposition()

    // --- Transition bar ---
    const transitionBar = buildTransitionBar(document.getElementById('hd4-transition'), {
        initialType: switcher.type,
        initialTime: switcher.time,
        initialCurve: 'dipped',
        onType: (t) => switcher.setType(t),
        onTime: (s) => switcher.setTime(s),
        onCurve: (c) => compositor.setCurve(c),
    })

    // --- Auto-mixing + beat matching ---
    const beatClock = new BeatClock({ bpm: 120 })
    const autoMix = new AutoMix({ channelCount: CHANNEL_COUNT })
    const beatDetect = new BeatDetector()
    let matchAudio = false
    let lastFollowSwitch = 0
    state.beatClock = beatClock
    state.autoMix = autoMix
    const autoBar = buildAutoBar(document.getElementById('hd4-transition'), {
        initialBpm: beatClock.bpm,
        initialBars: autoMix.barsPerSwitch,
        initialMode: autoMix.mode,
        onToggle: () => {
            const on = autoMix.toggle()
            if (on) autoMix.reset(beatClock.beatIndex)
            autoBar.setEnabled(on)
        },
        onTap: () => autoBar.setBpm(beatClock.tap(now())),
        onMode: (m) => autoMix.setMode(m),
        onBars: (n) => autoMix.setBarsPerSwitch(n),
        onMatchAudio: () => {
            matchAudio = !matchAudio
            if (matchAudio) beatDetect.reset()
            autoBar.setMatchAudio(matchAudio)
        },
    })
    beatClock.start(now())

    // --- Settings (persisted global config) ---
    const settings = new Settings(window.localStorage)
    state.settings = settings
    const applyResolution = (str) => {
        const { width, height } = parseResolution(str)
        if (width && height) compositor.resize(width, height)
    }
    const settingsDrawer = buildSettingsDrawer(app, settings, {
        onResolution: (v) => { settings.set('resolution', v); applyResolution(v) },
        onFadeTime: (v) => { settings.set('outputFadeTime', v); output.setFadeTime(v) },
        onBeatSensitivity: (v) => { settings.set('beatSensitivity', v); beatDetect.setSensitivity(v) },
        onTheme: (v) => { settings.set('theme', v); applyTheme(v) },
    })
    document.getElementById('hd4-topbar').appendChild(settingsDrawer.toggleButton)
    // Apply persisted settings on boot.
    applyResolution(settings.get('resolution'))
    output.setFadeTime(settings.get('outputFadeTime'))
    beatDetect.setSensitivity(settings.get('beatSensitivity'))
    applyTheme(settings.get('theme'))

    // --- Multiview (source monitors) ---
    const multiview = buildMultiview(document.getElementById('hd4-sources'), state.channels, {
        onSelectSource: (index, choice) => applySourceChoice(index, choice).then(() => {
            multiview.refresh()
            if (choice.type === 'camera') refreshCameras() // re-enumerate for device labels
        }),
        onSetFit: (index, mode) => state.renderers[index].setFitMode(mode),
        getFit: (index) => state.renderers[index].fitMode,
        onSetAutoInclude: (index, on) => autoMix.setIncluded(index + 1, on),
        getAutoInclude: (index) => autoMix.isIncluded(index + 1),
    })
    const refreshCameras = async () => { multiview.setCameras(await listCameras()) }
    if (navigator.mediaDevices?.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', refreshCameras)
    }

    // Capture the current program as a still: feeds the KEY "STILL" source
    // and becomes selectable as a channel image.
    const captureStill = () => {
        if (!stillStore.capture(programView.canvas)) return
        compositor.setStill(stillStore.canvas)
        multiview.setStillAvailable(true)
    }

    // --- Recording (program canvas + main-bus audio → file) ---
    const buildRecordStream = () => {
        const stream = programView.canvas.captureStream(30)
        try {
            for (const track of audio.getOutputStream().getAudioTracks()) stream.addTrack(track)
        } catch (e) { console.warn('[hd4] recording without audio', e?.message || e) }
        return stream
    }
    const toggleRecording = async () => {
        if (recorder.recording) {
            const out = await recorder.stop()
            outputBar.setRecording(false)
            if (out && out.blob.size > 0) downloadBlob(out.blob, recordingFilename(new Date(), out.type))
            state.lastRecording = out ? { size: out.blob.size, type: out.type } : null
            return
        }
        await audio.resume()
        if (recorder.start(buildRecordStream(), { now: now() })) outputBar.setRecording(true)
    }

    // --- Audio mixer panel (channel strips + main) ---
    const mixerPanel = buildMixerPanel(document.getElementById('hd4-mixer'), {
        channelCount: CHANNEL_COUNT,
        initialFaders: state.channels.map((_, i) => audio.faderOf(i)),
        initialMainFader: audio.mainFader(),
        onFader: (i, pos) => audio.setFader(i, pos),
        onMute: (i) => mixerPanel.setMuted(i, audio.toggleMute(i)),
        onSolo: (i) => mixerPanel.setSoloed(i, audio.toggleSolo(i)),
        onMainFader: (pos) => audio.setMainFader(pos),
        onAudioSource: (i, mode, deviceId) => audio.setChannelAudioMode(i, mode, deviceId).then(refreshAudioInputs),
        onEditStrip: (i) => { audio.ensureContext(); stripEditor.open(i, audio.stripParams(i)) },
        onEditMain: () => { audio.ensureContext(); mainBusEditor.open(audio.mainParams()) },
    })

    // --- Audio editors: per-channel strip + main bus ---
    const stripEditor = buildStripEditor(app, {
        channelCount: CHANNEL_COUNT,
        onParam: (i, key, value) => audio.setStripParam(i, key, value),
    })
    const mainBusEditor = buildMainBusEditor(app, {
        onParam: (key, value) => audio.setMainParam(key, value),
    })
    const refreshAudioInputs = async () => { mixerPanel.setAudioInputs(await listAudioInputs()) }
    if (navigator.mediaDevices?.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', refreshAudioInputs)
    }

    // --- Memory (8-slot save/recall) ---
    const memory = new MemoryStore(window.localStorage)
    const modules = { channels: state.channels, switcher, output, compositor: compositorState, audio }
    const refreshAfterRecall = () => {
        multiview.refresh()
        transitionBar.setType(switcher.type)
        transitionBar.setTime(switcher.time)
        outputBar.setVfx(output.vfx)
        syncComposition()
        for (let i = 0; i < CHANNEL_COUNT; i++) {
            mixerPanel.setFader(i, audio.faderOf(i))
            mixerPanel.setMuted(i, audio.isMuted(i))
            mixerPanel.setSoloed(i, audio.isSoloed(i))
        }
        mixerPanel.setMainFader(audio.mainFader())
        if (stripEditor.isOpen) stripEditor.update(audio.stripParams(stripEditor.channel))
        if (mainBusEditor.isOpen) mainBusEditor.update(audio.mainParams())
    }
    const memoryBar = buildMemoryBar(document.getElementById('hd4-topbar'), {
        onSave: (slot) => { memory.save(slot, captureSnapshot(modules)); memoryBar.setOccupied(memory.list()) },
        onRecall: (slot) => { applySnapshot(memory.load(slot), modules); refreshAfterRecall() },
    })
    memoryBar.setOccupied(memory.list())

    // --- Keyboard shortcuts ---
    attachKeyboard({
        take: (a) => switcher.take(a.channel, now()),
        transitionType: (a) => { switcher.setType(a.value); transitionBar.setType(a.value) },
        quad: () => { compositorState.toggleComposition('quad'); syncComposition() },
        pinp: () => { compositorState.toggleComposition('pinp'); syncComposition() },
        key: () => { compositorState.toggleKey(); syncComposition() },
        record: () => toggleRecording(),
        freeze: () => output.toggleFreeze(),
        fade: () => output.toggleFade(now()),
        auto: () => {
            const on = autoMix.toggle()
            if (on) autoMix.reset(beatClock.beatIndex)
            autoBar.setEnabled(on)
        },
        settings: () => settingsDrawer.toggle(),
    })

    // --- USER assignable macro buttons ---
    const runUserAction = (id) => {
        if (!id) return
        if (id.startsWith('take:')) { switcher.take(Number(id.slice(5)), now()); return }
        if (id.startsWith('mem:')) { applySnapshot(memory.load(Number(id.slice(4))), modules); refreshAfterRecall(); return }
        switch (id) {
            case 'cut': case 'mix': case 'wipe': switcher.setType(id); transitionBar.setType(id); break
            case 'quad': case 'pinp': case 'split': compositorState.toggleComposition(id); syncComposition(); break
            case 'key': compositorState.toggleKey(); syncComposition(); break
            case 'freeze': output.toggleFreeze(); break
            case 'fade': output.toggleFade(now()); break
            case 'still': captureStill(); break
            case 'record': toggleRecording(); break
            case 'auto': { const on = autoMix.toggle(); if (on) autoMix.reset(beatClock.beatIndex); autoBar.setEnabled(on); break }
            default: break
        }
    }
    const USER_KEY = 'hd4.userButtons'
    let savedUser = null
    try { savedUser = JSON.parse(window.localStorage.getItem(USER_KEY) || 'null') } catch { savedUser = null }
    const userButtons = new UserButtons({ assignments: Array.isArray(savedUser) ? savedUser : undefined })
    state.userButtons = userButtons
    const userBar = buildUserBar(document.getElementById('hd4-transition'), {
        count: userButtons.count,
        initial: userButtons.list(),
        onTrigger: (slot) => runUserAction(userButtons.get(slot)),
        onAssign: (slot, id) => {
            userButtons.set(slot, id)
            userBar.setAssignment(slot, userButtons.get(slot))
            window.localStorage.setItem(USER_KEY, JSON.stringify(userButtons.serialize()))
        },
    })

    // Default layout: a live camera, a (still-empty) file input, and two
    // test-pattern references. Resilient — a denied camera or missing
    // device must not break boot.
    const shaderSource = (name) => {
        const p = presetByName(name)
        return createSource('shader', { dsl: p.dsl, name: p.name })
    }
    const defaultSources = [
        createSource('camera'),
        createSource('image', { url: 'img/testcard.png', name: 'Test Card' }),
        shaderSource('Color Bars'),
        shaderSource('Checkerboard'),
    ]
    await Promise.all(state.channels.map((ch, i) =>
        ch.setSource(defaultSources[i]).catch((e) => console.warn(`[hd4] default source ${i + 1}`, e?.message || e)),
    ))
    multiview.refresh()
    refreshCameras() // default camera (ch1) has granted permission → labels available
    refreshAudioInputs()

    // Unlock audio on the first user gesture (autoplay policy) so the
    // default camera's audio starts flowing once the user interacts.
    const unlockAudio = () => {
        audio.resume()
        window.removeEventListener('pointerdown', unlockAudio)
        window.removeEventListener('keydown', unlockAudio)
    }
    window.addEventListener('pointerdown', unlockAudio)
    window.addEventListener('keydown', unlockAudio)

    // --- Per-frame loop ---
    const frame = (t) => {
        for (const ch of state.channels) ch.tick()

        // Beat matching: optionally re-anchor the clock to the audio, then
        // run the beat clock and let auto-mix take channels on the beat.
        if (matchAudio && audio.enabled) {
            const { onset, bpm } = beatDetect.push(audio.getMainEnergy(), t)
            if (onset) {
                beatClock.resetPhase(t)
                if (bpm) { beatClock.setBpm(bpm); autoBar.setBpm(beatClock.bpm) }
            }
        }
        for (const beat of beatClock.tick(t)) {
            autoBar.flashBeat(beat)
            if (autoMix.enabled) {
                const target = autoMix.onBeat(beat, switcher.live)
                if (target) switcher.take(target, t)
            }
        }

        // VIDEO FOLLOWS AUDIO: take the loudest included input (with a hold).
        if (autoMix.enabled && autoMix.mode === 'follows-audio' && audio.enabled) {
            const included = []
            for (let c = 1; c <= CHANNEL_COUNT; c++) included.push(autoMix.isIncluded(c))
            const target = pickLoudest(audio.getInputLevels(), included, FOLLOW_AUDIO_SENSE)
            if (target && target !== switcher.live && (t - lastFollowSwitch) > FOLLOW_AUDIO_HOLD_MS) {
                switcher.take(target, t)
                lastFollowSwitch = t
            }
        }
        audio.setLiveChannel(switcher.live)

        const pres = switcher.tick(t)
        const out = { ...output.tick(t), ...compositorState.snapshot() }
        compositor.draw(pres, switcher.type, out)
        programView.setLive(switcher.live, switcher.transitioning)
        previewView.drawSource(state.channels[previewBus.preview - 1]?.canvas)
        outputBar.setState({ freeze: output.freeze, faded: output.faded })
        if (recorder.recording) outputBar.setRecording(true, `● ${formatElapsed(recorder.elapsed(t))}`)
        audio.tickDynamics(t)
        for (let i = 0; i < CHANNEL_COUNT; i++) mixerPanel.setMeter(i, audio.getMeter(i))
        mixerPanel.setMainMeter(audio.getMainMeter())
        _rafId = requestAnimationFrame(frame)
    }
    _rafId = requestAnimationFrame(frame)

    state.multiview = multiview
    state.ready = true

    // Automation hook — Playwright drives the app through this surface.
    window.__hd4 = {
        version: VERSION,
        state,
        channels: state.channels,
        renderers: state.renderers,
        switcher,
        preview: previewBus,
        compositor,
        output,
        composition: compositorState,
        still: stillStore,
        captureStill,
        recorder,
        userButtons,
        get lastRecording() { return state.lastRecording || null },
        audio,
        memory,
        beatClock,
        autoMix,
        settings,
        settingsDrawer,
        get ready() { return state.ready },
        sampleChannelBrightness: (i) => brightnessOf(state.channels[i]?.canvas),
        sampleChannelAvg: (i) => avgColorOf(state.channels[i]?.canvas),
        sampleProgramAvg: () => avgColorOf(programView.canvas),
        // Average color of one program quadrant (0=TL,1=TR,2=BL,3=BR) for
        // verifying the QUAD composite.
        sampleProgramQuad: (q) => {
            const c = programView.canvas
            const hw = c.width / 2
            const hh = c.height / 2
            const sx = (q % 2) * hw
            const sy = Math.floor(q / 2) * hh
            return avgColorOf(c, sx + hw * 0.25, sy + hh * 0.25, hw * 0.5, hh * 0.5)
        },
        // Average color of a fractional rect of the program (for verifying
        // PinP / SPLIT / KEY composites). Args are 0..1 of the canvas.
        sampleProgramRect: (fx, fy, fw, fh) => {
            const c = programView.canvas
            return avgColorOf(c, fx * c.width, fy * c.height, fw * c.width, fh * c.height)
        },
    }

    document.dispatchEvent(new CustomEvent('hd4:ready', { detail: { version: VERSION } }))
}

async function applySourceChoice(index, choice) {
    const ch = state.channels[index]
    if (!ch) return
    if (choice.type === 'camera') {
        await ch.setSource(createSource('camera', { deviceId: choice.deviceId || '' }))
    } else if (choice.type === 'shader') {
        const p = presetByName(choice.name)
        if (p) await ch.setSource(createSource('shader', { dsl: p.dsl, name: p.name }))
    } else if (choice.type === 'video' || choice.type === 'image') {
        await ch.setSource(createSource(choice.type, { name: choice.file.name }), { file: choice.file })
    } else if (choice.type === 'still') {
        if (state.still?.dataUrl) await ch.setSource(createSource('image', { url: state.still.dataUrl, name: 'Still' }))
    }
}

function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
}

/** mm:ss from milliseconds, for the recording readout. */
function formatElapsed(ms) {
    const s = Math.floor(ms / 1000)
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Trigger a browser download of a Blob. */
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Downsample a canvas (WebGL or 2D), or a source region of it, into a
 * scratch and read its pixels. Region args are in source pixels.
 */
function readScratch(canvas, region = null, w = 16, h = 9) {
    if (!canvas) return null
    const s = document.createElement('canvas')
    s.width = w
    s.height = h
    const ctx = s.getContext('2d')
    if (region) {
        ctx.drawImage(canvas, region[0], region[1], region[2], region[3], 0, 0, w, h)
    } else {
        ctx.drawImage(canvas, 0, 0, w, h)
    }
    return ctx.getImageData(0, 0, w, h).data
}

function brightnessOf(canvas) {
    const data = readScratch(canvas)
    if (!data) return 0
    let sum = 0
    for (let p = 0; p < data.length; p += 4) sum += data[p] + data[p + 1] + data[p + 2]
    return sum
}

function avgColorOf(canvas, sx, sy, sw, sh) {
    const region = (sx !== undefined) ? [sx, sy, sw, sh] : null
    const data = readScratch(canvas, region)
    if (!data) return [0, 0, 0]
    let r = 0, g = 0, b = 0
    const n = data.length / 4
    for (let p = 0; p < data.length; p += 4) { r += data[p]; g += data[p + 1]; b += data[p + 2] }
    return [r / n, g / n, b / n]
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
    boot()
}

export { state, VERSION }
