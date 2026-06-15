// SPDX-License-Identifier: MIT
/**
 * Multiview — the four source monitors ([INPUT] view). Each tile
 * shows a channel's live canvas, its number + label, and a source
 * selector (shader presets, camera, or a video/image file). The selector
 * reports the user's choice via onSelectSource; the app applies it.
 */
import { SHADER_PRESETS } from '../sources/presets.js'
import { sourceKind } from '../sources/sourceModel.js'

export function buildMultiview(container, channels, { onSelectSource, onSetFit, getFit } = {}) {
    container.innerHTML = ''
    const tiles = channels.map((ch, i) => buildTile(ch, i, onSelectSource, onSetFit, getFit ? getFit(i) : 'cover'))
    for (const t of tiles) container.appendChild(t.el)

    return {
        refresh() {
            tiles.forEach((t, i) => {
                t.setLabel(channels[i].label)
                t.syncSelect(channels[i].source)
                t.setFitVisible(sourceKind(channels[i].source) === 'media')
            })
        },
    }
}

function buildTile(channel, index, onSelectSource, onSetFit, initialFit) {
    const el = document.createElement('div')
    el.className = 'hd4-monitor'
    el.dataset.channel = String(channel.id)

    const screen = document.createElement('div')
    screen.className = 'hd4-monitor-screen'
    channel.canvas.classList.add('hd4-monitor-canvas')
    screen.appendChild(channel.canvas)

    const bar = document.createElement('div')
    bar.className = 'hd4-monitor-bar'

    const num = document.createElement('span')
    num.className = 'hd4-monitor-num'
    num.textContent = String(channel.id)

    const label = document.createElement('span')
    label.className = 'hd4-monitor-label'
    label.textContent = channel.label

    const fit = buildFitToggle(index, onSetFit, initialFit)
    const { control, select } = buildSourceSelect(index, onSelectSource)
    setSelectValue(select, channel.source)

    bar.append(num, label, fit.el, control)
    el.append(screen, bar)

    return {
        el,
        setLabel(text) { label.textContent = text },
        syncSelect(source) { setSelectValue(select, source) },
        setFitVisible(on) { fit.el.style.display = on ? '' : 'none' },
    }
}

/** Toggle a media channel between zoom/crop (cover) and scale (contain). */
function buildFitToggle(index, onSetFit, initialMode = 'cover') {
    let mode = initialMode === 'contain' ? 'contain' : 'cover'
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'hd4-fit-btn'
    el.title = 'Fit: zoom/crop vs scale-to-fit'
    el.setAttribute('aria-label', `Channel ${index + 1} fit mode`)
    const render = () => { el.textContent = mode === 'cover' ? 'Crop' : 'Scale' }
    render()
    el.addEventListener('click', () => {
        mode = mode === 'cover' ? 'contain' : 'cover'
        render()
        onSetFit?.(index, mode)
    })
    return { el }
}

function buildSourceSelect(index, onSelectSource) {
    const select = document.createElement('select')
    select.className = 'hd4-source-select'
    select.setAttribute('aria-label', `Channel ${index + 1} source`)

    const shaderGroup = document.createElement('optgroup')
    shaderGroup.label = 'Shader'
    SHADER_PRESETS.forEach((p, pi) => {
        const o = document.createElement('option')
        o.value = `shader:${pi}`
        o.textContent = p.name
        shaderGroup.appendChild(o)
    })

    const inputGroup = document.createElement('optgroup')
    inputGroup.label = 'Input'
    for (const [value, text] of [['camera', 'Camera'], ['video', 'Video file…'], ['image', 'Image file…']]) {
        const o = document.createElement('option')
        o.value = value
        o.textContent = text
        inputGroup.appendChild(o)
    }

    select.append(shaderGroup, inputGroup)

    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.style.display = 'none'

    select.addEventListener('change', () => {
        const v = select.value
        if (v.startsWith('shader:')) {
            onSelectSource?.(index, { type: 'shader', presetIndex: Number(v.slice(7)) })
        } else if (v === 'camera') {
            onSelectSource?.(index, { type: 'camera' })
        } else if (v === 'video' || v === 'image') {
            fileInput.accept = v === 'video' ? 'video/*' : 'image/*'
            fileInput.onchange = () => {
                const file = fileInput.files?.[0]
                if (file) {
                    const type = file.type.startsWith('video/') ? 'video' : 'image'
                    onSelectSource?.(index, { type, file })
                }
                fileInput.value = ''
            }
            fileInput.click()
        }
    })

    const control = document.createElement('span')
    control.className = 'hd4-source-control'
    control.append(select, fileInput)
    return { control, select }
}

/** Reflect the channel's actual source in the dropdown where we can. */
function setSelectValue(select, source) {
    if (source?.type === 'shader') {
        const idx = SHADER_PRESETS.findIndex((p) => p.dsl === source.dsl)
        if (idx >= 0) select.value = `shader:${idx}`
    } else if (source?.type === 'camera') {
        select.value = 'camera'
    } else if (source?.type === 'video' || source?.type === 'image') {
        select.value = source.type
    }
}
