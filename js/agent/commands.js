// SPDX-License-Identifier: MIT
/**
 * HD4Agent command handlers. Each handler receives (args, ctx) and returns
 * { result, warnings?, image? }; the dispatcher builds the envelope.
 *
 * ctx holds the app's modules (channels, renderers, switcher, preview,
 * compositor, composition, output, audio, memory, settings, autoMix,
 * beatClock, userButtons, still, recorder, programCanvas) and `controls`,
 * the app's own actions (app.js). Handlers change state only through
 * `controls`, so the panels, the readout and persistence behave the same for
 * an agent as for a person.
 *
 * Channels are numbered 1 to 4. A command that takes an optional `channel`
 * acts on the PVW (preview) channel when it is omitted.
 *
 * A command that came through a Seance session gets `{ remote: true }` as its
 * third argument. It then shows only what the session may see: programs as the
 * session holds them, local sources by their kind, and no image while a
 * camera, a video, an image file or a still feeds the mix.
 *
 * @module agent/commands
 */

import { commandError } from './dispatcher.js'
import { agentView, buildSnapshot, channelProgram, channelSummary, isLocalMedia } from './snapshot.js'
import { compile as compileDsl, getEffect } from '../noisemaker/bundle.js'
import { stripMediaUrls } from '../programImages.js'
import { listCameras } from '../sources/cameras.js'
import { listAudioInputs } from '../audioDevices.js'
import { USER_ACTIONS } from '../userButtons.js'
import { MEMORY_SLOTS } from '../memory.js'

const channelOrPreview = (channel, ctx) => channel ?? ctx.preview.preview

function programState({ switcher, preview }) {
    return { live: switcher.live, preview: preview.preview, transitioning: switcher.transitioning }
}

// A source change is applied by the channel itself; turn its outcome into a
// result or the matching error. `what` names the source in messages.
function sourceOutcome(outcome, channel, what) {
    if (outcome.status === 'superseded') {
        throw commandError('CONFLICT_CHANNEL_CHANGED',
            `Another change took channel ${channel} while ${what} started. The channel shows that change.`, { channel })
    }
    if (outcome.status === 'failed') {
        throw commandError('COMPILE_FAILED',
            `Channel ${channel} could not show ${what}. It shows its previous source again. ${outcome.message || ''}`.trim(),
            { channel })
    }
    if (!outcome.missingImages?.length) return []
    return [{
        code: 'IMAGE_UNAVAILABLE',
        message: 'The program runs, but these images are not in the Seance session or this page. Their media steps stay empty.',
        imageIds: outcome.missingImages,
    }]
}

export async function getState(_args, ctx, options) {
    return { result: buildSnapshot(ctx, options) }
}

export async function getProgram({ channel }, ctx, options) {
    const n = channelOrPreview(channel, ctx)
    const view = agentView(ctx, options)
    const summary = channelSummary(ctx.channels[n - 1], ctx.renderers[n - 1], n, view)
    return {
        result: {
            channel: n,
            source: summary.source,
            dsl: channelProgram(ctx.channels[n - 1], n, view),
            running: summary.running,
        },
    }
}

function keySource(sourceCh) {
    if (sourceCh === 5) return 'still'
    return sourceCh >= 1 && sourceCh <= 4 ? sourceCh : null
}

export async function getControls({ section }, ctx, options) {
    const { channels, renderers, autoMix, audio, composition, beatClock, controls } = ctx
    switch (section) {
        case 'channels':
            return {
                result: {
                    section,
                    channels: channels.map((channel, i) => ({
                        ...channelSummary(channel, renderers[i], i + 1, agentView(ctx, options)),
                        fit: renderers[i].fitMode,
                        autoInclude: autoMix.isIncluded(i + 1),
                    })),
                    stillCaptured: controls.stillCaptured(),
                },
            }
        case 'composition': {
            const snap = composition.snapshot()
            const { sourceCh, ...key } = snap.key
            return { result: { section, mode: snap.composition, pinp: snap.pinp, split: snap.split, key: { ...key, source: keySource(sourceCh) } } }
        }
        case 'audio':
            return {
                result: {
                    section,
                    channels: channels.map((_, i) => ({
                        channel: i + 1,
                        fader: audio.faderOf(i),
                        mute: audio.isMuted(i),
                        solo: audio.isSoloed(i),
                        source: audio.channelAudioMode(i),
                        strip: audio.stripParams(i),
                    })),
                    main: { fader: audio.mainFader(), monitor: audio.monitorSource(), recordSource: controls.recordSource(), bus: audio.mainParams() },
                    running: audio.enabled,
                },
            }
        default: // 'auto'
            return {
                result: {
                    section,
                    on: autoMix.enabled,
                    mode: autoMix.mode,
                    bars: autoMix.barsPerSwitch,
                    bpm: beatClock.bpm,
                    matchAudio: controls.matchAudio(),
                    include: channels.map((_, i) => ({ channel: i + 1, autoInclude: autoMix.isIncluded(i + 1) })),
                },
            }
    }
}

export async function listDevices() {
    return { result: { cameras: await listCameras(), audioInputs: await listAudioInputs() } }
}

export async function getSettings(_args, { settings, userButtons }) {
    return {
        result: {
            settings: settings.all(),
            userButtons: userButtons.list().map((action, i) => ({ button: i + 1, action: action || 'none' })),
            actions: USER_ACTIONS,
        },
    }
}

async function loadProgramEffects(dsl, ctx, channel) {
    try {
        await ctx.renderers[channel - 1].loadEffectsFor(stripMediaUrls(dsl))
    } catch (err) {
        throw commandError('EFFECT_LOAD_FAILED', `Could not load effects: ${err?.message || err}`, {})
    }
}

// The engine's media() has no `url` argument: HD4 removes it before it
// compiles a program (programImages.js), so diagnosis removes it the same way.
function diagnose(dsl) {
    try {
        const compiled = compileDsl(stripMediaUrls(dsl))
        return (compiled?.diagnostics || []).map(d => ({
            code: d.code,
            severity: d.severity,
            message: d.message,
            ...(d.location ? { location: d.location } : {}),
        }))
    } catch (err) {
        // The parser throws on syntax errors: "Expected ... at line N col M".
        const at = /line (\d+) col (\d+)/.exec(err?.message || '')
        return [{
            code: 'SYNTAX',
            severity: 'error',
            message: err?.message || String(err),
            ...(at ? { location: { line: Number(at[1]), column: Number(at[2]) } } : {}),
        }]
    }
}

const isError = d => d.severity === 'error'

export async function validateProgram({ dsl }, ctx) {
    await loadProgramEffects(dsl, ctx, ctx.preview.preview)
    const diagnostics = diagnose(dsl)
    return { result: { valid: !diagnostics.some(isError), diagnostics } }
}

export async function setProgram({ dsl, channel }, ctx) {
    const n = channelOrPreview(channel, ctx)
    await loadProgramEffects(dsl, ctx, n)
    const diagnostics = diagnose(dsl)
    if (diagnostics.some(isError)) {
        throw commandError('INVALID_PROGRAM', 'The program does not compile. Nothing changed.', { diagnostics })
    }
    const warnings = sourceOutcome(await ctx.controls.setChannelProgram(n, dsl), n, 'the program')
    return { result: { applied: true, channel: n, diagnostics }, warnings }
}

function effectRenderer(ctx) {
    return ctx.renderers[0]
}

export async function searchEffects({ query = '', namespace, limit = 50 }, ctx) {
    const renderer = effectRenderer(ctx)
    await renderer.init()
    const q = query.toLowerCase()
    const matches = Object.entries(renderer.inner.manifest || {})
        .map(([effectId, entry]) => {
            const [ns, name] = effectId.split('/')
            return { effectId, namespace: ns, name, description: entry.description || '', tags: entry.tags || [] }
        })
        .filter(e => (!namespace || e.namespace === namespace)
            && (!q || `${e.effectId} ${e.description} ${e.tags.join(' ')}`.toLowerCase().includes(q)))
    return { result: { total: matches.length, effects: matches.slice(0, limit) } }
}

function enumChoices(spec, enums) {
    if (spec.choices) return { choices: spec.choices }
    const path = spec.enum || spec.enumPath
        || (spec.type === 'member' && typeof spec.default === 'string'
            ? spec.default.split('.').slice(0, -1).join('.') : '')
    if (!path) return {}
    const node = path.split('.').reduce((value, key) => value?.[key], enums)
    if (!node || typeof node !== 'object') return {}
    return { enum: path, choices: Object.fromEntries(Object.entries(node).map(([key, value]) =>
        [key, spec.type === 'member' ? `${path}.${key}` : value?.value ?? value])) }
}

export async function getEffectDefinition({ effectId }, ctx) {
    const renderer = effectRenderer(ctx)
    await renderer.init()
    const inner = renderer.inner
    if (!inner.manifest?.[effectId]) {
        throw commandError('NOT_FOUND_EFFECT', `Unknown effect: ${effectId}`, { effectId })
    }
    if (!inner.loadedEffects.has(effectId)) {
        try {
            await inner.loadEffects([effectId])
        } catch (err) {
            throw commandError('EFFECT_LOAD_FAILED', `Could not load ${effectId}: ${err?.message || err}`, { effectId })
        }
    }
    const [namespace, name] = effectId.split('/')
    const def = getEffect(`${namespace}.${name}`) || getEffect(effectId)
    if (!def) throw commandError('NOT_FOUND_EFFECT', `Unknown effect: ${effectId}`, { effectId })
    const params = Object.entries(def.globals || {})
        .filter(([, spec]) => spec && !spec.internal && !spec.ui?.hidden)
        .map(([param, spec]) => ({
            name: param,
            type: spec.type,
            default: spec.default ?? null,
            ...(spec.min !== undefined ? { min: spec.min } : {}),
            ...(spec.max !== undefined ? { max: spec.max } : {}),
            ...enumChoices(spec, inner.enums),
            ...(spec.ui?.label ? { label: spec.ui.label } : {}),
        }))
    return {
        result: {
            effectId,
            func: def.func || name,
            namespace,
            description: def.description || inner.manifest[effectId].description || '',
            params,
        },
    }
}

export async function setSource({ channel, source }, ctx, options) {
    const n = channelOrPreview(channel, ctx)
    if (source === 'still') {
        const outcome = await ctx.controls.setChannelStill(n)
        if (outcome.status === 'missing') {
            throw commandError('NOT_FOUND_STILL', 'No still was captured in this page. Run captureStill first.', {})
        }
        sourceOutcome(outcome, n, 'the still')
    } else {
        sourceOutcome(await ctx.controls.setChannelLibrary(n, source), n, source)
    }
    const summary = channelSummary(ctx.channels[n - 1], ctx.renderers[n - 1], n, agentView(ctx, options))
    return { result: { channel: n, source: summary.source, name: summary.name } }
}

export async function setChannelOptions({ channel, fit, autoInclude }, ctx) {
    ctx.controls.setChannelOptions(channel, { fit, autoInclude })
    return { result: { channel, fit: ctx.renderers[channel - 1].fitMode, autoInclude: ctx.autoMix.isIncluded(channel) } }
}

export async function setCameraSource({ channel, deviceId }, ctx) {
    const n = channelOrPreview(channel, ctx)
    const outcome = await ctx.controls.setChannelCamera(n, deviceId || '')
    if (outcome.status === 'failed') {
        throw commandError('DEVICE_FAILED',
            `The camera did not start: ${outcome.message || 'no camera or no permission'}. Channel ${n} shows its previous source again.`,
            { channel: n })
    }
    sourceOutcome(outcome, n, 'the camera')
    return { result: { channel: n, source: 'camera', deviceId: deviceId || '' } }
}

export async function setPreview({ channel }, ctx) {
    ctx.controls.setPreview(channel)
    return { result: programState(ctx) }
}

// A cut always switches, the hard-cut escape from a running transition.
export async function take({ channel, transition = 'auto' }, ctx) {
    if (transition === 'auto' && ctx.switcher.transitioning) {
        throw commandError('CONFLICT_TRANSITION_RUNNING',
            'A transition is running. Nothing changed. Take again when state.program.transitioning is false.', {})
    }
    ctx.controls.take({ channel, transition })
    return { result: programState(ctx) }
}

export async function setTransition(args, ctx) {
    ctx.controls.setTransition(args)
    const { switcher, compositor } = ctx
    return { result: { type: switcher.type, time: switcher.time, curve: compositor.curve, blend: compositor.blend } }
}

export async function setAuto(args, ctx) {
    ctx.controls.setAuto(args)
    const { autoMix, beatClock, controls } = ctx
    return { result: { on: autoMix.enabled, mode: autoMix.mode, bars: autoMix.barsPerSwitch, bpm: beatClock.bpm, matchAudio: controls.matchAudio() } }
}

export async function setComposition(args, ctx) {
    ctx.controls.setComposition(args)
    const snap = ctx.composition.snapshot()
    return { result: { mode: snap.composition, pinp: snap.pinp, split: snap.split } }
}

export async function setKey({ source, ...rest }, ctx) {
    const partial = { ...rest }
    if (source !== undefined) partial.sourceCh = source === 'still' ? 5 : source
    ctx.controls.setKey(partial)
    const { sourceCh, ...key } = ctx.composition.snapshot().key
    return { result: { ...key, source: keySource(sourceCh) } }
}

export async function setOutput(args, ctx) {
    ctx.controls.setOutput(args)
    const { output } = ctx
    return { result: { freeze: output.freeze, fade: output.faded, vfx: output.vfx } }
}

export async function captureStill(_args, ctx) {
    const captured = ctx.controls.captureStill()
    const canvas = ctx.still.canvas
    return { result: { captured, width: canvas?.width ?? 0, height: canvas?.height ?? 0 } }
}

export async function setRecording({ recording }, ctx) {
    await ctx.controls.setRecording(recording)
    return { result: { recording: Boolean(ctx.recorder.recording) } }
}

export async function openViewport(_args, ctx) {
    return { result: { open: ctx.controls.openViewport() } }
}

export async function setAudioChannel({ channel, ...args }, ctx) {
    await ctx.controls.setAudioChannel(channel, args)
    const { audio } = ctx
    const i = channel - 1
    return { result: { channel, fader: audio.faderOf(i), mute: audio.isMuted(i), solo: audio.isSoloed(i), source: audio.channelAudioMode(i) } }
}

export async function setAudioMain(args, ctx) {
    ctx.controls.setAudioMain(args)
    const { audio, controls } = ctx
    return { result: { fader: audio.mainFader(), monitor: audio.monitorSource(), recordSource: controls.recordSource() } }
}

export async function setAudioInput({ channel, deviceId }, ctx) {
    await ctx.controls.setAudioInput(channel, deviceId || '')
    return { result: { channel, source: ctx.audio.channelAudioMode(channel - 1) } }
}

export async function listMemory(_args, { memory }) {
    const occupied = new Set(memory.list())
    const slots = []
    for (let slot = 1; slot <= MEMORY_SLOTS; slot++) slots.push({ slot, occupied: occupied.has(slot) })
    return { result: { slots } }
}

export async function saveMemory({ slot }, ctx) {
    const saved = await ctx.controls.saveMemory(slot)
    if (!saved) {
        throw commandError('MEMORY_SAVE_FAILED',
            `Memory ${slot} was not saved, so it keeps what it held. Browser storage may be full.`, { slot })
    }
    return { result: { saved: true, slot } }
}

export async function recallMemory({ slot }, ctx) {
    if (!ctx.memory.has(slot)) {
        throw commandError('NOT_FOUND_MEMORY', `Memory ${slot} is empty.`, { slot })
    }
    await ctx.controls.recallMemory(slot)
    return { result: { recalled: true, slot } }
}

export async function setSettings(args, ctx) {
    ctx.controls.setSettings(args)
    return { result: ctx.settings.all() }
}

export async function setUserButton({ button, action }, ctx) {
    ctx.controls.setUserButton(button, action === 'none' ? null : action)
    return { result: { button, action: ctx.userButtons.get(button - 1) || 'none' } }
}

// Through a session an image may show only what the session carries. A
// camera, a video, an image file or a still never enters it, and FREEZE can
// hold a frame of one, so while any of them feeds the mix there is no image.
function privateInput({ channels, composition, output }) {
    const n = channels.findIndex(channel => isLocalMedia(channel.source))
    if (n >= 0) return `channel ${n + 1} shows a ${channels[n].source.type}`
    if (composition.key.on && composition.key.sourceCh === 5) return 'the KEY shows the still'
    if (output.freeze) return 'FREEZE holds a frame'
    return null
}

// The program canvas is drawn on each animation frame. Two frames make sure
// a change made just before shows; a hidden tab gets no frames, so the wait
// is bounded and the last drawn frame is used. Waiting draws nothing itself.
function nextFrames() {
    return Promise.race([
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        new Promise(resolve => setTimeout(resolve, 250)),
    ])
}

export async function getThumbnail({ maxDimension = 256, format = 'jpg', source = 'program' }, ctx, options = {}) {
    const channel = source === 'program' ? null : source === 'preview' ? ctx.preview.preview : source
    await nextFrames()
    const hidden = options.remote && privateInput(ctx)
    if (hidden) {
        throw commandError('REMOTE_UNAVAILABLE',
            `Images are not available through a session while ${hidden}: cameras, video, image files and stills stay on the person's computer.`,
            { reason: hidden })
    }
    const live = channel ? ctx.channels[channel - 1].canvas : ctx.programCanvas
    const scale = Math.min(1, maxDimension / Math.max(live.width, live.height, 1))
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(live.width * scale))
    out.height = Math.max(1, Math.round(live.height * scale))
    out.getContext('2d').drawImage(live, 0, 0, out.width, out.height)
    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg'
    const image = await new Promise((resolve, reject) => {
        out.toBlob(blob => blob ? resolve(blob) : reject(new Error('The canvas could not be encoded')), mimeType, 0.85)
    })
    return { result: { mimeType, width: out.width, height: out.height, source, channel }, image }
}
