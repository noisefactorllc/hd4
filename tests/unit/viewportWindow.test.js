// SPDX-License-Identifier: MIT
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ViewportWindow } from '../../js/viewportWindow.js'

function fakeElement(tag) {
    const classes = new Set()
    const draws = []
    const el = {
        tag,
        className: '',
        textContent: '',
        width: 300,
        height: 150,
        draws,
        classList: {
            add: (c) => classes.add(c),
            contains: (c) => classes.has(c) || el.className.split(' ').includes(c),
        },
        getContext(kind) {
            assert.equal(kind, '2d')
            return {
                set fillStyle(v) { draws.push(['fillStyle', v]) },
                fillRect: (...a) => draws.push(['fillRect', ...a]),
                drawImage: (...a) => draws.push(['drawImage', ...a]),
            }
        },
    }
    return el
}

function fakePopup() {
    const listeners = new Map()
    const timers = []
    const fullscreen = []
    const container = () => ({
        children: [],
        replaceChildren(...nodes) { this.children = nodes },
        append(...nodes) { this.children.push(...nodes) },
    })
    // Like a real document, setting the title writes a <title> into the head.
    const doc = {
        get title() { return doc.head.children.find((c) => c.tag === 'title')?.textContent ?? '' },
        set title(value) {
            let el = doc.head.children.find((c) => c.tag === 'title')
            if (!el) { el = { tag: 'title' }; doc.head.children.push(el) }
            el.textContent = value
        },
        head: container(),
        body: container(),
        fullscreenElement: null,
        documentElement: { requestFullscreen: () => { fullscreen.push('enter'); return Promise.resolve() } },
        exitFullscreen: () => { fullscreen.push('exit'); return Promise.resolve() },
        createElement: fakeElement,
    }
    const popup = {
        closed: false,
        document: doc,
        innerWidth: 1000,
        innerHeight: 1000,
        focused: 0,
        listeners,
        timers,
        fullscreen,
        addEventListener: (type, fn) => listeners.set(type, fn),
        removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type) },
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
        clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true },
        focus() { popup.focused++ },
        close() { popup.closed = true },
    }
    return popup
}

function fakeOutput() {
    const sinks = new Set()
    return {
        sinks,
        addSink(sink) {
            sinks.add(sink)
            return () => { sinks.delete(sink); sink.close() }
        },
        publish(source) { for (const sink of [...sinks]) sink.submit(source, 0) },
    }
}

function setup({ blocked = false } = {}) {
    const popup = fakePopup()
    const opens = []
    const opener = {
        open(...args) { opens.push(args); return blocked ? null : popup },
    }
    const output = fakeOutput()
    const changes = []
    const viewport = new ViewportWindow({ output, window: opener, onChange: (open) => changes.push(open) })
    return { popup, opens, output, changes, viewport }
}

test('open builds the popup and starts mirroring the program', () => {
    const { popup, opens, output, changes, viewport } = setup()
    assert.equal(viewport.open(), true)
    assert.deepEqual(opens, [['', 'hd4-viewport', 'width=1280,height=720,popup=yes']])
    assert.equal(viewport.isOpen, true)
    assert.deepEqual(changes, [true])
    assert.equal(output.sinks.size, 1)
    assert.equal(popup.document.title, 'HD4 — Viewport')
    assert.deepEqual(popup.document.head.children.map((c) => c.tag).sort(), ['style', 'title'])
    const [canvas, hint] = popup.document.body.children
    assert.equal(canvas.tag, 'canvas')
    assert.equal(canvas.width, 1000)
    assert.equal(canvas.height, 1000)
    assert.match(hint.textContent, /press F for fullscreen/)
})

test('each program frame is drawn over black at cover scale', () => {
    const { popup, output, viewport } = setup()
    viewport.open()
    const source = { width: 1280, height: 720 }
    output.publish(source)
    const canvas = popup.document.body.children[0]
    const [fill, rect, draw] = canvas.draws
    assert.deepEqual(fill, ['fillStyle', '#000'])
    assert.deepEqual(rect, ['fillRect', 0, 0, 1000, 1000])
    const [, drawn, x, y, w, h] = draw
    assert.equal(drawn, source)
    assert.equal(h, 1000) // fills the height…
    assert.ok(Math.abs(w - 1280 * (1000 / 720)) < 1e-9) // …and crops the width overflow
    assert.ok(Math.abs(x - (1000 - w) / 2) < 1e-9)
    assert.equal(y, 0)
})

test('opening again focuses the open popup', () => {
    const { popup, opens, viewport, changes } = setup()
    viewport.open()
    assert.equal(viewport.open(), true)
    assert.equal(opens.length, 1)
    assert.equal(popup.focused, 1)
    assert.deepEqual(changes, [true])
})

test('a blocked popup reports false and mirrors nothing', () => {
    const { output, changes, viewport } = setup({ blocked: true })
    assert.equal(viewport.open(), false)
    assert.equal(viewport.isOpen, false)
    assert.equal(output.sinks.size, 0)
    assert.deepEqual(changes, [])
})

test('F toggles full screen inside the popup', () => {
    const { popup, viewport } = setup()
    viewport.open()
    const keydown = popup.listeners.get('keydown')
    keydown({ key: 'x' })
    keydown({ key: 'f' })
    popup.document.fullscreenElement = popup.document.documentElement
    keydown({ key: 'F' })
    assert.deepEqual(popup.fullscreen, ['enter', 'exit'])
})

test('resizing the popup refits its canvas', () => {
    const { popup, viewport } = setup()
    viewport.open()
    popup.innerWidth = 1920
    popup.innerHeight = 1080
    popup.listeners.get('resize')()
    const canvas = popup.document.body.children[0]
    assert.equal(canvas.width, 1920)
    assert.equal(canvas.height, 1080)
})

test('the hint fades out after three seconds', () => {
    const { popup, viewport } = setup()
    viewport.open()
    const hint = popup.document.body.children[1]
    assert.equal(popup.timers[0].ms, 3000)
    assert.equal(hint.classList.contains('is-hidden'), false)
    popup.timers[0].fn()
    assert.equal(hint.classList.contains('is-hidden'), true)
})

test('a popup the operator closed detaches on the next frame', () => {
    const { popup, output, changes, viewport } = setup()
    viewport.open()
    popup.closed = true
    output.publish({ width: 2, height: 2 })
    assert.equal(viewport.isOpen, false)
    assert.equal(output.sinks.size, 0)
    assert.deepEqual(changes, [true, false])
    assert.equal(popup.listeners.size, 0)
})

test('the popup unloading detaches it', () => {
    const { popup, output, changes, viewport } = setup()
    viewport.open()
    popup.listeners.get('pagehide')()
    assert.equal(output.sinks.size, 0)
    assert.deepEqual(changes, [true, false])
})

test('close closes the popup, stops mirroring and is idempotent', () => {
    const { popup, output, changes, viewport } = setup()
    viewport.open()
    viewport.close()
    viewport.close()
    assert.equal(popup.closed, true)
    assert.equal(output.sinks.size, 0)
    assert.deepEqual(changes, [true, false])
    assert.equal(popup.timers[0].cleared, true)
})

test('reopening a named popup left over from an earlier session rebuilds it', () => {
    const { popup, viewport } = setup()
    popup.document.body.children = [{ tag: 'stale' }]
    viewport.open()
    assert.deepEqual(popup.document.body.children.map((c) => c.tag), ['canvas', 'div'])
})

test('a window that cannot be built is closed and nothing is left open', () => {
    const { popup, output, changes, viewport } = setup()
    Object.defineProperty(popup, 'document', { get() { throw new Error('cross-origin') } })
    assert.equal(viewport.open(), false)
    assert.equal(viewport.isOpen, false)
    assert.equal(popup.closed, true)
    assert.equal(output.sinks.size, 0)
    assert.deepEqual(changes, [])
})

test('an output that refuses the sink leaves nothing open', () => {
    const { popup, output, changes, viewport } = setup()
    output.addSink = () => { throw new Error('ProgramOutput is closed') }
    assert.equal(viewport.open(), false)
    assert.equal(viewport.isOpen, false)
    assert.equal(popup.closed, true)
    assert.equal(popup.listeners.size, 0)
    assert.deepEqual(changes, [])
})

test('requires a program output', () => {
    assert.throws(() => new ViewportWindow({}), TypeError)
})
