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

// Importing handfish registers the web components used by the UI
// (select-dropdown, slider-value, tempo-bar) and provides the About dialog +
// tooltip initializer for the industrial top bar. initEscapeHandler wires the
// global Escape handler for the handfish escape stack the overlay panels
// register with (once at boot; double-registration corrupts close ordering).
import { AboutDialog, initializeTooltips, initEscapeHandler } from 'handfish'
import { logoSvg } from './ui/logo.js'
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
import { getStill, memoryStillsMigrated, migrateMemoryStills, storeEmbeddedStills } from './stillStorage.js'
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
import { MidiMap, parseMidiMessage } from './midi.js'
import { buildMidiPanel } from './ui/midiPanel.js'
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

/**
 * Standalone boot — auto-invoked at module load. Mounts into the page's #app
 * with the lazy own-context audio mixer routed to the speakers, exactly as
 * before. This is a thin wrapper so the standalone path is unchanged.
 */
async function boot() {
    return bootInto()
}

/**
 * bootInto(options) — the full HD4 assembly, parameterized so it can run both
 * standalone (no options) and as a rack module (container + injected audio).
 *
 *   container     mount root (default: the page's #app). All structural
 *                 #hd4-* lookups are scoped to it, so the rack adapter can
 *                 build the same scaffold inside a slot.
 *   audioContext  shared AudioContext to adopt (default: the mixer's own lazy
 *                 singleton — standalone is byte-for-byte unchanged).
 *   destination   AudioNode the main/monitor bus feeds into (default:
 *                 ctx.destination → the speakers).
 *
 * Returns the same surface published on window.__hd4 plus a `stop()` to halt
 * the RAF loop and a `programCanvas` handle (the on-air canvas), so the rack
 * adapter can expose the program video without reaching into internals.
 */
// initEscapeHandler attaches a document-level keydown listener and does not
// guard against double registration — a second call makes one Escape press
// close two stacked items (the handfish convention is exactly one close per
// press). bootInto() runs per mounted rack module, so initialize it exactly
// once per document.
let escapeHandlerReady = false
const initEscapeHandlerOnce = () => {
    if (escapeHandlerReady) return
    initEscapeHandler()
    escapeHandlerReady = true
}

async function bootInto({ container = null, audioContext = null, destination = null } = {}) {
    const app = container || document.getElementById('app')
    if (app) app.dataset.booted = 'true'
    const byId = (id) => app.querySelector('#' + id)

    // --- Audio mixer (WebAudio). Standalone: own context, lazy on first
    //     source, routed to the speakers. Rack: the injected shared context +
    //     per-module destination (the single optional-arg integration seam). ---
    const audio = new AudioMixer({ channelCount: CHANNEL_COUNT, audioContext, destination })
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
            driverFactory: makeChannelDriverFactory(renderer, audioBinding, { loadStill: getStill }),
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

    // --- Top bar: HD4 logotype + master output controls. The industrial
    //     `.hf-topbar` chrome makes the right-aligned cluster (settings + info,
    //     added below) sit upper-right; the MEMORY + MIDI app controls slot in
    //     between the output group and the cluster. ---
    const topbar = byId('hd4-topbar')
    topbar.classList.add('hf-topbar')
    const outputBar = buildOutputBar(topbar, {
        onFreeze: () => { output.toggleFreeze(); showParam('FREEZE', output.freeze ? 'ON' : 'OFF') },
        onFade: () => { output.toggleFade(now()); showParam('FADE', output.faded ? 'ON' : 'OFF') },
        onVfx: (name) => { output.setVfx(name); showParam('VFX', String(name).toUpperCase()) },
        onStill: () => captureStill(),
        onRecord: () => toggleRecording(),
    })

    // --- Status readout: the shared handfish <led-matrix> micro-OLED. Mounted
    //     in the top bar between the output group and MEMORY, it shows the
    //     last-touched control's { label, value } and otherwise idles on
    //     HD4 / READY. activeControl latches the live readout; refreshOled()
    //     restores it (or the idle default) when nothing is being touched. ---
    const refs = {}
    const led = document.createElement('led-matrix')
    led.className = 'hd4-led'
    topbar.append(led)
    refs.led = led
    let activeControl = null // { label, value } of the last-touched control, or null
    function showParam(label, value) {
        activeControl = { label, value }
        refs.led.show(activeControl)
    }
    function refreshOled() {
        if (activeControl) return refs.led.show(activeControl)
        refs.led.show({ label: 'HD4', value: 'READY' })
    }
    refreshOled()

    // --- Program view + preview bus + compositor ---
    const previewBus = new PreviewBus({ channelCount: CHANNEL_COUNT, preview: 2 })
    state.previewBus = previewBus
    const programEl = byId('hd4-program')
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
    const compositionBar = buildCompositionBar(byId('hd4-compositor'), {
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
    const transitionBar = buildTransitionBar(byId('hd4-transition'), {
        initialType: switcher.type,
        initialTime: switcher.time,
        initialCurve: 'dipped',
        onType: (t) => { switcher.setType(t); showParam('XFADE', String(t).toUpperCase()) },
        onTime: (s) => { switcher.setTime(s); showParam('TIME', `${s.toFixed(1)}s`) },
        onCurve: (c) => { compositor.setCurve(c); showParam('CURVE', String(c).toUpperCase()) },
        onBlend: (b) => { compositor.setBlend(b); showParam('BLEND', String(b).toUpperCase()) },
    })

    // --- Auto-mixing + beat matching ---
    const beatClock = new BeatClock({ bpm: 120 })
    const autoMix = new AutoMix({ channelCount: CHANNEL_COUNT })
    const beatDetect = new BeatDetector()
    let matchAudio = false
    let lastFollowSwitch = 0
    state.beatClock = beatClock
    state.autoMix = autoMix

    // External-beat sync (rack only). When on, the internal BeatClock no longer
    // drives the auto-switch from the RAF loop; instead the rack adapter calls
    // syncToExternalBeat() once per shared transport beat, so HD4's AUTO follows
    // the rack's tempo and downbeats. Standalone leaves this off and keeps its
    // own free-running BeatClock — purely additive.
    let externalBeatMode = false
    let externalBeatIndex = 0
    // Run the exact auto-switch step the RAF loop runs on an internal beat, so
    // the external path and the standalone path share one code path.
    const applyAutoBeat = (beat, t) => {
        if (!autoMix.enabled) return
        const target = autoMix.onBeat(beat, switcher.live)
        if (target) switcher.take(target, t)
    }
    const autoBar = buildAutoBar(byId('hd4-transition'), {
        initialBpm: beatClock.bpm,
        initialBars: autoMix.barsPerSwitch,
        initialMode: autoMix.mode,
        onToggle: () => {
            const on = autoMix.toggle()
            if (on) autoMix.reset(beatClock.beatIndex)
            autoBar.setEnabled(on)
        },
        // TAP + manual BPM edits surface through the tempo-bar's `change`
        // event: re-tempo the switching clock and re-anchor its phase so the
        // beat grid that drives AUTO follows the tempo-bar.
        onTempoChange: (bpm) => { beatClock.setBpm(bpm); beatClock.resetPhase(now()); showParam('TEMPO', `${Math.round(bpm)} BPM`) },
        onMode: (m) => { autoMix.setMode(m); showParam('MODE', String(m).toUpperCase()) },
        onBars: (n) => { autoMix.setBarsPerSwitch(n); showParam('BARS', String(n)) },
        onMatchAudio: () => {
            matchAudio = !matchAudio
            if (matchAudio) beatDetect.reset()
            autoBar.setMatchAudio(matchAudio)
        },
    })
    beatClock.start(now())
    autoBar.startTempo() // run the tempo-bar's beat animation alongside the clock

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
    // Normalized top-bar cluster (upper-right): settings gear + info. The gear
    // is the drawer's own toggle (keeps its .hd4-settings-gear class + wiring);
    // info opens the handfish AboutDialog. The cluster is appended to the top
    // bar last (after MEMORY + MIDI) so it aligns right via margin-left:auto.
    const about = new AboutDialog({
        name: 'HD4',
        logo: logoSvg(),
        version: VERSION,
        tagline: 'video mixer',
        repo: 'noisefactorllc/hd4',
    })
    // HD4 renders on the Noisemaker engine (the /1 channel its bundle loads) —
    // surface that build in the About box.
    about.setNoisemakerFromUrl('https://shaders.noisedeck.app/1/deployment-meta.json')
    wireAboutBuild(about) // HD4's own deployed build hash/date, when present
    const infoBtn = document.createElement('button')
    infoBtn.type = 'button'
    infoBtn.className = 'hf-icon-btn tooltip'
    infoBtn.dataset.title = 'About HD4'
    infoBtn.setAttribute('aria-label', 'About HD4')
    const infoIcon = document.createElement('span')
    infoIcon.className = 'hf-icon'
    infoIcon.textContent = 'info'
    infoBtn.appendChild(infoIcon)
    infoBtn.addEventListener('click', () => about.show())
    const topbarCluster = document.createElement('div')
    topbarCluster.className = 'hf-topbar-cluster'
    topbarCluster.append(settingsDrawer.toggleButton, infoBtn)

    // Apply persisted settings on boot.
    applyResolution(settings.get('resolution'))
    output.setFadeTime(settings.get('outputFadeTime'))
    beatDetect.setSensitivity(settings.get('beatSensitivity'))
    applyTheme(settings.get('theme'))

    // --- Multiview (source monitors) ---
    const multiview = buildMultiview(byId('hd4-sources'), state.channels, {
        onSelectSource: (index, choice) => {
            // The rejection handler covers only the application itself (the
            // channel has already fallen back to its previous source via
            // Channel.setSource): warn and re-sync the picker, which still
            // sits on the choice that failed. A two-argument then keeps a
            // throw in the success path out of that guard.
            return applySourceChoice(index, choice).then(() => {
                multiview.refresh()
                if (choice.type === 'camera') refreshCameras() // re-enumerate for device labels
            }, (e) => {
                console.warn(`[hd4] channel ${index + 1} source was not applied`, e?.message || e)
                multiview.refresh()
            })
        },
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
        // KEY=STILL keys the still over the program, so capturing the on-air
        // canvas would compound the overlay onto itself. In that case grab the
        // clean program *beneath* the key; otherwise capture the on-air program.
        const k = compositorState.key
        const source = k.on && k.sourceCh === 5 ? compositor.cleanCanvas : programView.canvas
        if (!stillStore.capture(source)) return
        compositor.setStill(stillStore.canvas) // KEY STILL reads this live buffer
        multiview.setStillAvailable(true)
        // Refresh any channel already sourced from the still so a re-capture
        // propagates everywhere (the KEY path already tracks the live buffer).
        state.channels.forEach((ch) => {
            const s = ch.source
            if (s?.type === 'image' && s.name === 'Still') {
                ch.setSource(createSource('image', { url: stillStore.dataUrl, name: 'Still' }))
                    .then(() => multiview.refresh())
                    .catch(() => {})
            }
        })
    }

    // --- Recording (program canvas + main/AUX audio → file) ---
    let recordSource = 'program' // 'program' (main bus) | 'aux' (AUX mix)
    const buildRecordStream = () => {
        const stream = programView.canvas.captureStream(30)
        try {
            const bus = recordSource === 'aux' ? audio.getAuxStream() : audio.getOutputStream()
            for (const track of bus.getAudioTracks()) stream.addTrack(track)
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
    const mixerPanel = buildMixerPanel(byId('hd4-mixer'), {
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
        onMonitor: (which) => { audio.setMonitor(which) }, // audition AUX vs MAIN
        onRecordSource: (src) => { recordSource = src }, // REC captures PGM vs AUX
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
    // Slots saved before stills had their own storage hold the still as data
    // URL text. Move the bytes to IndexedDB, which frees localStorage.
    // Non-blocking; saves wait for it.
    migrateMemoryStills(memory).catch((e) => console.error('[hd4] could not move memory stills', e))
    const modules = { channels: state.channels, switcher, output, compositor: compositorState, audio, renderers: state.renderers, preview: previewBus }
    const refreshAfterRecall = () => {
        multiview.refresh() // re-reads each tile's fit toggle from its renderer
        transitionBar.setType(switcher.type)
        transitionBar.setTime(switcher.time)
        outputBar.setVfx(output.vfx)
        previewView.setPreview(previewBus.preview)
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
    // A channel showing a still saves a reference to it: the still goes to
    // IndexedDB first, then the slot. If either fails the slot keeps what it had.
    const writeMemory = async (slot, snapshot) => {
        // On a full localStorage there is room only once older slots' stills
        // have moved out.
        await memoryStillsMigrated()
        try {
            await memory.saveWithStills(slot, snapshot, storeEmbeddedStills)
        } catch (e) {
            console.error(`[hd4] memory ${slot} was not saved`, e)
            return
        }
        memoryBar.setOccupied(memory.list())
    }
    // Saves finish in click order, and a recall waits for a save still being
    // written, as when saves were synchronous.
    let saving = null
    const saveMemory = (slot) => {
        const snapshot = captureSnapshot(modules)
        const save = (saving || Promise.resolve()).then(() => writeMemory(slot, snapshot))
        saving = save
        save.then(() => { if (saving === save) saving = null })
    }
    const recallMemory = (slot) => {
        const recall = () => { applySnapshot(memory.load(slot), modules); refreshAfterRecall() }
        if (saving) saving.then(recall)
        else recall()
    }
    const memoryBar = buildMemoryBar(topbar, {
        onSave: (slot) => { saveMemory(slot) },
        onRecall: (slot) => { recallMemory(slot) },
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
    }, document, {
        // Global single-key shortcuts are suspended while any overlay panel
        // (settings drawer, channel-strip / main-bus editor, MIDI panel) is
        // open, so keys pressed inside it only reach that panel's controls.
        isSuspended: () =>
            settingsDrawer.isOpen || stripEditor.isOpen ||
            mainBusEditor.isOpen || midiPanel.isOpen,
    })

    // --- USER assignable macro buttons ---
    const runUserAction = (id) => {
        if (!id) return
        if (id.startsWith('take:')) { switcher.take(Number(id.slice(5)), now()); return }
        if (id.startsWith('mem:')) { recallMemory(Number(id.slice(4))); return }
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
    // USER macros render as a module on the mixer row's right flank.
    const userBar = buildUserBar(byId('hd4-mixer'), {
        count: userButtons.count,
        initial: userButtons.list(),
        onTrigger: (slot) => runUserAction(userButtons.get(slot)),
        onAssign: (slot, id) => {
            userButtons.set(slot, id)
            userBar.setAssignment(slot, userButtons.get(slot))
            window.localStorage.setItem(USER_KEY, JSON.stringify(userButtons.serialize()))
        },
    })

    // --- MIDI control (learn + map) ---
    const MIDI_KEY = 'hd4.midiMap'
    const midiMap = new MidiMap()
    try {
        const saved = JSON.parse(window.localStorage.getItem(MIDI_KEY) || 'null')
        if (Array.isArray(saved)) midiMap.restore(saved)
    } catch { /* ignore corrupt */ }
    const persistMidi = () => window.localStorage.setItem(MIDI_KEY, JSON.stringify(midiMap.serialize()))
    const applyMidiFader = (id, value) => {
        if (id === 'fader:main') { audio.setMainFader(value); mixerPanel.setMainFader(value) }
        else if (id === 'transitionTime') { const s = value * 4; switcher.setTime(s); transitionBar.setTime(s) }
        else if (id.startsWith('fader:')) { const ch = Number(id.slice(6)) - 1; audio.setFader(ch, value); mixerPanel.setFader(ch, value) }
    }
    const onMidi = (bytes) => {
        const msg = parseMidiMessage(bytes)
        if (!msg) return
        const r = midiMap.handle(msg)
        if (!r) return
        if (r.learned) { midiPanel.setLearning(null); midiPanel.refresh(midiMap.list()); persistMidi() }
        else if (r.action) runUserAction(r.action)
        else if (r.fader) applyMidiFader(r.fader, r.value)
    }
    const enableMidi = async () => {
        if (!navigator.requestMIDIAccess) { midiPanel.setStatus('unsupported'); return }
        try {
            const access = await navigator.requestMIDIAccess()
            const wire = () => { for (const input of access.inputs.values()) input.onmidimessage = (e) => onMidi(e.data) }
            wire()
            access.onstatechange = wire
            midiPanel.setStatus('enabled')
        } catch { midiPanel.setStatus('denied') }
    }
    const midiPanel = buildMidiPanel(app, {
        onEnable: () => enableMidi(),
        onLearn: (target) => { midiMap.arm(target); midiPanel.setLearning(target) },
        onClear: (target) => {
            for (const { signature, target: t } of midiMap.list()) if (t.id === target.id) midiMap.clear(signature)
            midiPanel.refresh(midiMap.list())
            persistMidi()
        },
    })
    midiPanel.refresh(midiMap.list())
    const midiBtn = document.createElement('button')
    midiBtn.type = 'button'
    midiBtn.className = 'hd4-midi-open hf-icon-btn tooltip'
    midiBtn.dataset.title = 'MIDI control (learn + map)'
    midiBtn.setAttribute('aria-label', 'MIDI control')
    const midiIcon = document.createElement('span')
    midiIcon.className = 'hf-icon'
    midiIcon.textContent = 'piano'
    midiBtn.appendChild(midiIcon)
    midiBtn.addEventListener('click', () => midiPanel.open())
    topbar.appendChild(midiBtn)

    // Finally the normalized cluster (settings + info) — appended last so it
    // anchors upper-right; tooltips activate the .tooltip data-title hints.
    topbar.appendChild(topbarCluster)
    initializeTooltips()
    initEscapeHandlerOnce()

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
        // run the beat clock and let auto-mix take channels on the beat. The
        // detected tempo is routed to the tempo-bar (audio SYNC sets BPM); the
        // tempo-bar's change event re-tempos the BeatClock in turn.
        if (matchAudio && audio.enabled) {
            const { onset, bpm } = beatDetect.push(audio.getMainEnergy(), t)
            if (onset) {
                beatClock.resetPhase(t)
                if (bpm) autoBar.setBpm(bpm)
            }
        }
        // Rack external-beat sync owns the auto-switch cadence; skip the
        // internal clock's beats then (the adapter calls syncToExternalBeat).
        if (!externalBeatMode) {
            for (const beat of beatClock.tick(t)) applyAutoBeat(beat, t)
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
        mixerPanel.setAuxMeter(audio.getAuxLevel())
        _rafId = requestAnimationFrame(frame)
    }
    _rafId = requestAnimationFrame(frame)

    state.multiview = multiview
    state.ready = true

    // Automation hook — Playwright drives the app through this surface. The
    // rack adapter also reads it (programCanvas, audio, transport-sync hooks).
    const surface = {
        version: VERSION,
        state,
        led,
        refreshOled,
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
        get recordSource() { return recordSource },
        userButtons,
        midi: { map: midiMap, simulate: (bytes) => onMidi(bytes) },
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

        // --- Rack integration surface (no effect on standalone behaviour) ---

        // The on-air program canvas — what the recorder captures and what the
        // rack exposes as the PGM video frameSource.
        programCanvas: programView.canvas,

        // Toggle external-beat sync. On: the RAF loop stops driving auto-switch
        // from the internal clock; the host transport does (via syncToExternalBeat).
        setExternalBeatMode(on) {
            externalBeatMode = !!on
            if (externalBeatMode) externalBeatIndex = 0
        },
        // Retempo HD4's beat grid + tempo-bar to the host BPM (rack tempo sync).
        setSyncBpm(bpm) {
            const n = Number(bpm)
            if (!Number.isFinite(n) || n <= 0) return
            beatClock.setBpm(n)
            autoBar.setBpm(n)
        },
        // Called once per shared transport beat: optionally retempo, then run
        // one auto-switch step against a beat synthesized from a running index
        // (so AUTO follows the rack's beats/bars exactly like the internal clock).
        syncToExternalBeat({ bpm } = {}) {
            if (bpm != null) this.setSyncBpm(bpm)
            const beatInBar = externalBeatIndex % 4
            const beat = { beatIndex: externalBeatIndex, beatInBar, isDownbeat: beatInBar === 0, bpm: beatClock.bpm }
            externalBeatIndex++
            applyAutoBeat(beat, now())
        },
        // Enable AUTO and anchor it (used when slaving to a running transport).
        enableAuto(on = true) {
            autoMix.setEnabled(on)
            if (on) autoMix.reset(externalBeatMode ? externalBeatIndex : beatClock.beatIndex)
            autoBar.setEnabled(on)
        },

        // Stop the RAF loop and detach the mixer's bus from its destination.
        // The rack adapter calls this on unmount; standalone never does.
        stop() {
            if (_rafId != null) { cancelAnimationFrame(_rafId); _rafId = null }
            beatClock.stop()
            try { audio.dispose() } catch { /* ignore */ }
            state.ready = false
        },
    }

    // Publish the automation hook (standalone + e2e depend on it). One HD4 per
    // page; the rack mounts a single instance, so this remains the live surface.
    window.__hd4 = surface

    document.dispatchEvent(new CustomEvent('hd4:ready', { detail: { version: VERSION } }))

    return surface
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

/**
 * Populate the About dialog's build hash/date from the app's own
 * deployment-meta.json (written by CI on deploy). Skipped on local dev where
 * no meta exists; fails silently — the About box stays useful without it.
 */
function wireAboutBuild(dialog) {
    const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname) || location.protocol === 'file:'
    if (isLocalDev) return
    fetch('./deployment-meta.json', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && dialog.setBuild({
            hash: d.git_hash?.trim().slice(0, 8) || 'LOCAL',
            deployed: d.date ? new Date(d.date * 1000) : null,
        }))
        .catch(() => {})
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

// Standalone auto-boot. Guarded on the presence of #app so that importing this
// module elsewhere (the rack adapter pulls in bootInto) does NOT trigger a boot:
// the rack page has no #app, and the adapter calls bootInto({ container }) itself.
// On the standalone page #app is present, so this runs exactly as before.
function autoBoot() {
    if (document.getElementById('app')) boot()
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoBoot, { once: true })
} else {
    autoBoot()
}

export { state, VERSION, bootInto }
