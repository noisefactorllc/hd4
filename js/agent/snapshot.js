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

const MEDIA_NAMES = { camera: 'Camera', video: 'Video', image: 'Image' }

/**
 * A source that never enters a Seance session: a camera, a video, or an image
 * from the person's files or a captured still. An image the app itself serves
 * (the test card) is no one's private input.
 */
export function isLocalMedia(source) {
    if (source?.type === 'camera' || source?.type === 'video') return true
    if (source?.type !== 'image') return false
    const url = String(source.url || '')
    return !url || /^(?:data|blob):/i.test(url) || Boolean(source.stillId)
}

/**
 * The view a command answers for. Through a Seance session (`remote`) a
 * channel's program is the text the session holds, and a local source goes by
 * its kind, never by a file name.
 */
export function agentView(ctx, { remote = false } = {}) {
    return remote ? { remote, publishedText: (n) => ctx.controls.publishedText(n) } : {}
}

/** One channel's program text in a view. */
export function channelProgram(channel, number, view = {}) {
    if (view.remote) return String(view.publishedText(number) ?? '')
    return channel.source?.type === 'shader' ? String(channel.source.dsl || '') : ''
}

/** One channel's source, as getProgram, getControls and the snapshot name it. */
export function channelSummary(channel, renderer, number, view = {}) {
    const source = channel.source || { type: 'none' }
    const dsl = channelProgram(channel, number, view)
    return {
        channel: number,
        source: source.type,
        name: view.remote && isLocalMedia(source) ? MEDIA_NAMES[source.type] : channel.label,
        chars: dsl.length,
        running: Boolean(dsl) && renderer?.currentDsl === dsl,
    }
}

export function buildSnapshot(ctx, options = {}) {
    const view = agentView(ctx, options)
    const { channels, renderers, switcher, preview, compositor, composition, output, recorder, autoMix, beatClock } = ctx
    const online = ctx.getOnline?.()
    const canvas = ctx.programCanvas
    return {
        schemaVersion: SCHEMA_VERSION,
        program: { live: switcher.live, preview: preview.preview, transitioning: switcher.transitioning },
        channels: channels.map((channel, i) => channelSummary(channel, renderers[i], i + 1, view)),
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
