// SPDX-License-Identifier: MIT
/**
 * ProgramExportQueue — a Noisedeck Sync export queue for the 2D program canvas.
 *
 * Reading a 2D canvas back synchronously (the SDK's CanvasExportQueue) costs
 * ~8 ms a frame at 1280×720 and ~11 ms at 1920×1080 on an Apple M4, most of a
 * 60 fps frame. Instead, each accepted frame is uploaded into a texture on a
 * private WebGL2 context and read back asynchronously by the SDK's
 * WebGL2ExportQueue (pixel-pack buffers behind fences): ~4 ms at 1280×720,
 * ~5 ms at 1920×1080. The upload flips rows into GL's bottom-up order, which
 * the SDK queue flips back to top-down.
 *
 * The context exists only while a Sync output is configured, and it is a
 * 1×1 drawing buffer (frames live in the texture). A lost context, or a
 * rebuild that fails after a resize, is retried at most once a second; until
 * then the queue reports itself busy, so the sender counts those frames as
 * dropped.
 */
import { WebGL2ExportQueue } from './sync/bundle.js'

const REBUILD_INTERVAL_MS = 1000

export class ProgramExportQueue {
    constructor({
        canvas,
        slots = 3,
        document: documentObject = globalThis.document,
        clock = globalThis.performance,
        Queue = WebGL2ExportQueue,
    } = {}) {
        if (!canvas || !Number.isSafeInteger(canvas.width) || !Number.isSafeInteger(canvas.height)) {
            throw new TypeError('canvas must expose integer width and height')
        }
        this._canvas = canvas
        this._slots = slots
        this._document = documentObject
        this._clock = clock
        this._Queue = Queue
        this._descriptor = null
        this._gpu = null
        this._lost = false
        this._built = false
        this._lastBuild = -Infinity
        this._closed = false
    }

    get available() {
        return !this._closed && !this._lost && this._gpu !== null && this._gpu.queue.available
    }

    configure(descriptor) {
        if (this._closed) return
        this._descriptor = null
        this._release()
        try {
            this._build(descriptor)
        } catch (error) {
            // The first build failing means this browser cannot export, and
            // starting the output reports it. A later reconfigure (a resize
            // while sending) is treated like a lost context: stay busy and
            // rebuild on the retry interval.
            if (!this._built) throw error
            this._lost = true
        }
        this._descriptor = descriptor
        this._built = true
    }

    enqueue(source, timestamp, onFrame, sequence) {
        if (!this.available) return false
        const { width, height } = this._descriptor
        if (source.width !== width || source.height !== height) {
            throw new RangeError('canvas dimensions must equal descriptor dimensions')
        }
        const { gl, texture, framebuffer, queue } = this._gpu
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
        try {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, source)
        } finally {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        }
        return queue.enqueue(framebuffer, timestamp, onFrame, sequence)
    }

    poll() {
        if (this._closed || !this._descriptor) return
        if (this._lost || this._gpu?.gl.isContextLost()) {
            this._lost = true
            this._rebuildWhenDue()
            return
        }
        this._gpu?.queue.poll()
    }

    close(options) {
        if (this._closed) return
        this._closed = true
        this._descriptor = null
        this._release(options)
        this._canvas = null
    }

    _rebuildWhenDue() {
        const now = this._clock.now()
        if (now - this._lastBuild < REBUILD_INTERVAL_MS) return
        const descriptor = this._descriptor
        this._release()
        try {
            this._build(descriptor)
        } catch {
            // Still no usable context; try again after the interval.
        }
    }

    _build(descriptor) {
        this._lastBuild = this._clock.now()
        const surface = this._document.createElement('canvas')
        surface.width = 1
        surface.height = 1
        const gl = surface.getContext('webgl2', {
            alpha: true,
            antialias: false,
            depth: false,
            stencil: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: false,
        })
        if (!gl) throw new Error('WebGL2 is unavailable for Sync export')
        const onLost = (event) => {
            event.preventDefault()
            this._lost = true
        }
        surface.addEventListener('webglcontextlost', onLost)
        const gpu = { surface, gl, onLost, texture: null, framebuffer: null, queue: null }
        try {
            gpu.texture = gl.createTexture()
            gl.bindTexture(gl.TEXTURE_2D, gpu.texture)
            gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, descriptor.width, descriptor.height)
            gpu.framebuffer = gl.createFramebuffer()
            gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.framebuffer)
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gpu.texture, 0)
            gl.bindFramebuffer(gl.FRAMEBUFFER, null)
            gpu.queue = new this._Queue({ gl, slots: this._slots })
            gpu.queue.configure(descriptor)
        } catch (error) {
            this._destroy(gpu)
            throw error
        }
        this._gpu = gpu
        this._lost = false
    }

    _release(options) {
        if (!this._gpu) return
        const gpu = this._gpu
        this._gpu = null
        this._destroy(gpu, options)
    }

    _destroy(gpu, options) {
        try { gpu.queue?.close(options) } catch { /* the queue is already torn down */ }
        const { gl } = gpu
        if (!gl.isContextLost()) {
            if (gpu.framebuffer) gl.deleteFramebuffer(gpu.framebuffer)
            if (gpu.texture) gl.deleteTexture(gpu.texture)
            gl.getExtension('WEBGL_lose_context')?.loseContext()
        }
        gpu.surface.removeEventListener('webglcontextlost', gpu.onLost)
    }
}
