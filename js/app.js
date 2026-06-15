// SPDX-License-Identifier: MIT
/**
 * HD4 — application boot.
 *
 * Owns the central `state`, instantiates the subsystems, and wires their
 * callbacks together. Each subsystem lives in its own module and is
 * testable on its own (pure logic in Node, browser/GPU pieces in
 * Playwright).
 *
 * Phase 3: a program-bus switcher drives a 2D program compositor —
 * VIDEO INPUT SELECT [1–4] takes through CUT / MIX / WIPE + TIME.
 */

import { Channel } from './channel.js'
import { ChannelRenderer } from './channelRenderer.js'
import { makeChannelDriverFactory } from './sources/driverFactory.js'
import { createSource } from './sources/sourceModel.js'
import { SHADER_PRESETS, DEFAULT_SOURCE_PRESET_INDEX } from './sources/presets.js'
import { buildMultiview } from './ui/multiview.js'
import { Switcher } from './switcher.js'
import { ProgramCompositor } from './programCompositor.js'
import { buildProgramView } from './ui/programView.js'
import { buildTransitionBar } from './ui/transitionBar.js'

const VERSION = '0.1.0'
const CHANNEL_COUNT = 4
const CHANNEL_W = 960
const CHANNEL_H = 540
const PROGRAM_W = 1280
const PROGRAM_H = 720

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

    // --- Channels: each a persistent renderer with a pluggable source ---
    for (let i = 0; i < CHANNEL_COUNT; i++) {
        const canvas = document.createElement('canvas')
        const renderer = new ChannelRenderer(canvas, { width: CHANNEL_W, height: CHANNEL_H })
        const channel = new Channel({
            id: i + 1,
            canvas,
            driverFactory: makeChannelDriverFactory(renderer),
        })
        state.channels.push(channel)
        state.renderers.push(renderer)
    }

    // --- Switcher (program-bus state machine) ---
    const switcher = new Switcher({ channelCount: CHANNEL_COUNT, live: 1, type: 'mix', time: 1.0 })
    state.switcher = switcher

    // --- Program view + compositor ---
    const programView = buildProgramView(document.getElementById('hd4-program'), {
        onTake: (i) => switcher.take(i, now()),
    })
    const compositor = new ProgramCompositor(programView.canvas, { width: PROGRAM_W, height: PROGRAM_H })
    compositor.setChannels(state.channels)
    state.compositor = compositor

    // --- Transition bar ---
    buildTransitionBar(document.getElementById('hd4-transition'), {
        initialType: switcher.type,
        initialTime: switcher.time,
        onType: (t) => switcher.setType(t),
        onTime: (s) => switcher.setTime(s),
    })

    // --- Multiview (source monitors) ---
    const multiview = buildMultiview(document.getElementById('hd4-sources'), state.channels, {
        onSelectSource: (index, choice) => applySourceChoice(index, choice).then(() => multiview.refresh()),
    })

    // Default each channel to a distinct shader (no permission prompt on
    // first run; the user can switch any channel to a camera or file).
    await Promise.all(state.channels.map((ch, i) => {
        const preset = SHADER_PRESETS[DEFAULT_SOURCE_PRESET_INDEX[i]]
        return ch.setSource(createSource('shader', { dsl: preset.dsl, name: preset.name }))
    }))
    multiview.refresh()

    // --- Per-frame loop ---
    const frame = (t) => {
        for (const ch of state.channels) ch.tick()
        const pres = switcher.tick(t)
        compositor.draw(pres, switcher.type)
        programView.setLive(switcher.live, switcher.transitioning)
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
        compositor,
        get ready() { return state.ready },
        sampleChannelBrightness: (i) => brightnessOf(state.channels[i]?.canvas),
        sampleChannelAvg: (i) => avgColorOf(state.channels[i]?.canvas),
        sampleProgramAvg: () => avgColorOf(programView.canvas),
    }

    document.dispatchEvent(new CustomEvent('hd4:ready', { detail: { version: VERSION } }))
}

async function applySourceChoice(index, choice) {
    const ch = state.channels[index]
    if (!ch) return
    if (choice.type === 'camera') {
        await ch.setSource(createSource('camera'))
    } else if (choice.type === 'shader') {
        const p = SHADER_PRESETS[choice.presetIndex]
        await ch.setSource(createSource('shader', { dsl: p.dsl, name: p.name }))
    } else if (choice.type === 'video' || choice.type === 'image') {
        await ch.setSource(createSource(choice.type, { name: choice.file.name }), { file: choice.file })
    }
}

function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
}

/** Downsample a canvas (WebGL or 2D) into a scratch and read its pixels. */
function readScratch(canvas, w = 16, h = 9) {
    if (!canvas) return null
    const s = document.createElement('canvas')
    s.width = w
    s.height = h
    const ctx = s.getContext('2d')
    ctx.drawImage(canvas, 0, 0, w, h)
    return ctx.getImageData(0, 0, w, h).data
}

function brightnessOf(canvas) {
    const data = readScratch(canvas)
    if (!data) return 0
    let sum = 0
    for (let p = 0; p < data.length; p += 4) sum += data[p] + data[p + 1] + data[p + 2]
    return sum
}

function avgColorOf(canvas) {
    const data = readScratch(canvas)
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
