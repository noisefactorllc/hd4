// SPDX-License-Identifier: MIT
/**
 * Media source driver — feeds a live camera, a video file, or an image
 * file into the channel by compiling a `media()` program and uploading
 * the source element as its texture each frame.
 *
 * The non-serializable handle (a File) arrives via ctx.runtime; the
 * descriptor only carries a persistable name (or, for cameras, deviceId).
 * Mirrors visualize's DeckMedia + the media DSL.
 */

const MEDIA_DSL = 'search synth\nmedia().write(o0)\nrender(o0)'

export function makeMediaDriver(source, renderer, ctx = {}) {
    const kind = source.type // 'camera' | 'video' | 'image'
    let video = null
    let img = null
    let stream = null
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
        const constraints = {
            video: source.deviceId ? { deviceId: { exact: source.deviceId } } : true,
            audio: false,
        }
        stream = await navigator.mediaDevices.getUserMedia(constraints)
        video = makeHiddenVideo()
        video.srcObject = stream
        await video.play().catch(() => { /* autoplay may need a retry */ })
    }

    function startVideoFile(file) {
        if (!file) return
        objectUrl = URL.createObjectURL(file)
        video = makeHiddenVideo()
        video.src = objectUrl
        video.loop = true
        video.play().catch(() => {})
    }

    function startImageFile(file) {
        if (!file) return
        objectUrl = URL.createObjectURL(file)
        img = new Image()
        img.crossOrigin = 'anonymous'
        img.src = objectUrl
    }

    function tick() {
        const src = (video && video.readyState >= 2) ? video
            : (img && img.complete && img.naturalWidth > 0) ? img
                : null
        if (src) renderer.uploadMediaFrame(src)
    }

    function stop() {
        if (stream) {
            for (const t of stream.getTracks()) { try { t.stop() } catch { /* ignore */ } }
            stream = null
        }
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

function makeHiddenVideo() {
    const v = document.createElement('video')
    v.autoplay = true
    v.playsInline = true
    v.muted = true
    v.crossOrigin = 'anonymous'
    v.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;'
    document.body.appendChild(v)
    return v
}
