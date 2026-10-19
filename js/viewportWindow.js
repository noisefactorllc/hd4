// SPDX-License-Identifier: MIT
/**
 * ViewportWindow — mirrors the program in a popup for a secondary display
 * (projector, external monitor), the way Noisedeck's viewport window does:
 * drag the window to the display, press F for full screen, close it to
 * detach.
 *
 * It is a ProgramOutput sink: every published program frame is drawn into
 * the popup's canvas at cover scale (fill the window, crop the overflow).
 * The popup is a same-origin blank window whose DOM is built from here, so
 * it carries no markup or script of its own.
 */
import { computeFit } from './fit.js'

const WINDOW_NAME = 'hd4-viewport'
const WINDOW_FEATURES = 'width=1280,height=720,popup=yes'
const HINT = 'drag to projector · press F for fullscreen · close to detach'
const HINT_FADE_DELAY_MS = 3000

const POPUP_CSS = `
html, body { margin: 0; padding: 0; height: 100%; background: #000; overflow: hidden; cursor: none; }
canvas { width: 100vw; height: 100vh; display: block; }
.hint {
    position: fixed; bottom: 8px; right: 12px;
    color: rgba(255, 255, 255, 0.3); font-family: monospace; font-size: 11px;
    pointer-events: none; transition: opacity 1s ease; opacity: 1;
}
.hint.is-hidden { opacity: 0; }
`

export class ViewportWindow {
    /**
     * @param {object} opts
     * @param {{ addSink: (sink: object) => () => void }} opts.output  the ProgramOutput hub
     * @param {Window} [opts.window]  the opener window
     * @param {(open: boolean) => void} [opts.onChange]  called when the popup opens or detaches
     */
    constructor({ output, window: openerWindow = globalThis.window, onChange } = {}) {
        if (!output || typeof output.addSink !== 'function') {
            throw new TypeError('ViewportWindow needs a program output')
        }
        this._output = output
        this._opener = openerWindow
        this._onChange = onChange
        this._popup = null
        this._removeSink = null
        this._canvas = null
        this._ctx = null
        this._detachPopup = null
    }

    get isOpen() {
        return !!this._popup && !this._popup.closed
    }

    /**
     * Open the popup, or focus it when it is already open.
     * @returns {boolean} false when the browser blocked the popup
     */
    open() {
        if (this.isOpen) {
            try { this._popup.focus() } catch { /* the browser may refuse to focus a popup */ }
            return true
        }
        this._detach()
        const popup = this._opener.open('', WINDOW_NAME, WINDOW_FEATURES)
        if (!popup) return false
        try {
            this._build(popup)
            this._removeSink = this._output.addSink(this._createSink(popup))
        } catch {
            // An unusable window (e.g. a reused one that navigated away) or a
            // closed output: leave nothing half-open.
            this._detach()
            try { popup.close() } catch { /* already gone */ }
            return false
        }
        this._popup = popup
        this._onChange?.(true)
        return true
    }

    /** Close the popup and stop mirroring. */
    close() {
        const popup = this._popup
        this._detach()
        if (popup && !popup.closed) popup.close()
    }

    _build(popup) {
        const doc = popup.document
        // Clear first: setting the title creates a <title> in the head.
        doc.head.replaceChildren()
        doc.body.replaceChildren()
        doc.title = 'HD4 — Viewport'
        const style = doc.createElement('style')
        style.textContent = POPUP_CSS
        doc.head.append(style)
        const canvas = doc.createElement('canvas')
        const hint = doc.createElement('div')
        hint.className = 'hint'
        hint.textContent = HINT
        doc.body.append(canvas, hint)
        this._canvas = canvas
        this._ctx = canvas.getContext('2d')

        const fit = () => {
            canvas.width = Math.max(1, popup.innerWidth)
            canvas.height = Math.max(1, popup.innerHeight)
        }
        fit()
        const onKeyDown = (event) => {
            if (event.key !== 'f' && event.key !== 'F') return
            if (!doc.fullscreenElement) doc.documentElement.requestFullscreen?.()?.catch?.(() => {})
            else doc.exitFullscreen?.()?.catch?.(() => {})
        }
        const onPageHide = () => {
            if (this._popup === popup) this._detach()
        }
        popup.addEventListener('resize', fit)
        popup.addEventListener('keydown', onKeyDown)
        popup.addEventListener('pagehide', onPageHide)
        const hintTimer = popup.setTimeout(() => hint.classList.add('is-hidden'), HINT_FADE_DELAY_MS)
        this._detachPopup = () => {
            popup.clearTimeout(hintTimer)
            popup.removeEventListener('resize', fit)
            popup.removeEventListener('keydown', onKeyDown)
            popup.removeEventListener('pagehide', onPageHide)
        }
    }

    _createSink(popup) {
        return {
            configure() {},
            submit: (source) => {
                if (this._popup !== popup) return false
                if (popup.closed) {
                    this._detach()
                    return false
                }
                this._draw(source)
                return true
            },
            close() {},
        }
    }

    _draw(source) {
        const canvas = this._canvas
        const ctx = this._ctx
        if (!ctx) return
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (!source?.width || !source?.height) return
        const { x, y, w, h } = computeFit('cover', source.width, source.height, canvas.width, canvas.height)
        ctx.drawImage(source, x, y, w, h)
    }

    _detach() {
        const wasOpen = this._popup !== null
        const removeSink = this._removeSink
        const detachPopup = this._detachPopup
        this._removeSink = null
        this._detachPopup = null
        this._popup = null
        this._canvas = null
        this._ctx = null
        try { detachPopup?.() } catch { /* the popup is mid-teardown */ }
        removeSink?.()
        if (wasOpen) this._onChange?.(false)
    }
}
