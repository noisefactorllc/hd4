// SPDX-License-Identifier: MIT
/**
 * Composition bar — the composition section: the mutually-exclusive
 * [PinP] [SPLIT] [QUAD] buttons and the independent [KEY] toggle, each with
 * its parameter panel. Buttons toggle the mode; the panels expose every
 * parameter (PinP size/shape/position/border/crop, SPLIT pattern/
 * centres, KEY type/source/level/gain/colour). All controls report through
 * callbacks; setState() reflects the authoritative CompositorState.
 */
import { PINP_SIZES, PINP_SHAPES, PINP_ASPECTS, BORDER_COLORS } from '../compositing.js'

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

export function buildCompositionBar(container, {
    channelCount = 4,
    onComposition,
    onToggleKey,
    onPinp,
    onSplit,
    onKey,
} = {}) {
    container.innerHTML = ''
    const bar = el('div', 'hd4-composition-bar')

    const heading = el('span', 'hd4-section-label')
    heading.textContent = 'COMPOSITE'

    const modes = el('div', 'hd4-comp-modes')
    const modeBtns = {}
    for (const [value, label] of [['pinp', 'PinP'], ['split', 'SPLIT'], ['quad', 'QUAD']]) {
        const b = button(label, `${label} composition`, () => onComposition?.(value))
        modeBtns[value] = b
        modes.appendChild(b)
    }
    const keyBtn = button('KEY', 'Chroma / luminance key overlay', () => onToggleKey?.())
    keyBtn.classList.add('hd4-comp-key-btn')

    const params = el('div', 'hd4-comp-params')
    const pinp = buildPinpControls(onPinp, channelCount)
    const split = buildSplitControls(onSplit, channelCount)
    const key = buildKeyControls(onKey, channelCount)
    params.append(pinp.el, split.el, key.el)

    bar.append(heading, modes, keyBtn, params)
    container.appendChild(bar)

    return {
        setState(snap) {
            for (const [mode, b] of Object.entries(modeBtns)) {
                b.classList.toggle('is-active', snap.composition === mode)
            }
            keyBtn.classList.toggle('is-active', snap.key.on)
            pinp.el.hidden = snap.composition !== 'pinp'
            split.el.hidden = snap.composition !== 'split'
            key.el.hidden = !snap.key.on
            pinp.update(snap.pinp)
            split.update(snap.split)
            key.update(snap.key)
        },
    }
}

// --- parameter panels -------------------------------------------------------

function channelOptions(n, { off = false, still = false } = {}) {
    const opts = []
    if (off) opts.push(['0', 'OFF'])
    for (let i = 1; i <= n; i++) opts.push([String(i), `CH ${i}`])
    if (still) opts.push(['5', 'STILL'])
    return opts
}

function buildPinpControls(onPinp, n) {
    const wrap = el('div', 'hd4-comp-panel')
    const send = (k) => (v) => onPinp?.({ [k]: v })
    const sendNum = (k) => (v) => onPinp?.({ [k]: Number(v) })

    const source = select('PinP source channel', channelOptions(n), sendNum('source'))
    const size = select('PinP size', Object.keys(PINP_SIZES).map((s) => [s, s]), send('size'))
    const aspect = select('PinP aspect', PINP_ASPECTS.map((a) => [a, a]), send('aspect'))
    const shape = select('PinP shape', PINP_SHAPES.map((s) => [s, cap(s)]), send('shape'))
    const borderColor = select('PinP border colour', Object.keys(BORDER_COLORS).map((c) => [c, cap(c)]), send('borderColor'))
    const hPos = range('PinP horizontal position', -50, 50, 1, pct, sendNum('hPosition'))
    const vPos = range('PinP vertical position', -50, 50, 1, pct, sendNum('vPosition'))
    const border = range('PinP border width', 0, 15, 1, (v) => `${v}`, sendNum('borderWidth'))
    const hCrop = range('PinP horizontal crop', 1, 100, 1, pctPlain, sendNum('hCropping'))
    const vCrop = range('PinP vertical crop', 1, 100, 1, pctPlain, sendNum('vCropping'))
    const hView = range('PinP horizontal view', -50, 50, 1, pct, sendNum('hViewPosition'))
    const vView = range('PinP vertical view', -50, 50, 1, pct, sendNum('vViewPosition'))

    wrap.append(
        row('Source', source), row('Size', size), row('Aspect', aspect), row('Shape', shape),
        row('Pos H', hPos.el), row('Pos V', vPos.el),
        row('Border', border.el), row('Colour', borderColor),
        row('Crop H', hCrop.el), row('Crop V', vCrop.el),
        row('View H', hView.el), row('View V', vView.el),
    )
    return {
        el: wrap,
        update(p) {
            source.value = String(p.source)
            size.value = p.size
            aspect.value = p.aspect
            shape.value = p.shape
            borderColor.value = p.borderColor
            hPos.set(p.hPosition); vPos.set(p.vPosition); border.set(p.borderWidth)
            hCrop.set(p.hCropping); vCrop.set(p.vCropping); hView.set(p.hViewPosition); vView.set(p.vViewPosition)
        },
    }
}

function buildSplitControls(onSplit, n) {
    const wrap = el('div', 'hd4-comp-panel')
    const send = (k) => (v) => onSplit?.({ [k]: v })
    const sendNum = (k) => (v) => onSplit?.({ [k]: Number(v) })

    const sourceB = select('SPLIT B source channel', channelOptions(n), sendNum('sourceB'))
    const pattern = select('SPLIT pattern', [
        ['v-center', 'V-Center'], ['h-center', 'H-Center'], ['v-stretch', 'V-Stretch'], ['h-stretch', 'H-Stretch'],
    ], (v) => { onSplit?.({ pattern: v }); applyVisibility(v) })
    const aCenter = range('SPLIT A centre', 0, 100, 1, pctPlain, sendNum('aCenter'))
    const bCenter = range('SPLIT B centre', 0, 100, 1, pctPlain, sendNum('bCenter'))
    const boundary = range('SPLIT boundary', -50, 50, 1, pct, sendNum('centerPosition'))

    const rowA = row('A pos', aCenter.el)
    const rowB = row('B pos', bCenter.el)
    const rowBound = row('Split', boundary.el)
    wrap.append(row('Source B', sourceB), row('Pattern', pattern), rowA, rowB, rowBound)

    function applyVisibility(p) {
        const centered = p === 'v-center' || p === 'h-center'
        rowA.hidden = rowB.hidden = rowBound.hidden = !centered
    }
    return {
        el: wrap,
        update(s) {
            sourceB.value = String(s.sourceB)
            pattern.value = s.pattern
            aCenter.set(s.aCenter); bCenter.set(s.bCenter); boundary.set(s.centerPosition)
            applyVisibility(s.pattern)
        },
    }
}

function buildKeyControls(onKey, n) {
    const wrap = el('div', 'hd4-comp-panel')
    const sendNum = (k) => (v) => onKey?.({ [k]: Number(v) })
    let type = 'chroma'

    const source = select('KEY source channel', channelOptions(n, { off: true, still: true }), sendNum('sourceCh'))
    const typeSel = select('KEY type', [['chroma', 'Chroma'], ['luma', 'Luma']], (v) => { onKey?.({ type: v }); type = v; applyColours() })
    const colour = select('KEY colour', [['green', 'Green'], ['blue', 'Blue']],
        (v) => onKey?.(type === 'luma' ? { lumaColor: v } : { chromaColor: v }))
    const level = range('KEY level', 0, 255, 1, (v) => `${v}`, sendNum('level'))
    const gain = range('KEY gain', 0, 255, 1, (v) => `${v}`, sendNum('gain'))

    wrap.append(row('Source', source), row('Type', typeSel), row('Colour', colour), row('Level', level.el), row('Gain', gain.el))

    function applyColours() {
        const opts = type === 'luma' ? [['white', 'White'], ['black', 'Black']] : [['green', 'Green'], ['blue', 'Blue']]
        const prev = colour.value
        colour.textContent = ''
        for (const [v, t] of opts) colour.appendChild(opt(v, t))
        if ([...colour.options].some((o) => o.value === prev)) colour.value = prev
    }
    return {
        el: wrap,
        update(k) {
            type = k.type
            applyColours()
            source.value = String(k.sourceCh)
            typeSel.value = k.type
            colour.value = k.type === 'luma' ? k.lumaColor : k.chromaColor
            level.set(k.level); gain.set(k.gain)
        },
    }
}

// --- small DOM helpers ------------------------------------------------------

const pct = (v) => `${v > 0 ? '+' : ''}${v}%`
const pctPlain = (v) => `${v}%`

function el(tag, className) {
    const e = document.createElement(tag)
    if (className) e.className = className
    return e
}

function opt(value, text) {
    const o = document.createElement('option')
    o.value = value
    o.textContent = text
    return o
}

function row(labelText, control) {
    const r = el('label', 'hd4-comp-row')
    const lab = el('span', 'hd4-comp-label')
    lab.textContent = labelText
    r.append(lab, control)
    return r
}

function button(label, title, onClick) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'hd4-comp-btn'
    b.textContent = label
    b.title = title
    b.addEventListener('click', onClick)
    return b
}

function select(ariaLabel, options, onChange) {
    const s = document.createElement('select')
    s.className = 'hd4-comp-select'
    s.setAttribute('aria-label', ariaLabel)
    for (const [v, t] of options) s.appendChild(opt(v, t))
    s.addEventListener('change', () => onChange(s.value))
    return s
}

function range(ariaLabel, min, max, step, fmt, onChange) {
    const wrap = el('div', 'hd4-comp-range')
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.className = 'hd4-comp-slider'
    input.setAttribute('aria-label', ariaLabel)
    const readout = el('span', 'hd4-comp-readout')
    const setReadout = (v) => { readout.textContent = fmt(v) }
    input.addEventListener('input', () => { const v = Number(input.value); setReadout(v); onChange(v) })
    wrap.append(input, readout)
    return {
        el: wrap,
        set(v) { input.value = String(v); setReadout(v) },
    }
}
