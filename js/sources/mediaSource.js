// SPDX-License-Identifier: MIT
/**
 * Media source driver — feeds a live camera, a video file, or an image
 * file into the channel by compiling a `media()` program and uploading
 * the source element as its texture each frame. Audio (camera mic / video
 * track) is routed into the channel's mixer strip via ctx.audio.
 *
 * The non-serializable handle (a File) arrives via ctx.runtime; the
 * descriptor only carries a persistable name (or, for cameras, deviceId).
 * Mirrors visualize's DeckMedia + the media DSL.
 */

const MEDIA_DSL = 'search synth\nmedia().write(o0)\nrender(o0)'

export function makeMediaDriver(source, renderer, ctx = {}) {
    const kind = source.type // 'camera' | 'video' | 'image'
    const audio = ctx.audio
    let video = null
    let img = null
    let stream = null
    let audioStream = null
    let objectUrl = null

    async function start() {
        await renderer.compile(MEDIA_DSL)
        if (kind === 'camera') {
            await startCamera()
        } else if (kind === 'video') {
            startVideoFile(ctx.runtime?.file)
        } else if (kind === 'image') {
            startImageFile(ctx.runtime?.file)
        }
    }

    async function startCamera() {
        // Video-only stream for the texture — keeps camera video working
        // even on machines with no microphone.
        const constraints = {
            video: source.deviceId ? { deviceId: { exact: source.deviceId } } : true,
            audio: false,
        }
        stream = await navigator.mediaDevices.getUserMedia(constraints)
        video = makeHiddenVideo(true)
        video.srcObject = stream
        await video.play().catch(() => { /* autoplay may need a retry */ })

        // Best-effort audio on a separate stream so a missing mic can't
        // break the video path.
        if (audio) {
            try {
                audioStream = await navigator.mediaDevices.getUserMedia({ audio: true })
                await audio.connectStream(audioStream)
            } catch { audioStream = null }
        }
    }

    function startVideoFile(file) {
        // A runtime File (user-loaded) or a bundled url (e.g. a default clip).
        const src = file ? (objectUrl = URL.createObjectURL(file)) : (source.url || '')
        if (!src) return
        // Unmuted so the file's audio reaches the mixer graph (the element
        // source replaces direct playback once connected).
        video = makeHiddenVideo(false)
        video.src = src
        video.loop = true
        if (audio) { try { audio.connectElement(video) } catch { /* ignore */ } }
        video.play().catch(() => {})
    }

    function startImageFile(file) {
        // A runtime File (user-loaded) or a bundled url (e.g. the test card).
        const src = file ? (objectUrl = URL.createObjectURL(file)) : (source.url || '')
        if (!src) return
        img = new Image()
        img.crossOrigin = 'anonymous'
        img.src = src
    }

    function tick() {
        const src = (video && video.readyState >= 2) ? video
            : (img && img.complete && img.naturalWidth > 0) ? img
                : null
        if (src) renderer.uploadMediaFrame(src)
    }

    function stop() {
        if (audio) { try { audio.disconnect() } catch { /* ignore */ } }
        stopTracks(stream); stream = null
        stopTracks(audioStream); audioStream = null
        if (video) {
            try { video.pause() } catch { /* ignore */ }
            video.srcObject = null
            video.src = ''
            video.remove()
            video = null
        }
        if (img) { img.src = ''; img = null }
        if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null }
    }

    return { start, tick, stop }
}

function stopTracks(stream) {
    if (!stream) return
    for (const t of stream.getTracks()) { try { t.stop() } catch { /* ignore */ } }
}

function makeHiddenVideo(muted) {
    const v = document.createElement('video')
    v.autoplay = true
    v.playsInline = true
    v.muted = muted
    v.crossOrigin = 'anonymous'
    v.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;'
    document.body.appendChild(v)
    return v
}
