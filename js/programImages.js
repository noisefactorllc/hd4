// SPDX-License-Identifier: MIT
/**
 * Program images — a shader program names an image as
 * `media(url: "image:<sha256>")`, the same reference every Noise Factor app
 * uses, so a program and its images move between apps.
 *
 * The engine's media() has no `url` argument. HD4 removes it before it
 * compiles a program (and before it diagnoses one), then binds each named
 * image as its media step's texture. Images are images: they are Blobs named
 * by the SHA-256 of their bytes, never text. While HD4 is online they come
 * from the Seance session (setImageResolver); each one stays in memory for
 * the page, so a recompile and the next session can still find it.
 */

// media( ... ) with at most one level of nested parentheses in its arguments.
const MEDIA_CALL = /\bmedia\s*\(((?:[^()]|\([^()]*\))*)\)/gi
const URL_ARG = /\burl\s*:\s*(?:"[^"]*"|'[^']*')\s*,?/i
const IMAGE_REF = /image:([a-f0-9]{64})/g
const IMAGE_URL = /^image:([a-f0-9]{64})$/
const MEDIA_EFFECTS = new Set(['media', 'synth.media', 'synth/media'])

const images = new Map() // image id -> Blob
let resolver = null

/**
 * The program without the `url` argument of its media() calls. Lines and
 * columns of everything else stay where they were.
 */
export function stripMediaUrls(dsl) {
    return String(dsl ?? '').replace(MEDIA_CALL, (call, args) => {
        if (!URL_ARG.test(args)) return call
        const kept = args
            .replace(URL_ARG, '')
            .replace(/,\s*$/, '')
            .replace(/^\s*,\s*/, '')
            .trim()
        return `media(${kept})`
    })
}

/** The ids of the images a program names, each once, in order. */
export function programImageIds(dsl) {
    return [...new Set([...String(dsl ?? '').matchAll(IMAGE_REF)].map((match) => match[1]))]
}

/** Where images come from beyond this page's memory (the Seance session), or null. */
export function setImageResolver(fn) {
    resolver = typeof fn === 'function' ? fn : null
}

/** Keep an image's bytes for the page. */
export function rememberImage(id, blob) {
    if (IMAGE_URL.test(`image:${id}`) && blob instanceof Blob) images.set(id, blob)
}

/** An image this page holds, or null. */
export function heldImage(id) {
    return images.get(id) || null
}

/** An image's bytes: from this page's memory, else from the resolver. */
export async function resolveImage(id) {
    const held = images.get(id)
    if (held) return held
    if (!resolver) throw new Error(`image ${id} is not available offline`)
    const blob = await resolver(id)
    images.set(id, blob)
    return blob
}

function decode(blob) {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    return new Promise((resolve, reject) => {
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('the image could not be decoded'))
        image.src = url
    }).finally(() => URL.revokeObjectURL(url))
}

/**
 * Bind every image the program names as its media step's texture. Call after
 * the (url-free) program compiled. isCurrent() turns false once a newer
 * compile owns the renderer; its pipeline is then left alone. Resolves to the
 * ids that could not be bound; their media steps stay empty.
 */
export async function bindProgramImages(renderer, dsl, extractEffectsFromDsl, isCurrent = () => true) {
    const ids = programImageIds(dsl)
    if (!ids.length) return []
    let effects
    try {
        effects = (extractEffectsFromDsl(dsl) || [])
            .filter((effect) => MEDIA_EFFECTS.has(effect.effectKey || effect.fullName || effect.name))
    } catch (err) {
        console.warn('[hd4] the program images were not bound', err?.message || err)
        return ids
    }
    const missing = []
    for (const effect of effects) {
        const raw = effect.rawKwargs?.url ?? effect.args?.url
        const url = typeof raw === 'string' ? raw : raw?.type === 'String' ? raw.value : null
        const id = IMAGE_URL.exec(url || '')?.[1]
        if (!id) continue
        let image
        try {
            image = await decode(await resolveImage(id))
        } catch (err) {
            console.warn(`[hd4] program image ${id} was not bound`, err?.message || err)
            missing.push(id)
            continue
        }
        if (!isCurrent()) return missing
        const step = effect.temp ?? effect.stepIndex
        try {
            renderer.updateTextureFromSource(`imageTex_step_${step}`, image, { flipY: false })
            renderer.applyStepParameterValues?.({
                [`step_${step}`]: { imageSize: [image.naturalWidth || image.width, image.naturalHeight || image.height] },
            })
        } catch (err) {
            console.warn(`[hd4] program image ${id} was not bound`, err?.message || err)
            missing.push(id)
        }
    }
    return missing
}
