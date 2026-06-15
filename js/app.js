// SPDX-License-Identifier: MIT
/**
 * HD4 — application boot.
 *
 * Owns the central `state`, instantiates the subsystems, and wires their
 * callbacks together. Each subsystem lives in its own module and is
 * testable on its own (pure logic in Node, browser/GPU pieces in
 * Playwright).
 *
 * Phase 2: four channels, each a ChannelRenderer fed by a pluggable
 * source (shader / camera / video / image), shown in the multiview.
 */

import { Channel } from './channel.js'
import { ChannelRenderer } from './channelRenderer.js'
import { makeChannelDriverFactory } from './sources/driverFactory.js'
import { createSource } from './sources/sourceModel.js'
import { SHADER_PRESETS, DEFAULT_SOURCE_PRESET_INDEX } from './sources/presets.js'
import { buildMultiview } from './ui/multiview.js'

const VERSION = '0.1.0'
const CHANNEL_COUNT = 4
const CHANNEL_W = 960
const CHANNEL_H = 540

const state = {
    version: VERSION,
    ready: false,
    channels: [],
    renderers: [],
}

let _rafId = null

async function boot() {
    const app = document.getElementById('app')
    if (app) app.dataset.booted = 'true'

    // Build the four channels, each with its own persistent renderer.
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

    // Multiview (inserts each channel's canvas into its tile).
    const sourcesEl = document.getElementById('hd4-sources')
    const multiview = buildMultiview(sourcesEl, state.channels, {
        onSelectSource: (index, choice) => applySourceChoice(index, choice).then(() => multiview.refresh()),
    })

    // Default each channel to a distinct shader (no permission prompt on
    // first run; the user can switch any channel to a camera or file).
    await Promise.all(state.channels.map((ch, i) => {
        const preset = SHADER_PRESETS[DEFAULT_SOURCE_PRESET_INDEX[i]]
        return ch.setSource(createSource('shader', { dsl: preset.dsl, name: preset.name }))
    }))
    multiview.refresh()

    // Per-frame pump: media channels upload their texture; shaders advance
    // on their renderer's own loop, so tick() is a cheap no-op for them.
    const frame = () => {
        for (const ch of state.channels) ch.tick()
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
        get ready() { return state.ready },
        // Read back a small sample of a channel's rendered output; returns
        // the summed luma-ish brightness so a test can assert "not black".
        sampleChannelBrightness(i) {
            const canvas = state.channels[i]?.canvas
            if (!canvas) return 0
            const s = document.createElement('canvas')
            s.width = 32
            s.height = 18
            const ctx = s.getContext('2d')
            ctx.drawImage(canvas, 0, 0, s.width, s.height)
            const data = ctx.getImageData(0, 0, s.width, s.height).data
            let sum = 0
            for (let p = 0; p < data.length; p += 4) sum += data[p] + data[p + 1] + data[p + 2]
            return sum
        },
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
    boot()
}

export { state, VERSION }
