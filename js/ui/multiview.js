// SPDX-License-Identifier: MIT
/**
 * Multiview — the four source monitors ([INPUT] view). Each tile
 * shows a channel's live canvas, its number + label, a fit toggle (for
 * media sources), and a categorized source picker: live cameras (one per
 * device), video/image files, and the pattern/fill library. The picker
 * reports the user's choice via onSelectSource; the app applies it.
 */
import { SOURCE_LIBRARY, presetByDsl } from '../sources/presets.js'
import { sourceKind } from '../sources/sourceModel.js'

export function buildMultiview(container, channels, { onSelectSource, onSetFit, getFit, cameras = [] } = {}) {
    container.innerHTML = ''
    const tiles = channels.map((ch, i) => buildTile(ch, i, onSelectSource, onSetFit, getFit ? getFit(i) : 'cover'))
    for (const t of tiles) container.appendChild(t.el)
    tiles.forEach((t) => t.updateCameras(cameras))

    return {
        refresh() {
            tiles.forEach((t, i) => {
                t.setLabel(channels[i].label)
                t.syncSelect(channels[i].source)
                t.setFitVisible(sourceKind(channels[i].source) === 'media')
            })
        },
        setCameras(list) {
            tiles.forEach((t, i) => { t.updateCameras(list); t.syncSelect(channels[i].source) })
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
    const picker = buildSourcePicker(index, onSelectSource)
    setSelectValue(picker.select, channel.source)

    bar.append(num, label, fit.el, picker.control)
    el.append(screen, bar)

    return {
        el,
        setLabel(text) { label.textContent = text },
        syncSelect(source) { setSelectValue(picker.select, source) },
        setFitVisible(on) { fit.el.style.display = on ? '' : 'none' },
        updateCameras(list) { picker.updateCameras(list) },
    }
}

/** Categorized source picker: cameras (per device) / files / library. */
function buildSourcePicker(index, onSelectSource) {
    const select = document.createElement('select')
    select.className = 'hd4-source-select'
    select.setAttribute('aria-label', `Channel ${index + 1} source`)

    const camGroup = document.createElement('optgroup')
    camGroup.label = 'Camera'

    const fileGroup = document.createElement('optgroup')
    fileGroup.label = 'File'
    for (const [value, text] of [['video', 'Video file…'], ['image', 'Image file…']]) {
        const o = document.createElement('option')
        o.value = value
        o.textContent = text
        fileGroup.appendChild(o)
    }

    select.append(camGroup, fileGroup)
    for (const cat of SOURCE_LIBRARY) {
        const g = document.createElement('optgroup')
        g.label = cat.category
        for (const item of cat.items) {
            const o = document.createElement('option')
            o.value = `shader:${item.name}`
            o.textContent = item.name
            g.appendChild(o)
        }
        select.appendChild(g)
    }

    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.style.display = 'none'

    select.addEventListener('change', () => {
        const v = select.value
        if (v === 'camera') {
            onSelectSource?.(index, { type: 'camera' })
        } else if (v.startsWith('camera:')) {
            onSelectSource?.(index, { type: 'camera', deviceId: v.slice(7) })
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
        } else if (v.startsWith('shader:')) {
            onSelectSource?.(index, { type: 'shader', name: v.slice(7) })
        }
    })

    function updateCameras(list) {
        const prev = select.value
        camGroup.textContent = ''
        const def = document.createElement('option')
        def.value = 'camera'
        def.textContent = 'Camera (default)'
        camGroup.appendChild(def)
        for (const cam of list || []) {
            const o = document.createElement('option')
            o.value = `camera:${cam.deviceId}`
            o.textContent = cam.label
            camGroup.appendChild(o)
        }
        // Keep the prior selection if it still exists.
        if ([...select.options].some((o) => o.value === prev)) select.value = prev
    }

    const control = document.createElement('span')
    control.className = 'hd4-source-control'
    control.append(select, fileInput)
    return { control, select, updateCameras }
}

/** Reflect the channel's actual source in the picker where we can. */
function setSelectValue(select, source) {
    const has = (v) => [...select.options].some((o) => o.value === v)
    if (source?.type === 'shader') {
        const preset = presetByDsl(source.dsl)
        if (preset && has(`shader:${preset.name}`)) select.value = `shader:${preset.name}`
    } else if (source?.type === 'camera') {
        const byDevice = `camera:${source.deviceId}`
        select.value = (source.deviceId && has(byDevice)) ? byDevice : 'camera'
    } else if (source?.type === 'video' || source?.type === 'image') {
        select.value = source.type
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
