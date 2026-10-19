// SPDX-License-Identifier: MIT
/**
 * State snapshot attached to every HD4Agent envelope. It stays small: program
 * text comes from getProgram, and the full parameters of a section from
 * getControls.
 *
 * @module agent/snapshot
 */

/** Snapshot schema version. Bump for renamed or removed fields. */
export const SCHEMA_VERSION = '1.0'

/** One channel's source, as getProgram, getControls and the snapshot name it. */
export function channelSummary(channel, renderer, number) {
    const source = channel.source || { type: 'none' }
    const dsl = source.type === 'shader' ? String(source.dsl || '') : ''
    return {
        channel: number,
        source: source.type,
        name: channel.label,
        chars: dsl.length,
        running: Boolean(dsl) && renderer?.currentDsl === dsl,
    }
}

export function buildSnapshot(ctx) {
    const { channels, renderers, switcher, preview, compositor, composition, output, recorder, autoMix, beatClock } = ctx
    const online = ctx.getOnline?.()
    const canvas = ctx.programCanvas
    return {
        schemaVersion: SCHEMA_VERSION,
        program: { live: switcher.live, preview: preview.preview, transitioning: switcher.transitioning },
        channels: channels.map((channel, i) => channelSummary(channel, renderers[i], i + 1)),
        transition: { type: switcher.type, time: switcher.time, curve: compositor.curve, blend: compositor.blend },
        composition: { mode: composition.composition, key: Boolean(composition.key.on) },
        output: {
            freeze: output.freeze,
            fade: output.faded,
            vfx: output.vfx,
            recording: Boolean(recorder.recording),
            width: canvas?.width ?? 0,
            height: canvas?.height ?? 0,
        },
        auto: { on: autoMix.enabled, mode: autoMix.mode, bars: autoMix.barsPerSwitch, bpm: beatClock.bpm },
        online: { status: online?.getStatus?.() || 'offline', session: online?.getSessionId?.() || null },
    }
}
